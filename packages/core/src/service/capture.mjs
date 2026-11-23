import { extractedItems, extractionOutputTokens } from "../capture/capture-input.mjs";
import { createCaptureDeadline } from "../capture/deadline.mjs";
import { callModel, emitDiagnostic } from "../capture/model-call.mjs";
import { detach, identifier, isWellFormedText, validateDenseArray, validateObject } from "../capture/validate.mjs";
import { CoreError, isErrorCode } from "../errors.mjs";
import { plainExtractionSpec } from "../extraction/extraction.mjs";
import { allDigests, fingerprintMemoryPassages } from "../privacy/fingerprint.mjs";
import { boundedText, normalizeForHash, prepareCoreText } from "../privacy/text.mjs";
import { requiresLegacyMacDomain, withholdsAnyPassage } from "../privacy/withholds.mjs";
import { entry, entryError, scopeOf } from "./entry.mjs";
import { pauseResult } from "./pause.mjs";
import { hashesOf, validWriteEmbedding } from "./writes.mjs";

/** @import {CaptureKey, CaptureMessage, FinishItem, Tx} from "../ports/index.d.ts" */
/** @typedef {ReturnType<typeof createCaptureDeadline>} CaptureDeadline */

// Engine core/capture.mjs:144 gives a plain capture a 125-second admission lease.
const DEFAULT_LEASE_MS = 125_000;
const DEFAULT_EXTRACT_MS = 30_000;

/** @param {unknown} raw @returns {import("../ports/capture.d.ts").CaptureMessage} */
function prepareMessage(raw) {
  const { id, role, content, occurredAtMs } = validateObject(raw, ["id", "role", "content", "occurredAtMs"]);
  if (!isWellFormedText(id) || !id || id.length > 512 ||
      (role !== "user" && role !== "assistant") || !isWellFormedText(content) ||
      (occurredAtMs !== null && (typeof occurredAtMs !== "number" || !Number.isSafeInteger(occurredAtMs)))) {
    throw new CoreError("invalid_input");
  }
  try {
    // Use the same normalization, redaction, and bounds as captureSnapshot.
    return { id, role, content: boundedText(content, 4000), occurredAtMs };
  } catch (error) {
    if (error instanceof CoreError && error.code === "invalid_text") throw new CoreError("invalid_input");
    throw error;
  }
}

/** @param {AbortSignal | undefined} signal @param {CaptureDeadline} deadline */
function checkCaptureAbort(signal, deadline) {
  deadline.check();
  if (signal?.aborted) throw new CoreError("model_cancelled");
}

/**
 * Post-validation INTAKE seam. Convert validated extraction into finish candidates.
 * @param {Array<ReturnType<typeof extractedItems>[number] & {rawContent: string}>} candidates
 * @param {readonly CaptureMessage[]} messages
 * @param {CaptureKey} key
 * @param {import("./index.d.mts").MemoryServiceDeps} deps
 * @param {CaptureDeadline} deadline
 * @param {AbortSignal} [signal]
 */
async function prepareCaptureCandidatesForFinish(candidates, messages, key, deps, deadline, signal) {
  if (candidates.length === 0) return [];
  const { storage, clock, gate, embedder } = deps;
  const { owner } = key.scope;
  const fingerprintKey = await storage.keys.userKey(owner);
  const sources = new Map(messages.map(message => [message.id, message]));
  const prepared = await Promise.all(candidates.map(async candidate => {
    const { rawContent: raw, kind, confidence } = candidate;
    const content = prepareCoreText(raw);
    if (!content || content === "[REDACTED]" || content.length > 600) throw new CoreError("invalid_model_output");
    const [{ textHash }, digests, passages] = await Promise.all([
      hashesOf(raw),
      fingerprintKey ? allDigests(content, fingerprintKey) : undefined,
      fingerprintMemoryPassages(raw, content, fingerprintKey, text => clock.sha256Hex(text)),
    ]);
    const receipts = candidate.receipts.map(({ client, sessionId, eventId: messageId }) => {
      const message = sources.get(messageId);
      if (!message) throw new CoreError("internal_error");
      return { client, sessionId, messageId, role: message.role, occurredAtMs: message.occurredAtMs };
    });
    return { item: { content, kind, confidence, textHash, ...(digests && { digests }), receipts }, passages };
  }));

  const texts = prepared.map(({ item }) => normalizeForHash(item.content));
  const { model, dimensions } = embedder;
  checkCaptureAbort(signal, deadline);
  const timeout = AbortSignal.timeout(deadline.remainingMs());
  const options = { signal: signal ? AbortSignal.any([signal, timeout]) : timeout };
  /** @type {Float32Array[]} */
  let vectors;
  await gate.assertOpen(owner, "dispatch");
  try {
    if (timeout.aborted) throw new CoreError("model_timeout");
    checkCaptureAbort(signal, deadline);
    vectors = await embedder.embed(texts, options);
  } catch (error) {
    if (timeout.aborted) throw new CoreError("model_timeout");
    checkCaptureAbort(signal, deadline);
    throw error;
  }
  if (timeout.aborted) throw new CoreError("model_timeout");
  checkCaptureAbort(signal, deadline);
  if ((await storage.keys.userKey(owner))?.id !== fingerprintKey?.id) throw new CoreError("fingerprint_key_mismatch");

  return prepared.map(({ item, passages }, index) => {
    const vector = Array.isArray(vectors) && vectors.length <= prepared.length ? vectors[index] : undefined;
    const embedding = validWriteEmbedding(vector, dimensions) ? { model, vector } : null;
    if (storage.capabilities.embeddingRequiredOnInsert && embedding === null) throw new CoreError("embedding_failed");
    return { item: { ...item, embedding }, passages };
  });
}

/**
 * @param {import("./index.d.mts").MemoryServiceDeps} deps
 * @returns {Pick<import("../ports/host.d.ts").MemoryService, "enqueueCapture" | "captureStatus"> & import("./index.d.mts").CaptureRunner}
 */
export function captureMethods(deps) {
  const { storage, clock, model, gate, config, diagnostics } = deps;
  const { uow, pause, suppressions, capture, sessionLineage, raw, capabilities } = storage;
  return {
    enqueueCapture: entry(async (inputScope, input) => {
      const scope = scopeOf(inputScope);
      const admit = capture?.admit;
      if (typeof admit !== "function") throw new CoreError("capability_unavailable");
      const { client: inputClient, sessionId: inputSession, eventId: inputEvent, messages } =
        validateObject(input, ["client", "sessionId", "eventId", "messages"]);
      const client = identifier(inputClient);
      const sessionId = identifier(inputSession);
      const eventId = identifier(inputEvent);
      const prepared = validateDenseArray(messages, 1, 24).map(prepareMessage);
      if (new Set(prepared.map(message => message.id)).size !== prepared.length ||
          prepared.reduce((sum, message) => sum + message.content.length, 0) > 20000) {
        throw new CoreError("invalid_input");
      }
      // Canonical JSON is [client, sessionId, eventId, [[id, role, redactedContent, occurredAtMs], ...]] in message order.
      const payloadDigest = await clock.sha256Hex(JSON.stringify([client, sessionId, eventId,
        prepared.map(({ id, role, content, occurredAtMs }) => [id, role, content, occurredAtMs])]));
      const key = { scope, client, sessionId, eventId, payloadDigest };
      return uow.run(scope.owner, { pauseLock: true }, async tx => {
        if (pauseResult(await pause.get(tx, scope.owner)).paused) return { status: "paused" };
        const session = { client, sessionId };
        const { blockedSession } = await suppressions.snapshot(tx, scope, session);
        if (blockedSession === true) return { status: "blocked" };
        if (blockedSession !== false) throw new CoreError("internal_error");
        if (capabilities.sessionLineage) {
          if (typeof sessionLineage?.isFenced !== "function") throw new CoreError("capability_unavailable");
          const { fenced } = await sessionLineage.isFenced(tx, scope, session);
          if (fenced === true) return { status: "blocked" };
          if (fenced !== false) throw new CoreError("internal_error");
        }
        const { status } = await admit.call(capture, tx, key, prepared);
        switch (status) {
          case "duplicate": case "processing": case "rawReplay":
            return { status: "duplicate" };
          case "admitted":
            if (capabilities.rawArchive) {
              if (typeof raw?.recordLineage !== "function") throw new CoreError("capability_unavailable");
              await raw.recordLineage(tx, key, prepared);
            }
            return { status: "accepted" };
          default:
            throw new CoreError("internal_error");
        }
      });
    }),
    captureStatus: entry(async (inputScope, inputEvent, options) => {
      const scope = scopeOf(inputScope);
      const readStatus = capture?.status;
      if (typeof readStatus !== "function") throw new CoreError("capability_unavailable");
      const eventId = identifier(inputEvent);
      const { client } = options === undefined ? {} : validateObject(options, ["client"]);
      const selectedClient = client === undefined ? undefined : identifier(client);
      return uow.run(scope.owner, { readOnly: true }, async tx => {
        const result = await readStatus.call(capture, tx, scope, eventId, selectedClient);
        if (result == null) return { status: "unknown" };
        const { status } = result;
        switch (status) {
          case "pending": case "done": case "unknown":
            return { status };
          case "failed": {
            const code = result.code;
            return code === undefined ? { status } : { status, code: isErrorCode(code) ? code : "internal_error" };
          }
          default:
            throw new CoreError("internal_error");
        }
      });
    }),
    runCapture: entry(async (inputScope, input, options) => {
      const scope = scopeOf(inputScope);
      const { owner } = scope;
      const { client: inputClient, sessionId: inputSession, eventId: inputEvent } =
        validateObject(input, ["client", "sessionId", "eventId"]);
      const client = identifier(inputClient);
      const sessionId = identifier(inputSession);
      const eventId = identifier(inputEvent);
      const load = capture?.load;
      const readStatus = capture?.status;
      const archive = capabilities.rawArchive ? raw : undefined;
      if (typeof load !== "function" || typeof readStatus !== "function" ||
          [capture.claim, capture.beginDispatch, capture.finish, capture.abandon, capture.eligible, capture.assertEligible,
            suppressions?.snapshot, storage.keys?.userKey].some(method => typeof method !== "function") ||
          (capabilities.rawArchive && (typeof archive?.archiveAllowed !== "function" || typeof archive.archive !== "function"))) {
        throw new CoreError("capability_unavailable");
      }
      const readLedgerStatus = readStatus.bind(capture);
      const lock = { pauseLock: true };
      const preflight = await uow.run(owner, lock, async tx => pauseResult(await pause.get(tx, owner)));
      if (preflight.paused) return { status: "paused" };

      // Status has no FinishResult. A later invocation can obtain it by rawReplay.
      async function resolveUnknownCommit() {
        let failureCode = "commit_outcome_unknown";
        try {
          const result = await uow.run(owner, { readOnly: true }, tx => readLedgerStatus(tx, scope, eventId, client));
          if (result?.status === "failed" && isErrorCode(result.code)) failureCode = result.code;
        } catch { /* Keep the ambiguous outcome when the ledger cannot be read. */ }
        return /** @type {const} */ ({ status: "failed", code: failureCode });
      }

      let claimed;
      try {
        claimed = await uow.run(owner, lock, async tx => {
          if (pauseResult(await pause.get(tx, owner)).paused) return /** @type {const} */ ({ status: "paused" });
          const admission = await load.call(capture, tx, { scope, client, sessionId, eventId });
          if (admission === null) return /** @type {const} */ ({ status: "failed", code: "not_found" });
          const { key, messages } = admission;
          const claim = await capture.claim(tx, key, messages, { leaseMs: config.leaseMs ?? DEFAULT_LEASE_MS });
          switch (claim.status) {
            case "rawReplay": return /** @type {const} */ ({ status: "done", result: claim.result });
            case "duplicate": case "processing": return { status: claim.status };
            case "claimed": {
              const eligible = await capture.eligible(tx, key, messages);
              const positions = /** @type {number[]} */ (validateDenseArray(eligible, 0, messages.length));
              if (new Set(positions).size !== positions.length ||
                  positions.some(position => !Number.isSafeInteger(position) || position < 0 || position >= messages.length)) {
                throw new CoreError("internal_error");
              }
              return { ...claim, key, positions, messages: positions.map(position => messages[position]) };
            }
            default: throw new CoreError("internal_error");
          }
        });
      } catch (error) {
        const failure = entryError(error);
        if (failure.code === "commit_outcome_unknown") return resolveUnknownCommit();
        throw failure;
      }
      if (claimed.status !== "claimed") return claimed;
      const { key, positions, messages } = claimed;
      let { token } = claimed;

      /** @param {Tx} tx */
      async function pauseChanged(tx) {
        const state = pauseResult(await pause.get(tx, owner));
        return state.paused || state.generation !== preflight.generation;
      }

      /** @template T @param {(tx: Tx) => Promise<T>} work */
      function runAtGeneration(work) {
        return uow.run(owner, lock, async tx => {
          if (!await pauseChanged(tx)) return work(tx);
          await capture.abandon(tx, token, { code: "capture_paused", retryable: false });
          return null;
        });
      }

      try {
        if (positions.length === 0) {
          const result = await runAtGeneration(tx => capture.finish(tx, token, []));
          return result === null ? { status: "paused" } : { status: "done", result };
        }

        const dispatch = await runAtGeneration(tx => capture.beginDispatch(tx, token));
        if (dispatch === null) return { status: "paused" };
        token = dispatch.token;
        const signal = options?.signal;
        const deadline = createCaptureDeadline(config.deadlines?.extract ?? DEFAULT_EXTRACT_MS, clock);
        const { system, input } = plainExtractionSpec(messages);
        const output = await callModel(model, "extract", { system, input, maxOutputTokens: extractionOutputTokens(input.messages) },
          { owner, gate, deadline, signal, onDiagnostic: diagnostics });
        // Hosted ingest.ts:123–125 and index.ts:37. extractedItems validates non-empty source indices.
        const validated = extractedItems(output, { client, sessionId, messages },
          undefined, reason => emitDiagnostic(diagnostics, "extract", "core_validation", reason));
        // The validator preserves order. Keep the original spelling for the historical digests.
        const rawCandidates = /** @type {{items: Array<{content: string}>}} */ (output).items;
        const candidates = validated.map((candidate, index) => ({ ...candidate, rawContent: rawCandidates[index].content }))
          .filter(candidate => candidate.confidence >= 0.5);
        const prepared = await prepareCaptureCandidatesForFinish(candidates, messages, key, deps, deadline, signal);

        const completed = await runAtGeneration(async tx => {
          checkCaptureAbort(signal, deadline);
          await capture.assertEligible(tx, key, positions);
          const snapshot = await suppressions.snapshot(tx, scope, {
            client, sessionId, passages: prepared.flatMap(candidate => candidate.passages),
          });
          if (snapshot.blockedSession !== false || snapshot.blockedMessages.length) throw new CoreError("suppressed");
          const facts = snapshot.passages.map(({ fact }) => fact);
          if (facts.some(fact => fact?.owner !== owner || (fact.namespace ?? null) !== scope.namespace)) {
            throw new CoreError("internal_error");
          }
          const legacyMac = facts.some(requiresLegacyMacDomain);
          /** @type {FinishItem[]} */
          const items = [];
          for (const candidate of prepared) {
            if (!legacyMac && !withholdsAnyPassage(candidate.passages, facts)) items.push(candidate.item);
          }
          checkCaptureAbort(signal, deadline);
          const result = await capture.finish(tx, token, items);
          if (archive && await archive.archiveAllowed(tx, key) === true) await archive.archive(tx, key, messages);
          return { result, withheld: prepared.length - items.length };
        });
        if (completed === null) return { status: "paused" };
        for (let i = 0; i < completed.withheld; i++) emitDiagnostic(diagnostics, "extract", "core_finish", "candidate_withheld");
        return { status: "done", result: completed.result };
      } catch (error) {
        const failure = entryError(error);
        if (failure.code === "commit_outcome_unknown") return resolveUnknownCommit();
        let paused = failure.kind === "paused";
        try {
          await uow.run(owner, lock, async tx => {
            paused = await pauseChanged(tx) || paused;
            await capture.abandon(tx, token, paused ? { code: "capture_paused", retryable: false }
              : { code: failure.code, retryable: failure.kind === "retryable" });
          });
        } catch (cleanupError) {
          if (entryError(cleanupError).code === "commit_outcome_unknown") return resolveUnknownCommit();
          // A stale or failed cleanup must not replace the original outcome or release a successor.
        }
        return paused ? { status: "paused" } : { status: "failed", code: failure.code };
      }
    }, undefined, ([scope, selection, options]) => {
      // AbortSignal is a live cancellation capability. Snapshot the input data once and
      // derive a signal that follows it without relying on properties on the caller's object.
      const input = detach(/** @type {const} */ ([scope, selection]), "invalid_input");
      if (options === undefined) return [...input, undefined];
      const fields = validateObject(options, ["signal"]);
      const signal = Object.hasOwn(fields, "signal") ? fields.signal : undefined;
      try {
        return [...input, { signal: signal === undefined ? undefined : AbortSignal.any([/** @type {AbortSignal} */ (signal)]) }];
      } catch { throw new CoreError("invalid_input"); }
    }),
  };
}

import { createCaptureDeadline } from "../capture/deadline.mjs";
import { emitDiagnostic } from "../capture/model-call.mjs";
import { countTokens, MODEL_OUTPUT_TOKENS, modelRequestText } from "../capture/request-size.mjs";
import { detach, identifier, isWellFormedText, validateDenseArray, validateObject } from "../capture/validate.mjs";
import { CoreError, isErrorCode } from "../errors.mjs";
import { plainExtractionSpec, validatePlainCandidates } from "../extraction/extraction.mjs";
import { fingerprintMemoryPassages } from "../privacy/fingerprint.mjs";
import { redactCore } from "../privacy/redact.mjs";
import { cleanContent, normalizeForHash, prepareCoreText } from "../privacy/text.mjs";
import { requiresLegacyMacDomain, withholdsAnyPassage } from "../privacy/withholds.mjs";
import { entry, entryError, scopeOf } from "./entry.mjs";
import { pauseResult } from "./pause.mjs";
import { prepareWriteText, validWriteEmbedding } from "./writes.mjs";

/** @import {CaptureKey, CaptureMessage, RetainedDigester, Tx} from "../ports/index.d.ts" */
/** @import {CallOptions} from "../ports/common.d.ts" */
/** @import {ModelRequest} from "../ports/model.d.ts" */
/** @typedef {ReturnType<typeof createCaptureDeadline>} CaptureDeadline */
/** @typedef {Awaited<ReturnType<import("../ports/privacy.d.ts").FingerprintKeyProvider["userKey"]>>} FingerprintKey */
/** @typedef {import("./index.d.mts").MemoryServiceDeps} Deps */

// Engine core/capture.mjs:144 gives a plain capture a 125-second admission lease.
const DEFAULT_LEASE_MS = 125_000;
const DEFAULT_EXTRACT_MS = 30_000;
// Hosted openai.ts:83–91 leaves the output budget at the default model's 32,768 tokens.
// The port requires an explicit budget. The serialized bound also allows JSON escaping
// of 20 candidates with 600 units each, plus fields and source indices.
const HOSTED_EXTRACT_OUTPUT_TOKENS = 32_768;
// The provider budget allows 1,024 tokens for schema and framing above the local count.
const EXTRACT_FRAMING_TOKENS = 1024;
const MAX_EXTRACT_OUTPUT_UNITS = 80_000;

/** @param {unknown} raw @returns {CaptureMessage} */
function validateMessage(raw) {
  const { id, role, content, occurredAtMs } = validateObject(raw, ["id", "role", "content", "occurredAtMs"]);
  if (!isWellFormedText(id) || !id || id.length > 200 ||
      (role !== "user" && role !== "assistant") || typeof content !== "string" || !content || content.length > 20_000 ||
      (occurredAtMs !== null && (typeof occurredAtMs !== "number" || !Number.isSafeInteger(occurredAtMs)))) {
    throw new CoreError("invalid_input");
  }
  return { id, role, content, occurredAtMs };
}

/** @param {string} cleanedContent */
export function prepareMessageContent(cleanedContent) {
  return redactCore(cleanedContent.normalize("NFKC"));
}

/** @param {unknown} raw */
function prepareMessage(raw) {
  const message = validateMessage(raw);
  const originalContent = message.content;
  if (!isWellFormedText(originalContent)) throw new CoreError("invalid_input");
  return { message: { ...message, content: prepareMessageContent(cleanContent(originalContent)) }, originalContent };
}

/** @param {import("../ports/privacy.d.ts").SuppressionSnapshot["passages"]} passages */
export function captureTextWithholding(passages) {
  const textFacts = passages.map(({ fact }) => fact);
  const legacyKeyUnavailable = textFacts.some(requiresLegacyMacDomain);
  // Historical aliases are used for suppression only.
  /** @param {string} originalContent @param {string} preparedContent @param {FingerprintKey | null} key */
  const matches = async (originalContent, preparedContent, key) =>
    withholdsAnyPassage(await fingerprintMemoryPassages(originalContent, preparedContent, key), textFacts);
  return { legacyKeyUnavailable, matches: textFacts.length ? matches : null };
}

/** @param {AbortSignal | undefined} signal @param {CaptureDeadline} deadline */
function checkCaptureAbort(signal, deadline) {
  deadline.check();
  if (signal?.aborted) throw new CoreError("model_cancelled");
}

/** @param {AbortSignal | undefined} caller @param {CaptureDeadline} deadline */
function captureTransport(caller, deadline) {
  checkCaptureAbort(caller, deadline);
  const timeout = AbortSignal.timeout(deadline.remainingMs());
  const signal = caller ? AbortSignal.any([caller, timeout]) : timeout;
  function check() {
    if (timeout.aborted && signal.reason === timeout.reason) throw new CoreError("model_timeout");
    checkCaptureAbort(caller, deadline);
  }
  return { signal, check };
}

/** @template T @param {AbortSignal} signal @param {Promise<T>} pending */
async function untilAborted(signal, pending) {
  let onAbort = () => {};
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  try { return await Promise.race([pending, aborted]); }
  finally { signal.removeEventListener("abort", onAbort); }
}

/**
 * @param {unknown} raw
 * @param {{sourceCount: number, itemLimit: number}} policy
 * @param {CallOptions["onDiagnostic"]} diagnostics
 */
function hostedCandidates(raw, policy, diagnostics) {
  let output;
  try {
    output = structuredClone(raw);
    const serialized = JSON.stringify(output);
    if (typeof serialized !== "string" || serialized.length > MAX_EXTRACT_OUTPUT_UNITS) {
      throw new CoreError("invalid_model_output");
    }
  } catch {
    emitDiagnostic(diagnostics, "extract", "core_call", "output_bounds");
    throw new CoreError("invalid_model_output");
  }
  try {
    // Hosted openai.ts:101–109 checks distinct, non-empty, in-range indices.
    // Hosted ingest.ts:122–125 and index.ts:37 apply the inclusive confidence floor.
    const validated = validatePlainCandidates(output, policy);
    const { items } = /** @type {{items: Array<{content: string}>}} */ (output);
    return validated
      .map((candidate, index) => ({ ...candidate, rawContent: items[index].content }))
      .filter(candidate => candidate.confidence >= 0.5);
  } catch (error) {
    const { code } = /** @type {{code: string}} */ (error);
    emitDiagnostic(diagnostics, "extract", "core_validation", code);
    throw new CoreError("invalid_model_output");
  }
}

/**
 * @param {ReturnType<typeof hostedCandidates>} candidates
 * @param {readonly CaptureMessage[]} messages
 * @param {CaptureKey} key
 * @param {FingerprintKey} fingerprintKey
 * @param {Deps["clock"]} clock
 * @param {readonly RetainedDigester[] | undefined} digesters
 */
function prepareCaptureCandidates(candidates, messages, { client, sessionId }, fingerprintKey, clock, digesters) {
  return Promise.all(candidates.map(async candidate => {
    const { rawContent: raw, kind, confidence } = candidate;
    const content = prepareCoreText(raw);
    if (!content || content === "[REDACTED]" || content.length > 600) throw new CoreError("invalid_model_output");
    const { query: { textHash, digests }, passages } =
      await prepareWriteText(raw, content, fingerprintKey, text => clock.sha256Hex(text), digesters);
    const receipts = candidate.sourceIndices.map(index => {
      const { id: messageId, role, occurredAtMs } = messages[index];
      return { client, sessionId, messageId, role, occurredAtMs };
    });
    return { item: { content, kind, confidence, textHash, ...(digests && { digests }), receipts }, passages };
  }));
}

/** @typedef {Awaited<ReturnType<typeof prepareCaptureCandidates>>[number]} PreparedCandidate */
/**
 * @template {PreparedCandidate} T
 * @param {T[]} candidates
 * @param {import("../ports/privacy.d.ts").SuppressionSnapshot} snapshot
 * @param {CaptureKey["scope"]} scope
 * @param {Set<string>} excludedSources
 */
function filterCaptureCandidates(candidates, snapshot, scope, excludedSources) {
  if (snapshot.blockedSession !== false || snapshot.blockedMessages.length) throw new CoreError("suppressed");
  const facts = snapshot.passages.map(({ fact }) => fact);
  if (facts.some(fact => fact?.owner !== scope.owner || (fact.namespace ?? null) !== scope.namespace)) {
    throw new CoreError("internal_error");
  }
  return candidates.filter(candidate => {
    if (!withholdsAnyPassage(candidate.passages, facts)) return true;
    for (const { messageId } of candidate.item.receipts) excludedSources.add(messageId);
    return false;
  });
}

/**
 * @param {PreparedCandidate[]} prepared
 * @param {CaptureKey["scope"]["owner"]} owner
 * @param {Deps} deps
 * @param {CaptureDeadline} deadline
 * @param {AbortSignal | undefined} caller
 */
async function embedCaptureCandidates(prepared, owner, { storage, gate, embedder }, deadline, caller) {
  if (prepared.length === 0) return [];
  const texts = prepared.map(({ item }) => normalizeForHash(item.content));
  const { model, dimensions } = embedder;
  const { signal, check } = captureTransport(caller, deadline);
  /** @type {Float32Array[]} */
  let vectors;
  await gate.assertOpen(owner, "dispatch");
  try {
    check();
    vectors = await untilAborted(signal, embedder.embed(texts, { signal }));
  } catch (error) {
    check();
    throw error;
  }
  check();

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
  const { uow, pause, suppressions, capture, sessionLineage, raw, keys, capabilities } = storage;
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
      const incoming = validateDenseArray(messages, 1, 24).map(prepareMessage);
      const prepared = incoming.map(({ message }) => message);
      if (new Set(prepared.map(message => message.id)).size !== prepared.length) {
        throw new CoreError("invalid_input");
      }
      // Keep the established digest canonicalization for redelivery of existing admissions.
      const payloadDigest = await clock.sha256Hex(JSON.stringify([client, sessionId, eventId,
        prepared.map(({ id, role, content, occurredAtMs }) => [id, role, content.replace(/\s+/gu, " ").trim(), occurredAtMs])]));
      const key = { scope, client, sessionId, eventId, payloadDigest };
      const preparedKey = capabilities.fingerprintKey && !keys.userKeyForWrite ? await keys.userKey(scope.owner) : null;
      const digesters = await keys?.retainedDigesters?.(scope.owner);
      const preparedEvidence = digesters?.length ? await Promise.all(incoming.map(({ message, originalContent }) =>
        fingerprintMemoryPassages(originalContent, message.content, preparedKey, undefined, digesters))) : null;
      return uow.run(scope.owner, { pauseLock: true }, async tx => {
        if (pauseResult(await pause.get(tx, scope.owner)).paused) return { status: "paused" };
        const session = { client, sessionId };
        const { blockedSession, passages } = await suppressions.snapshot(tx, scope, session);
        if (blockedSession === true) return { status: "blocked" };
        if (blockedSession !== false) throw new CoreError("internal_error");
        if (capabilities.sessionLineage) {
          if (typeof sessionLineage?.isFenced !== "function") throw new CoreError("capability_unavailable");
          const { fenced } = await sessionLineage.isFenced(tx, scope, session);
          if (fenced === true) return { status: "blocked" };
          if (fenced !== false) throw new CoreError("internal_error");
        }
        const positions = await capture.eligible(tx, key, prepared);
        if (!Array.isArray(positions) ||
            positions.some(position => !Number.isInteger(position) || position < 0 || position >= prepared.length)) {
          throw new CoreError("internal_error");
        }
        const eligible = new Set(positions);
        const { legacyKeyUnavailable, matches } = captureTextWithholding(passages);
        const transactionKey = capabilities.fingerprintKey && keys.userKeyForWrite && matches
          ? await keys.userKeyForWrite(tx) : null;
        const textFacts = preparedEvidence && passages.map(({ fact }) => fact);
        const admitted = await Promise.all(incoming.map(async ({ message, originalContent }, index) => {
          const scrubbed = { ...message, content: "" };
          if (!eligible.has(index)) return scrubbed;
          // The reference filter checks the source and its time. Compare snapshot text facts too.
          if (preparedEvidence && textFacts) {
            const retained = preparedEvidence[index];
            let evidence = retained;
            if (transactionKey) {
              const current = await fingerprintMemoryPassages(originalContent, message.content, transactionKey);
              // Spelling order is independent of the key. Reuse the retained evidence for each spelling.
              evidence = current.map((passage, position) => {
                const { digests, retainedShingles } = retained[position];
                return { ...passage, digests: [...passage.digests, ...digests.filter(digest => digest.label !== undefined)],
                  retainedShingles };
              });
            }
            return withholdsAnyPassage(evidence, textFacts) ? scrubbed : message;
          }
          return legacyKeyUnavailable || (matches && message.content &&
            await matches(originalContent, message.content, transactionKey ?? preparedKey)) ? scrubbed : message;
        }));
        const { status } = await admit.call(capture, tx, key, admitted);
        switch (status) {
          case "duplicate": case "processing": case "rawReplay":
            return { status: "duplicate" };
          case "admitted":
            if (capabilities.rawArchive) {
              if (typeof raw?.recordLineage !== "function") throw new CoreError("capability_unavailable");
              await raw.recordLineage(tx, key, admitted);
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
      /** @param {Tx} tx */
      const readPause = async tx => pauseResult(await pause.get(tx, owner));
      /** @param {Tx} tx @param {CaptureKey} key @param {readonly CaptureMessage[]} messages */
      const readEligible = async (tx, key, messages) => {
        const eligible = await capture.eligible(tx, key, messages);
        const positions = /** @type {number[]} */ (validateDenseArray(eligible, 0, messages.length));
        if (new Set(positions).size !== positions.length ||
            positions.some(position => !Number.isSafeInteger(position) || position < 0 || position >= messages.length)) {
          throw new CoreError("internal_error");
        }
        return positions;
      };
      const preflight = await uow.run(owner, lock, readPause);
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
          if ((await readPause(tx)).paused) return /** @type {const} */ ({ status: "paused" });
          const admission = await load.call(capture, tx, { scope, client, sessionId, eventId });
          if (admission === null) return /** @type {const} */ ({ status: "failed", code: "not_found" });
          const { key, messages } = admission;
          if (key?.scope?.owner !== owner || key.scope.namespace !== scope.namespace ||
              key.client !== client || key.sessionId !== sessionId || key.eventId !== eventId) {
            return /** @type {const} */ ({ status: "failed", code: "internal_error" });
          }
          const claim = await capture.claim(tx, key, messages, { leaseMs: config.leaseMs ?? DEFAULT_LEASE_MS });
          switch (claim.status) {
            case "rawReplay": return /** @type {const} */ ({ status: "done", result: claim.result });
            case "duplicate": case "processing": return { status: claim.status };
            case "claimed": {
              const positions = await readEligible(tx, key, messages);
              const selected = positions.filter(position => messages[position].content !== "");
              return { ...claim, key, positions: selected, admittedMessages: messages,
                messages: selected.map(position => messages[position]) };
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
      const { key, positions, messages, admittedMessages } = claimed;
      let { token } = claimed;

      /** @param {Tx} tx */
      async function pauseChanged(tx) {
        const state = await readPause(tx);
        return state.paused || state.generation !== preflight.generation;
      }

      async function assertSendGeneration() {
        // Releasing the pause lock before the transport gate leaves a window for a pause
        // and resume between this committed read and the gate's open check.
        if (await uow.run(owner, lock, pauseChanged)) throw new CoreError("capture_paused");
      }

      /** @template T @param {(tx: Tx) => Promise<T>} work */
      function runAtGeneration(work) {
        return uow.run(owner, lock, async tx => {
          if (!await pauseChanged(tx)) return work(tx);
          await capture.abandon(tx, token, { code: "capture_paused", retryable: false });
          return null;
        });
      }

      let retryableExtraction = false;
      try {
        if (positions.length === 0) {
          const result = await runAtGeneration(tx => capture.finish(tx, token, []));
          return result === null ? { status: "paused" } : { status: "done", result };
        }

        const { system, input, schema } = plainExtractionSpec(messages);
        const inputTokens = countTokens(model, modelRequestText(system, input, HOSTED_EXTRACT_OUTPUT_TOKENS));
        const maxOutputTokens = Math.min(HOSTED_EXTRACT_OUTPUT_TOKENS,
          model.contextWindow - inputTokens - EXTRACT_FRAMING_TOKENS);
        if (maxOutputTokens < MODEL_OUTPUT_TOKENS) throw new CoreError("context_budget_exceeded");
        /** @type {ModelRequest} */
        const request = { system, input, schema, schemaName: "extract_memories", maxOutputTokens };
        const { properties } = /** @type {{properties: {items: {maxItems: number}}}} */ (schema);
        const policy = { sourceCount: messages.length, itemLimit: properties.items.maxItems };
        const dispatch = await runAtGeneration(async tx => {
          await capture.assertEligible(tx, key, positions);
          return capture.beginDispatch(tx, token);
        });
        if (dispatch === null) return { status: "paused" };
        token = dispatch.token;
        const signal = options?.signal;
        const deadline = createCaptureDeadline(config.deadlines?.extract ?? DEFAULT_EXTRACT_MS, clock);
        await gate.assertOpen(owner, "pre-send");
        const transport = captureTransport(signal, deadline);
        /** @type {CallOptions} */
        const portOptions = {
          signal: transport.signal,
          onDiagnostic: diagnostics && (event => emitDiagnostic(diagnostics, event.stage, event.layer, event.reason)),
        };
        await assertSendGeneration();
        await gate.assertOpen(owner, "dispatch");
        let output;
        try {
          transport.check();
          output = await untilAborted(transport.signal, model.call("extract", request, portOptions));
        } catch (error) {
          transport.check();
          const failure = entryError(error);
          if (failure.code === "model_timeout" || failure.code === "model_cancelled" ||
              failure.code === "context_budget_exceeded" || failure.code === "token_count_unavailable" ||
              failure.code === "invalid_model_output") throw failure;
          retryableExtraction = failure.kind === "retryable";
          emitDiagnostic(diagnostics, "extract", "core_call", "provider_failure");
          throw new CoreError("extraction_failed");
        } finally {
          await gate.assertOpen(owner, "post-send");
        }
        transport.check();
        const candidates = hostedCandidates(output, policy, diagnostics);
        const fingerprintKey = candidates.length ? await keys.userKey(owner) : null;
        const digesters = candidates.length ? await keys.retainedDigesters?.(owner) : undefined;
        const prepared = await prepareCaptureCandidates(candidates, messages, key, fingerprintKey, clock, digesters);
        const excludedSources = new Set();
        /** @param {Tx} tx @param {PreparedCandidate[]} batch */
        const readFacts = (tx, batch) => suppressions.snapshot(tx, scope, {
          client, sessionId, passages: batch.flatMap(candidate => candidate.passages),
        });
        /** @param {Tx} tx */
        const abandonKeyMismatch = async tx => {
          await capture.abandon(tx, token, { code: "fingerprint_key_mismatch", retryable: true });
          return /** @type {const} */ ({ status: "failed", code: "fingerprint_key_mismatch" });
        };
        const preEmbed = await runAtGeneration(async tx => {
          const eligible = new Set(await readEligible(tx, key, admittedMessages));
          const stillEligible = positions.filter(position => eligible.has(position));
          const eligibleIds = new Set(stillEligible.map(position => admittedMessages[position].id));
          if (prepared.length && keys.userKeyForWrite && (await keys.userKeyForWrite(tx))?.id !== fingerprintKey?.id) {
            return abandonKeyMismatch(tx);
          }
          const allowedByPassage = prepared.length
            ? filterCaptureCandidates(prepared, await readFacts(tx, prepared), scope, excludedSources) : prepared;
          const survivors = allowedByPassage.filter(({ item }) =>
            item.receipts.every(({ messageId }) => eligibleIds.has(messageId)));
          return { stillEligible, survivors };
        });
        if (preEmbed === null) return { status: "paused" };
        if ("status" in preEmbed) return preEmbed;
        const embedded = await embedCaptureCandidates(preEmbed.survivors, owner, deps, deadline, signal);

        const completed = await runAtGeneration(async tx => {
          checkCaptureAbort(signal, deadline);
          await capture.assertEligible(tx, key, preEmbed.stillEligible);
          if (prepared.length && keys.userKeyForWrite && (await keys.userKeyForWrite(tx))?.id !== fingerprintKey?.id) {
            return abandonKeyMismatch(tx);
          }
          const snapshot = await readFacts(tx, embedded);
          if (prepared.length && !keys.userKeyForWrite && (await keys.userKey(owner))?.id !== fingerprintKey?.id) {
            return abandonKeyMismatch(tx);
          }
          const items = filterCaptureCandidates(embedded, snapshot, scope, excludedSources).map(candidate => candidate.item);
          checkCaptureAbort(signal, deadline);
          const result = await capture.finish(tx, token, items);
          const rawMessages = preEmbed.stillEligible.map(position => admittedMessages[position])
            .filter(({ id }) => !excludedSources.has(id));
          if (archive && rawMessages.length && await archive.archiveAllowed(tx, key) === true) {
            await archive.archive(tx, key, rawMessages);
          }
          return /** @type {const} */ ({ status: "done", result, withheld: prepared.length - items.length });
        });
        if (completed === null) return { status: "paused" };
        if (completed.status === "failed") return completed;
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
              : { code: failure.code, retryable: failure.kind === "retryable" ||
                  (failure.code === "extraction_failed" && retryableExtraction) });
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

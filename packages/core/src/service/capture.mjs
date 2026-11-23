import { identifier, isWellFormedText, validateDenseArray, validateObject } from "../capture/validate.mjs";
import { CoreError, isErrorCode } from "../errors.mjs";
import { fingerprintMemoryPassages } from "../privacy/fingerprint.mjs";
import { prepareCoreText } from "../privacy/text.mjs";
import { requiresLegacyMacDomain, withholdsAnyPassage } from "../privacy/withholds.mjs";
import { entry, scopeOf } from "./entry.mjs";
import { pauseResult } from "./pause.mjs";

/** @param {unknown} raw
 * @returns {{ message: import("../ports/capture.d.ts").CaptureMessage, originalContent: string }}
 */
function prepareMessage(raw) {
  const { id, role, content, occurredAtMs } = validateObject(raw, ["id", "role", "content", "occurredAtMs"]);
  if (!isWellFormedText(id) || !id || id.length > 200 ||
      (role !== "user" && role !== "assistant") || !isWellFormedText(content) || !content || content.length > 20_000 ||
      (occurredAtMs !== null && (typeof occurredAtMs !== "number" || !Number.isSafeInteger(occurredAtMs)))) {
    throw new CoreError("invalid_input");
  }
  // Keep capture's NFKC and whitespace normalization with the union of v1 and hosted masking.
  return { message: { id, role, content: prepareCoreText(content), occurredAtMs }, originalContent: content };
}

/**
 * @param {import("./index.d.mts").MemoryServiceDeps} deps
 * @returns {Pick<import("../ports/host.d.ts").MemoryService, "enqueueCapture" | "captureStatus">}
 */
export function captureMethods({ storage, clock }) {
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
      // Canonical JSON is [client, sessionId, eventId, [[id, role, redactedContent, occurredAtMs], ...]] in message order.
      const payloadDigest = await clock.sha256Hex(JSON.stringify([client, sessionId, eventId,
        prepared.map(({ id, role, content, occurredAtMs }) => [id, role, content, occurredAtMs])]));
      const key = { scope, client, sessionId, eventId, payloadDigest };
      const fingerprintKey = capabilities.fingerprintKey ? await keys.userKey(scope.owner) : null;
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
        const textFacts = passages.map(({ fact }) => fact);
        const legacyKeyUnavailable = textFacts.some(requiresLegacyMacDomain);
        const admitted = await Promise.all(incoming.map(async ({ message, originalContent }, index) => {
          const scrubbed = { ...message, content: "" };
          if (!eligible.has(index) || legacyKeyUnavailable) return scrubbed;
          // The reference filter checks the source and its time. Compare snapshot text facts too,
          // using historical aliases for suppression only.
          if (textFacts.length && message.content && withholdsAnyPassage(
            await fingerprintMemoryPassages(originalContent, message.content, fingerprintKey), textFacts)) return scrubbed;
          return message;
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
  };
}

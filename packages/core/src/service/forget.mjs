import { identifier, isWellFormedText } from "../capture/validate.mjs";
import { SUPPRESSION_DISTANCE } from "../decisions.mjs";
import { CoreError } from "../errors.mjs";
import { FORGET_STEP_CAPABILITIES } from "../privacy/forget-steps.mjs";
import { factIncarnationBody, validateSuppressionFact } from "../suppression-fact.mjs";
import { entry, entryError, scopeOf } from "./entry.mjs";
import { predecessorFact, scopedRow, sourceOf } from "./writes.mjs";

/** @import {Capability, Capabilities} from "../capabilities.mjs" */
/** @import {ForgetStep} from "../privacy/forget-steps.mjs" */
/** @import {DocumentCardSession, DocumentCardSourceMessage, MemoryRow, ProvenClosure, Scope, StorageAdapter, Tx} from "../ports/index.d.ts" */

/** @param {Capabilities} flags @param {ForgetStep} step @param {Capability} capability */
function enabled(flags, step, capability) {
  return FORGET_STEP_CAPABILITIES[step]?.includes(capability) && flags[capability] === true;
}

/** @param {unknown} value */
function sourceId(value) {
  return isWellFormedText(value) && value.length > 0 && !value.includes("\0");
}

/** @param {StorageAdapter} storage @param {Tx} tx @param {Scope} scope @param {MemoryRow} row */
async function similarCount({ memories, capabilities }, tx, scope, row) {
  if (typeof memories.findDuplicates !== "function" ||
      (row.embedding && capabilities.vectorSuppression && !capabilities.nearDuplicate)) {
    throw new CoreError("capability_unavailable");
  }
  const embedding = capabilities.nearDuplicate ? row.embedding?.vector : undefined;
  const [matches] = await memories.findDuplicates(tx, scope, [{ textHash: row.textHash, embedding }],
    { nearDistance: SUPPRESSION_DISTANCE, excludeId: row.id });
  const ids = new Set();
  for (const match of matches) {
    if (match.kind !== "stored" || match.id === row.id) continue;
    if (match.match === "exact" || (embedding != null && match.distance !== undefined &&
        match.distance <= SUPPRESSION_DISTANCE)) ids.add(match.id);
  }
  return ids.size;
}

/** @param {StorageAdapter["hydrate"]} hydrate @param {Tx} tx @param {Scope} scope @param {MemoryRow} row */
async function cardSources(hydrate, tx, scope, row) {
  if (typeof hydrate?.hydrate !== "function") throw new CoreError("raw_lineage_unavailable");
  const items = await hydrate.hydrate(tx, { owner: scope.owner, namespaces: [scope.namespace] },
    [{ type: "memory", id: row.id, namespace: scope.namespace }], "read");
  const source = items.find(({ ref }) => ref.type === "memory" && ref.id === row.id && ref.namespace === scope.namespace);
  if (!Array.isArray(source?.receipts)) throw new CoreError("raw_lineage_unavailable");
  /** @type {Map<string, DocumentCardSourceMessage>} */
  const messages = new Map();
  for (const { client, sessionId, messageId } of source.receipts) {
    if (!sourceId(client) || !sourceId(sessionId) || !sourceId(messageId)) throw new CoreError("raw_lineage_unavailable");
    messages.set(JSON.stringify([client, sessionId, messageId]), { client, sessionId, messageId });
  }
  return messages;
}

/**
 * @param {import("./index.d.mts").MemoryServiceDeps} deps
 * @returns {import("../ports/host.d.ts").MemoryService["forget"]}
 */
export function forgetMethod({ storage, clock }) {
  const { uow, capabilities, keys, memories, suppressions, raw, sessionLineage, spanLineage, hydrate,
    conflicts, documentCards, quantityLedger, forgetLog } = storage;

  return entry(async (input, inputId, inputSource) => {
    const scope = scopeOf(input);
    const { owner, namespace } = scope;
    const id = identifier(inputId);
    sourceOf(inputSource);
    if (typeof memories.get !== "function") throw new CoreError("capability_unavailable");

    // Key lookup can be external. Defer its result until the transaction has
    // established that there is a row to forget, as for a missing key.
    const keyResult = await Promise.resolve().then(() => keys?.userKey(owner)).then(
      key => ({ key, error: null }), error => ({ key: null, error: entryError(error) }),
    );

    return uow.run(owner, { pauseLock: true }, async tx => {
      // resolve
      const row = await scopedRow(memories, scope, id, tx);
      if (!row) return { status: "not_found" };
      if (keyResult.error) throw keyResult.error;
      const { key } = keyResult;
      if (!key) throw new CoreError("fingerprint_unavailable");
      if (typeof suppressions?.writeFact !== "function" || typeof memories.erase !== "function") {
        throw new CoreError("capability_unavailable");
      }
      const removedSimilar = await similarCount(storage, tx, scope, row);

      // lineage.resolve
      const spans = enabled(capabilities, "lineage.resolve", "spanLineage")
        ? await spanLineage?.resolveSpans(tx, scope, id) : [];
      if (!Array.isArray(spans)) throw new CoreError("raw_lineage_unavailable");
      const hideCards = enabled(capabilities, "dependents.invalidate", "documentCards");
      const messages = hideCards ? await cardSources(hydrate, tx, scope, row) : new Map();
      const messageIds = new Set(Array.from(messages.values(), ({ messageId }) => messageId));
      if (hideCards && spans.some(span => !messageIds.has(span.messageKey))) {
        throw new CoreError("raw_lineage_unavailable");
      }

      const fenceRaw = enabled(capabilities, "session.fence", "rawArchive");
      /** @type {Map<string, DocumentCardSession>} */
      const sessions = new Map();
      /** @type {ProvenClosure | undefined} */
      let closure;
      const { client, sessionId } = row.source;
      if (fenceRaw && client !== null && sessionId !== null) {
        if (!sourceId(client) || !sourceId(sessionId)) throw new CoreError("raw_lineage_unavailable");
        sessions.set(sessionId, { client, sessionId });
        if (capabilities.sessionLineage) {
          closure = await sessionLineage?.provenClosure(tx, scope, [{ client, sessionId }]);
          if (!Array.isArray(closure)) throw new CoreError("raw_lineage_unavailable");
          for (const session of closure) {
            if (session.client !== client || !sourceId(session.sessionId)) throw new CoreError("raw_lineage_unavailable");
            sessions.set(session.sessionId, session);
          }
        }
      }

      // suppression.write
      const { fact, incarnation } = await predecessorFact(scope, row, key, clock, "forget");
      const { factId, epoch, createdAtMs, created } = await suppressions.writeFact(tx, fact, incarnation);

      // session.fence
      if (fenceRaw) {
        if (!raw) throw new CoreError("capability_unavailable");
        for (const session of sessions.values()) await raw.fenceSession(tx, scope, session);
      }

      // raw.purge
      if (enabled(capabilities, "raw.purge", "rawArchive")) {
        if (!raw) throw new CoreError("capability_unavailable");
        if (closure?.length) await raw.eraseSessions(tx, scope, closure);
        const facts = created ? [{ fact, incarnation, factId, epoch, createdAtMs }]
          : await suppressions.factsFor(tx, scope, { memoryId: id });
        const stored = facts === "ineligible" ? undefined : facts.find(candidate => candidate.factId === factId &&
          candidate.incarnation === incarnation && candidate.fact.kind === "text" &&
          candidate.fact.owner === owner && (candidate.fact.namespace ?? null) === namespace);
        if (!stored) throw new CoreError("ineligible");
        await raw.purgeWithheld(tx, scope, [stored]);
      }

      // receipts.suppress
      if (enabled(capabilities, "receipts.suppress", "spanLineage") && capabilities.rawSpans) {
        for (const resolved of spans) {
          if (resolved.kind !== "rawSpan" || resolved.owner !== owner || (resolved.namespace ?? null) !== namespace) {
            throw new CoreError("raw_lineage_unavailable");
          }
          const span = { ...resolved, actionId: fact.actionId, origin: /** @type {const} */ ("forget") };
          validateSuppressionFact(span);
          await suppressions.writeFact(tx, span, await clock.sha256Hex(factIncarnationBody(span)));
        }
      }

      // dependents.invalidate
      if (hideCards) {
        if (typeof documentCards?.hideWhere !== "function") throw new CoreError("capability_unavailable");
        await documentCards.hideWhere(tx, scope, { sourceMemoryId: id }, "forget");
        for (const sourceMessage of messages.values()) {
          await documentCards.hideWhere(tx, scope, { sourceMessage }, "forget");
        }
        for (const session of sessions.values()) await documentCards.hideWhere(tx, scope, { session }, "forget");
      }
      if (enabled(capabilities, "dependents.invalidate", "conflictEdges")) {
        if (!conflicts) throw new CoreError("capability_unavailable");
        await conflicts.invalidate(tx, scope, id);
      }
      if (enabled(capabilities, "dependents.invalidate", "quantityLedger")) {
        if (!quantityLedger) throw new CoreError("capability_unavailable");
        await quantityLedger.dropWhere(tx, scope, { by: "memoryId", id });
      }
      if (enabled(capabilities, "dependents.invalidate", "cards") ||
          enabled(capabilities, "dependents.invalidate", "stagedEvidence")) {
        throw new CoreError("capability_unavailable");
      }

      // edits.unlink has no port. Keep the old edit suppression in force.
      // tombstone and receipts.delete are atomic within erase (which also removes placements).
      if (!await memories.erase(tx, scope, id)) throw new CoreError("ineligible");
      if (capabilities.forgetLog) {
        if (!forgetLog) throw new CoreError("capability_unavailable");
        await forgetLog.record(tx, owner, id, clock.nowMs());
      }
      // epoch.advance is owned by each writeFact call.
      return { status: "forgotten", removedSimilar };
    });
  });
}

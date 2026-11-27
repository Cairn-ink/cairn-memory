import { detach, isWellFormedText } from "../capture/validate.mjs";
import { SUPPRESSION_DISTANCE } from "../decisions.mjs";
import { CoreError } from "../errors.mjs";
import { FORGET_STEP_CAPABILITIES } from "../privacy/forget-steps.mjs";
import { documentCardVisible } from "../routing/visibility.mjs";
import { factIncarnationBody, validateSuppressionFact } from "../suppression-fact.mjs";
import { compareUtf8 } from "../utf8.mjs";
import { entry, entryError, scopeOf, factReference, predecessorOf, spanReference, writeHookResult } from "./entry.mjs";
import { predecessorFact, scopedRow, sourceOf, sourceWindowFacts } from "./writes.mjs";

/** @import {Capability, Capabilities} from "../capabilities.mjs" */
/** @import {ForgetStep} from "../privacy/forget-steps.mjs" */
/** @import {DocumentCardHideSelector, DocumentCardSession, DocumentCardSourceMessage, MemoryRow, MemoryService, ProvenClosure, RawSourceTuple, Revision, Scope, StorageAdapter, Tx} from "../ports/index.d.ts" */
/** @import {RawSpanFact} from "../suppression-fact.mjs" */

/** @typedef {MemoryService["forget"]} Forget */
/** @typedef {{ expectedRevision?: Revision }} ForgetOptions */

/** @param {ForgetOptions | null | undefined} options @returns {Revision | undefined} */
function readExpectedRevision(options) {
  if (options == null) return undefined;
  try {
    if (typeof options === "object") {
      const prototype = Object.getPrototypeOf(options);
      if (prototype === Object.prototype || prototype === null) {
        const descriptor = Object.getOwnPropertyDescriptor(options, "expectedRevision");
        if (descriptor?.enumerable && Object.hasOwn(descriptor, "value")) return descriptor.value;
        if (!("expectedRevision" in options)) return undefined;
      }
    }
  } catch {
    // Proxy traps can throw during reflection. Detachment rejects proxies that pass these checks.
  }
  throw new CoreError("invalid_input");
}

/** @param {Capabilities} flags @param {ForgetStep} step @param {Capability} capability */
function enabled(flags, step, capability) {
  return FORGET_STEP_CAPABILITIES[step]?.includes(capability) === true && flags[capability] === true;
}

/** @param {unknown} value */
function sourceId(value) {
  return isWellFormedText(value) && value.length > 0 && !value.includes("\0");
}

/** @param {Pick<StorageAdapter, "memories" | "capabilities">} storage @param {Tx} tx @param {Scope} scope @param {MemoryRow} row
 * @param {boolean} withKey
 */
async function similarCount({ memories, capabilities }, tx, scope, row, withKey) {
  if (typeof memories.findDuplicates !== "function") return 0;
  const embedding = withKey && capabilities.vectorSuppression && capabilities.nearDuplicate
    ? row.embedding?.vector : undefined;
  const query = withKey ? { textHash: row.textHash, embedding } : { textHash: row.textHash };
  const [matches] = await memories.findDuplicates(tx, scope, [query],
    { nearDistance: SUPPRESSION_DISTANCE, excludeId: row.id });
  const ids = new Set();
  for (const match of matches) {
    if (match.kind !== "stored" || match.id === row.id) continue;
    if (match.match === "exact" || (embedding != null && match.distance !== undefined &&
        match.distance <= SUPPRESSION_DISTANCE)) ids.add(match.id);
  }
  return ids.size;
}

/** @param {StorageAdapter["hydrate"]} hydrate @param {Tx} tx @param {Scope} scope @param {MemoryRow} row
 * @param {readonly RawSpanFact[]} spans @param {boolean} resolvedEmptySpans
 */
async function cardSources(hydrate, tx, scope, row, spans, resolvedEmptySpans) {
  if (typeof hydrate?.hydrate !== "function") throw new CoreError("raw_lineage_unavailable");
  const receipts = hydrate.receiptsForForget ? await hydrate.receiptsForForget(tx, scope, row.id) :
    (await hydrate.hydrate(tx, { owner: scope.owner, namespaces: [scope.namespace] },
      [{ type: "memory", id: row.id, namespace: scope.namespace }], "read"))
      .find(({ ref }) => ref.type === "memory" && ref.id === row.id && ref.namespace === scope.namespace)?.receipts;
  // A confirmed empty span lookup can outlive the hydrated source. The memory
  // and session selectors still invalidate their dependent cards.
  if (receipts === undefined && resolvedEmptySpans) return [];
  if (!Array.isArray(receipts)) throw new CoreError("raw_lineage_unavailable");
  /** @type {Map<string, DocumentCardSourceMessage>} */
  const messages = new Map();
  /** @type {Map<string, string>} */
  const clearBySpan = new Map();
  for (const receipt of receipts) {
    const { client, sessionId, messageId } = receipt;
    if (!sourceId(client) || !sourceId(sessionId) || !sourceId(messageId)) throw new CoreError("raw_lineage_unavailable");
    const clearId = JSON.stringify([client, sessionId, messageId]);
    messages.set(clearId, { client, sessionId, messageId });
    // The adapter owns the opaque span keys. A receipt may project both keys alongside its clear identity.
    if ("sessionKeyHash" in receipt && "messageKey" in receipt &&
        typeof receipt.sessionKeyHash === "string" && /^[0-9a-f]{64}$/u.test(receipt.sessionKeyHash) &&
        sourceId(receipt.messageKey)) {
      const spanId = JSON.stringify([receipt.sessionKeyHash, receipt.messageKey]);
      const previous = clearBySpan.get(spanId);
      if (previous !== undefined && previous !== clearId) throw new CoreError("raw_lineage_unavailable");
      clearBySpan.set(spanId, clearId);
    }
  }
  for (const { sessionKeyHash, messageKey } of spans) {
    if (!clearBySpan.has(JSON.stringify([sessionKeyHash, messageKey]))) {
      throw new CoreError("raw_lineage_unavailable");
    }
  }
  return messages.values();
}

/** @param {DocumentCardSourceMessage} source */
function sourceBinding({ client, sessionId, messageId }) {
  return JSON.stringify([client, sessionId, messageId]);
}

/** @param {NonNullable<import("./index.d.mts").MemoryServiceDeps["storage"]["documentCards"]>} cards @param {Tx} tx @param {Scope} scope
 * @param {Set<string>} deletedSources @param {{actionId: string, factIds: readonly string[]}} action
 * @param {readonly DocumentCardHideSelector[]} [selectors] */
async function purgeWithheldCards(cards, tx, scope, deletedSources, action, selectors) {
  if (typeof cards.purgeById !== "function" || typeof cards.listForPurge !== "function") return;
  const candidates = await cards.listForPurge(tx, scope, selectors, action);
  for (const { cardId, input, amendments } of candidates) {
    if (input) {
      const { sourceMessage } = input.card;
      const sourceWithheld = sourceMessage && deletedSources.has(sourceBinding(sourceMessage)) ? true : input.sourceWithheld;
      const { reason } = await documentCardVisible({ ...input, sourceWithheld }, { definiteOnly: true });
      if (reason === "text_withheld" || reason === "source_withheld" ||
          reason === "source_memory_forgotten" || reason === "source_memory_not_visible") {
        await cards.purgeById(tx, scope, cardId, reason);
        continue;
      }
    }
    for (const { amendmentId, sourceMessage, sourceWithheld } of amendments) {
      if (sourceWithheld === true || deletedSources.has(sourceBinding(sourceMessage))) {
        await cards.hideAmendment(tx, scope, cardId, amendmentId, "source_withheld", { purge: true });
      }
    }
  }
}

/**
 * @param {import("./entry.mjs").HookedDeps} deps
 * @returns {Forget}
 */
export function forgetMethod({ storage, clock, config, hooks }) {
  const { uow, capabilities, keys, memories, suppressions, raw, sessionLineage, spanLineage, hydrate,
    conflicts, rationale, documentCards, quantityLedger, forgetLog, proceduralTags } = storage;

  /** @type {(...args: [...Parameters<Forget>, options?: ForgetOptions]) =>
   *   Promise<Awaited<ReturnType<Forget>> | { status: "conflict", indexRevision?: number }>} */
  const forget = entry(async (input, id, inputSource, options) => {
    const scope = scopeOf(input);
    const { owner, namespace } = scope;
    if (!isWellFormedText(id) || !id || id.length > 512 ||
        id.trim() !== id || /[\x00-\x1f\x7f]/.test(id)) throw new CoreError("invalid_input");
    sourceOf(inputSource);
    const expectedRevision = options?.expectedRevision;
    if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) {
      throw new CoreError("invalid_input");
    }
    if (typeof memories.get !== "function") throw new CoreError("capability_unavailable");

    // Only the adapter's configured key provider can use its transaction.
    const userKeyForWrite = capabilities.fingerprintKey === true ? keys?.userKeyForWrite?.bind(keys) : undefined;
    // Resolve external keys before the lock, but surface failures only for an existing row.
    const keyResult = capabilities.fingerprintKey === false || userKeyForWrite || !keys ? null
      : await Promise.resolve().then(() => keys.userKey(owner)).then(
        key => ({ key, error: null }), error => ({ key: null, error: entryError(error) }),
      );

    return uow.run(owner, { pauseLock: true }, async tx => {
      // resolve
      const row = await scopedRow(memories, scope, id, tx);
      if (!row) {
        const indexRevision = await (memories.committedIndexRevision
          ? memories.committedIndexRevision(tx) : memories.indexRevision?.(tx));
        return { status: "not_found", ...(indexRevision === undefined ? {} : { indexRevision }) };
      }
      if (expectedRevision !== undefined && row.revision !== expectedRevision) {
        const indexRevision = await memories.indexRevision?.(tx);
        return { status: "conflict", ...(indexRevision === undefined ? {} : { indexRevision }) };
      }
      if (keyResult?.error) throw keyResult.error;
      const key = userKeyForWrite ? await userKeyForWrite(tx) : keyResult === null ? null : keyResult.key;
      if (typeof suppressions?.writeFact !== "function" || typeof memories.erase !== "function") {
        throw new CoreError("capability_unavailable");
      }
      const removedSimilar = await similarCount(storage, tx, scope, row, key !== null);

      // lineage.resolve
      const resolveSpans = enabled(capabilities, "lineage.resolve", "spanLineage");
      const spans = resolveSpans ? await spanLineage?.resolveSpans(tx, scope, id) : [];
      if (!Array.isArray(spans)) throw new CoreError("raw_lineage_unavailable");
      const hideCards = enabled(capabilities, "dependents.invalidate", "documentCards");
      const assessCardPurge = hideCards && typeof documentCards?.listForPurge === "function" &&
        typeof documentCards.purgeById === "function";
      const messages = hideCards ? await cardSources(hydrate, tx, scope, row, spans, resolveSpans && spans.length === 0) : [];

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

      const predecessor = hooks && predecessorOf(row);
      const evidence = hooks && await hooks.port.predecessorEvidence(tx, scope, id);
      /** @type {Map<string, DocumentCardSourceMessage | RawSourceTuple> | undefined} */
      const affectedMessages = evidence && new Map([...evidence.affectedMessages, ...messages]
        .map(message => [sourceBinding(message), message]));
      /** @type {import("../ports/index.d.ts").HostFactRef[] | undefined} */
      const hookFacts = hooks ? [] : undefined;
      // suppression.write
      const { fact, incarnation } = await predecessorFact(scope, row, key, clock, "forget");
      const { factId, epoch, createdAtMs, created } = await suppressions.writeFact(tx, fact, incarnation);
      hookFacts?.push(factReference(fact.kind, { factId, epoch, createdAtMs }));
      const factIds = new Set([factId]);
      if (config?.explicitWindowFence?.enabled === true) {
        for (const window of sourceWindowFacts(row, fact.actionId)) {
          const written = await suppressions.writeFact(tx, window, await clock.sha256Hex(factIncarnationBody(window)));
          factIds.add(written.factId);
          hookFacts?.push(factReference(window.kind, written));
        }
      }

      // session.fence
      if (fenceRaw) {
        if (!raw) throw new CoreError("capability_unavailable");
        for (const session of sessions.values()) await raw.fenceSession(tx, scope, session);
      }

      // raw.purge
      /** @type {Set<string>} */
      const deletedSources = new Set();
      const purgeSourceOptions = hooks ? { includeDeletedSources: true } : undefined;
      /** @param {readonly RawSourceTuple[] | undefined} sources */
      function collectPurgedMessages(sources) {
        if (!affectedMessages || !sources) return;
        for (const { client, sessionId, messageId, role, occurredAtMs } of sources) {
          const source = { client, sessionId, messageId, role, occurredAtMs };
          affectedMessages.set(sourceBinding(source), source);
        }
      }
      if (enabled(capabilities, "raw.purge", "rawArchive")) {
        if (!raw) throw new CoreError("capability_unavailable");
        if (closure?.length) {
          const erased = await raw.eraseSessions(tx, scope, closure, purgeSourceOptions);
          if (hooks) collectPurgedMessages(erased.deletedSources);
        }
        if (fact.kind === "text") {
          const facts = created ? [{ fact, incarnation, factId, epoch, createdAtMs }]
            : await suppressions.factsFor(tx, scope, { memoryId: id });
          const stored = facts === "ineligible" ? undefined : facts.find(candidate => candidate.factId === factId &&
            candidate.incarnation === incarnation && candidate.fact.kind === "text" &&
            candidate.fact.owner === owner && (candidate.fact.namespace ?? null) === namespace);
          if (!stored) throw new CoreError("ineligible");
          const purgeOptions = assessCardPurge ? {
            ...purgeSourceOptions, onDelete: (/** @type {DocumentCardSourceMessage} */ source) => { deletedSources.add(sourceBinding(source)); },
          } : purgeSourceOptions;
          const purged = await raw.purgeWithheld(tx, scope, [stored], purgeOptions);
          if (hooks) collectPurgedMessages(purged.deletedSources);
        }
      }

      // receipts.suppress
      if (enabled(capabilities, "receipts.suppress", "spanLineage")) {
        for (const resolved of spans) {
          if (resolved.kind !== "rawSpan" || resolved.owner !== owner || (resolved.namespace ?? null) !== namespace) {
            throw new CoreError("raw_lineage_unavailable");
          }
          const span = { ...resolved, actionId: fact.actionId, origin: /** @type {const} */ ("forget") };
          validateSuppressionFact(span);
          const written = await suppressions.writeFact(tx, span, await clock.sha256Hex(factIncarnationBody(span)));
          factIds.add(written.factId);
          hookFacts?.push(factReference(span.kind, written));
        }
      }

      // dependents.invalidate
      if (hideCards) {
        if (typeof documentCards?.hideWhere !== "function") throw new CoreError("capability_unavailable");
        /** @type {DocumentCardHideSelector[]} */
        const selectors = [{ sourceMemoryId: id }];
        for (const sourceMessage of messages) selectors.push({ sourceMessage });
        for (const session of sessions.values()) selectors.push({ session });
        const erasedSessions = new Set(closure?.map(({ sessionId }) => sessionId));
        for (const selector of selectors) {
          if (selector.session && erasedSessions.has(selector.session.sessionId)) {
            await documentCards.hideWhere(tx, scope, selector, "forget", { purge: true });
          } else if (assessCardPurge) {
            await documentCards.hideWhere(tx, scope, selector, "forget", { retainText: true });
          } else {
            await documentCards.hideWhere(tx, scope, selector, "forget");
          }
        }
        if (assessCardPurge) {
          await purgeWithheldCards(documentCards, tx, scope, deletedSources, { actionId: fact.actionId, factIds: [...factIds] },
            fact.kind === "text" ? undefined : selectors);
        }
      }
      if (enabled(capabilities, "dependents.invalidate", "conflictEdges")) {
        if (!conflicts) throw new CoreError("capability_unavailable");
        await conflicts.invalidate(tx, scope, id);
      }
      if (enabled(capabilities, "dependents.invalidate", "rationaleEdges")) {
        if (!rationale) throw new CoreError("capability_unavailable");
        await rationale.invalidate(tx, scope, id);
      }
      if (enabled(capabilities, "dependents.invalidate", "quantityLedger")) {
        if (!quantityLedger) throw new CoreError("capability_unavailable");
        await quantityLedger.dropWhere(tx, scope, { by: "memoryId", id });
      }
      if (capabilities.proceduralTags === true) {
        if (!proceduralTags) throw new CoreError("capability_unavailable");
        await proceduralTags.clear(tx, scope, id);
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
      if (hooks && predecessor && evidence && hookFacts && affectedMessages) {
        const erased = new Set(closure?.map(session => session.sessionId));
        await hooks.invoke("onForget", tx, {
          scope, predecessor, priorReceipts: evidence.priorReceipts,
          facts: hookFacts, status: "forgotten", removedSimilar,
          affectedSessions: [...sessions.values()].map(session => ({
            ...session, effect: erased.has(session.sessionId) ? "erase" : "hide",
          })),
          affectedMessages: [...affectedMessages].sort(([a], [b]) => compareUtf8(a, b)).map(([, message]) => message),
          affectedSpans: spans.map(spanReference),
        }, writeHookResult);
      }
      // epoch.advance is owned by each writeFact call.
      const indexRevision = await memories.committedIndexRevision?.(tx);
      return { status: "forgotten", removedSimilar, ...(indexRevision === undefined ? {} : { indexRevision }) };
    });
  }, undefined, args => {
    // Capture the guard before cloning can drop it or another argument's getter can change it.
    const expectedRevision = readExpectedRevision(args[3]);
    const input = detach(args, "invalid_input");
    // Built-in objects can have a reassigned prototype. Cloning restores their built-in prototype.
    if (input[3] != null && Object.getPrototypeOf(input[3]) !== Object.prototype) {
      throw new CoreError("invalid_input");
    }
    input[3] = { expectedRevision };
    return input;
  });
  // Only calls that supply an expected revision can return a conflict.
  return /** @type {Forget} */ (forget);
}

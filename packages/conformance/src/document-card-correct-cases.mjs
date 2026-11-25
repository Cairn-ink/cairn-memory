import { coreDigest, factIncarnationBody } from "@cairn-ink/core";
import { buildDocumentCard, documentCardStaleness } from "@cairn-ink/core/routing";
import { createMemoryService } from "@cairn-ink/core/service";
import { assemblyClock, fixtureCount, formatAssembly } from "./context-assembly-cases.mjs";
import { captureService, client, firstDay, message, nextDay } from "./capture-documents-support.mjs";
import { check, equal, readDump, rejects, row, source } from "./support.mjs";

/** @import { ContextCardRef, ContextReadStore, DocumentCardWrite, ItemRef, StorageAdapter,
 * StoredDocumentCardRecord, Tx } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */
/** @import { TextFact } from "@cairn-ink/core" */

const original = "The machine uses brass fasteners.";
const corrected = "The machine takes polymer rivets.";
const query = "albatross";
const sessionId = "maintenance";
const initial = message("manual", "Albatross field guide\n\nKeep a log of every maintenance visit.");
const change = message("change", "The new inspection day is Tuesday.", nextDay);

/** @param {CaseContext} ctx */
async function fixture(ctx) {
  const storage = /** @type {StorageAdapter<StoredDocumentCardRecord> & { contextRead?: ContextReadStore }} */ (ctx.adapter);
  const { documentCards: cards, raw, uow, memories, fence } = storage;
  check(cards, "Expected a document card store");
  const scope = ctx.scope(null);
  /** @template T @param {(tx: Tx) => Promise<T>} work */
  const read = work => uow.run(scope.owner, { readOnly: true }, work);
  /** @template T @param {(tx: Tx) => Promise<T>} work */
  const write = work => uow.run(scope.owner, { pauseLock: true }, work);
  const seed = await row(ctx, original);
  const link = await write(tx => memories.insert(tx, scope, seed, [{
    client, sessionId, messageId: "memory-receipt", occurredAtMs: firstDay, role: "user", excerpt: original,
  }], firstDay));
  const canonicalSessionKey = ctx.harness.hashSessionKey?.(client, sessionId) ?? sessionId;
  const { card: built } = await buildDocumentCard(initial, { scope, client, canonicalSessionKey });
  check(built, "Expected a routed card");
  /** @type {DocumentCardWrite<StoredDocumentCardRecord>} */
  const card = { id: built.id, scope, origin: "router", title: built.title, body: built.body, date: built.date,
    contentHash: await ctx.hash(built.body), sourceMessage: { client, sessionId, messageId: initial.id },
    sourceMemories: [{ id: link.id, revision: link.revision }], sentences: [], stale: [] };
  await write(async tx => {
    if (raw) await raw.archive(tx, { scope, client, sessionId, eventId: initial.id, payloadDigest: "a".repeat(64) }, [initial]);
    await cards.put(tx, scope, card);
  });

  /** @type {ItemRef} */
  const ref = { type: "card", id: card.id, namespace: scope.namespace };
  const set = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] };
  /** @type {import("@cairn-ink/core/ports").ReadContextInput} */
  const request = { query, types: ["card"], intent: "current", semantic: false };
  const reads = createMemoryService({
    storage, clock: assemblyClock(), config: {},
    model: { model: "unused", contextWindow: 1, countTokens: () => 0,
      async call() { throw new Error("Read used extraction"); } },
    embedder: null, gate: { async assertOpen() {} }, tokens: { countTokens: () => 0 },
    contextReadFormat: formatAssembly, contextReadCounter: { count: fixtureCount },
  });
  const { findCandidates, fetchEvidence, readContext } = reads;
  check(findCandidates && fetchEvidence && readContext, "Expected Context Read service entries");
  const capture = captureService(ctx, { documentCards: { enabled: true, amendments: true } });
  /** @param {"new" | "same" | "none"} receipt */
  async function correct(receipt) {
    const session = receipt === "same" ? sessionId : "editor";
    const editor = message("editor-message", corrected, nextDay);
    if (raw && receipt !== "none") {
      await write(tx => raw.archive(tx, { scope, client, sessionId: session, eventId: editor.id, payloadDigest: "b".repeat(64) }, [editor]));
    }
    const result = await capture.service.correct(scope, link.id, link.revision, corrected, source,
      receipt === "none" ? undefined : { receipt: { client, sessionId: session,
        messageId: editor.id, occurredAtMs: nextDay, role: "user", excerpt: corrected } });
    check(result.status === "saved" && result.item.revision === link.revision + 1, "Expected a committed correction");
    return result.item;
  }
  return { storage, cards, scope, read, write, card, ref, set, request, link, correct,
    reads: { ...reads, findCandidates, fetchEvidence, readContext },
    visible: () => read(tx => fence.assertVisible(tx, set, [ref], "read")) };
}

/** @typedef {Awaited<ReturnType<typeof fixture>>} Fixture */

/** @param {Fixture} f */
async function findRef(f) {
  const ref = (await f.reads.findCandidates(f.set, f.request)).items[0]?.ref;
  check(ref?.type === "card" && ref.id === f.card.id, "Expected a discoverable card");
  return ref;
}

/** @param {CaseContext} ctx @param {Fixture} f @param {ContextCardRef | undefined} before */
async function assertWithheld(ctx, f, before) {
  const { scope, card, set, request, reads } = f;
  equal(await reads.readCard(scope, card.id), { status: "not_found" }, "Card read exposed a corrected citation");
  equal(await f.read(tx => f.cards.get(tx, scope, card.id)), null, "Card store exposed a corrected citation");
  check(!(await f.read(tx => f.cards.list(tx, scope))).some(({ id }) => id === card.id),
    "Card list exposed a corrected citation");
  equal(await f.visible(), [], "AI visibility fence exposed a corrected citation");
  if (ctx.adapter.capabilities.documentCardSearch) {
    const result = await reads.find(scope, query, { kinds: ["card"] });
    equal(result.layers.card.status, "ok", "Expected lexical card search with no vector coverage");
    equal(result.cards, [], "Lexical fallback exposed a corrected citation");
  }
  if (before) {
    for (const intent of /** @type {const} */ (["current", "history"])) {
      const input = { ...request, intent };
      equal((await reads.findCandidates(set, input)).items, [], intent + " candidates exposed a corrected citation");
      equal((await reads.readContext(set, input)).assembly.items, [], intent + " assembly exposed a corrected citation");
      await rejects(() => reads.fetchEvidence(set, { refs: [before], intent }), "evidence_unavailable");
      const port = f.storage.contextRead;
      if (port) equal(await f.read(tx => port.evidence(tx, set, [before], intent)), [null],
        intent + " adapter evidence exposed a corrected citation");
    }
  }
  const { placement } = ctx.adapter;
  if (placement) {
    equal(await f.read(tx => placement.pendingCards(tx, scope, { limit: 5 })), [],
      "Topic placement exposed a corrected citation");
  }
  if (ctx.adapter.capture.admit) {
    const capture = captureService(ctx, { documentCards: { enabled: true, amendments: true } }, undefined, {
      async detectChanges({ input }) {
        check(!input.includes(card.id) && !input.includes(card.body), "Detection received an ineligible card");
        return { changes: [{ card_id: card.id, quote: change.content, new_value: change.content }] };
      },
      async verifyChange() {
        throw new Error("Verification received an ineligible card");
      },
    });
    await capture.capture("inspection", change.id, [change]);
  }
}

/** @param {CaseContext} ctx @param {Fixture} f */
async function dumpOwner(ctx, f) {
  const dump = await readDump(ctx.harness);
  check(Array.isArray(dump), "Expected storage snapshot");
  const owner = dump.find(entry => entry?.owner === f.scope.owner);
  check(owner, "Expected fixture owner in storage snapshot");
  return owner;
}

const requests = { contextRead: true, documentCardSearch: true, rawArchive: true, placement: true };

/** @param {string} suffix @param {string} title @param {ConformanceCase["run"]} run
 * @param {ConformanceCase["needs"]} [extraNeeds] @returns {ConformanceCase} */
const testCase = (suffix, title, run, extraNeeds = []) => ({
  id: "T-CARD-CORRECT-" + suffix, title, needs: ["documentCards", ...extraNeeds], requests, run,
});

/** @param {"new" | "same" | "none"} receipt */
const withholdFor = receipt => async (/** @type {CaseContext} */ ctx) => {
  const f = await fixture(ctx);
  equal(await f.visible(), [f.ref], "Expected a visible dependency before correction");
  const placement = ctx.adapter.placement;
  if (placement) {
    equal(await f.read(tx => placement.pendingCards(tx, f.scope, { limit: 5 })),
      [{ cardId: f.card.id, contentHash: f.card.contentHash }], "Expected placement eligibility before correction");
  }
  const ref = ctx.adapter.capabilities.contextRead ? await findRef(f) : undefined;
  if (ref) {
    for (const intent of /** @type {const} */ (["current", "history"])) {
      equal((await f.reads.readContext(f.set, { ...f.request, intent })).assembly.items.length, 1,
        "Expected delivery before correction");
    }
  }
  await f.correct(receipt);
  await assertWithheld(ctx, f, ref);
};

/** @param {CaseContext} ctx @param {Fixture} f @param {TextFact["origin"]} origin
 * @param {boolean} sourced */
async function legacyTextFact(ctx, f, origin, sourced) {
  /** @type {TextFact} */
  const fact = {
    ...f.scope, kind: "text", mode: "exact", origin, actionId: "hosted-predecessor",
    ...(sourced && { sourceMemory: { id: f.link.id, createdAtMs: f.link.createdAtMs } }),
    text: { digests: [await coreDigest(original)], keyId: null },
  };
  const incarnation = (await ctx.hash(factIncarnationBody(fact))).slice("sha256:".length);
  return (/** @type {Tx} */ tx) => f.storage.suppressions.writeFact(tx, fact, incarnation);
}

/** @param {"edit" | "correct"} origin */
const withholdForSourcedFact = origin => async (/** @type {CaseContext} */ ctx) => {
  const f = await fixture(ctx);
  const ref = ctx.adapter.capabilities.contextRead ? await findRef(f) : undefined;
  const next = await row(ctx, corrected);
  const writeFact = await legacyTextFact(ctx, f, origin, true);
  await f.write(async tx => {
    await writeFact(tx);
    equal((await f.storage.memories.replaceContent(tx, f.scope, f.link.id, f.link.revision, next, null, nextDay)).outcome,
      "changed", "Expected an in-place text replacement");
  });
  await assertWithheld(ctx, f, ref);
};

/** @type {readonly ConformanceCase[]} */
export const DOCUMENT_CARD_CORRECT_CASES = [
  testCase("1", "withholds a corrected citation with a new-conversation receipt", withholdFor("new")),
  testCase("2a", "withholds a corrected citation with a same-conversation receipt", withholdFor("same")),
  testCase("2b", "withholds a corrected citation without a receipt", withholdFor("none")),
  testCase("3", "a regenerated body citing the replacement revision is deliverable", async ctx => {
    const f = await fixture(ctx);
    const next = await f.correct("none");
    const body = "Every visit checks the new hardware.";
    const contentHash = await ctx.hash(body);
    await f.write(tx => f.cards.put(tx, f.scope, { ...f.card, body, contentHash,
      sourceMemories: [{ id: next.id, revision: next.revision }] }));
    const read = await f.reads.readCard(f.scope, f.card.id);
    check(read.status === "found" && read.card.body === body, "Expected the regenerated body");
  }),
  testCase("4", "linking the corrected revision leaves the unchanged body withheld", async ctx => {
    const f = await fixture(ctx);
    const ref = ctx.adapter.capabilities.contextRead ? await findRef(f) : undefined;
    const next = await f.correct("none");
    await f.write(tx => f.cards.linkMemories(tx, f.scope, f.card.id, [{ id: next.id, revision: next.revision }]));
    await assertWithheld(ctx, f, ref);
  }),
  testCase("5", "ordinary supersession still delivers the card marked stale", async ctx => {
    const f = await fixture(ctx);
    const { memories, supersession } = ctx.adapter;
    check(supersession, "Expected supersession");
    const input = await row(ctx, corrected);
    await f.write(async tx => {
      const replacement = await memories.insert(tx, f.scope, input, [], nextDay);
      await supersession.record(tx, f.scope, { previous: f.link, replacement }, [], nextDay);
      await supersession.markHistorical(tx, f.scope, f.link.id, nextDay);
    });
    equal(await f.visible(), [f.ref], "Supersession must leave the stale card deliverable");
    if (f.cards.visibilityInputs) {
      const [input] = await f.read(tx => f.cards.visibilityInputs?.(tx, f.scope, [f.ref]) ?? Promise.resolve([]));
      check(input && documentCardStaleness({ ...input, card: { ...input.card, stale: [] } }), "Expected a stale source link");
    }
    const result = await f.reads.find(f.scope, query, { kinds: ["card"] });
    if (ctx.adapter.capabilities.documentCardSearch) {
      equal(result.cards.map(({ id }) => id), [f.card.id], "Expected a search hit");
    }
  }, ["supersession"]),
  testCase("6", "a metadata revision still delivers the card", async ctx => {
    const f = await fixture(ctx);
    const result = await f.write(tx => ctx.adapter.memories.touchDuplicate(tx, f.scope, f.link.id, [], {
      confidence: 0.7,
    }, nextDay));
    equal(result.revision, f.link.revision + 1, "Expected an effective metadata revision");
    equal(await f.visible(), [f.ref], "A metadata revision must leave the card deliverable");
    equal((await f.reads.readCard(f.scope, f.card.id)).status, "found", "Expected card read after metadata change");
  }),
  testCase("7", "correcting a citation retains the stored card and Raw", async ctx => {
    const f = await fixture(ctx);
    const before = await dumpOwner(ctx, f);
    await f.correct("none");
    equal(await f.visible(), [], "Expected delivery withholding");
    const after = await dumpOwner(ctx, f);
    check(JSON.stringify(after.documentCards).includes(JSON.stringify(f.card.body)), "Correction erased stored card text");
    check(Array.isArray(before.rawRows) && before.rawRows.length > 0, "Expected stored Raw before correction");
    equal(after.rawRows, before.rawRows, "Correction changed stored Raw");
  }, ["rawArchive"]),
  testCase("8", "markStale advances each generation only on an effective change", async ctx => {
    const f = await fixture(ctx);
    const { contextRead, memories } = f.storage;
    check(contextRead && memories.indexRevision, "Expected generation and index accessors");
    const indexRevision = memories.indexRevision.bind(memories);
    const revisions = () => f.read(async tx => {
      const [{ card }] = await contextRead.snapshotState(tx, f.set, ["card"]);
      check(typeof card === "number", "Expected a card generation");
      return { card, index: await indexRevision(tx) };
    });
    const change = (/** @type {string} */ replacementMemoryId) => f.write(tx =>
      f.cards.markStale(tx, f.scope, f.card.id, { memoryId: f.link.id, replacementMemoryId }));
    const before = await revisions();
    await change("replacement");
    const first = await revisions();
    equal(first, { card: before.card + 1, index: before.index + 1 }, "First mark advances once");
    await change("replacement");
    equal(await revisions(), first, "Identical mark must preserve both revisions");
    await change("another");
    equal(await revisions(), { card: first.card + 1, index: first.index + 1 }, "A different mark advances once");
  }, ["contextRead"]),
  testCase("9", "correction between amendment detection and verification withdraws the card", async ctx => {
    if (!ctx.adapter.capture.admit) return "needs capture.admit";
    const f = await fixture(ctx);
    let detected = false;
    let verified = false;
    const capture = captureService(ctx, { documentCards: { enabled: true, amendments: true } }, undefined, {
      async detectChanges({ input }) {
        detected = input.includes(f.card.id);
        await f.correct("none");
        return { changes: [{ card_id: f.card.id, quote: change.content, new_value: change.content }] };
      },
      async verifyChange() {
        verified = true;
        return { applies: true, line: change.content };
      },
    });
    await capture.capture("inspection", change.id, [change]);
    equal([detected, verified], [true, false], "Only detection may receive the card before the correction");
  }),
  testCase("EDIT", "withholds a citation replaced by a stored edit without a core action ID",
    withholdForSourcedFact("edit")),
  testCase("LEGACY-SOURCED", "withholds a citation replaced by a sourced legacy correct fact",
    withholdForSourcedFact("correct")),
  testCase("LEGACY-UNSOURCED", "withholds when a legacy correct fact cannot be excluded from the citation", async ctx => {
    const f = await fixture(ctx);
    const next = await row(ctx, corrected);
    const { revision } = await f.write(tx =>
      f.storage.memories.replaceContent(tx, f.scope, f.link.id, f.link.revision, next, null, nextDay));
    equal(await f.visible(), [f.ref], "A text revision without a predecessor fact only makes the card stale");
    const ref = ctx.adapter.capabilities.contextRead ? await findRef(f) : undefined;
    await f.write(await legacyTextFact(ctx, f, "correct", false));
    await f.write(tx => f.cards.linkMemories(tx, f.scope, f.card.id, [{ id: f.link.id, revision }]));
    await assertWithheld(ctx, f, ref);

    const body = "Every visit checks the new hardware.";
    const contentHash = await ctx.hash(body);
    await f.write(tx => f.cards.put(tx, f.scope, { ...f.card, body, contentHash,
      sourceMemories: [{ id: f.link.id, revision }] }));
    equal((await f.reads.readCard(f.scope, f.card.id)).status, "found",
      "Regeneration can cite the revision that does not match the legacy fact");
  }),
  testCase("FORGET", "a forget-origin text fact keeps the established forget behavior", async ctx => {
    const f = await fixture(ctx);
    const next = await row(ctx, corrected);
    const writeFact = await legacyTextFact(ctx, f, "forget", true);
    await f.write(async tx => {
      await writeFact(tx);
      await f.storage.memories.replaceContent(tx, f.scope, f.link.id, f.link.revision, next, null, nextDay);
    });
    equal(await f.visible(), [f.ref], "A forget fact for earlier text is not an in-place edit fact");
    const { service } = captureService(ctx, { documentCards: { enabled: true } });
    equal((await service.forget(f.scope, f.link.id, source)).status, "forgotten", "Expected memory forget");
    equal(await f.visible(), [], "Forget still withholds dependent cards");
    equal((await f.write(tx => f.cards.put(tx, f.scope, f.card))).status, "tombstoned", "Forget still purges the card");
  }),
];

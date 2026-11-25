import { coreDigest, factIncarnationBody, placePendingCards } from "@cairn-ink/core";
import { buildDocumentCard, documentCardStaleness } from "@cairn-ink/core/routing";
import { createMemoryService } from "@cairn-ink/core/service";
import { assemblyClock, fixtureCount, formatAssembly } from "./context-assembly-cases.mjs";
import { captureService, client, firstDay, message, nextDay } from "./capture-documents-support.mjs";
import { check, equal, readDump, rejects, row, source } from "./support.mjs";

/** @import { CaptureMessage, ContextCardRef, ContextReadStore, DetectChangesRequest, DocumentCardSession,
 * DocumentCardWrite, ItemRef, ModelRequest, StorageAdapter, StoredDocumentCardRecord, Tx,
 * VerifyChangeRequest } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */
/** @import { TextFact } from "@cairn-ink/core" */

const original = "The machine uses brass fasteners.";
const corrected = "The machine takes polymer rivets.";
const query = "albatross";
const sessionId = "maintenance";
const change = message("change", "The new inspection day is Tuesday.", nextDay);

/** @param {CaseContext} ctx @param {CaptureMessage} [initial] */
async function fixture(ctx, initial = message("manual", "Albatross field guide\n\nKeep a log of every maintenance visit.")) {
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
    /** @type {ModelRequest[]} */
    const classified = [];
    await placePendingCards({
      uow: f.storage.uow, scope, placement, documentCards: f.cards, fence: f.storage.fence,
      gate: { async assertOpen() {} },
      model: { model: "test", contextWindow: 32_768, countTokens: () => 1,
        async call(_stage, request) {
          classified.push(request);
          return { items: [] };
        } },
    });
    equal(classified, [], "Classification received an ineligible card");
  }
  if (ctx.adapter.capture.admit) {
    /** @type {DetectChangesRequest[]} */
    const detected = [];
    /** @type {VerifyChangeRequest[]} */
    const verified = [];
    const capture = captureService(ctx, { documentCards: { enabled: true, amendments: true } }, undefined, {
      async detectChanges(request) {
        detected.push(request);
        return { changes: [{ card_id: card.id, quote: change.content, new_value: change.content }] };
      },
      async verifyChange(request) {
        verified.push(request);
        return { applies: true, line: change.content };
      },
    });
    await capture.capture("inspection", change.id, [change]);
    check(!detected.some(({ input }) => input.includes(card.id) || input.includes(card.body)),
      "Detection received an ineligible card");
    equal(verified, [], "Verification received an ineligible card");
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
    /** @type {DetectChangesRequest[]} */
    const detected = [];
    /** @type {VerifyChangeRequest[]} */
    const verified = [];
    const capture = captureService(ctx, { documentCards: { enabled: true, amendments: true } }, undefined, {
      async detectChanges(request) {
        detected.push(request);
        await f.correct("none");
        return { changes: [{ card_id: f.card.id, quote: change.content, new_value: change.content }] };
      },
      async verifyChange(request) {
        verified.push(request);
        return { applies: true, line: change.content };
      },
    });
    await capture.capture("inspection", change.id, [change]);
    check(detected.some(({ input }) => input.includes(f.card.id)), "Detection did not receive the card before correction");
    equal(verified, [], "Verification received the card after correction");
    equal(await f.visible(), [], "Expected the correction inside detection to commit");
  }),
  testCase("EDIT", "withholds a citation replaced by a stored edit without a core action ID",
    withholdForSourcedFact("edit")),
  testCase("LEGACY-SOURCED", "withholds a citation replaced by a sourced legacy correct fact",
    withholdForSourcedFact("correct")),
  testCase("LATE-FACT", "a late sourced fact withholds every citation before the replacement", async ctx => {
    const f = await fixture(ctx);
    const { memories } = f.storage;
    const middle = await row(ctx, corrected);
    const latest = await row(ctx, "The machine takes stainless steel rivets.");
    const { revision } = await f.write(tx =>
      memories.replaceContent(tx, f.scope, f.link.id, f.link.revision, middle, null, nextDay));
    equal(revision, f.link.revision + 1, "Expected the first replacement without a fact");
    const writeFact = await legacyTextFact(ctx, f, "correct", true);
    const result = await f.write(async tx => {
      await writeFact(tx);
      return memories.replaceContent(tx, f.scope, f.link.id, revision, latest, null, nextDay);
    });
    equal(result.revision, revision + 1, "Expected the replacement with the late fact");
    equal(await Promise.all([
      f.read(tx => f.cards.get(tx, f.scope, f.card.id)), f.reads.readCard(f.scope, f.card.id), f.visible(),
    ]), [null, { status: "not_found" }, []], "A late fact exposed a citation older than the latest replacement");

    const body = "Every visit checks the new hardware.";
    const contentHash = await ctx.hash(body);
    await f.write(tx => f.cards.put(tx, f.scope, { ...f.card, body, contentHash,
      sourceMemories: [{ id: f.link.id, revision: result.revision }] }));
    const metadata = await f.write(tx => memories.touchDuplicate(tx, f.scope, f.link.id, [], { confidence: 0.7 }, nextDay));
    equal(metadata.revision, result.revision + 1, "Expected a metadata revision after replacement");
    const read = await f.reads.readCard(f.scope, f.card.id);
    check(read.status === "found" && read.card.body === body, "A post-replacement metadata revision hid the new body");
  }),
  testCase("RECAPTURE-EMBED", "recapturing a corrected card never embeds the stored body", async ctx => {
    if (!ctx.adapter.capture.admit) return "needs capture.admit";
    const initial = message("manual", "Remember this Albatross field guide.\n\n" +
      "Keep a log of every maintenance visit. ".repeat(7).trimEnd());
    const control = message("control", "Remember this separate safety checklist. " +
      "Check the flashlight at the supply station. ".repeat(7).trimEnd());
    const f = await fixture(ctx, initial);
    await f.correct("none");
    const before = (await dumpOwner(ctx, f)).documentCards;
    /** @type {string[][]} */
    const embeddings = [];
    /** @type {string[]} */
    const puts = [];
    const service = createMemoryService({
      storage: { ...f.storage, documentCards: { ...f.cards, async put(tx, scope, card, embedding) {
        const result = await f.cards.put(tx, scope, card, embedding);
        if (card.id === f.card.id) puts.push(result.status);
        return result;
      } } },
      ...(ctx.harness.hashSessionKey && { documentCardSessionKey: (/** @type {DocumentCardSession} */ { client, sessionId }) =>
        ctx.harness.hashSessionKey?.(client, sessionId) ?? null }),
      clock: assemblyClock(), config: { documentCards: { enabled: true } },
      model: { model: "test", contextWindow: 32_768, countTokens: () => 1, async call() { return { items: [] }; } },
      embedder: { model: "test", dimensions: ctx.embeddingDimensions ?? 1, async embed(texts) {
        embeddings.push([...texts]);
        return texts.map(() => Float32Array.from(ctx.embeddingDimensions ? ctx.vec(0) : [1]));
      } },
      gate: { async assertOpen() {} }, tokens: { countTokens: () => 1 },
    });
    const selection = { client, sessionId, eventId: "fresh-event" };
    equal((await service.enqueueCapture(f.scope, { ...selection, messages: [initial, control] })).status,
      "accepted", "Expected fresh event admission");
    equal((await service.runCapture(f.scope, selection)).status, "done", "Expected recapture to finish");
    check(embeddings.flat().some(text => text.includes(control.content)), "Expected the eligible control to reach the embedder");
    check(!embeddings.flat().some(text => text.includes(f.card.body)), "The embedder received the old card body");
    equal(puts, ["unchanged"], "Recapture must keep the stored body revision");
    const after = (await dumpOwner(ctx, f)).documentCards;
    const storedCard = (/** @type {unknown} */ snapshot) => {
      check(Array.isArray(snapshot), "Expected a card storage snapshot");
      return snapshot.flatMap(({ cards }) => cards).find(([id]) => id === f.card.id);
    };
    check(storedCard(before), "Expected the old body in storage");
    equal(storedCard(after), storedCard(before), "Recapture changed the stored card");
  }, ["rawArchive"]),
  testCase("SAME-BODY-PUT", "a different content hash and title cannot advance an unchanged body's citation", async ctx => {
    const f = await fixture(ctx);
    const { memories } = f.storage;
    const metadata = await f.write(tx => memories.touchDuplicate(tx, f.scope, f.link.id, [], { confidence: 0.7 }, nextDay));
    equal(metadata.revision, f.link.revision + 1, "Expected a metadata revision before replacement");
    const next = await row(ctx, corrected);
    const writeFact = await legacyTextFact(ctx, f, "edit", true);
    const { revision } = await f.write(async tx => {
      await writeFact(tx);
      return memories.replaceContent(tx, f.scope, f.link.id, metadata.revision, next, null, nextDay);
    });
    const sourceMemories = [{ id: f.link.id, revision }];
    const put = async (/** @type {string} */ body, /** @type {string} */ title) => {
      const contentHash = await ctx.hash(JSON.stringify([title, body]));
      return f.write(tx => f.cards.put(tx, f.scope, { ...f.card, body, title, contentHash, sourceMemories }));
    };
    equal((await put(f.card.body, f.card.title)).status, "replaced", "Expected a same-body put with a different hash");
    equal(await f.visible(), [], "Changing only the hash advanced the old citation");
    equal((await put(f.card.body, "Revised title")).status, "replaced", "Expected a same-body put with a revised title");
    equal(await f.visible(), [], "Changing the title and hash advanced the old citation");
    const body = "Every visit checks the new hardware.";
    await put(body, "Revised title");
    const read = await f.reads.readCard(f.scope, f.card.id);
    check(read.status === "found" && read.card.body === body, "Expected delivery of the actual replacement body");
    const stored = await f.read(tx => f.cards.get(tx, f.scope, f.card.id));
    equal(stored?.sourceMemories, sourceMemories, "The new body did not advance the citation");
  }),
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

import { buildDocumentCard } from "@cairn-ink/core/routing";
import { createMemoryService } from "@cairn-ink/core/service";
import { assemblyClock, fixtureCount, formatAssembly } from "./context-assembly-cases.mjs";
import { check, equal, rejects, row } from "./support.mjs";

/** @import { CaptureMessage, ContextCardRef, ContextReadSet, ReadContextInput, ReadContractStorage,
 * Scope, StoredDocumentCardRecord, Tx } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */

/** @param {CaseContext} ctx */
function fixture(ctx) {
  const storage = /** @type {ReadContractStorage<StoredDocumentCardRecord>} */ (ctx.adapter);
  const { uow, raw, documentCards: cards } = storage;
  check(cards?.visibilityInputs && raw?.fenceSession && storage.contextRead, "Expected document-card Context Read ports");
  const fenceSession = raw.fenceSession.bind(raw);
  const scope = ctx.scope(null);
  /** @type {ContextReadSet} */
  const set = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] };
  /** @type {ReadContextInput} */
  const input = { query: "albatross", types: ["card"], intent: "current" };
  const clock = assemblyClock();
  const service = createMemoryService({
    storage, clock, config: {},
    model: { model: "unused", contextWindow: 1, countTokens: () => 0,
      async call() { throw new Error("Context Read used the model"); } },
    embedder: { model: "unused", dimensions: 4, async embed() { throw new Error("Context Read used the embedder"); } },
    gate: { async assertOpen() {} }, tokens: { countTokens: () => 0 },
    contextReadFormat: formatAssembly, contextReadCounter: { count: fixtureCount },
  });
  const { findCandidates, fetchEvidence, readContext } = service;
  check(findCandidates && fetchEvidence && readContext, "Expected Context Read service entries");

  /** @template T @param {(tx: Tx) => Promise<T>} fn */
  const write = fn => uow.run(ctx.owner, { pauseLock: true }, fn);

  /** @param {string} address @param {string} content @param {Scope} [target] */
  async function archive(address, content, target = scope) {
    const client = "fixture", sessionId = "archive-" + address;
    const key = { scope: target, client, sessionId, eventId: address, payloadDigest: "a".repeat(64) };
    /** @type {CaptureMessage} */
    const message = { id: address, role: "user", content, occurredAtMs: 1 };
    await uow.run(target.owner, { pauseLock: true }, tx => raw.archive(tx, key, [message]));
    return { message, source: { client, sessionId, messageId: message.id } };
  }

  /** @param {string} address @param {StoredDocumentCardRecord["sourceMemories"]} [sourceMemories]
   * @param {Scope} [target] */
  async function card(address, sourceMemories = [], target = scope) {
    const { message, source } = await archive(address, "Albatross notes\nThe albatross nests by the shore.", target);
    const canonicalSessionKey = ctx.harness.hashSessionKey?.(source.client, source.sessionId) ?? source.sessionId;
    const { card } = await buildDocumentCard(message, { scope: target, client: source.client, canonicalSessionKey });
    check(card, "Expected a routed card");
    const record = { id: card.id, scope: target, origin: /** @type {const} */ ("router"), title: card.title, body: card.body,
      contentHash: await ctx.hash(card.body), date: card.date, sourceMessage: source, sourceMemories, sentences: [], stale: [] };
    await uow.run(target.owner, { pauseLock: true }, tx => cards.put(tx, target, record));
    return record;
  }
  /** @param {string} cardId @param {string} date @param {string} sentence @param {string} quote */
  async function amend(cardId, date, sentence, quote) {
    const { source } = await archive(date, quote);
    await write(tx => cards.amend(tx, scope, cardId, { amendmentId: date, date, sentence, quote, sourceMessage: source }));
    return source;
  }
  /** @param {string} text */
  async function memory(text) {
    const input = await row(ctx, text);
    const { id, revision } = await write(tx => storage.memories.insert(tx, scope, input, [], 1));
    return { type: /** @type {const} */ ("memory"), scope, id, revision };
  }
  const find = () => findCandidates(set, input);
  /** @param {ContextCardRef} ref */
  const fetch = ref => fetchEvidence(set, { refs: [ref], intent: "current" });
  /** @param {Partial<ReadContextInput>} [overrides] */
  const read = overrides => readContext(set, { ...input, ...overrides });
  /** @param {{client: string, sessionId: string}} source */
  const fence = source => write(tx => fenceSession(tx, scope, source));
  return { scope, set, cards, fetchEvidence, write, fence, card, amend, memory, find, fetch, read };
}

const needs = /** @type {ConformanceCase["needs"]} */ (["contextRead", "documentCards", "rawArchive"]);
const older = "The nests moved uphill.";
const newer = "The nests moved inland.";
const olderQuote = "They now nest on the far hillside.";
const newerQuote = "They now nest in the interior.";

/** @type {readonly ConformanceCase[]} */
export const CONTEXT_READ_DOCUMENT_CARD_CASES = [
  {
    id: "T-CONTEXT-DOCUMENT-CARD-1",
    title: "finds and fetches a router card and assembles its visible amendments",
    needs,
    async run(ctx) {
      const f = fixture(ctx);
      const card = await f.card("initial");
      await f.amend(card.id, "2025-09-03", newer, newerQuote);
      const forgotten = await f.amend(card.id, "2025-09-02", older, olderQuote);
      const found = await f.find();
      equal(found.coverage.byType.card?.eligible, 1, "Expected one eligible card");
      equal(found.coverage.byType.card?.indexed, 1, "Expected one indexed card");
      const ref = found.items[0]?.ref;
      check(ref?.type === "card", "Expected a qualified card ref");
      const fetched = await f.fetch(ref);
      equal(fetched.items, [{ type: "card", ref, title: card.title, body: card.body, origin: "router",
        state: "active", triggerMemoryRefs: [], support: {}, qualification: {}, provenance: {}, bindings: [] }],
        "Fetch returns the qualified base evidence");
      const { assembly, snapshot, diagnostics } = await f.read();
      const item = assembly.items[0];
      check(item && "sources" in item && item.ref.type === "card" && snapshot, "Expected one qualified assembled card");
      equal(assembly.items.length, 1, "Amendments share the card's item slot");
      equal(item.body, [card.title + "\n" + card.body, "", "2025-09-02: " + older, "2025-09-03: " + newer,
        "These amendments are later changes and take precedence over the card text."].join("\n"), "Expected both changes in date order");
      equal(item.sources, [
        { index: 0, date: "2025-09-02", role: "user", excerpt: olderQuote },
        { index: 1, date: "2025-09-03", role: "user", excerpt: newerQuote },
      ], "Expected the amendment source messages");
      equal(diagnostics.budget.used, fixtureCount(formatAssembly(assembly)), "Expected the full item to be metered");
      equal((await f.fetchEvidence(f.set, { snapshot })).items.map(({ ref }) => ref), [ref], "Assembly snapshot replays");

      await f.fence(forgotten);
      const after = (await f.read()).assembly.items[0];
      check(after && "sources" in after && after.body.includes(newer) && !after.body.includes(older),
        "A forgotten amendment source must remove only that amendment");
      equal(after.sources, [{ index: 0, date: "2025-09-03", role: "user", excerpt: newerQuote }],
        "A forgotten amendment source must not appear as a quote");
    },
  },
  {
    id: "T-CONTEXT-DOCUMENT-CARD-2",
    title: "withholds linked, source-denied, hidden, and foreign cards from every Context Read entry",
    needs,
    async run(ctx) {
      const f = fixture(ctx);
      const linked = await f.memory("The albatross feeds on squid.");
      const dependent = await f.card("dependent", [linked]);
      const sourceFenced = await f.card("source-fenced");
      const sourceDeleted = await f.card("source-deleted");
      const hidden = await f.card("hidden");
      const foreign = await f.card("foreign", [], { ...f.scope, owner: ctx.otherOwner });
      const found = await f.find();
      equal(found.items.length, 4, "Only cards from the caller's owner are searchable");
      const snapshot = (await f.read()).snapshot;
      check(snapshot, "Expected a snapshot before forget");
      await ctx.harness.seedFact(ctx.owner, { ...f.scope, kind: "identity", origin: "forget", actionId: "forget-linked", memoryId: linked.id });
      await f.fence(sourceFenced.sourceMessage);
      const raw = ctx.adapter.raw;
      check(raw?.deleteConversation, "Expected Raw deletion");
      await f.write(tx => raw.deleteConversation(tx, f.scope, sourceDeleted.sourceMessage));
      await f.write(tx => f.cards.hide(tx, f.scope, hidden.id, "forget"));

      equal((await f.find()).items, [], "Withheld cards must not be searchable");
      equal((await f.read()).assembly.items, [], "Withheld cards must not be assembled");
      for (const { ref } of found.items) {
        check(ref.type === "card", "Expected a card reference");
        await rejects(() => f.fetch(ref), "evidence_unavailable");
      }
      check(found.items.some(({ ref }) => ref.id === dependent.id), "The forgotten memory had a discoverable dependent");
      const foreignRef = { ...found.items[0].ref, type: /** @type {const} */ ("card"), scope: foreign.scope, id: foreign.id, bodyRevision: 1 };
      await rejects(() => f.fetch(foreignRef), "authority_required");
      await rejects(() => f.fetch({ ...foreignRef, scope: f.scope }), "evidence_unavailable");
      await rejects(() => f.fetchEvidence(f.set, { snapshot }), "snapshot_stale");
    },
  },
  {
    id: "T-CONTEXT-DOCUMENT-CARD-3",
    title: "fits whole cards with their newest amendments and deduplicates cited memories",
    needs,
    async run(ctx) {
      const f = fixture(ctx);
      const linked = await f.memory("The albatross feeds on squid.");
      const card = await f.card("initial", [linked]);
      const bare = await f.read();
      await f.amend(card.id, "2025-09-02", older, olderQuote);
      await f.amend(card.id, "2025-09-03", newer, newerQuote);
      const full = await f.read();
      const noAmendments = await f.read({ budget: { maxItems: 1, maxTokens: Math.max(64, bare.diagnostics.budget.used) } });
      equal(noAmendments.assembly.items.map(item => item.body), bare.assembly.items.map(item => item.body),
        "The bare card still fits when the suffix exceeds the budget");

      const one = await f.read({ budget: { maxItems: 1, maxTokens: full.diagnostics.budget.used - 1 } });
      const item = one.assembly.items[0];
      check(item && "sources" in item && item.body.includes(newer) && !item.body.includes(older),
        "The oldest amendment must be dropped first");
      equal(one.assembly.items.length, 1, "The card still uses a single item");
      equal(item.sources.map(source => "excerpt" in source ? source.excerpt : null), [newerQuote], "Only shown amendments supply sources");

      const combined = await f.read({ types: ["memory", "card"], budget: { maxItems: 2 } });
      equal(combined.assembly.items.map(({ ref }) => ref.id), [card.id], "A selected card replaces its cited memory");
      const ref = (await f.find()).items[0]?.ref;
      check(ref?.type === "card", "Expected the linked card");
      const evidence = (await f.fetch(ref)).items[0];
      check(evidence.type === "card", "Expected card evidence");
      equal(evidence.triggerMemoryRefs, [linked], "Only qualified source memories are cited");
    },
  },
];

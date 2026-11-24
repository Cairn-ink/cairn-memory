import { CoreError } from "@cairn-ink/core";
import { buildDocumentCard } from "@cairn-ink/core/routing";
import { check, equal, readDump, rejects, row } from "./support.mjs";

/** @import { Capabilities } from "@cairn-ink/core" */
/** @import { CaptureMessage, DocumentCardRecord, DocumentCardStore, Scope, StoredDocumentCardRecord, Tx } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */
/** @typedef {DocumentCardRecord["sourceMemories"]} Links */
/** @typedef {Parameters<DocumentCardStore<StoredDocumentCardRecord>["put"]>[2]} CardWrite */

const page = { cursor: null, limit: 10 };

/** @param {CaseContext} ctx @param {Scope} [scope] */
function fixture(ctx, scope = ctx.scope(null)) {
  const { uow, documentCards } = ctx.adapter;
  check(documentCards, "Document card store is required");
  /** @template T @param {(tx: Tx) => Promise<T>} fn */
  const read = (fn) => uow.run(scope.owner, { readOnly: true }, fn);
  /** @template T @param {(tx: Tx) => Promise<T>} fn */
  const write = (fn) => uow.run(scope.owner, { pauseLock: true }, fn);
  return {
    scope, documentCards, read, write,
    /** @param {CardWrite} card */
    put: (card) => write((tx) => documentCards.put(tx, scope, card)),
    /** @param {string} id @param {Links} links */
    link: (id, links) => write((tx) => documentCards.linkMemories(tx, scope, id, links)),
    /** @param {string} id */
    get: (id) => read((tx) => documentCards.get(tx, scope, id)),
    list: () => read((tx) => documentCards.list(tx, scope)),
  };
}

/** @param {CaseContext} ctx @param {Scope} scope @param {string} id @param {Links} [sourceMemories]
 * @returns {Promise<CardWrite>} */
async function importedCard(ctx, scope, id, sourceMemories = []) {
  return {
    id, scope, origin: "import", title: "Imported document", body: "Document body",
    contentHash: await ctx.hash("Document body"), date: null, sourceMessage: null, sourceMemories, sentences: [], stale: [],
  };
}

/** @param {CaseContext} ctx @param {Scope} scope @param {Links} [sourceMemories] */
async function routedCard(ctx, scope, sourceMemories = []) {
  const client = "test-client";
  const sessionId = "conversation";
  const canonicalSessionKey = ctx.harness.hashSessionKey?.(client, sessionId) ??
    (ctx.sessionRefs === "plain" ? sessionId : undefined);
  check(canonicalSessionKey, "Expected the capture session key");
  /** @type {CaptureMessage} */
  const message = { id: "source-message", role: "user", occurredAtMs: 1, content: "Document title\n\nRouter document body." };
  const { card } = await buildDocumentCard(message, { scope, client, canonicalSessionKey });
  check(card, "Expected a routed card");
  /** @type {Parameters<DocumentCardStore["put"]>[2]} */
  const input = {
    id: card.id, scope, origin: "router", title: card.title, body: card.body, contentHash: await ctx.hash(card.body),
    date: card.date, sourceMessage: { client, sessionId, messageId: message.id }, sourceMemories, sentences: [], stale: [],
  };
  return { card: input, message };
}

/** @param {Links | undefined} links */
function revisions(links) {
  check(links, "Expected stored source memories");
  return new Map(links.map(({ id, revision }) => [id, revision]));
}

/** @param {number} number @param {string} title @param {ConformanceCase["run"]} run
 * @param {Array<keyof Capabilities>} [extraNeeds] @returns {ConformanceCase} */
const linkCase = (number, title, run, extraNeeds = []) =>
  ({ id: `T-CARD-LINK-${number}`, title, needs: ["documentCards", ...extraNeeds], run });

export const DOCUMENT_CARD_LINK_CASES = [
  linkCase(1, "linkMemories unions by ID and keeps the highest revision", async (ctx) => {
    const store = fixture(ctx);
    const initial = [{ id: "retained", revision: 8 }, { id: "upgraded", revision: 1 }];
    const card = await importedCard(ctx, store.scope, "union", initial);
    await store.put(card);
    const before = await store.get(card.id);
    const incoming = [{ id: "upgraded", revision: 6 }, { id: "added", revision: 3 },
      { id: "upgraded", revision: 4 }, { id: "added", revision: 2 }, { id: "retained", revision: 7 }];
    equal(await store.link(card.id, incoming), { status: "linked" }, "A changed union must return linked");
    const after = await store.get(card.id);
    check(after, "Expected the linked card");
    const expected = new Map([["retained", 8], ["upgraded", 6], ["added", 3]]);
    equal(after.sourceMemories.length, expected.size, "Each ID must occur once");
    equal(revisions(after.sourceMemories), expected, "The union must keep all IDs at their highest revisions");
    equal(revisions((await store.list())[0]?.sourceMemories), expected, "List must expose the updated bindings");
    equal({ ...after, sourceMemories: initial }, before, "Linking must preserve the rest of the card");
  }),

  linkCase(2, "each changed union advances the index exactly once", async (ctx) => {
    const store = fixture(ctx);
    const { placement } = ctx.adapter;
    check(placement, "Placement must expose the owner index revision");
    const card = await importedCard(ctx, store.scope, "revision");
    await store.put(card);
    const revision = async () => (await store.read((tx) => placement.catalog(tx, store.scope, page))).indexRevision;
    const before = await revision();
    await store.write(async (tx) => {
      const link = (/** @type {Links} */ links) => store.documentCards.linkMemories(tx, store.scope, card.id, links);
      equal(await link([{ id: "a", revision: 1 }, { id: "b", revision: 2 }]), { status: "linked" }, "First union changed");
      equal(await link([{ id: "a", revision: 2 }, { id: "c", revision: 1 }]), { status: "linked" }, "Second union changed");
      equal(await link([{ id: "a", revision: 1 }, { id: "b", revision: 2 }]), { status: "unchanged" }, "Older and equal links are no-ops");
      equal(await link([]), { status: "unchanged" }, "An empty union is a no-op");
    });
    equal(await revision(), before + 2, "The index must advance once per changed union in the same transaction");
    equal(await store.link(card.id, [{ id: "a", revision: 2 }]), { status: "unchanged" }, "Identical replay is unchanged");
    equal(await revision(), before + 2, "An unchanged replay must leave the committed index alone");
  }, ["placement"]),

  linkCase(3, "unknown, out-of-scope and tombstoned IDs leave the store unchanged", async (ctx) => {
    const store = fixture(ctx);
    const otherNamespace = fixture(ctx, ctx.scope("team"));
    const otherOwner = fixture(ctx, { ...store.scope, owner: ctx.otherOwner });
    const card = await importedCard(ctx, store.scope, "scoped");
    await store.put(card);
    const links = [{ id: "late", revision: 1 }];
    const before = await readDump(ctx.harness);
    equal(await store.link("missing", links), { status: "not_found" }, "An unknown card must report not_found");
    equal(await otherNamespace.link(card.id, links), { status: "not_found" }, "Another namespace must not find the card");
    equal(await otherOwner.link(card.id, links), { status: "not_found" }, "Another owner must not find the card");
    equal(await readDump(ctx.harness), before, "Missing cards must leave the store unchanged");
    await store.write((tx) => store.documentCards.hide(tx, store.scope, card.id, "forget"));
    const hidden = await readDump(ctx.harness);
    equal(await store.link(card.id, links), { status: "tombstoned" }, "A hidden card must report tombstoned");
    equal(await store.get(card.id), null, "Linking must not restore a tombstoned card");
    equal(await readDump(ctx.harness), hidden, "Tombstoned cards must leave the store unchanged");
  }),

  linkCase(4, "a router recapture unions on replacement and same-hash puts stay unchanged", async (ctx) => {
    const store = fixture(ctx);
    const { card } = await routedCard(ctx, store.scope, [{ id: "retained", revision: 2 }]);
    await store.put(card);
    await store.link(card.id, [{ id: "retained", revision: 4 }, { id: "late", revision: 3 }]);
    const body = "Recaptured document body.";
    const replacement = { ...card, body, contentHash: await ctx.hash(body), sourceMemories: [
      { id: "retained", revision: 1 }, { id: "new", revision: 5 },
    ] };
    equal(await store.put(replacement), { status: "replaced" }, "Recapture must replace changed content");
    const expected = new Map([["retained", 4], ["late", 3], ["new", 5]]);
    equal(revisions((await store.get(card.id))?.sourceMemories), expected, "Recapture must union prior and new links");
    equal(await store.put({ ...replacement, sourceMemories: [{ id: "other", revision: 6 }] }),
      { status: "unchanged" }, "Same-hash put must remain idempotent");
    equal(revisions((await store.get(card.id))?.sourceMemories), expected, "A same-hash replay must preserve bindings");
  }),

  linkCase(5, "linkMemories uses the live transaction and rolls back with it", async (ctx) => {
    const store = fixture(ctx);
    const card = await importedCard(ctx, store.scope, "rollback");
    await store.put(card);
    const before = await readDump(ctx.harness);
    await rejects(() => store.write(async (tx) => {
      equal(await store.documentCards.linkMemories(tx, store.scope, card.id, [{ id: "temporary", revision: 1 }]),
        { status: "linked" }, "The union must change in the live transaction");
      equal((await store.documentCards.get(tx, store.scope, card.id))?.sourceMemories, [{ id: "temporary", revision: 1 }],
        "The same transaction must see the new link");
      throw new CoreError("revision_conflict");
    }), "revision_conflict");
    equal(await readDump(ctx.harness), before, "Rollback must discard links and their index advance");
  }),

  linkCase(6, "topic views require the current revision of a memory linked after filing", async (ctx) => {
    const store = fixture(ctx);
    const { placement, memories } = ctx.adapter;
    check(placement?.forCards, "Card placement and annotations are required");
    const forCards = placement.forCards.bind(placement);
    const topicRow = await row(ctx, "Topic title source");
    const linkedRow = await row(ctx, "Later-linked memory");
    const seed = await store.write((tx) => memories.insert(tx, store.scope, topicRow, [], 1));
    const linked = await store.write((tx) => memories.insert(tx, store.scope, linkedRow, [], 1));
    const catalog = (/** @type {Tx} */ tx) => placement.catalog(tx, store.scope, page);
    const created = await store.write(async (tx) => placement.applyPlacement(tx, store.scope, {
      indexRevision: (await catalog(tx)).indexRevision, memoryRevisions: [{ memoryId: seed.id, revision: seed.revision }],
    }, { items: [{ memoryId: seed.id, parentIds: [], newL1: { title: "Child topic", parentL2Ids: [], newL2Title: "Parent topic" } }] }));
    const child = created.createdTopics.find(({ level }) => level === "L1")?.id;
    check(child, "Expected a child topic");
    const { card } = await routedCard(ctx, store.scope);
    await store.put(card);
    await store.write(async (tx) => placement.applyCardPlacement(tx, store.scope, {
      indexRevision: (await catalog(tx)).indexRevision, cards: [{ cardId: card.id, contentHash: card.contentHash }],
    }, { items: [{ cardId: card.id, parentIds: [child] }] }));
    const link = (/** @type {number} */ revision) => store.link(card.id, [{ id: linked.id, revision }]);
    equal(await link(linked.revision), { status: "linked" }, "Filing must allow a later link");
    const annotations = () => store.read((tx) => placement.forCard(tx, store.scope, card.id));
    equal(await annotations(), [child], "Linking a current memory must keep the card filed");
    const next = await row(ctx, "Corrected later-linked memory");
    const { revision } = await store.write((tx) => memories.replaceContent(tx, store.scope, linked.id, linked.revision, next, null, 2));
    equal(await annotations(), [], "A stale linked revision must withhold the card from forCard");
    equal(await store.read((tx) => forCards(tx, store.scope, [card.id])), [], "A stale linked revision must withhold batch annotations");
    const members = await store.read((tx) => placement.members(tx, store.scope, child, page));
    equal(members.items.some(({ kind }) => kind === "card"), false, "A stale linked revision must withhold topic members");
    const topics = await store.read((tx) => placement.list(tx, store.scope, page));
    equal(topics.items.find(({ id }) => id === child)?.cardCount, 0, "A stale linked revision must stop contributing to counts");
    equal(await link(revision), { status: "linked" }, "The higher revision must replace the old binding");
    equal(await annotations(), [child], "Refreshing the linked revision must restore the existing membership");
    const result = await store.write((tx) => store.documentCards.hideWhere(tx, store.scope, { sourceMemoryId: linked.id }, "forget"));
    equal(result, { hidden: 1 }, "Forget by source memory ID must find the later-linked card");
    equal(await annotations(), [], "Forgetting a linked memory must remove the existing membership");
  }, ["placement"]),

  linkCase(7, "a card source must pass the Raw archive visibility check", async (ctx) => {
    const store = fixture(ctx);
    const { raw, fence } = ctx.adapter;
    check(raw, "Raw archive is required");
    const { card, message } = await routedCard(ctx, store.scope);
    const { client, sessionId } = card.sourceMessage;
    await store.put(card);
    const ref = { type: /** @type {const} */ ("card"), id: card.id, namespace: store.scope.namespace };
    const visible = () => store.read((tx) => fence.assertVisible(tx, { owner: ctx.owner, namespaces: [store.scope.namespace] }, [ref]));
    equal(await visible(), [], "A missing Raw source must withhold the card");
    await store.write((tx) => raw.archive(tx, { scope: store.scope, client, sessionId,
      eventId: "card-capture", payloadDigest: "a".repeat(64) }, [message]));
    equal(await visible(), [ref], "An archived visible message must allow the card");
    await store.write(async (tx) => {
      await raw.fenceSession(tx, store.scope, { client, sessionId });
      equal(await fence.assertVisible(tx, { owner: ctx.owner, namespaces: [store.scope.namespace] }, [ref]), [],
        "The live Raw fence must withhold the source card");
    });
  }, ["rawArchive"]),
];

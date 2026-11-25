import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { allDigests } from "@cairn-ink/core";
import { createMemoryAdapter } from "../../adapter-memory/src/index.mjs";
import { openSqliteAdapter } from "../src/index.mjs";
import { service } from "./migration-fixtures.mjs";
import { scratch, sha256 } from "./storage-fixtures.mjs";

const scope = { owner: "owner-a", namespace: "space-a" };
const controls = [
  { ...scope, namespace: "space-b" },
  { ...scope, owner: "owner-b" },
  { owner: "owner-b", namespace: "space-b" },
];
const options = { capabilities: { placement: true, conflictEdges: true, supersession: true,
  inspect: true, receiptAttachAdvancesRevision: true }, now: () => 1000 };
const source = { kind: "mcp", client: null, sessionId: null };
const page = { cursor: null, limit: 20 };
const emptyLink = { supersededBy: null, supersedes: [] };
const read = (adapter, work, target = scope) => adapter.uow.run(target.owner, { readOnly: true }, work);
const write = (adapter, work, target = scope) => adapter.uow.run(target.owner, { pauseLock: true }, work);

async function store(t) {
  const { path, remove } = scratch();
  let adapter;
  t.after(async () => {
    try { await adapter?.close(); }
    finally { remove(); }
  });
  adapter = await openSqliteAdapter(path, options);
  return {
    get adapter() { return adapter; },
    async reopen() {
      await adapter.close();
      const bytes = readFileSync(path);
      adapter = await openSqliteAdapter(path, options);
      return bytes;
    },
  };
}

async function insert(adapter, text, target = scope, receipts = []) {
  const digests = await allDigests(text, null);
  const content = { text, textHash: "sha256:" + digests[0].value, digests, kind: "fact", origin: "explicit",
    confidence: 1, embedding: null, source };
  return write(adapter, tx => adapter.memories.insert(tx, target, content, receipts, 10), target);
}

const place = ({ id }, parentIds = [], title, newL2Title) => ({ memoryId: id, parentIds,
  ...(title && { newL1: { title, parentL2Ids: [], newL2Title } }) });

function apply(adapter, target, refs, items) {
  return write(adapter, async tx => {
    const { indexRevision } = await adapter.placement.catalog(tx, target, page);
    const memoryRevisions = refs.map(({ id, revision }) => ({ memoryId: id, revision }));
    return adapter.placement.applyPlacement(tx, target, { indexRevision, memoryRevisions }, { items });
  }, target);
}

function inspect(adapter, tx, target, ref) {
  return adapter.inspect.item(tx, target, ref.id, { limit: 10, includeQualification: false });
}

async function graph(adapter, target, title, receipts = []) {
  const lost = await insert(adapter, "Lake sample to withdraw", target, receipts);
  const kept = await insert(adapter, "Independent sample to keep", target);
  const previous = await insert(adapter, "Historical sample", target);
  await write(adapter, async tx => {
    await adapter.conflicts.insert(tx, target, { left: lost, right: kept, source: "explicit-hint", relation: "contradicts" }, 20);
    await adapter.supersession.record(tx, target, { previous, replacement: lost }, lost.receiptIds ?? [], 20);
    await adapter.supersession.markHistorical(tx, target, previous.id, 20);
  }, target);
  const { createdTopics } = await apply(adapter, target, [lost, kept],
    [place(lost, [], title, title + " collection"), place(kept)]);
  const child = createdTopics.find(topic => topic.level === "L1");
  await apply(adapter, target, [kept], [place(kept, [child.id])]);
  return { lost, kept, previous, createdTopics, child };
}

function view(adapter, target, { lost, kept, previous, createdTopics }) {
  return read(adapter, async tx => {
    const { item } = await inspect(adapter, tx, target, lost);
    const { item: other } = await inspect(adapter, tx, target, kept);
    const { item: historical } = await inspect(adapter, tx, target, previous);
    const listing = await adapter.inspect.list(tx, target, { states: ["active", "historical"], limit: 20 });
    const { placement, conflicts, supersession } = adapter;
    return {
      pending: (await placement.pending(tx, target, { limit: 5 })).map(row => row.memoryId),
      catalog: (await placement.catalog(tx, target, page)).items,
      list: (await placement.list(tx, target, page)).items,
      members: await Promise.all(createdTopics.map(async ({ id }) =>
        (await placement.members(tx, target, id, page)).items.map(member => member.id))),
      single: await placement.forMemory(tx, target, lost.id),
      batch: await placement.forMemories(tx, target, [lost.id, kept.id]),
      conflicts: await conflicts.list(tx, target, kept.id),
      conflictBatch: [...(await conflicts.readMany(tx, target, [lost.id, kept.id])).values()],
      forward: await supersession.read(tx, target, previous.id),
      reverse: await supersession.read(tx, target, lost.id),
      supersessionBatch: [...(await supersession.readMany(tx, target, [previous.id, lost.id])).values()],
      filing: [item.memory.filing.status, listing.rows.find(row => row.id === lost.id).filing.status],
      inspectPlacement: item.placements,
      inspectReceiptCount: item.receipts.length,
      inspectConflicts: other.conflicts,
      inspectSupersession: historical.supersession,
    };
  }, target);
}

const rootSession = { client: "synthetic-client", sessionId: "root-conversation" };
const forkSession = { ...rootSession, sessionId: "copied-conversation" };
const message = { id: "same-message", role: "user", occurredAtMs: 100, content: "A jay selected the seventh sector." };
const captureKey = (target, session, turn) =>
  ({ ...session, scope: target, eventId: session.sessionId, payloadDigest: sha256(turn.content) });

async function archive(adapter, target, session, turn) {
  const key = captureKey(target, session, turn);
  await write(adapter, async tx => {
    assert.deepEqual(await adapter.capture.eligible(tx, key, [turn]), [0]);
    await adapter.raw.recordLineage(tx, key, [turn]);
    assert.deepEqual(await adapter.raw.archive(tx, key, [turn]), { archived: 1 });
  }, target);
}

for (const hasExcerpt of [true, false]) {
  test(`durable root deletion withholds fork-derived evidence ${hasExcerpt ? "with" : "without"} a receipt excerpt`, async t => {
    const db = await store(t);
    const title = "Sector Seven Blue Jay";
    await archive(db.adapter, scope, rootSession, message);
    await archive(db.adapter, scope, forkSession, message);
    const address = { ...forkSession, messageId: message.id, role: message.role, occurredAtMs: message.occurredAtMs };
    const affected = await graph(db.adapter, scope, title, [{ ...address, ...(hasExcerpt && { excerpt: message.content }) }]);
    const independent = [];
    for (const [index, target] of controls.entries()) {
      const control = await graph(db.adapter, target, "Independent topic " + index, [{ ...address, ...rootSession }]);
      const before = await view(db.adapter, target, control);
      assert.equal(before.catalog.find(({ id }) => id === control.child.id).title, "Independent topic " + index);
      assert.deepEqual(before.filing, ["filed", "filed"]);
      independent.push({ target, control, before });
    }

    const before = await view(db.adapter, scope, affected);
    const { lost, kept, child } = affected;
    assert.equal(before.inspectReceiptCount, hasExcerpt ? 1 : 0);
    assert.equal(before.catalog.find(({ id }) => id === child.id).title, title);
    assert.ok(before.members.every(ids => ids.includes(lost.id)));
    assert.deepEqual(before.filing, ["filed", "filed"]);
    assert.equal(before.inspectConflicts[0].memoryId, lost.id);
    assert.equal(before.inspectSupersession.replacement.memoryId, lost.id);
    assert.ok((await db.reopen()).includes(title), "title bytes exist before withdrawal");

    const deletion = await write(db.adapter, tx => db.adapter.raw.deleteConversation(tx, scope, rootSession));
    assert.deepEqual(deletion, { rawDeleted: 1 });
    const bytes = await db.reopen();
    const after = await view(db.adapter, scope, affected);
    assert.equal(after.inspectReceiptCount, 0);
    for (const { target, control, before } of independent) {
      assert.deepEqual(await view(db.adapter, target, control), before);
    }

    const late = { ...message, id: "unseen-late-message", occurredAtMs: 500 };
    const key = { ...captureKey(scope, rootSession, late), eventId: "late-event" };
    assert.deepEqual(await write(db.adapter, tx => db.adapter.raw.archive(tx, key, [late])), { archived: 0 });
    assert.deepEqual({
      titleBytes: bytes.includes(title),
      pending: after.pending.includes(lost.id),
      catalogTitles: after.catalog.map(topic => topic.title),
      listTitlesAndMembers: after.list.map(topic => [topic.title, topic.newestMemberIds]),
      members: after.members,
      single: after.single,
      batch: after.batch,
      filing: after.filing,
      inspectPlacement: after.inspectPlacement,
      conflicts: after.conflicts,
      conflictBatch: after.conflictBatch,
      inspectConflicts: after.inspectConflicts,
      forward: after.forward,
      reverse: after.reverse,
      supersessionBatch: after.supersessionBatch,
      inspectReplacement: after.inspectSupersession.replacement,
    }, {
      titleBytes: false,
      pending: false,
      catalogTitles: [null, null],
      listTitlesAndMembers: [[null, [kept.id]], [null, [kept.id]]],
      members: [[kept.id], [kept.id]],
      single: [],
      batch: [{ memoryId: kept.id, topics: [{ id: child.id, title: null }] }],
      filing: ["unfiled", "unfiled"],
      inspectPlacement: [],
      conflicts: [],
      conflictBatch: [[], []],
      inspectConflicts: [],
      forward: emptyLink,
      reverse: emptyLink,
      supersessionBatch: [emptyLink, emptyLink],
      inspectReplacement: null,
    });
  });
}

test("correction preserves historical links at the recorded revision on both adapters", async t => {
  const { adapter: sqlite } = await store(t);
  async function trace(adapter) {
    const { lost, kept, previous } = await graph(adapter, scope, "Corrected source topic");
    assert.equal((await service(adapter).correct(scope, lost.id, lost.revision, "Revised lake sample", source)).status, "saved");
    return read(adapter, async tx => {
      const { item } = await inspect(adapter, tx, scope, previous);
      const { replacement, ...evidence } = item.supersession;
      const forward = await adapter.supersession.read(tx, scope, previous.id);
      const reverse = await adapter.supersession.read(tx, scope, lost.id);
      const batch = await adapter.supersession.readMany(tx, scope, [previous.id, lost.id]);
      return {
        forward: forward.supersededBy === lost.id,
        reverse: reverse.supersedes.length === 1 && reverse.supersedes[0] === previous.id,
        batch: batch.get(previous.id).supersededBy === lost.id && batch.get(lost.id).supersedes[0] === previous.id,
        replacementMatches: replacement.memoryId === lost.id,
        recordedRevision: replacement.revision,
        currentRevision: replacement.currentRevision,
        state: replacement.state,
        evidence,
        placement: await adapter.placement.forMemory(tx, scope, lost.id),
        conflicts: await adapter.conflicts.list(tx, scope, kept.id),
      };
    });
  }
  const reference = await trace(createMemoryAdapter(options));
  t.diagnostic(JSON.stringify(reference));
  assert.deepEqual(reference, {
    forward: true, reverse: true, batch: true, replacementMatches: true, recordedRevision: 1, currentRevision: 2, state: "active",
    evidence: { previousRevision: 1, receiptIds: [], evidenceAvailable: false }, placement: [], conflicts: [],
  });
  assert.deepEqual(await trace(sqlite), reference);
});

test("retired title reservations match the reference by normalized title, level and scope", async t => {
  const { adapter: sqlite } = await store(t);
  async function trace(adapter) {
    const { lost, child } = await graph(adapter, scope, "Blue Jay Notes");
    assert.equal((await service(adapter).forget(scope, lost.id, source)).status, "forgotten");
    const catalog = await read(adapter, tx => adapter.placement.catalog(tx, scope, page));
    assert.equal(catalog.items.find(topic => topic.id === child.id).title, null);
    const candidate = await insert(adapter, "Fresh independent candidate");
    async function proposal(target, row, title, parentTitle) {
      try {
        await apply(adapter, target, [row], [place(row, [], title, parentTitle)]);
        return "accepted";
      } catch (error) {
        return error.code;
      }
    }
    const sameL1 = await proposal(scope, candidate, "ＢＬＵＥ JAY NOTES");
    const sameL2 = await proposal(scope, candidate, "Unrelated child", "BLUE JAY NOTES COLLECTION");
    const differentLevel = await proposal(scope, candidate, "Blue Jay Notes collection", "Blue Jay Notes");
    const independent = [];
    for (const target of controls) {
      const row = await insert(adapter, "Independent candidate", target);
      independent.push(await proposal(target, row, "Blue Jay Notes", "Blue Jay Notes collection"));
    }
    return { sameL1, sameL2, differentLevel, independent };
  }
  const reference = await trace(createMemoryAdapter(options));
  t.diagnostic(JSON.stringify(reference));
  assert.deepEqual(reference, { sameL1: "moc_title_conflict", sameL2: "moc_title_conflict", differentLevel: "accepted",
    independent: ["accepted", "accepted", "accepted"] });
  assert.deepEqual(await trace(sqlite), reference);
});

test("members cursor is bound to its topic before checking revision", async t => {
  const { adapter } = await store(t);
  const { child, kept } = await graph(adapter, scope, "Cursor topic alpha");
  const otherMember = await insert(adapter, "Another cursor member");
  const { createdTopics: [other] } = await apply(adapter, scope, [otherMember], [place(otherMember, [], "Cursor topic beta")]);
  const members = (topic, cursor) => read(adapter, tx => adapter.placement.members(tx, scope, topic, { cursor, limit: 1 }));
  const first = await members(child.id, null);
  assert.ok(first.nextCursor);
  assert.equal((await members(child.id, first.nextCursor)).items.length, 1);
  await assert.rejects(members(other.id, first.nextCursor), { code: "invalid_cursor" });
  await apply(adapter, scope, [kept], [place(kept, [child.id, other.id])]);
  await assert.rejects(members(child.id, first.nextCursor), { code: "cursor_stale" });
  await assert.rejects(members(other.id, first.nextCursor), { code: "invalid_cursor" });
});

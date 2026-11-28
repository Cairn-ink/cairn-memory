import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { assertAdapterCapabilities, capabilities } from "../../core/src/index.mjs";
import {
  createPostgresDocumentCardStore, createPostgresSuppressionStore, createPostgresTopicStore, createPostgresUnitOfWork,
} from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const firstPage = { cursor: null, limit: 100 };
const one = { cursor: null, limit: 1 };
const hour = 3_600_000;
const vector = (first, second) => JSON.stringify([first, second, ...Array(1534).fill(0)]);
const digest = (id) => createHash("sha256").update(id).digest("hex");

async function setup(t) {
  const { pool, source } = await migrationDatabase(t);
  let clock = 100;
  const adapter = {
    uow: createPostgresUnitOfWork(source),
    capabilities: capabilities({ placement: true }),
    placement: createPostgresTopicStore({ now: () => clock }),
  };
  assertAdapterCapabilities(adapter);
  const { uow, placement } = adapter;
  const suppressions = createPostgresSuppressionStore();
  await pool.query("INSERT INTO users (id) VALUES ('owner'), ('other')");

  function lane(owner = "owner") {
    const scope = { owner, namespace: null };
    const read = (method, ...args) => uow.run(owner, { readOnly: true }, (tx) => placement[method](tx, scope, ...args));
    const write = (method, ...args) => uow.run(owner, {}, (tx) => placement[method](tx, scope, ...args));
    return {
      scope, read, write,
      async seed(id, { created = "1970-01-01T00:00:00.001Z", kind = "plugin", embedding = vector(0, 1) } = {}) {
        await pool.query(`
          INSERT INTO memories (id, user_id, text, kind, text_hash, embedding,
            embedding_model, source_kind, created_at, updated_at)
          VALUES ($1, $2, $1, 'fact', $3, $4, 'fixture', $5, $6, $6)`,
        [id, owner, digest(id), embedding, kind, created]);
        return { memoryId: id, revision: 1 };
      },
      async apply(memoryRevisions, items, indexRevision) {
        return uow.run(owner, {}, async (tx) => {
          const basis = indexRevision ?? (await placement.catalog(tx, scope, firstPage)).indexRevision;
          return placement.applyPlacement(tx, scope, { memoryRevisions, indexRevision: basis }, { items });
        });
      },
      async fact(fact) {
        const incarnation = digest(JSON.stringify(fact));
        return uow.run(owner, {}, (tx) => suppressions.writeFact(tx,
          { ...scope, ...fact, origin: "forget", actionId: "fixture" }, incarnation));
      },
    };
  }

  return { pool, uow, placement, lane, setClock: (ms) => { clock = ms; } };
}

function item({ memoryId }, parentIds = [], newL1) {
  return { memoryId, parentIds, ...(newL1 && { newL1 }) };
}

function topic(title, parentL2Ids = [], newL2Title) {
  return { title, parentL2Ids, newL2Title };
}

test("Postgres placement pages topics and distinct L2 members in core order", migrationDbTest, async (t) => {
  const { pool, lane, setClock } = await setup(t);
  const store = lane();
  const a = await store.seed("a");
  const b = await store.seed("😀");
  const c = await store.seed("\uE000");
  assert.deepEqual(await store.read("pending", { limit: 5 }), [a, c, b]);
  await assert.rejects(store.read("pending", { limit: 6 }), { code: "invalid_input" });

  const proposal = topic("Z", [], "Parent");
  const result = await store.apply([a, b], [item(a, [], proposal), item(b, [], proposal)]);
  const [parent, child] = result.createdTopics;
  assert.deepEqual(result.placed, [a, b].map(({ memoryId }) => ({ memoryId, topicIds: [child.id] })));
  assert.deepEqual(child.parentIds, [parent.id]);
  assert.deepEqual(parent.parentIds, []);

  const initialMembers = await store.read("members", child.id, firstPage);
  assert.deepEqual(initialMembers.items, [b, a].map(({ memoryId: id }) => ({ kind: "memory", id, placedAtUs: 100_000n })));

  setClock(200);
  const { createdTopics: [sibling] } = await store.apply([a, c], [
    item(a, [child.id], topic("😀", [parent.id])), item(c, [child.id]),
  ]);
  // The database retains hosted microsecond precision, including on replays.
  await pool.query(`
    UPDATE memory_topics SET placed_at = '1970-01-01T00:00:00.200007Z'
    WHERE topic_id = $1 AND memory_id = $2`, [sibling.id, a.memoryId]);
  setClock(300);
  const replayRevision = (await store.read("catalog", one)).indexRevision;
  await store.apply([a], [item(a, [child.id, sibling.id])], replayRevision);
  assert.equal((await store.read("catalog", one)).indexRevision, replayRevision);
  const first = await store.read("members", parent.id, one);
  assert.deepEqual(first.items, [{ kind: "memory", id: a.memoryId, placedAtUs: 200_007n }]);
  assert.ok(first.nextCursor);
  assert.deepEqual(await store.read("members", parent.id, { cursor: first.nextCursor, limit: 3 }), {
    items: [
      { kind: "memory", id: c.memoryId, placedAtUs: 200_000n },
      { kind: "memory", id: b.memoryId, placedAtUs: 100_000n },
    ],
    nextCursor: null,
  });
  assert.deepEqual((await store.read("members", child.id, firstPage)).items.at(-1),
    { kind: "memory", id: a.memoryId, placedAtUs: 100_000n });

  const catalog = await store.read("catalog", one);
  assert.equal(catalog.exhausted, false);
  const rest = await store.read("catalog", { cursor: catalog.nextCursor, limit: 10 });
  assert.equal(rest.exhausted, true);
  assert.equal(rest.indexRevision, catalog.indexRevision);
  assert.deepEqual([...catalog.items, ...rest.items].map(({ title }) => title), ["Z", "😀", "Parent"]);
  const list = await store.read("list", firstPage);
  assert.deepEqual(list.items.map(({ id, memberCount }) => [id, memberCount]), [[child.id, 3], [sibling.id, 1], [parent.id, 3]]);
  assert.deepEqual(list.items.at(-1).newestMemberIds, [a.memoryId, c.memoryId, b.memoryId]);
  assert.deepEqual((await store.read("list", { ...firstPage, level: "L2" })).items, [list.items.at(-1)]);
  const viaSingle = await store.read("forMemory", a.memoryId);
  assert.deepEqual(viaSingle, [child.id, sibling.id].sort());
  const batch = await store.read("forMemories", [b.memoryId, "missing", a.memoryId, b.memoryId, c.memoryId]);
  assert.deepEqual(batch.map(({ memoryId }) => memoryId), [b.memoryId, a.memoryId, c.memoryId]);
  assert.deepEqual(batch[1].topics.map(({ id }) => id), viaSingle);
  assert.deepEqual(await store.read("pending", { limit: 5 }), []);
});

test("Postgres topic visibility follows guarded revisions and hosted and core suppression", migrationDbTest, async (t) => {
  const { pool, lane } = await setup(t);
  const store = lane();
  const member = await store.seed("member");
  const source = await store.seed("forgotten source");
  const old = await store.seed("historical");
  const updated = await store.seed("updated");
  const { createdTopics: [child] } = await store.apply([member, source, old, updated], [
    item(member, [], topic("Shared title")), item(source), item(old), item(updated),
  ]);
  assert.deepEqual(await store.read("forMemories", [source.memoryId]), [{ memoryId: source.memoryId, topics: [] }]);
  await store.fact({ kind: "identity", memoryId: member.memoryId, namespace: "project" });
  assert.deepEqual(await store.read("forMemory", member.memoryId), [child.id]);
  await store.apply([source], [item(source, [child.id])]);
  assert.deepEqual((await store.read("list", firstPage)).items.map(({ title, memberCount }) => [title, memberCount]), [[child.title, 2]]);
  await store.fact({ kind: "identity", memoryId: source.memoryId });
  assert.deepEqual((await store.read("list", firstPage)).items.map(({ title, memberCount }) => [title, memberCount]), [[null, 1]]);
  assert.deepEqual((await store.read("members", child.id, firstPage)).items.map(({ id }) => id), [member.memoryId]);
  await pool.query("UPDATE memories SET revision = 2 WHERE id = $1", [updated.memoryId]);
  await pool.query("UPDATE memories SET currentness = 'historical' WHERE id = $1", [old.memoryId]);
  assert.deepEqual((await store.read("catalog", firstPage)).items, [{ ...child, title: null }]);
  assert.deepEqual((await store.read("list", firstPage)).items.map(({ title, memberCount }) => [title, memberCount]), [[null, 1]]);
  assert.deepEqual(await store.read("forMemories", [source.memoryId, member.memoryId, old.memoryId, updated.memoryId]),
    [{ memoryId: member.memoryId, topics: [{ id: child.id, title: null }] }]);
  assert.deepEqual(await store.read("pending", { limit: 5 }), [{ ...updated, revision: 2 }]);
  await assert.rejects(store.apply([source], [item(source, [child.id])]), { code: "revision_conflict" });

  const vectorMatch = await store.seed("vector match", { embedding: vector(1, 0) });
  const savedLater = await store.seed("explicit save", { kind: "mcp" });
  const hashMatch = await store.seed("exact match");
  const logged = await store.seed("forgotten log");
  const receiptLinked = await store.seed("receipt linked");
  await store.apply([vectorMatch, savedLater, hashMatch, logged, receiptLinked],
    [vectorMatch, savedLater, hashMatch, logged, receiptLinked].map((guard) => item(guard, [child.id])));
  const { createdTopics: [hosted] } = await store.apply([hashMatch], [item(hashMatch, [child.id], topic("Hosted title"))]);
  await store.apply([savedLater], [item(savedLater, [child.id, hosted.id])]);
  const hostedList = async () => (await store.read("list", firstPage)).items.filter(({ id }) => id === hosted.id)
    .map(({ title, memberCount }) => [title, memberCount]);
  assert.deepEqual(await hostedList(), [[hosted.title, 2]]);
  await pool.query("UPDATE core_owner_state SET legacy_facts_ready = true WHERE user_id = $1", [store.scope.owner]);
  await pool.query(`
    INSERT INTO suppressions (id, user_id, kind, text_hash, embedding, origin, created_at)
    VALUES ('legacy vector', 'owner', 'text', $3, $1, 'forget', 'epoch'),
           ('legacy exact', 'owner', 'text', $2, $1, 'edit', 'epoch')`, [vector(1, 0), digest(hashMatch.memoryId), digest("different")]);
  assert.deepEqual(await hostedList(), [[null, 1]]);
  assert.deepEqual((await store.read("members", hosted.id, firstPage)).items.map(({ id }) => id), [savedLater.memoryId]);
  await pool.query("INSERT INTO memory_forget_log (user_id, memory_id) VALUES ('owner', $1)", [logged.memoryId]);
  await pool.query(`
    INSERT INTO core_memory_receipts (user_id, memory_id, client, session_id, message_id, role)
    VALUES ('owner', $1, 'client', 'session', 'message', 'user')`, [receiptLinked.memoryId]);
  await store.fact({ kind: "session", session: { client: "client", sessionId: "session" } });
  assert.deepEqual((await store.read("members", child.id, firstPage)).items.map(({ id }) => id),
    [member.memoryId, savedLater.memoryId]);
  for (const { memoryId } of [vectorMatch, hashMatch, logged, receiptLinked]) {
    assert.deepEqual(await store.read("forMemory", memoryId), []);
  }
  await store.fact({ kind: "text", mode: "exact", text: { digests: [
    { alg: "sha256", value: digest(savedLater.memoryId), pipeline: "core", redactionVersion: 1, keyId: null },
  ] } });
  assert.deepEqual(await store.read("forMemory", savedLater.memoryId), []);
  assert.deepEqual((await store.read("members", child.id, firstPage)).items.map(({ id }) => id), [member.memoryId]);
});

test("Postgres topic placement isolates owners", migrationDbTest, async (t) => {
  const { lane, uow, placement } = await setup(t);
  const home = lane();
  const other = lane("other");
  const a = await home.seed("home");
  const b = await other.seed("other");
  const choices = [[home, a], [other, b]];
  const topics = [];
  for (const [store, memory] of choices) {
    const result = await store.apply([memory], [item(memory, [], topic("Shared name", [], "Shared parent"))]);
    topics.push(result.createdTopics[1]);
  }
  for (const [i, [store, memory]] of choices.entries()) {
    assert.deepEqual((await store.read("list", { ...firstPage, level: "L1" })).items.map(({ id }) => id), [topics[i].id]);
    assert.deepEqual(await store.read("forMemories", [a.memoryId, b.memoryId]),
      [{ memoryId: memory.memoryId, topics: [{ id: topics[i].id, title: "Shared name" }] }]);
    for (const [j, foreign] of topics.entries()) {
      if (i === j) continue;
      assert.deepEqual(await store.read("members", foreign.id, firstPage), { items: [], nextCursor: null });
      await assert.rejects(store.apply([memory], [item(memory, [foreign.id])]), { code: "not_found" });
    }
  }
  const { nextCursor, indexRevision } = await home.read("catalog", one);
  assert.ok(nextCursor);
  await assert.rejects(other.read("catalog", { cursor: nextCursor, limit: 1 }), { code: "invalid_cursor" });
  await assert.rejects(home.apply([b], [item(b)]), { code: "revision_conflict" });
  assert.deepEqual(await home.write("dropMemory", b.memoryId), { dropped: 0 });
  assert.equal((await home.read("catalog", one)).indexRevision, indexRevision);
  await assert.rejects(uow.run("owner", { readOnly: true }, (tx) => placement.catalog(tx, other.scope, one)),
    { code: "internal_error" });
  await assert.rejects(uow.run("owner", { readOnly: true }, (tx) => placement.dropMemory(tx, home.scope, a.memoryId)),
    { code: "internal_error" });
  const otherRevision = (await other.read("catalog", one)).indexRevision;
  await home.fact({ kind: "identity", memoryId: a.memoryId });
  await assert.rejects(home.read("catalog", { cursor: nextCursor, limit: 1 }), { code: "cursor_stale" });
  assert.equal((await other.read("catalog", one)).indexRevision, otherRevision);
});

test("every Postgres TopicStore method rejects a non-null namespace", migrationDbTest, async (t) => {
  const { uow, placement } = await setup(t);
  const withCards = createPostgresTopicStore({ documentCards: createPostgresDocumentCardStore() });
  const reads = {
    memoryCounts: [],
    unfiled: [firstPage],
    pending: [{ limit: 5 }],
    pendingCards: [{ limit: 5 }],
    catalog: [firstPage],
    list: [firstPage],
    members: ["topic", firstPage],
    forMemory: ["memory"],
    forMemories: [["memory"]],
    forCard: ["card"],
  };
  const writes = {
    applyPlacement: [
      { indexRevision: 0, memoryRevisions: [{ memoryId: "memory", revision: 1 }] },
      { items: [{ memoryId: "memory", parentIds: [] }] },
    ],
    applyCardPlacement: [
      { indexRevision: 0, cards: [{ cardId: "card", contentHash: "hash" }] },
      { items: [{ cardId: "card", parentIds: [] }] },
    ],
    markFailed: [["memory"], "storage_busy"],
    markCardsFailed: [["card"], "storage_busy"],
    dropMemory: ["memory"],
    dropCard: ["card"],
  };
  const names = [...Object.keys(reads), ...Object.keys(writes)].sort();
  assert.deepEqual(Object.keys(withCards).sort(), names);
  assert.deepEqual(Object.keys(placement).sort(), names.filter(name => !name.includes("Card")));
  for (const store of [placement, withCards]) {
    for (const [readOnly, methods] of [[true, reads], [false, writes]]) {
      for (const [method, args] of Object.entries(methods)) {
        for (const namespace of ["project\0notes", ""]) {
          const scope = { owner: "owner", namespace };
          await assert.rejects(uow.run(scope.owner, { readOnly }, (tx) => store[method](tx, scope, ...args)),
            { code: "capability_unavailable" }, method);
        }
      }
    }
  }
});

test("Postgres reports L1 parent ids in UTF-8 id order", migrationDbTest, async (t) => {
  const { pool, lane } = await setup(t);
  const store = lane();
  const member = await store.seed("member");
  await pool.query(`
    INSERT INTO topics (user_id, id, level, title, title_key)
    VALUES ('owner', $1, 2, 'First parent', 'first parent'), ('owner', $2, 2, 'Second parent', 'second parent')`,
  ["😀", "\uE000"]);
  const { createdTopics: [child] } = await store.apply([member], [item(member, [], topic("Child", ["😀", "\uE000"]))]);
  assert.deepEqual(child.parentIds, ["\uE000", "😀"]);
  assert.deepEqual((await store.read("catalog", firstPage)).items[0], child);
  assert.deepEqual((await store.read("list", { ...firstPage, level: "L1" })).items[0].parentIds, child.parentIds);
});

test("Postgres title retirement and membership changes stale pages once; outcomes and failures do not", migrationDbTest, async (t) => {
  const { pool, lane } = await setup(t);
  const store = lane();
  const a = await store.seed("Alpha member");
  const z = await store.seed("Zulu member");
  const source = await store.seed("Zulu source");
  const unfiled = await store.seed("unfiled");
  const failed = await store.seed("failure");
  const initial = (await store.read("catalog", firstPage)).indexRevision;
  const plan = [item(z, [], topic("Zulu")), item(source)];
  const { createdTopics: [alpha] } = await store.apply([a], [item(a, [], topic("Alpha"))], initial);
  const { createdTopics: [zulu] } = await store.apply([z, source], plan, initial + 1);
  const catalog = await store.read("catalog", one);
  const list = await store.read("list", one);
  assert.equal(catalog.indexRevision, initial + 2);
  assert.ok(catalog.nextCursor && list.nextCursor);
  await assert.rejects(store.apply([z, source], plan, initial + 1), { code: "revision_conflict" });
  await assert.rejects(store.apply([a], [item(a, [], topic("ＡＬＰＨＡ"))]), { code: "moc_title_conflict" });
  await assert.rejects(store.apply([a, z], [item(a, [], topic("Transient")), item(z, ["absent"])]), { code: "not_found" });

  await store.apply([unfiled], [item(unfiled)]);
  await store.write("markFailed", [failed.memoryId], "storage_busy");
  await store.apply([a], [item(a, [alpha.id])], catalog.indexRevision);
  assert.equal((await store.read("catalog", firstPage)).indexRevision, catalog.indexRevision);
  assert.deepEqual(await store.read("forMemories", [unfiled.memoryId, failed.memoryId]), [{ memoryId: unfiled.memoryId, topics: [] }]);
  assert.equal((await store.read("catalog", { cursor: catalog.nextCursor, limit: 1 })).items[0].title, "Zulu");

  assert.deepEqual(await store.write("dropMemory", source.memoryId), { dropped: 0 });
  assert.deepEqual((await store.read("catalog", firstPage)).items.map(({ title }) => title), [null, "Alpha"]);
  assert.deepEqual((await store.read("list", firstPage)).items.map(({ title }) => title), [null, "Alpha"]);
  assert.deepEqual((await store.read("forMemories", [z.memoryId]))[0].topics, [{ id: zulu.id, title: null }]);
  const retired = await pool.query("SELECT memory_revision FROM topic_title_sources WHERE topic_id = $1 AND memory_id = $2",
    [zulu.id, source.memoryId]);
  assert.equal(retired.rows[0].memory_revision, 0);
  await assert.rejects(store.read("catalog", { cursor: catalog.nextCursor, limit: 1 }), { code: "cursor_stale" });
  await assert.rejects(store.read("list", { cursor: list.nextCursor, limit: 1 }), { code: "cursor_stale" });
  assert.deepEqual(await store.write("dropMemory", source.memoryId), { dropped: 0 });
  assert.equal((await store.read("catalog", firstPage)).indexRevision, catalog.indexRevision + 1);

  await store.apply([unfiled], [item(unfiled, [alpha.id])]);
  const memberPage = await store.read("members", alpha.id, one);
  assert.ok(memberPage.nextCursor);
  assert.deepEqual(await store.write("dropMemory", a.memoryId), { dropped: 1 });
  assert.deepEqual(await store.read("forMemory", a.memoryId), []);
  assert.deepEqual(await store.read("forMemories", [a.memoryId]), [{ memoryId: a.memoryId, topics: [] }]);
  assert.equal((await store.read("catalog", firstPage)).indexRevision, catalog.indexRevision + 3);
  await assert.rejects(store.read("members", alpha.id, { cursor: memberPage.nextCursor, limit: 1 }), { code: "cursor_stale" });
  assert.deepEqual(await store.read("pending", { limit: 5 }), []);
});

test("Postgres pending retries only retryable codes at the deadline and stops after three attempts", migrationDbTest, async (t) => {
  const { pool, lane, setClock } = await setup(t);
  const store = lane();
  const a = await store.seed("retry");
  const b = await store.seed("terminal");
  const pending = () => store.read("pending", { limit: 5 });
  await store.write("markFailed", [a.memoryId, a.memoryId, "missing"], "storage_busy");
  await store.write("markFailed", [b.memoryId], "invalid_model_output");
  assert.deepEqual(await pending(), []);
  setClock(100 + hour - 1);
  assert.deepEqual(await pending(), []);
  setClock(100 + hour);
  assert.deepEqual(await pending(), [a]);
  await store.write("markFailed", [a.memoryId], "storage_busy");
  assert.deepEqual(await pending(), []);
  setClock(100 + 2 * hour);
  assert.deepEqual(await pending(), [a]);
  await store.write("markFailed", [a.memoryId], "storage_busy");
  setClock(100 + 3 * hour);
  assert.deepEqual(await pending(), []);
  assert.equal((await store.read("catalog", firstPage)).indexRevision, 0);
  assert.deepEqual(await store.read("forMemories", [a.memoryId, b.memoryId]), []);
  await pool.query("UPDATE memories SET revision = 2");
  assert.deepEqual(await pending(), [a, b].map((guard) => ({ ...guard, revision: 2 })));
  await store.write("markFailed", [a.memoryId], "storage_busy");
  setClock(100 + 4 * hour);
  assert.deepEqual(await pending(), [a, b].map((guard) => ({ ...guard, revision: 2 })));
});

test("Postgres batch lookup snapshots scope and dense arrays before awaiting the database", migrationDbTest, async (t) => {
  const { lane, uow, placement } = await setup(t);
  const store = lane();
  const a = await store.seed("snapshot");
  const b = await store.seed("other input");
  await store.apply([a, b], [item(a), item(b)]);
  const expected = [{ memoryId: a.memoryId, topics: [] }];
  assert.deepEqual(await store.read("forMemories", Array(100).fill(a.memoryId)), expected);
  await assert.rejects(store.read("forMemories", []), { code: "invalid_input" });
  await assert.rejects(store.read("forMemories", Array(101).fill(a.memoryId)), { code: "invalid_input" });
  let calls = 0;
  const iterable = Object.defineProperty([a.memoryId], Symbol.iterator, {
    value: function* () { calls++; yield b.memoryId; },
  });
  const accessor = Object.defineProperty([a.memoryId], "0", {
    get() { calls++; return b.memoryId; },
  });
  await assert.rejects(store.read("forMemories", iterable), { code: "invalid_input" });
  await assert.rejects(store.read("forMemories", accessor), { code: "invalid_input" });
  assert.equal(calls, 0);
  let savedTx;
  assert.deepEqual(await uow.run("owner", { readOnly: true }, (tx) => {
    savedTx = tx;
    const scope = { ...store.scope };
    const ids = [a.memoryId];
    const pending = placement.forMemories(tx, scope, ids);
    ids[0] = b.memoryId;
    scope.namespace = "other";
    return pending;
  }), expected);
  await assert.rejects(placement.forMemories(savedTx, store.scope, [a.memoryId]), { code: "internal_error" });
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { allDigests, normalizeForHash } from "../../core/src/index.mjs";
import { createPostgresSuppressionStore, createPostgresTopicStore, createPostgresUnitOfWork } from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const owner = "owner";
const scope = { owner, namespace: null };
const page = { cursor: null, limit: 1 };
const title = "Sourced title";
const vector = JSON.stringify([1, ...Array(1535).fill(0)]);
const sha = (value) => createHash("sha256").update(value).digest("hex");

const session = { client: "plugin-client", sessionId: "capture-session" };
const hiddenText = (id) => `Copper notebook ${id}. api_key=fixture-placeholder`;
const cases = [
  ["source-on-row session fact", session, { kind: "session", session }],
  ["source-on-row window fact", session, { kind: "window", client: session.client, window: { startMs: 1999, endMs: 2001 } }],
  ["legacy alias-only text fact", {}, null],
];

for (const [name, sourceRef, sourceFact] of cases) {
  test(`Postgres TopicStore hides hosted rows matched by a ${name}`, migrationDbTest, async (t) => {
    const { pool, source } = await migrationDatabase(t);
    const topics = createPostgresTopicStore();
    const facts = createPostgresSuppressionStore();
    const { run } = createPostgresUnitOfWork(source);
    const read = (body) => run(owner, { readOnly: true }, body);

    await pool.query("INSERT INTO users (id) VALUES ($1)", [owner]);
    async function seed(id, { hidden = false, member = false, placedAt = 1 } = {}) {
      const text = hidden ? hiddenText(id) : id;
      await pool.query(`INSERT INTO memories (id, user_id, text, text_hash, kind, embedding, embedding_model,
        source_kind, source_client, source_session_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 'fact', $5, 'fixture', 'plugin', $6, $7, to_timestamp($8), to_timestamp($8))`,
      [id, owner, text, sha(normalizeForHash(text)), vector,
        hidden ? sourceRef.client ?? null : null, hidden ? sourceRef.sessionId ?? null : null, hidden ? 2 : 3]);
      if (member) {
        await pool.query(`INSERT INTO memory_placements (user_id, memory_id, memory_revision, status)
          VALUES ($1, $2, 1, 'filed')`, [owner, id]);
        await pool.query(`INSERT INTO memory_topics (user_id, memory_id, memory_revision, topic_id, placed_at)
          VALUES ($1, $2, 1, 'child', to_timestamp($3))`, [owner, id, placedAt]);
      }
    }

    await pool.query("INSERT INTO topics (user_id, id, level, title, title_key) VALUES ($1, 'child', 1, $2, lower($2))",
      [owner, title]);
    await seed("title-source", { hidden: true, member: true, placedAt: 3 });
    await pool.query(`INSERT INTO topic_title_sources (user_id, topic_id, memory_id, memory_revision)
      VALUES ($1, 'child', 'title-source', 1)`, [owner]);
    await seed("pending-0", { hidden: true });
    if (sourceFact) {
      // Hidden candidates fill a whole SQL batch before any visible pending or member row.
      for (let i = 1; i <= 16; i++) {
        await seed(`pending-${i}`, { hidden: true });
        await seed(`member-${i}`, { hidden: true, member: true, placedAt: 3 });
      }
    }
    await seed("first-visible-member", { member: true, placedAt: 2 });
    await seed("second-visible-member", { member: true });
    await seed("visible-pending");

    async function snapshot() {
      return read(async (tx) => {
        const members = await topics.members(tx, scope, "child", page);
        const next = await topics.members(tx, scope, "child", { ...page, cursor: members.nextCursor });
        const [entry] = (await topics.list(tx, scope, page)).items;
        return {
          pending: (await topics.pending(tx, scope, { limit: 1 })).map(({ memoryId }) => memoryId),
          members: [members.items[0]?.id, next.items[0]?.id],
          hasMoreMembers: next.nextCursor !== null,
          memberCount: entry.memberCount,
          newestMemberIds: entry.newestMemberIds,
          listTitle: entry.title,
          catalogTitle: (await topics.catalog(tx, scope, page)).items[0].title,
          batch: await topics.forMemories(tx, scope, ["title-source", "first-visible-member"]),
          single: await topics.forMemory(tx, scope, "title-source"),
        };
      });
    }

    const before = await snapshot();
    assert.equal(before.catalogTitle, title);
    assert.equal(before.memberCount, sourceFact ? 19 : 3);
    assert.equal(before.pending[0], "pending-0");
    let fact = sourceFact;
    if (!fact) {
      const digests = [];
      for (const id of ["title-source", "pending-0"]) {
        const text = hiddenText(id);
        const aliases = (await allDigests(text)).filter(({ value }) => value !== sha(normalizeForHash(text)));
        assert.ok(aliases.length > 0);
        digests.push(...aliases);
      }
      fact = { kind: "text", mode: "exact", text: { digests } };
    }
    await run(owner, {}, (tx) => facts.writeFact(tx, { ...scope, ...fact, origin: "forget", actionId: name }, sha(name)));

    assert.deepEqual(await snapshot(), {
      pending: ["visible-pending"],
      members: ["first-visible-member", "second-visible-member"],
      hasMoreMembers: false,
      memberCount: 2,
      newestMemberIds: ["first-visible-member", "second-visible-member"],
      listTitle: null,
      catalogTitle: null,
      batch: [{ memoryId: "first-visible-member", topics: [{ id: "child", title: null }] }],
      single: [],
    });
    const indexRevision = await read(async (tx) => (await topics.catalog(tx, scope, page)).indexRevision);
    await assert.rejects(run(owner, {}, (tx) => topics.applyPlacement(tx, scope,
      { indexRevision, memoryRevisions: [{ memoryId: "title-source", revision: 1 }] },
      { items: [{ memoryId: "title-source", parentIds: [] }] })), { code: "revision_conflict" });
    await run(owner, {}, (tx) => topics.markFailed(tx, scope, ["pending-0"], "storage_busy"));
    const { rowCount } = await pool.query("SELECT 1 FROM memory_placements WHERE user_id = $1 AND memory_id = 'pending-0'", [owner]);
    assert.equal(rowCount, 0);
  });
}

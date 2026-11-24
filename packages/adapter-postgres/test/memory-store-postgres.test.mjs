import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { capabilities, coreDigest, decideWrite, legacyExactMac, normalizeForHash, userFingerprintKey } from "@cairn-ink/core";
import { forgetMethod } from "../../core/src/service/forget.mjs";
import { importMethod } from "../../core/src/service/import.mjs";
import { cases, FAKE_MASTER, inputOf, OWNERS } from "../../core/test/privacy-vectors.mjs";
import * as postgres from "../src/index.mjs";
import {
  createPostgresConflictEdgeStore, createPostgresMemoryReads, createPostgresMemoryStore, createPostgresPauseStore,
  createPostgresSupersessionStore, createPostgresSuppressionStore, createPostgresUnitOfWork,
} from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const owner = "memory-owner";
const other = "other-owner";
const scope = { owner, namespace: null };
const readSet = { owner, namespaces: [null] };
const readOnly = { readOnly: true };
const pauseLock = { pauseLock: true };
const evidence = { client: "client", sessionId: "session", messageId: "message", role: "user", occurredAtMs: 0.0005 };
const hash = (text) => createHash("sha256").update(text).digest("hex");
const content = (text, vector = [1, ...Array(1535).fill(0)]) => ({
  text, textHash: "sha256:" + hash(text), confidence: 1, kind: "fact", origin: "explicit",
  source: { kind: "mcp", client: null, sessionId: null }, embedding: { model: "fixture", vector },
});
const ref = (id) => ({ type: "memory", namespace: null, id });

async function fixture(t, observe) {
  const { pool, source } = await migrationDatabase(t);
  await pool.query("INSERT INTO users (id) VALUES ($1), ($2)", [owner, other]);
  const uow = createPostgresUnitOfWork(observe ? {
    async connect() {
      const connection = await source.connect();
      return {
        ...connection,
        async query(sql, values) {
          const result = await connection.query(sql, values);
          observe(sql, result);
          return result;
        },
      };
    },
  } : source);
  return {
    pool, run: uow.run, uow, memories: createPostgresMemoryStore(), pause: createPostgresPauseStore(),
    supersession: createPostgresSupersessionStore(), suppressions: createPostgresSuppressionStore(),
    conflicts: createPostgresConflictEdgeStore(),
    ...createPostgresMemoryReads(),
  };
}

async function hostedMemory(pool, id, text, { client = null, sessionId = null, user = owner, index = 0 } = {}) {
  const vector = Array(1536).fill(0);
  vector[index] = 1;
  await pool.query(`INSERT INTO memories (user_id, id, text, text_hash, kind, embedding, embedding_model,
    source_kind, source_client, source_session_id, created_at, updated_at)
    VALUES ($1, $2, $3, $4, 'fact', $5, 'fixture', 'plugin', $6, $7, to_timestamp(1), to_timestamp(2))`,
  [user, id, text, hash(normalizeForHash(text)), JSON.stringify(vector), client, sessionId]);
}

const keyId = "fixture-key";
async function writeDeps(f) {
  const signingKey = await crypto.subtle.importKey("raw", new TextEncoder().encode("fixture"),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return {
    storage: { ...f, capabilities: capabilities({ embeddingRequiredOnInsert: true, nearDuplicate: true }),
      keys: { userKey: async () => ({ id: keyId, signingKey }) },
      suppressions: { ...f.suppressions, snapshot: async () => ({ blockedSession: false, blockedMessages: [], passages: [] }) },
    },
    clock: { nowMs: () => 5000, sha256Hex: async (value) => hash(value) },
    config: {}, gate: { assertOpen: async () => {} },
    embedder: { model: "fixture", dimensions: 1536,
      embed: async texts => texts.map(() => Float32Array.from(content("fixture").embedding.vector)) },
  };
}

test("P1-1 receipt-less hosted rows obey copied session and window facts on every read and duplicate path", migrationDbTest, async (t) => {
  const { pool, run, memories, suppressions, recent, hydrate, fence } = await fixture(t);
  await hostedMemory(pool, "session-row", "session row", { client: "client", sessionId: "held" });
  await hostedMemory(pool, "window-row", "window row", { client: "client", sessionId: "other" });
  await hostedMemory(pool, "visible-row", "visible row", { client: "different", sessionId: "held" });
  await pool.query("INSERT INTO core_owner_state (user_id, legacy_facts_ready) VALUES ($1, true)", [owner]);
  for (const fact of [
    { kind: "session", session: { client: "client", sessionId: "held" } },
    { kind: "window", client: "client", window: { startMs: 1999, endMs: 2001 } },
  ]) {
    await run(owner, {}, tx => suppressions.writeFact(tx,
      { ...fact, owner, actionId: fact.kind, origin: "backfill" }, hash(fact.kind)));
  }
  await run(owner, readOnly, async tx => {
    const refs = ["session-row", "window-row", "visible-row"].map(ref);
    const page = { cursor: null, limit: 10 };
    assert.deepEqual((await recent.recent(tx, readSet, page)).items.map(row => row.id), ["visible-row"]);
    assert.deepEqual((await memories.exportPage(tx, scope, page)).items.map(row => row.id), ["visible-row"]);
    assert.deepEqual((await hydrate.hydrate(tx, readSet, refs, "read")).map(item => item.ref.id), ["visible-row"]);
    assert.deepEqual(await fence.assertVisible(tx, readSet, refs), [ref("visible-row")]);
    const batch = ["session row", "window row"].map(text => ({ textHash: content(text).textHash }));
    assert.deepEqual(await memories.findDuplicates(tx, scope, batch, { nearDistance: 0 }), [[], []]);
    const policy = await memories.readWritePolicy(tx, scope, batch, content("").source, "hash");
    assert.deepEqual(batch.map((_, i) => decideWrite(policy, i)), Array(2).fill({ status: "suppressed" }));
  });
});

test("P1-2 core forget round trips through a hosted bare text hash", migrationDbTest, async (t) => {
  const f = await fixture(t);
  const text = "Take the copper notebook.";
  await hostedMemory(f.pool, "legacy", text);
  const deps = await writeDeps(f);
  deps.storage.capabilities = capabilities({ embeddingRequiredOnInsert: true });
  const forget = forgetMethod(deps);
  assert.deepEqual(await forget(scope, "legacy", content("").source), { status: "forgotten", removedSimilar: 0 });
  assert.equal(await f.run(owner, readOnly, tx => f.memories.get(tx, scope, "legacy")), null);
  const { rows } = await f.pool.query("SELECT body FROM core_suppression_facts WHERE user_id = $1", [owner]);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].body.text.digests.some(digest => digest.value === hash(normalizeForHash(text))));
  await assert.rejects(f.run(owner, readOnly, tx =>
    f.memories.findDuplicates(tx, scope, [{ textHash: hash(text) }], { nearDistance: 0 })), { code: "invalid_input" });
});

test("P1-3 marked receipts still withhold their source messages after replacement and erase", migrationDbTest, async (t) => {
  const { pool, run, memories, hydrate } = await fixture(t);
  const marked = [evidence, { ...evidence, messageId: "erased-message" }];
  const [edited, erased] = await run(owner, {}, async tx => [
    await memories.insert(tx, scope, content("edit this"), [marked[0]], 10),
    await memories.insert(tx, scope, content("erase this"), [marked[1]], 10),
  ]);
  await pool.query("UPDATE core_memory_receipts SET forgotten_at = to_timestamp(5) WHERE user_id = $1", [owner]);
  const replacement = { ...evidence, messageId: "replacement", occurredAtMs: 1.5 };
  await run(owner, {}, async tx => {
    await memories.replaceContent(tx, scope, edited.id, 1, content("edited text"), [replacement], 11);
    await memories.erase(tx, scope, erased.id);
  });
  for (const { client, sessionId, messageId } of marked) {
    // Hosted admission resolves these markers by message identity independently of the memory row.
    const { rows } = await pool.query(`SELECT 1 FROM core_memory_receipts
      WHERE user_id = $1 AND client = $2 AND session_id = $3 AND message_id = $4 AND forgotten_at IS NOT NULL`,
    [owner, client, sessionId, messageId]);
    assert.equal(rows.length, 1, `replay of ${messageId} must stay withheld`);
  }
  const [updated] = await run(owner, readOnly, tx => hydrate.hydrate(tx, readSet, [ref(edited.id)], "read"));
  assert.deepEqual(updated.receipts, [replacement]);
  const { rows } = await pool.query("SELECT EXTRACT(EPOCH FROM occurred_at) * 1000 AS ms FROM core_memory_receipts WHERE message_id = $1",
    [replacement.messageId]);
  assert.equal(Number(rows[0].ms), 1.5);
});

test("P1-4 hosted and core share one physical hash even when its holder is hidden", migrationDbTest, async (t) => {
  const { pool, run, memories, suppressions } = await fixture(t);
  const item = content("original");
  const { id } = await run(owner, {}, tx => memories.insert(tx, scope, item, [], 10));
  const { rows } = await pool.query("SELECT text_hash FROM memories WHERE id = $1", [id]);
  assert.equal(rows[0].text_hash, hash(item.text));
  await assert.rejects(hostedMemory(pool, "hosted", item.text), { code: "23505" });
  const fact = { owner, kind: "identity", origin: "forget", actionId: "hide", memoryId: id };
  await run(owner, {}, tx => suppressions.writeFact(tx, fact, hash("hide")));
  await run(owner, readOnly, async tx => {
    assert.equal((await memories.readRevision(tx, scope, id)).textHash, item.textHash);
    const policy = await memories.readWritePolicy(tx, scope, [{ textHash: item.textHash }], item.source, "hash");
    assert.deepEqual(decideWrite(policy, 0), { status: "suppressed" });
  });
  await assert.rejects(run(owner, {}, tx => memories.insert(tx, scope, item, [], 11)), { code: "memory_conflict" });
  const edit = await run(owner, {}, tx => memories.insert(tx, scope, content("edit source"), [], 11));
  await assert.rejects(run(owner, {}, tx => memories.replaceContent(tx, scope, edit.id, 1, item, null, 12)),
    { code: "memory_conflict" });
  assert.equal((await pool.query("SELECT 1 FROM memories WHERE user_id = $1 AND text_hash = $2",
    [owner, hash(item.text)])).rowCount, 1);
});

test("P1-5 visibility dual-reads legacy suppressions committed after the copy", migrationDbTest, async (t) => {
  const { pool, run, memories, recent } = await fixture(t);
  await hostedMemory(pool, "legacy-session", "session capture", { client: "client", sessionId: "held", index: 1 });
  await hostedMemory(pool, "legacy-window", "window capture", { client: "window-client", index: 1 });
  await hostedMemory(pool, "legacy-text", "suppressed wording");
  await hostedMemory(pool, "legacy-visible", "unrelated wording", { index: 1, client: "other-client" });
  await pool.query("INSERT INTO core_owner_state (user_id, legacy_facts_ready) VALUES ($1, true)", [owner]);
  const page = { cursor: null, limit: 10 };
  const visible = () => run(owner, readOnly, async tx => (await recent.recent(tx, readSet, page)).items.map(row => row.id));
  assert.equal((await visible()).length, 4);
  await pool.query(`INSERT INTO suppressions (id, user_id, kind, client, session_id, window_start, window_end, text_hash, embedding)
    VALUES ('s', $1, 'session', 'client', 'held', NULL, NULL, NULL, NULL),
      ('w', $1, 'window', 'window-client', NULL, to_timestamp(1), to_timestamp(1.5), NULL, NULL),
      ('t', $1, 'text', NULL, NULL, NULL, NULL, $2, $3)`,
  [owner, hash("suppressed wording"), JSON.stringify(content("").embedding.vector)]);
  assert.deepEqual(await visible(), ["legacy-visible"]);
  const incoming = { kind: "capture", client: "client", sessionId: "held" };
  const policy = await run(owner, readOnly, tx => memories.readWritePolicy(tx, scope, [], incoming, "full"));
  assert.equal(policy.blockedSession, true);
  await pool.query("UPDATE core_owner_state SET legacy_facts_ready = false WHERE user_id = $1", [owner]);
  await assert.rejects(visible(), { code: "ineligible" });
  await pool.query("UPDATE core_owner_state SET legacy_facts_ready = true WHERE user_id = $1", [owner]);
  await pool.query("UPDATE core_owner_state SET legacy_writes_reconciled = true WHERE user_id = $1", [owner]);
  assert.equal((await visible()).length, 4);
});

test("P1-5 keyed digest gate counts missing rows and HMAC-only visibility evaluates each candidate", migrationDbTest, async (t) => {
  const f = await fixture(t);
  await hostedMemory(f.pool, "no-key", "legacy text");
  await hostedMemory(f.pool, "foreign", "foreign text", { user: other });
  const digest = { alg: "hmac", value: hash("matched"), keyId, pipeline: "core", redactionVersion: 1 };
  const [matched, different] = await f.run(owner, {}, async tx => [
    await f.memories.insert(tx, scope, { ...content("matched"), digests: [digest] }, [], 10),
    await f.memories.insert(tx, scope, { ...content("different"), digests: [{ ...digest, value: hash("different") }] }, [], 11),
  ]);
  const fact = { owner, kind: "text", mode: "exact", origin: "forget", actionId: "keyed", text: { digests: [digest] } };
  await f.run(owner, {}, tx => f.suppressions.writeFact(tx, fact, hash("keyed")));
  const { items } = await f.run(owner, readOnly, tx => f.recent.recent(tx, readSet, { cursor: null, limit: 10 }));
  assert.deepEqual(items.map(row => row.id), [different.id]);
  assert.notEqual(matched.id, different.id);
  const rowsMissingKeyedDigest = postgres.createPostgresDigestGate(f.uow, async id => id === owner ? [keyId] : []);
  assert.equal(await rowsMissingKeyedDigest(owner), 1);
  assert.equal(await rowsMissingKeyedDigest(other), 0);
  await f.pool.query("UPDATE memories SET core_digests = $1::jsonb WHERE user_id = $2 AND id = 'no-key'",
    [JSON.stringify([{ ...digest, keyId: "retired" }]), owner]);
  assert.equal(await rowsMissingKeyedDigest(owner), 1);
  await f.pool.query("UPDATE memories SET core_digests = $1::jsonb WHERE user_id = $2 AND id = 'no-key'",
    [JSON.stringify([digest]), owner]);
  assert.equal(await rowsMissingKeyedDigest(owner), 0);
});

const hostedFingerprints = JSON.parse(readFileSync(new URL("./fixtures/fingerprint-labels.json", import.meta.url), "utf8"));
for (const caseId of ["fingerprint-forget-secret", "fingerprint-forget-fullwidth-secret"]) {
  test(`P1-5 hosted HMAC domain ${caseId} fails closed until backfill`, migrationDbTest, async (t) => {
    const f = await fixture(t);
    const labels = postgres.HOSTED_FINGERPRINT_LABELS;
    const key = await userFingerprintKey(FAKE_MASTER, OWNERS[0], labels);
    const { text_hmac: mac, key_id: hostedKeyId } = hostedFingerprints.cases[caseId][OWNERS[0]];
    const text = inputOf(cases.find(({ id }) => id === caseId));
    assert.equal(key.id, hostedKeyId);
    assert.equal(await legacyExactMac(text, key, labels), mac);
    const miss = [0, 1, ...Array(1534).fill(0)];
    const rows = await Promise.all([text, "unrelated wording"].map(async wording => ({
      ...content(wording, miss), digests: [await coreDigest(wording, key)],
    })));
    assert.notEqual(rows[0].digests[0].value, mac);
    const [matched, different] = await f.run(owner, {}, async tx => [
      await f.memories.insert(tx, scope, rows[0], [], 10),
      await f.memories.insert(tx, scope, rows[1], [], 11),
    ]);
    await hostedMemory(f.pool, "foreign", "foreign wording", { user: other });
    await f.pool.query("UPDATE core_owner_state SET legacy_facts_ready = true WHERE user_id = $1", [owner]);
    await f.pool.query(`INSERT INTO suppressions (id, user_id, kind, text_hash, text_hmac, key_id, embedding)
      VALUES ('legacy-mac', $1, 'text', $2, $3, $4, $5)`,
    [owner, "hmac:" + mac, mac, hostedKeyId, JSON.stringify(content("").embedding.vector)]);
    const visible = () => f.run(owner, readOnly, tx =>
      f.fence.assertVisible(tx, readSet, [ref(matched.id), ref(different.id)]));
    const admission = (digests) => f.run(owner, readOnly, async tx => {
      // Distinct hashes and a vector miss isolate the text-fact decision from dedupe.
      const incoming = rows.map((row, i) => ({ textHash: content("incoming " + i).textHash, digests: digests[i], embedding: miss }));
      const results = [];
      for (const mode of ["hash", "full"]) {
        const policy = await f.memories.readWritePolicy(tx, scope, incoming, rows[0].source, mode, undefined, { nearDuplicate: false });
        results.push(policy.blockedPositions);
      }
      return results;
    });
    const rowsMissing = postgres.createPostgresDigestGate(f.uow, id => id === owner ? [hostedKeyId] : []);
    const rowsMissingLiveDomains = postgres.createPostgresDigestGate(f.uow, () => []);
    assert.deepEqual({
      blocked: await admission(rows.map(row => row.digests)),
      visible: (await visible()).length,
      missing: await rowsMissing(owner),
    }, { blocked: [[0, 1], [0, 1]], visible: 0, missing: 2 });
    assert.equal(await rowsMissingLiveDomains(owner), 2);
    const backfill = (macForText) => postgres.backfillPostgresHostedDigests(f.uow, owner, {
      keyId: hostedKeyId, redactionVersion: 1, macForText,
    });
    let calls = 0;
    await assert.rejects(backfill(wording => ++calls === 1 ? legacyExactMac(wording, key, labels) : "bad-mac"), { code: "invalid_input" });
    assert.equal(await rowsMissing(owner), 2);
    assert.equal(await backfill(wording => legacyExactMac(wording, key, labels)), 2);
    assert.equal(await backfill(() => { assert.fail("an existing digest should be reused"); }), 0);
    const { rows: stored } = await f.pool.query("SELECT core_digests FROM memories WHERE user_id = $1 ORDER BY updated_at", [owner]);
    for (const [i, { core_digests }] of stored.entries()) {
      assert.deepEqual(core_digests.slice(0, rows[i].digests.length), rows[i].digests);
      assert.deepEqual(core_digests.at(-1), { alg: "hmac", pipeline: "hosted-v1", redactionVersion: 1,
        keyId: hostedKeyId, value: await legacyExactMac(rows[i].text, key, labels) });
    }
    assert.deepEqual(await visible(), [ref(different.id)]);
    assert.deepEqual(await admission(stored.map(row => row.core_digests)), [[0], [0]]);
    const hostedMiss = stored[1].core_digests.at(-1);
    assert.deepEqual(await admission([
      [hostedMiss, { ...rows[0].digests[0], value: mac }],
      [hostedMiss, { ...hostedMiss, value: mac, keyId: "retired" }],
    ]), [[], []]);
    assert.equal(await rowsMissing(owner), 0);
    assert.equal(await rowsMissingLiveDomains(owner), 0);
    assert.equal(await rowsMissing(other), 0);
    assert.equal((await f.pool.query("SELECT core_digests FROM memories WHERE user_id = $1", [other])).rows[0].core_digests, null);

    // A live core fact under a second key requires its own domain even after hosted backfill.
    const coreFact = { ...scope, kind: "text", mode: "exact", origin: "forget", actionId: "second-key",
      text: { digests: [{ ...rows[0].digests[0], keyId }] } };
    await f.run(owner, {}, tx => f.suppressions.writeFact(tx, coreFact, hash(coreFact.actionId)));
    assert.equal(await rowsMissing(owner), 2);
    assert.deepEqual(await visible(), []);
  });
}

test("P1-6 uses an owner-scoped bounded pgvector projection and skips it on import", migrationDbTest, async (t) => {
  const observed = [];
  const f = await fixture(t, (sql, result) => {
    if (/FROM memories\b/u.test(sql)) observed.push({ sql, rows: result.rows });
  });
  await f.pool.query(`INSERT INTO memories (user_id, id, text, text_hash, kind, embedding, embedding_model, source_kind)
    SELECT $1, 'near-' || i, 'near-' || i, lpad(i::text, 64, '0'), 'fact', $2, 'fixture', 'plugin'
    FROM generate_series(1, 64) i`, [owner, JSON.stringify(content("").embedding.vector)]);
  await hostedMemory(f.pool, "foreign-near", "foreign near", { user: other });
  await f.pool.query("UPDATE memories SET updated_at = statement_timestamp() + interval '1 day' WHERE user_id = $1", [other]);
  await f.pool.query(`INSERT INTO memories
    (user_id, id, text, text_hash, kind, embedding, embedding_model, source_kind, core_namespace, updated_at)
    VALUES ($1, 'other-namespace', 'other namespace', $2, 'fact', $3, 'fixture', 'plugin', '"project"',
      statement_timestamp() + interval '1 day')`,
  [owner, hash("other namespace"), JSON.stringify(content("").embedding.vector)]);
  const query = { textHash: content("new").textHash, embedding: content("").embedding.vector };
  const matches = await f.run(owner, readOnly, tx => f.memories.findDuplicates(tx, scope,
    [query, { ...query, textHash: content("another").textHash }], { nearDistance: 0.08 }));
  const vectorReads = observed.filter(({ sql }) => /ORDER BY[^;]*<=>[^;]*LIMIT/su.test(sql));
  assert.equal(vectorReads.length, 2);
  for (const [i, { rows }] of vectorReads.entries()) {
    assert.equal(rows.length, 32);
    assert.equal(matches[i].filter(match => match.kind === "stored").length, 32);
    assert.ok(rows.every(row => row.id.startsWith("near-") && row.core_namespace === null));
    assert.ok(rows.every(row => !("embedding" in row) && !("text" in row)));
  }
  observed.length = 0;
  const importMemories = importMethod(await writeDeps(f));
  assert.deepEqual(await importMemories(scope, [{ text: "imported wording", kind: "fact" }], content("").source),
    { imported: 1, duplicate: 0, suppressed: 0, invalid: 0 });
  assert.ok(observed.some(({ sql }) => /text_hash\s*=\s*ANY/u.test(sql)));
  assert.ok(!observed.some(({ sql }) => sql.includes("<=>")));
  assert.ok(!observed.some(({ sql }) => sql.includes("core_text_hash")));
});

test("Postgres advances only the acting owner's index for committed memory and pause changes", migrationDbTest, async (t) => {
  const { pool, run, memories, pause, supersession, hydrate, recent, fence } = await fixture(t);
  await pool.query("INSERT INTO core_owner_state (user_id, index_revision) VALUES ($1, 19)", [other]);
  const state = async (revision) => {
    const { rows } = await pool.query("SELECT user_id, index_revision, fact_epoch FROM core_owner_state ORDER BY user_id COLLATE \"C\"");
    assert.deepEqual(rows, [
      { user_id: owner, index_revision: String(revision), fact_epoch: "0" },
      { user_id: other, index_revision: "19", fact_epoch: "0" },
    ]);
  };

  const original = content("original");
  const inserted = await run(owner, {}, (tx) => memories.insert(tx, scope, original, [], 10));
  const { id } = inserted;
  await state(1);
  const merge = { confidence: original.confidence };
  await run(owner, {}, (tx) => memories.touchDuplicate(tx, scope, id, [evidence, evidence], merge, 10));
  await state(2);
  const [item] = await run(owner, readOnly, (tx) => hydrate.hydrate(tx, readSet, [ref(id)], "read"));
  assert.deepEqual(item.receipts, [evidence]);

  await run(owner, {}, (tx) => memories.touchDuplicate(tx, scope, id, [evidence], merge, 10));
  await run(owner, {}, (tx) => memories.replaceContent(tx, scope, id, 1, original, [], 11));
  await run(owner, pauseLock, (tx) => pause.set(tx, owner, false));
  await state(2);

  await assert.rejects(run(owner, {}, async (tx) => {
    await memories.replaceContent(tx, scope, id, 1, content("rolled back"), [], 12);
    throw new Error("rollback");
  }), { message: "rollback" });
  await state(2);
  await run(owner, {}, (tx) => memories.replaceContent(tx, scope, id, 1, content("changed"), null, 12));
  await state(3);

  await run(owner, {}, (tx) => supersession.markHistorical(tx, scope, id, 13));
  await state(4);
  await assert.rejects(
    run(owner, {}, (tx) => memories.replaceContent(tx, scope, id, 3, original, null, 14)),
    { code: "memory_historical" },
  );
  await state(4);
  await run(owner, readOnly, async (tx) => {
    const page = await recent.recent(tx, readSet, { cursor: null, limit: 1 });
    assert.deepEqual(page.items, []);
    assert.deepEqual(await fence.assertVisible(tx, readSet, [ref(id)], "read"), [ref(id)]);
  });
  await run(owner, pauseLock, (tx) => pause.set(tx, owner, true));
  await state(5);
  await run(owner, pauseLock, (tx) => pause.set(tx, owner, false));
  await state(6);

  await run(owner, {}, async (tx) => {
    assert.equal(await memories.erase(tx, scope, id), true);
    assert.equal(await memories.erase(tx, scope, id), false);
  });
  await state(7);
  assert.equal((await pool.query("SELECT 1 FROM core_memory_receipts WHERE user_id = $1", [owner])).rowCount, 0);
});

test("Postgres reads legacy metadata and pages by exact microseconds then C collation", migrationDbTest, async (t) => {
  const { pool, run, memories, recent } = await fixture(t);
  const ids = ["\u{10000}", "\uE000", "later"];
  const vector = JSON.stringify(content("fixture").embedding.vector);
  for (const [i, id] of ids.entries()) {
    await pool.query(`INSERT INTO memories (user_id, id, text, text_hash, kind, embedding, embedding_model,
      source_kind, updated_at, created_at) VALUES ($1, $2, $2, $3, 'fact', $4, 'fixture', 'plugin',
      TIMESTAMPTZ 'epoch' + $5::int * INTERVAL '1 microsecond', TIMESTAMPTZ 'epoch')`,
    [owner, id, hash(id), vector, i === 2 ? 1002 : 1001]);
  }
  await run(owner, readOnly, async (tx) => {
    const order = [];
    let cursor = null;
    do {
      const page = await recent.recent(tx, readSet, { cursor, limit: 1 });
      const [row] = page.items;
      assert.deepEqual([row.origin, row.confidence, row.revision, row.source.kind], ["inferred", 1, 1, "plugin"]);
      order.push([row.id, row.updatedAtUs]);
      cursor = page.nextCursor;
    } while (cursor !== null);
    assert.deepEqual(order, [[ids[2], 1002n], [ids[0], 1001n], [ids[1], 1001n]]);
    const [matches] = await memories.findDuplicates(tx, scope, [{ textHash: "sha256:" + hash(ids[0]) }], { nearDistance: 0 });
    assert.deepEqual(matches.map(match => match.id), [ids[0]]);
  });
});

test("Postgres preserves safe-integer import times and requires an opt-in for named memory namespaces", migrationDbTest, async (t) => {
  const { run, memories, supersession } = await fixture(t);
  const text = content("shared text");
  const earlier = await run(owner, {}, (tx) => memories.insert(tx, scope, {
    ...text, createdAtMs: Number.MIN_SAFE_INTEGER,
  }, [], Number.MAX_SAFE_INTEGER));
  const named = { owner, namespace: "project\u0000example" };
  const namedText = content("named text");
  await assert.rejects(run(owner, {}, tx => memories.insert(tx, named, namedText, [], 10)), { code: "invalid_input" });
  const optedIn = createPostgresMemoryStore({ allowNonNullNamespace: true });
  const later = await run(owner, {}, tx => optedIn.insert(tx, named, namedText, [], 10));
  await run(owner, readOnly, async (tx) => {
    const saved = await memories.get(tx, scope, earlier.id);
    assert.equal(saved.createdAtMs, Number.MIN_SAFE_INTEGER);
    assert.equal(saved.updatedAtUs, BigInt(Number.MAX_SAFE_INTEGER) * 1000n);
    assert.equal((await memories.get(tx, named, later.id)).textHash, namedText.textHash);
    assert.equal(await memories.get(tx, scope, later.id), null);
    const query = { textHash: namedText.textHash };
    assert.deepEqual(await memories.findDuplicates(tx, scope, [query], { nearDistance: 0 }), [[]]);
    const policy = await memories.readWritePolicy(tx, scope, [query], namedText.source, "hash");
    assert.deepEqual(decideWrite(policy, 0), { status: "suppressed" });
  });
  await assert.rejects(run(owner, {}, tx => supersession.markHistorical(tx, named, later.id, 11)), { code: "invalid_input" });
  await assert.rejects(run(owner, {}, tx => memories.erase(tx, named, later.id)), { code: "invalid_input" });
  await assert.rejects(run(owner, {}, tx => optedIn.insert(tx, named, text, [], 11)), { code: "memory_conflict" });
});

const emptySupersession = { supersededBy: null, supersedes: [] };
const conflict = (left, right) => ({ left, right, relation: "contradicts", source: "explicit-hint" });

test("Postgres relation batches use one statement and fence both endpoints against receipt sessions", migrationDbTest, async (t) => {
  const statements = [];
  const { run, memories, supersession, conflicts, suppressions } = await fixture(t, sql => statements.push(sql));
  const [left, right] = await run(owner, {}, async tx => {
    const left = await memories.insert(tx, scope, content("left endpoint"), [], 1);
    const right = await memories.insert(tx, scope, content("right endpoint"), [evidence], 1);
    await supersession.record(tx, scope, { previous: left, replacement: right }, [], 2);
    assert.deepEqual(await conflicts.insert(tx, scope, conflict(right, left), 2), { inserted: true });
    return [left, right];
  });
  const unrelated = Array.from({ length: 64 }, (_, i) => `missing-${i}`);
  const ids = [left.id, ...unrelated, right.id, left.id];
  const check = (visible) => run(owner, readOnly, async tx => {
    statements.length = 0;
    const links = await supersession.readMany(tx, scope, ids);
    assert.equal(statements.length, 1);
    statements.length = 0;
    const edges = await conflicts.readMany(tx, scope, ids);
    assert.equal(statements.length, 1);
    assert.equal(links.size, 66);
    assert.equal(edges.size, 66);
    for (const id of unrelated) {
      assert.deepEqual(links.get(id), emptySupersession);
      assert.deepEqual(edges.get(id), []);
    }
    assert.deepEqual(links.get(left.id), { supersededBy: visible ? right.id : null, supersedes: [] });
    assert.deepEqual(links.get(right.id), { supersededBy: null, supersedes: visible ? [left.id] : [] });
    for (const [endpoint, peer] of [[left, right], [right, left]]) {
      assert.deepEqual(edges.get(endpoint.id), visible
        ? [{ memoryId: peer.id, revision: peer.revision, relation: "contradicts", source: "explicit-hint" }] : []);
    }
  });
  await check(true);
  await run(owner, {}, tx => suppressions.writeFact(tx, {
    owner, kind: "session", origin: "forget", actionId: "withhold-evidence",
    session: { client: evidence.client, sessionId: evidence.sessionId },
  }, hash("withhold-evidence")));
  await check(false);
});

test("Postgres scopes relation mutations and advances the index only for real conflict changes", migrationDbTest, async (t) => {
  const { run, memories, supersession, conflicts, snapshot } = await fixture(t);
  const [first, second] = await run(owner, {}, async tx => [
    await memories.insert(tx, scope, content("first"), [], 1),
    await memories.insert(tx, scope, content("second"), [], 1),
  ]);
  const foreignScope = { ...scope, owner: other };
  const foreign = await run(other, {}, tx => memories.insert(tx, foreignScope, content("unrelated"), [], 1));
  const edge = conflict(first, second);
  await run(owner, {}, async tx => {
    const before = await snapshot.stateToken(tx, readSet);
    assert.deepEqual(await conflicts.insert(tx, scope, conflict(first, foreign), 2), { inserted: false });
    assert.equal(await snapshot.stateToken(tx, readSet), before);
    assert.deepEqual(await conflicts.insert(tx, scope, edge, 2), { inserted: true });
    const inserted = await snapshot.stateToken(tx, readSet);
    assert.notEqual(inserted, before);
    assert.deepEqual(await conflicts.insert(tx, scope, edge, 3), { inserted: false });
    assert.equal(await conflicts.invalidate(tx, scope, foreign.id), 0);
    assert.equal(await snapshot.stateToken(tx, readSet), inserted);
    await supersession.record(tx, scope, { previous: first, replacement: second }, [], 2);
  });
  await assert.rejects(run(other, {}, tx => conflicts.invalidate(tx, scope, first.id)), { code: "internal_error" });
  await assert.rejects(run(other, {}, tx => supersession.record(tx, foreignScope, {
    previous: foreign, replacement: second,
  }, [], 2)), { code: "invalid_ref" });
  await run(other, {}, async tx => {
    assert.deepEqual(await supersession.read(tx, foreignScope, first.id), emptySupersession);
    assert.deepEqual(await conflicts.list(tx, foreignScope, first.id), []);
    assert.equal(await conflicts.degree(tx, foreignScope, first.id), 0);
    assert.equal(await conflicts.invalidate(tx, foreignScope, first.id), 0);
  });
  await run(owner, {}, async tx => {
    const before = await snapshot.stateToken(tx, readSet);
    assert.equal(await conflicts.invalidate(tx, scope, first.id), 1);
    assert.notEqual(await snapshot.stateToken(tx, readSet), before);
    assert.equal(await supersession.incomingCount(tx, scope, second.id), 1);
  });
});

test("Postgres forget removes relation rows atomically and delivers only the unavailable marker", migrationDbTest, async (t) => {
  const { run, memories, supersession, conflicts, hydrate, fence } = await fixture(t);
  const [previous, replacement, peer] = await run(owner, {}, async tx => {
    const previous = await memories.insert(tx, scope, content("former"), [], 1);
    const replacement = await memories.insert(tx, scope, content("replacement"), [], 1);
    const peer = await memories.insert(tx, scope, content("other current"), [], 1);
    await supersession.record(tx, scope, { previous, replacement }, [], 2);
    await supersession.markHistorical(tx, scope, previous.id, 2);
    await conflicts.insert(tx, scope, conflict(replacement, peer), 2);
    return [previous, replacement, peer];
  });
  const ids = [previous.id, replacement.id, peer.id];
  const refs = ids.map(ref);
  const counts = async tx => (await postgres.query(tx, `SELECT
    (SELECT count(*)::int FROM memory_supersessions WHERE user_id = $1) AS supersessions,
    (SELECT count(*)::int FROM memory_conflicts WHERE user_id = $1) AS conflicts`, [owner])).rows[0];
  const erase = async tx => {
    assert.deepEqual(await counts(tx), { supersessions: 1, conflicts: 1 });
    assert.equal(await memories.erase(tx, scope, replacement.id), true);
    assert.deepEqual(await counts(tx), { supersessions: 0, conflicts: 0 });
    assert.deepEqual(await supersession.readMany(tx, scope, ids), new Map(ids.map(id => [id, emptySupersession])));
    assert.deepEqual(await conflicts.readMany(tx, scope, ids), new Map(ids.map(id => [id, []])));
  };
  await assert.rejects(run(owner, {}, async tx => {
    await erase(tx);
    throw new Error("rollback forget");
  }), { message: "rollback forget" });
  await run(owner, {}, erase);
  await run(owner, readOnly, async tx => {
    const items = await hydrate.hydrate(tx, readSet, refs, "read");
    assert.deepEqual(await fence.assertVisible(tx, readSet, refs, "read"), [refs[0], refs[2]]);
    assert.deepEqual(items.map(({ memory }) => [memory.id, memory.historical, memory.supersession]), [
      [previous.id, true, "superseded (replacement no longer available)"], [peer.id, false, undefined],
    ]);
    assert.deepEqual((await hydrate.hydrate(tx, readSet, refs, "recall")).map(({ ref }) => ref.id), [peer.id]);
    const exported = await memories.exportPage(tx, scope, { cursor: null, limit: 10 });
    assert.deepEqual(new Set(exported.items.map(({ id }) => id)), new Set([previous.id, peer.id]));
    for (const memory of [...items.map(({ memory }) => memory), ...exported.items]) {
      assert.ok(!JSON.stringify(memory, (_, value) => typeof value === "bigint" ? value.toString() : value).includes(replacement.id));
    }
  });
});

test("Postgres relation reads and hydration use the same hashed session visibility", migrationDbTest, async (t) => {
  const { run, memories } = await fixture(t);
  const hashSessionKey = (client, sessionId) => hash(JSON.stringify([client, sessionId]));
  const suppressions = createPostgresSuppressionStore({ sessionRefs: "hashed", hashSessionKey });
  const supersession = createPostgresSupersessionStore({ hashSessionKey });
  const conflicts = createPostgresConflictEdgeStore({ hashSessionKey });
  const { hydrate } = createPostgresMemoryReads({ hashSessionKey });
  const [previous, replacement, peer] = await run(owner, {}, async tx => {
    const previous = await memories.insert(tx, scope, content("previous"), [], 1);
    const replacement = await memories.insert(tx, scope, content("replacement"), [evidence], 1);
    const peer = await memories.insert(tx, scope, content("peer"), [{ ...evidence, sessionId: "peer-session" }], 1);
    await supersession.record(tx, scope, { previous, replacement }, [], 2);
    await supersession.markHistorical(tx, scope, previous.id, 2);
    await conflicts.insert(tx, scope, conflict(replacement, peer), 2);
    return [previous, replacement, peer];
  });
  const writeSessionFact = (sessionId) => run(owner, {}, tx => suppressions.writeFact(tx, {
    ...scope, kind: "session", origin: "forget", actionId: sessionId,
    session: { client: evidence.client, sessionKeyHash: hashSessionKey(evidence.client, sessionId) },
  }, hash(sessionId)));

  await writeSessionFact("unrelated-session");
  await run(owner, readOnly, async tx => {
    assert.equal((await supersession.read(tx, scope, previous.id)).supersededBy, replacement.id);
    assert.deepEqual((await conflicts.list(tx, scope, peer.id)).map(edge => edge.memoryId), [replacement.id]);
    const [item] = await hydrate.hydrate(tx, readSet, [ref(previous.id)], "read");
    assert.equal(item.memory.supersession, undefined);
  });

  await writeSessionFact(evidence.sessionId);
  await run(owner, readOnly, async tx => {
    assert.deepEqual(await supersession.read(tx, scope, previous.id), emptySupersession);
    assert.deepEqual(await conflicts.list(tx, scope, peer.id), []);
    const [item] = await hydrate.hydrate(tx, readSet, [ref(previous.id), ref(replacement.id)], "read");
    assert.equal(item.memory.supersession, "superseded (replacement no longer available)");
    assert.deepEqual(await hydrate.hydrate(tx, readSet, [ref(replacement.id)], "read"), []);
  });
});

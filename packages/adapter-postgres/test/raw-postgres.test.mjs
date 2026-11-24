import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import {
  coreDigest, factIncarnationBody, fingerprintLegacyCapture, userFingerprintKey,
} from "../../core/src/index.mjs";
import {
  createPostgresCapturePorts, createPostgresRawPorts, createPostgresSuppressionStore, createPostgresUnitOfWork,
  HOSTED_FINGERPRINT_LABELS,
} from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const client = "mcp";
const pauseLock = { pauseLock: true };
const readOnly = { readOnly: true };
const message = (content, occurredAtMs = null) => ({ id: randomUUID(), role: "user", content, occurredAtMs });

async function fixture(t, options = {}) {
  const { pool, source } = await migrationDatabase(t);
  const owner = randomUUID();
  const other = randomUUID();
  await pool.query("INSERT INTO users (id) VALUES ($1), ($2)", [owner, other]);
  const lineageSecret = randomBytes(32).toString("hex");
  const mac = (domain) => createHmac("sha256", lineageSecret).update(domain).digest("hex");
  const rawOptions = { lineageSecret, ...options };
  const uow = createPostgresUnitOfWork(source);
  const capture = createPostgresCapturePorts(rawOptions);
  const { raw, sessionLineage } = createPostgresRawPorts(rawOptions);
  const key = (scope = { owner, namespace: null }, sessionId = randomUUID()) => ({
    scope, client, sessionId, eventId: randomUUID(), payloadDigest: createHash("sha256").update(randomUUID()).digest("hex"),
  });
  const write = (fn, user = owner) => uow.run(user, pauseLock, fn);
  const read = (fn, user = owner) => uow.run(user, readOnly, fn);
  const save = (item, messages) => write(async (tx) => {
    assert.deepEqual(await capture.admit(tx, item, messages), { status: "admitted" });
    await raw.recordLineage(tx, item, messages);
    return raw.archive(tx, item, messages);
  }, item.scope.owner);
  const storeFact = async (fact) => {
    const incarnation = createHash("sha256").update(factIncarnationBody(fact)).digest("hex");
    const stored = await write((tx) => createPostgresSuppressionStore().writeFact(tx, fact, incarnation), fact.owner);
    return { ...stored, incarnation, fact };
  };
  return { pool, source, owner, other, mac, uow, capture, raw, sessionLineage, key, write, read, save, storeFact };
}

function wireMessage({ id, role, content, occurredAtMs }, extras = {}) {
  return { id, role, content, ...(occurredAtMs === null ? {} : { occurred_at: new Date(occurredAtMs).toISOString() }), ...extras };
}

async function hostedLedger(pool, key, messages, { legacy = false, keyId = null } = {}) {
  const { scope, sessionId, eventId } = key;
  const rawRequest = JSON.stringify({ client, session_id: sessionId, event_id: eventId, messages });
  await pool.query(`INSERT INTO capture_events
    (user_id, client, session_id, event_id, received_at, raw_lineage_key_id, raw_request)
    VALUES ($1, $2, $3, $4, now(), $5, $6)`,
  [scope.owner, client, sessionId, eventId, keyId, legacy ? JSON.stringify(rawRequest) : rawRequest]);
}

async function hostedArchive(pool, key, item) {
  const { rows } = await pool.query(`INSERT INTO raw_messages
    (id, user_id, client, session_id, message_id, seq, occurred_at, role, content)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (user_id, client, session_id, message_id) DO NOTHING RETURNING 1`,
  [randomUUID(), key.scope.owner, client, key.sessionId, item.id, 0,
    item.occurredAtMs === null ? null : new Date(item.occurredAtMs).toISOString(), item.role, item.content]);
  return rows.length;
}

async function hostedAnchor(pool, key, messageMac, contentMac = null) {
  await pool.query(`INSERT INTO capture_raw_lineage (user_id, client, session_id, message_mac, content_mac)
    VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`, [key.scope.owner, client, key.sessionId, messageMac, contentMac]);
}

const keyIdDomain = "\0cairn:w1a:raw-lineage";
const contentDomain = (key, item) =>
  "\0cairn:raw-lineage-content:" + JSON.stringify([key.scope.owner, client, item.id, item.content]);

test("Core archive, proofs, ledger and fence remain usable by hosted rollback", migrationDbTest, async (t) => {
  const { pool, owner, mac, capture, raw, key, write, read, save } = await fixture(t);
  const root = key();
  const item = message("cedar drawer", 1);
  assert.deepEqual(await save(root, [item]), { archived: 1 });
  assert.deepEqual(await write((tx) => raw.archive(tx, root, [item, { ...item, content: "waxed drawer" }])), { archived: 0 });
  assert.equal(await hostedArchive(pool, root, item), 0);
  const { rows: [stored] } = await pool.query(`SELECT r.id, r.message_id, r.seq, r.occurred_at, r.role, r.content,
      e.raw_request, e.raw_lineage_key_id, l.content_mac
    FROM raw_messages r JOIN capture_events e USING (user_id, client, session_id)
    JOIN capture_raw_lineage l USING (user_id, client, session_id)
    WHERE r.user_id = $1 AND r.client = $2 AND r.session_id = $3 AND l.message_mac = $4`,
  [owner, client, root.sessionId, mac(item.id)]);
  assert.match(stored.id, /^[a-f0-9-]{36}$/u);
  assert.deepEqual([stored.message_id, stored.seq, +stored.occurred_at, stored.role, stored.content],
    [item.id, null, item.occurredAtMs, item.role, item.content]);
  assert.equal(stored.raw_lineage_key_id, "content:" + mac(keyIdDomain));
  assert.equal(stored.content_mac, mac(contentDomain(root, item)));
  assert.deepEqual(stored.raw_request, {
    client, event_id: root.eventId, session_id: root.sessionId, messages: [wireMessage(item)],
  });

  await write((tx) => raw.fenceSession(tx, root.scope, root));
  // The hosted visibility predicate sees the same archive-only fence after rollback.
  const { rows: visible } = await pool.query(`SELECT r.id FROM raw_messages r WHERE r.user_id = $1 AND NOT EXISTS (
    SELECT 1 FROM capture_raw_fences f WHERE (f.user_id, f.client, f.session_id) = (r.user_id, r.client, r.session_id))`, [owner]);
  assert.deepEqual(visible, []);

  // Hosted forget deletes in the shared session and scrubs the existing request object.
  const hosted = await pool.connect();
  try {
    await hosted.query("BEGIN");
    await hosted.query("SELECT pg_advisory_xact_lock(hashtextextended('cairn:memory-pause:' || $1, 0))", [owner]);
    await hosted.query("SELECT pg_advisory_xact_lock(hashtext('w3:' || $1))", [owner]);
    await hosted.query(`INSERT INTO suppressions (id, user_id, kind, client, session_id, origin)
      VALUES ($1, $2, 'session', $3, $4, 'forget')`, [randomUUID(), owner, client, root.sessionId]);
    await hosted.query("DELETE FROM raw_messages WHERE user_id = $1 AND client = $2 AND session_id = $3",
      [owner, client, root.sessionId]);
    await hosted.query(`UPDATE capture_events SET raw_request = jsonb_set(raw_request, '{messages,0,content}', '""'::jsonb)
      WHERE user_id = $1 AND client = $2 AND session_id = $3`, [owner, client, root.sessionId]);
    await hosted.query("COMMIT");
  } finally {
    hosted.release(true);
  }
  assert.deepEqual((await read((tx) => capture.load(tx, root))).messages, [{ ...item, content: "" }]);
  assert.deepEqual(await write((tx) => raw.archive(tx, root, [item])), { archived: 0 });
  assert.deepEqual(await read((tx) => capture.eligible(tx, key(), [item])), []);
});

test("Core erases hosted rows by proven closure, preserving ID-only rows and legacy encodings", migrationDbTest, async (t) => {
  const { pool, owner, capture, raw, sessionLineage, mac, key, write, read } = await fixture(t);
  const root = key();
  const proven = key();
  const legacy = key();
  const item = message("elm cabinet");
  const legacyId = message("older passage");
  legacyId.id += "\u0000\ud800" + String.raw`\u0000`;
  const proof = mac(contentDomain(root, item));
  await hostedLedger(pool, root, [wireMessage(item, { document_ill_formed: true }),
    wireMessage(legacyId, { occurred_at: "unknown", normalized_empty: true })], { legacy: true });
  await hostedLedger(pool, proven, [wireMessage(item)], { keyId: "content:" + mac(keyIdDomain) });
  await hostedLedger(pool, legacy, [wireMessage(item)], { keyId: mac(keyIdDomain) });
  await hostedAnchor(pool, root, mac(item.id), proof);
  await hostedAnchor(pool, proven, mac(item.id), proof);
  await hostedAnchor(pool, legacy, mac(item.id));
  for (const target of [root, proven, legacy]) assert.equal(await hostedArchive(pool, target, item), 1);
  const erased = await write(async (tx) => {
    const closure = await sessionLineage.provenClosure(tx, root.scope, [root]);
    assert.deepEqual(new Set(closure.map(({ sessionId }) => sessionId)), new Set([root.sessionId, proven.sessionId]));
    return raw.eraseSessions(tx, root.scope, closure);
  });
  assert.deepEqual(erased, { rawDeleted: 2, ledgerBlanked: 3 });
  assert.deepEqual((await pool.query("SELECT session_id, content FROM raw_messages WHERE user_id = $1", [owner])).rows,
    [{ session_id: legacy.sessionId, content: item.content }]);
  const { rows } = await pool.query("SELECT session_id, raw_request FROM capture_events WHERE user_id = $1", [owner]);
  const requests = new Map(rows.map((row) => [row.session_id, row.raw_request]));
  assert.equal(typeof requests.get(root.sessionId), "string");
  assert.deepEqual(JSON.parse(requests.get(root.sessionId)).messages,
    [wireMessage({ ...item, content: "" }), wireMessage({ ...legacyId, content: "" })]);
  assert.deepEqual(requests.get(proven.sessionId).messages, [wireMessage({ ...item, content: "" })]);
  assert.deepEqual(requests.get(legacy.sessionId).messages, [wireMessage(item)]);
  assert.deepEqual(await read((tx) => sessionLineage.isFenced(tx, legacy.scope, legacy)), { fenced: true, proof: "id-only" });
  assert.deepEqual(await read((tx) => capture.eligible(tx, key(), [item])), []);
  assert.equal(await read((tx) => raw.archiveAllowed(tx, legacy)), false);
  assert.deepEqual(await write(async (tx) =>
    raw.eraseSessions(tx, root.scope, await sessionLineage.provenClosure(tx, root.scope, [root]))),
  { rawDeleted: 0, ledgerBlanked: 0 });
});

test("legacy unindexed ledger IDs withhold exact IDs without fencing unrelated arrivals", migrationDbTest, async (t) => {
  const { pool, owner, capture, raw, key, write, read } = await fixture(t);
  const root = key();
  const replay = key();
  const item = message("ash desk");
  const edit = { ...item, content: "ash shelf" };
  const unrelated = message("linen cabinet");
  await hostedLedger(pool, root, [wireMessage(item)], { legacy: true });
  await hostedLedger(pool, replay, [wireMessage(edit)]);
  await pool.query("INSERT INTO capture_raw_fences (user_id, client, session_id) VALUES ($1, $2, $3)",
    [owner, client, root.sessionId]);
  assert.equal(await read((tx) => raw.archiveAllowed(tx, replay)), false);
  assert.deepEqual(await read((tx) => capture.eligible(tx, key(), [edit, unrelated])), []);
  assert.deepEqual(await write((tx) => raw.archive(tx, key(), [unrelated])), { archived: 1 });
  assert.deepEqual(await read((tx) => capture.status(tx, root.scope, root.eventId)), { status: "pending" });
});

test("Raw follows a weak link into a proven component across both ledger writers", migrationDbTest, async (t) => {
  const { pool, mac, raw, key, write, read } = await fixture(t);
  const fence = key();
  const bridge = key();
  const target = key();
  const weak = message("later wording");
  const entry = message("retained proof");
  const strong = message("shared proof");
  await hostedAnchor(pool, bridge, mac(entry.id), mac(contentDomain(bridge, entry)));
  await write((tx) => raw.recordLineage(tx, bridge, [strong]));
  await write((tx) => raw.recordLineage(tx, fence, [strong]));
  await hostedLedger(pool, target, [wireMessage({ ...weak, id: entry.id })], { legacy: true });
  await write((tx) => raw.fenceSession(tx, fence.scope, fence));
  assert.equal(await read((tx) => raw.archiveAllowed(tx, target)), false);
  assert.deepEqual(await write((tx) => raw.archive(tx, target, [weak])), { archived: 0 });
  assert.deepEqual(await write((tx) => raw.archive(tx, key(), [weak])), { archived: 1 });
});

test("Raw archive refuses session and window facts, preserving supplied positions and exact counts", migrationDbTest, async (t) => {
  const { pool, owner, raw, key, write, storeFact } = await fixture(t);
  const root = key();
  const positions = [-2, -1, 0, 1, 2, null].map((time) => message("oak chest", time));
  await pool.query(`INSERT INTO suppressions (id, user_id, kind, client, window_start, window_end, origin)
    VALUES ($1, $2, 'window', $3, to_timestamp(-0.0005), to_timestamp(0.0015), 'forget')`, [randomUUID(), owner, client]);
  assert.deepEqual(await write((tx) => raw.archive(tx, root, [...positions, positions[0]])), { archived: 3 });
  assert.deepEqual(await write((tx) => raw.archive(tx, root, [positions[0]])), { archived: 0 });
  assert.deepEqual((await pool.query("SELECT message_id FROM raw_messages WHERE user_id = $1", [owner])).rows.map(({ message_id }) =>
    message_id).sort(), [positions[0].id, positions[4].id, positions[5].id].sort());
  await storeFact({ ...root.scope, kind: "window", actionId: randomUUID(), origin: "forget",
    client, window: { startMs: -1, endMs: 2 }, unknownTime: true });
  assert.deepEqual(await write((tx) => raw.archive(tx, root, [message("birch chest")])), { archived: 0 });
  await pool.query(`INSERT INTO suppressions (id, user_id, kind, client, session_id, origin)
    VALUES ($1, $2, 'session', $3, $4, 'forget')`, [randomUUID(), owner, client, root.sessionId]);
  assert.equal(await write((tx) => raw.archiveAllowed(tx, root)), false);
  assert.deepEqual(await write((tx) => raw.archive(tx, root, [message("birch chest", 4)])), { archived: 0 });
  assert.deepEqual(await write((tx) => raw.deleteConversation(tx, root.scope, root)), { rawDeleted: 3 });
});

test("purge deletes definite text matches and retains doubt or session-only rows", migrationDbTest, async (t) => {
  const { pool, owner, raw, key, write, save, storeFact } = await fixture(t);
  const root = key();
  const same = key();
  const hidden = key();
  const match = message("Cedar    Writing Desk");
  const survivor = message("linen valance");
  const sessionOnly = message("glass lamp");
  await save(root, [match, survivor]);
  await hostedArchive(pool, hidden, sessionOnly);
  const digest = await coreDigest("cedar writing desk");
  const fact = (digests) => ({ ...root.scope, kind: "text", mode: "exact", origin: "forget",
    actionId: randomUUID(), text: { digests } });
  const exact = await storeFact(fact([digest]));
  const doubt = await storeFact(fact([{ ...digest, alg: "hmac", keyId: randomUUID() }]));
  const blocked = await storeFact({ ...root.scope, kind: "session", origin: "forget", actionId: randomUUID(),
    session: { client, sessionId: hidden.sessionId } });
  const window = await storeFact({ ...root.scope, kind: "window", origin: "forget", actionId: randomUUID(),
    client, window: { startMs: -1, endMs: 2 } });
  await hostedArchive(pool, same, { ...match, id: randomUUID(), content: "cedar writing desk" });
  const revision = async () => (await pool.query("SELECT index_revision FROM core_owner_state WHERE user_id = $1", [owner])).rows[0].index_revision;
  const before = BigInt(await revision());
  const purge = () => write((tx) => raw.purgeWithheld(tx, root.scope, [exact, doubt, blocked, window]));
  assert.deepEqual(await purge(), { rawDeleted: 2, ledgerBlanked: 1 });
  assert.deepEqual(await purge(), { rawDeleted: 0, ledgerBlanked: 0 });
  assert.equal(BigInt(await revision()), before + 1n);
  assert.deepEqual((await pool.query("SELECT message_id FROM raw_messages WHERE user_id = $1 ORDER BY message_id", [owner])).rows,
    [survivor.id, sessionOnly.id].sort().map((message_id) => ({ message_id })));
  const { rows: [{ raw_request }] } = await pool.query("SELECT raw_request FROM capture_events WHERE user_id = $1", [owner]);
  assert.deepEqual(raw_request.messages, [wireMessage({ ...match, content: "" }), wireMessage(survivor)]);
});

test("purge recognizes hosted keyed containment and stored legacy fingerprints", migrationDbTest, async (t) => {
  const secret = randomBytes(32).toString("hex");
  const getKey = (owner) => userFingerprintKey(secret, owner, HOSTED_FINGERPRINT_LABELS);
  const { pool, owner, raw, key, write, storeFact } = await fixture(t, {
    fingerprintKeys: async (owner) => [{ pipeline: "hosted-v1", key: await getKey(owner) }],
  });
  const root = key();
  const phrase = "frosted glass cabinet with copper pulls";
  const fingerprint = await fingerprintLegacyCapture(phrase, await getKey(owner), HOSTED_FINGERPRINT_LABELS);
  const containing = message("inventory includes a frosted glass cabinet with copper pulls by the window");
  const changedByRedaction = message("replacement wording");
  await hostedArchive(pool, root, containing);
  await hostedLedger(pool, root, [wireMessage(changedByRedaction, { legacy_fingerprint: fingerprint })]);
  const text = await storeFact({ ...root.scope, kind: "text", mode: "full", origin: "forget", actionId: randomUUID(),
    text: { keyId: fingerprint.key_id, shingles: fingerprint.shingles,
      digests: [{ alg: "hmac", pipeline: "hosted-v1", value: fingerprint.text_hmac,
        keyId: fingerprint.key_id, redactionVersion: 1 }] } });
  assert.deepEqual(await write((tx) => raw.purgeWithheld(tx, root.scope, [text])), { rawDeleted: 1, ledgerBlanked: 1 });
  const { rows: [{ raw_request }] } = await pool.query("SELECT raw_request FROM capture_events WHERE user_id = $1", [owner]);
  assert.deepEqual(raw_request.messages, [wireMessage({ ...changedByRedaction, content: "" })]);
});

test("raw deletion, purge, fencing and anchors isolate other owners", migrationDbTest, async (t) => {
  const { pool, owner, other, capture, raw, key, write, read, save, storeFact } = await fixture(t);
  const root = key();
  const foreign = key({ owner: other, namespace: null }, root.sessionId);
  const item = message("shared message shape");
  await save(root, [item]);
  await save(foreign, [item]);
  await write((tx) => raw.fenceSession(tx, root.scope, root));
  assert.equal(await read((tx) => raw.archiveAllowed(tx, foreign), other), true);
  assert.deepEqual(await read((tx) => capture.eligible(tx, key(foreign.scope), [item]), other), [0]);
  await assert.rejects(write((tx) => raw.deleteConversation(tx, foreign.scope, foreign)), { code: "internal_error" });
  assert.deepEqual(await write((tx) => raw.deleteConversation(tx, root.scope, root)), { rawDeleted: 1 });
  const text = await storeFact({ ...root.scope, kind: "text", mode: "exact", origin: "forget", actionId: randomUUID(),
    text: { digests: [await coreDigest(item.content)] } });
  assert.deepEqual(await write((tx) => raw.purgeWithheld(tx, root.scope, [text])), { rawDeleted: 0, ledgerBlanked: 1 });
  assert.deepEqual((await pool.query("SELECT user_id, content FROM raw_messages WHERE user_id = ANY($1)", [[owner, other]])).rows, [{ user_id: other, content: item.content }]);
  assert.deepEqual((await read((tx) => capture.load(tx, foreign), other)).messages, [item]);
  assert.deepEqual((await read((tx) => capture.load(tx, root), owner)).messages, [{ ...item, content: "" }]);
});

test("erase rejects unproven and stale closures and recording rolls back without an archive", migrationDbTest, async (t) => {
  const { pool, owner, raw, sessionLineage, key, write, save } = await fixture(t);
  const root = key();
  const replay = key();
  const item = message("brass fittings");
  await save(root, [item]);
  const abort = new Error("abort anchor recording");
  await assert.rejects(write(async (tx) => {
    await raw.recordLineage(tx, replay, [item]);
    throw abort;
  }), (error) => error === abort);
  assert.deepEqual((await pool.query("SELECT session_id FROM capture_raw_lineage WHERE user_id = $1", [owner])).rows,
    [{ session_id: root.sessionId }]);
  await write((tx) => raw.recordLineage(tx, replay, [item]));
  assert.deepEqual((await pool.query("SELECT session_id FROM raw_messages WHERE user_id = $1", [owner])).rows,
    [{ session_id: root.sessionId }]);
  const stale = await write((tx) => sessionLineage.provenClosure(tx, root.scope, [root]));
  for (const forged of [[root, replay], stale, [...stale]]) {
    await assert.rejects(write((tx) => raw.eraseSessions(tx, root.scope, forged)), { code: "raw_lineage_unavailable" });
  }
  assert.deepEqual((await pool.query("SELECT session_id, content FROM raw_messages WHERE user_id = $1", [owner])).rows,
    [{ session_id: root.sessionId, content: item.content }]);
});

test("hosted Raw writes refuse a project namespace without writing", migrationDbTest, async (t) => {
  const { capture, raw, sessionLineage, pool, owner, key, write } = await fixture(t);
  const root = key({ owner, namespace: "project" });
  const personal = { ...root.scope, namespace: null };
  const item = message("green bookcase");
  await write((tx) => capture.admit(tx, root, [item]));

  await write(async (tx) => {
    const refusal = { code: "invalid_input" };
    await assert.rejects(raw.archive(tx, root, [item]), refusal);
    await assert.rejects(raw.recordLineage(tx, root, [item]), refusal);
    await assert.rejects(sessionLineage.recordAnchors(tx, root.scope, root, []), refusal);
    await assert.rejects(raw.fenceSession(tx, root.scope, root), refusal);
    const closure = await sessionLineage.provenClosure(tx, personal, [root]);
    await assert.rejects(raw.eraseSessions(tx, root.scope, closure), refusal);
    await assert.rejects(raw.purgeWithheld(tx, root.scope, []), refusal);
    await assert.rejects(raw.deleteConversation(tx, root.scope, root), refusal);
  });

  for (const table of ["raw_messages", "capture_raw_lineage", "capture_raw_fences"]) {
    const { rows } = await pool.query(`SELECT 1 FROM ${table} WHERE user_id = $1`, [owner]);
    assert.deepEqual(rows, []);
  }
  const { rows } = await pool.query("SELECT raw_lineage_key_id, raw_request FROM capture_events WHERE user_id = $1", [owner]);
  assert.deepEqual(rows, [{
    raw_lineage_key_id: null,
    raw_request: { client, event_id: root.eventId, session_id: root.sessionId, messages: [wireMessage(item)] },
  }]);
});

test("project ancestor facts still block a fork of a personal Raw session", migrationDbTest, async (t) => {
  const { capture, raw, sessionLineage, owner, key, write, read, storeFact } = await fixture(t);
  const root = key();
  const fork = key();
  const project = { owner, namespace: "project" };
  const projectEvent = key(project, root.sessionId);
  const item = message("narrow green bookcase");
  const projectMessage = message("different project capture");
  await write(async (tx) => {
    await capture.admit(tx, projectEvent, [projectMessage]);
    await raw.recordLineage(tx, root, [item]);
    await raw.recordLineage(tx, fork, [item]);
  });
  const suppress = (sessionId) => storeFact({ ...project, kind: "session", origin: "forget",
    actionId: randomUUID(), session: { client, sessionId } });
  await suppress(fork.sessionId);
  assert.deepEqual(await read((tx) => capture.eligible(tx, fork, [item])), [0]);
  await suppress(root.sessionId);
  assert.deepEqual(await read((tx) => capture.eligible(tx, fork, [item])), []);
  await write(async (tx) => {
    const closure = await sessionLineage.provenClosure(tx, root.scope, [root]);
    assert.deepEqual(new Set(closure.map(({ sessionId }) => sessionId)), new Set([root.sessionId, fork.sessionId]));
    assert.deepEqual(await raw.eraseSessions(tx, root.scope, closure), { rawDeleted: 0, ledgerBlanked: 0 });
  });
  assert.deepEqual((await read((tx) => capture.load(tx, projectEvent))).messages, [projectMessage]);
});

async function whileArchiveWaits({ pool, source, owner, raw }, target, messages, privacyStep) {
  let started;
  const waiting = new Promise((resolve) => { started = resolve; });
  const archiveUow = createPostgresUnitOfWork({
    async connect() {
      const conn = await source.connect();
      const { rows: [{ pid }] } = await conn.query("SELECT pg_backend_pid() AS pid");
      return {
        query(sql, values) {
          if (sql.includes("SELECT pg_advisory_xact_lock") && sql.includes("memory-pause")) started(pid);
          return conn.query(sql, values);
        },
        release: (destroy) => conn.release(destroy),
      };
    },
  });
  const uow = createPostgresUnitOfWork(source);
  let archive;
  try {
    const result = await uow.run(owner, pauseLock, async (tx) => {
      archive = archiveUow.run(owner, pauseLock, (tx) => raw.archive(tx, target, messages));
      const pid = await Promise.race([waiting, archive.then(() => assert.fail("archive skipped the pause lock"))]);
      let blocked = false;
      for (let i = 0; i < 100 && !blocked; i++) {
        const { rows } = await pool.query("SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked", [pid]);
        blocked = rows[0].blocked;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.equal(blocked, true);
      return privacyStep(tx);
    });
    return { result, archive: await archive };
  } finally {
    await archive?.catch(() => {});
  }
}

test("a concurrent archive waits for fenceSession and refuses a late message", migrationDbTest, async (t) => {
  const f = await fixture(t);
  const root = f.key();
  const first = message("existing raw row");
  await f.save(root, [first]);
  const result = await whileArchiveWaits(f, root, [message("late arrival")],
    (tx) => f.raw.fenceSession(tx, root.scope, root));
  assert.deepEqual(result.archive, { archived: 0 });
  assert.deepEqual((await f.pool.query("SELECT message_id FROM raw_messages WHERE user_id = $1", [f.owner])).rows,
    [{ message_id: first.id }]);
});

test("a concurrent archive waits for proven erasure and cannot repopulate a member", migrationDbTest, async (t) => {
  const f = await fixture(t);
  const root = f.key();
  const fork = f.key();
  const item = message("one proven source");
  await f.save(root, [item]);
  await f.save(fork, [item]);
  const result = await whileArchiveWaits(f, fork, [message("late arrival")], async (tx) => {
    const closure = await f.sessionLineage.provenClosure(tx, root.scope, [root]);
    return f.raw.eraseSessions(tx, root.scope, closure);
  });
  assert.deepEqual(result, { result: { rawDeleted: 2, ledgerBlanked: 2 }, archive: { archived: 0 } });
  assert.deepEqual((await f.pool.query("SELECT message_id FROM raw_messages WHERE user_id = $1", [f.owner])).rows, []);
});

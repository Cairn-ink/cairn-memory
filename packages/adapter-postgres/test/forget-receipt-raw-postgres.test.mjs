import { AsyncLocalStorage } from "node:async_hooks";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { test } from "node:test";
import { syntheticHooks } from "@cairn-ink/conformance/host-write-hooks";
import { capabilities, userFingerprintKey } from "../../core/src/index.mjs";
import { createMemoryService } from "../../core/src/service/index.mjs";
import {
  createPostgresCapturePorts, createPostgresFingerprintKeyProvider, createPostgresHostWriteHookPort,
  createPostgresMemoryCandidates, createPostgresMemoryReads, createPostgresMemoryStore, createPostgresPauseStore,
  createPostgresQuantityLedgerStore, createPostgresRawPorts, createPostgresRawReads, createPostgresSuppressionStore,
  createPostgresUnitOfWork, HOSTED_FINGERPRINT_LABELS,
} from "../src/index.mjs";
import { decodeOutboxMessages } from "../src/capture-input.mjs";
import { canonicalReceiptId } from "../src/memory-rows.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const scope = { owner: "fixture-owner", namespace: null };
const other = { owner: "fixture-other", namespace: null };
const source = { kind: "mcp", client: null, sessionId: null };
const readSet = { owner: scope.owner, namespaces: [null] };
const page = { limit: 20, cursor: null };
const now = 50_000;
const vector = Float32Array.of(1, ...Array(1535).fill(0));
const sha256Hex = text => createHash("sha256").update(text).digest("hex");

const primary = { client: "test-client", sessionId: "primary-session", eventId: "primary-capture" };
const secondary = { client: primary.client, sessionId: "secondary-session", eventId: "secondary-capture" };
const separate = { client: primary.client, sessionId: "separate-session", eventId: "separate-capture" };
const turn = (id, content, role = "user") => ({ id, content, role, occurredAtMs: 10_000 });
const primaryTurn = turn("primary-message", "The equipment locker contains a folding ladder.");
const secondaryTurn = turn("secondary-message", "A kestrel flew over the orchard.");
const neighbor = turn("neighbor", "A kestrel landed beside the shed.");
const sameId = turn(secondaryTurn.id, "A kestrel perched on the weather vane.");
const delayed = turn("delayed-message", "An otter swam past the bridge.");
const memoryText = "The ladder is available for maintenance.";

function receipt({ client, sessionId }, { id, role, occurredAtMs }) {
  return { client, sessionId, messageId: id, role, occurredAtMs };
}

function tuple({ client, sessionId, messageId }) {
  return [client, sessionId, messageId];
}

const dumpSql = `SELECT jsonb_build_object(
  'memories', ARRAY(SELECT to_jsonb(m) || jsonb_build_object('embedding', m.embedding::text)
    FROM memories m ORDER BY user_id, id),
  'receipts', ARRAY(SELECT to_jsonb(r) FROM core_memory_receipts r ORDER BY user_id, memory_id, client, session_id, message_id),
  'raw', ARRAY(SELECT to_jsonb(r) FROM raw_messages r ORDER BY user_id, id),
  'capture', ARRAY(SELECT to_jsonb(e) FROM capture_events e ORDER BY user_id, client, event_id),
  'quantities', ARRAY(SELECT to_jsonb(q) FROM core_quantity_ledger q ORDER BY user_id, ledger_key),
  'facts', ARRAY(SELECT to_jsonb(f) || jsonb_build_object('epoch', f.epoch::text, 'embedding', f.embedding::text)
    FROM core_suppression_facts f ORDER BY user_id, epoch),
  'digests', ARRAY(SELECT to_jsonb(d) FROM core_fact_digests d ORDER BY user_id, fact_id, alg, value),
  'lineage', ARRAY(SELECT to_jsonb(l) FROM capture_raw_lineage l
    ORDER BY user_id, client, session_id, message_mac, content_mac),
  'fences', ARRAY(SELECT to_jsonb(f) FROM capture_raw_fences f ORDER BY user_id, client, session_id),
  'suppressions', ARRAY(SELECT to_jsonb(s) FROM suppressions s ORDER BY user_id, text_hash),
  'ownerState', ARRAY(SELECT to_jsonb(s) || jsonb_build_object('fact_epoch', s.fact_epoch::text, 'index_revision', s.index_revision::text)
    FROM core_owner_state s ORDER BY user_id)
) AS snapshot`;

async function fixture(t, keyed, overrides) {
  const { pool, source: database } = await migrationDatabase(t);
  await pool.query("INSERT INTO users (id) VALUES ($1), ($2)", [scope.owner, other.owner]);
  await pool.query("INSERT INTO core_owner_state (user_id, legacy_facts_ready) VALUES ($1, true)", [scope.owner]);
  const uow = createPostgresUnitOfWork(database);
  const write = (fn, target = scope) => uow.run(target.owner, { pauseLock: true }, fn);
  const read = fn => uow.run(scope.owner, { readOnly: true }, fn);
  const secret = keyed ? "forget-receipt-key" : null;
  const keys = createPostgresFingerprintKeyProvider(secret, { uow });
  const key = keyed ? await userFingerprintKey(secret, scope.owner, HOSTED_FINGERPRINT_LABELS) : null;
  if (key) await keys.publish(scope.owner, key.id);

  const readOptions = { allowNonNullNamespace: true };
  const rawOptions = {
    lineageSecret: "forget-receipt-lineage",
    fingerprintKeys: async owner => key && owner === scope.owner ? [key] : [],
  };
  const { raw: archive, sessionLineage } = createPostgresRawPorts({ ...rawOptions,
    fingerprintKeys: async owner => (await rawOptions.fingerprintKeys(owner)).map(key => ({ pipeline: "core", key })) });
  const raw = { ...archive, ...createPostgresRawReads(rawOptions) };
  const reads = createPostgresMemoryReads({ ...readOptions, ...rawOptions });
  const memories = createPostgresMemoryStore({ ...readOptions, nearDuplicate: false });
  const quantityLedger = createPostgresQuantityLedgerStore(readOptions);
  const context = new AsyncLocalStorage();
  let extraction = [];
  const createService = ({ rawEnabled = true, sessionLineageEnabled = rawEnabled } = {}) => createMemoryService({
    storage: {
      name: "postgres", uow, keys, memories, quantityLedger, raw, sessionLineage,
      hostWriteHookPort: overrides && createPostgresHostWriteHookPort({ context, rawVisibility: rawOptions }),
      ...reads,
      capture: createPostgresCapturePorts({ ...readOptions, lineageSecret: rawOptions.lineageSecret,
        nearDuplicate: false, now: () => now }),
      pause: createPostgresPauseStore(),
      suppressions: createPostgresSuppressionStore({ ...readOptions, lineageSecret: rawOptions.lineageSecret }),
      ...createPostgresMemoryCandidates(readOptions),
      capabilities: capabilities({ fingerprintKey: keyed, embeddingRequiredOnInsert: true, nearDuplicate: false,
        rawArchive: rawEnabled, sessionLineage: sessionLineageEnabled, quantityLedger: true, hostWriteHooks: !!overrides }),
    },
    config: {},
    ...(overrides && { hostWriteHooks: syntheticHooks(overrides) }),
    clock: { nowMs: () => now, monotonicMs: () => performance.now(), sha256Hex,
      hmacHex: (key, text) => createHmac("sha256", key).update(text).digest("hex") },
    gate: { assertOpen() {} }, tokens: { countTokens: () => 1 },
    model: { model: "fixture", contextWindow: 32_768, countTokens: () => 1,
      async call() { return { items: extraction }; } },
    embedder: { model: "fixture", dimensions: vector.length, async embed(texts) { return texts.map(() => vector); } },
  });
  const service = createService();
  const enqueue = async (event, messages) => {
    assert.equal((await service.enqueueCapture(scope, { ...event, messages })).status, "accepted");
  };
  async function runCapture(event, text) {
    extraction = text ? [{ content: text, kind: "fact", confidence: 1, sourceIndices: [0] }] : [];
    const result = await service.runCapture(scope, event);
    assert.equal(result.status, "done", result.code);
    assert.equal(result.result.memories.length, extraction.length);
    return result.result.memories[0]?.id;
  }
  async function capture(event, messages, text) {
    await enqueue(event, messages);
    return runCapture(event, text);
  }

  const rawRows = async () => (await pool.query(`SELECT id, user_id AS owner, client, session_id AS "sessionId",
    message_id AS "messageId", role, content FROM raw_messages ORDER BY user_id, client, session_id, message_id`)).rows;
  const receiptRows = async id => (await pool.query(`SELECT client, session_id AS "sessionId", message_id AS "messageId",
    role, forgotten_at IS NOT NULL AS marked FROM core_memory_receipts WHERE user_id = $1 AND memory_id = $2
    ORDER BY client, session_id, message_id`, [scope.owner, id])).rows;
  const attach = (id, evidence) => write(tx => memories.touchDuplicate(tx, scope, id, evidence, { confidence: 1 }, now));
  const forget = id => service.forget(scope, id, source);
  const importRaw = (event, message, target = scope) =>
    write(tx => raw.importArchive(tx, target, event, [message]), target);
  const insert = (target, text, evidence) => write(tx => memories.insert(tx, target, {
    text, textHash: `sha256:${sha256Hex(text)}`, kind: "fact", origin: "explicit", confidence: 1, source,
    embedding: { model: "fixture", vector },
  }, evidence, now), target);

  async function seedSecondary(message = secondaryTurn) {
    const id = await capture(primary, [primaryTurn], memoryText);
    await capture(secondary, [message, neighbor]);
    await attach(id, [receipt(secondary, secondaryTurn)]);
    return id;
  }

  async function assertRawViews(term, visible, hidden) {
    const refs = rows => rows.map(({ id }) => ({ type: "raw", id, namespace: null }));
    const found = await service.find(scope, term, { kinds: ["raw"] });
    assert.equal(found.layers.raw.status, "ok");
    assert.deepEqual(new Set(found.raw.map(({ ref }) => ref)), new Set(refs(visible)), "Raw search");
    const listed = await service.listRawMessages(scope, page);
    const candidates = new Set([...visible, ...hidden].map(({ id }) => id));
    assert.deepEqual(new Set(listed.items.filter(({ ref }) => candidates.has(ref.id)).map(({ ref }) => ref)),
      new Set(refs(visible)), "Raw list");
    await read(async tx => {
      assert.deepEqual(await reads.fence.assertVisible(tx, readSet, refs([...visible, ...hidden]), "read"),
        refs(visible), "Raw ref visibility");
      const { segments } = await raw.raw(tx, readSet, term, "context", { limit: page.limit });
      assert.deepEqual(new Set(segments.map(({ ref }) => ref)), new Set(refs(visible)), "Raw context candidates");
    });
  }

  async function seedQuantities(evidence) {
    const { id } = await insert(scope, "Separate quantity provenance.", evidence);
    const rows = await Promise.all(evidence.map(async (item, ordinal) => ({
      memoryId: id, receiptId: await canonicalReceiptId(scope.owner, scope.namespace, id, item),
      textHash: `sha256:${sha256Hex("Separate quantity provenance.")}`, date: now, ordinal,
      kind: "record", measure: "count", category: "supplies", value: 1, unit: "unit", group: "fixture",
      period: "none", comparator: "none",
    })));
    assert.deepEqual(await write(tx => quantityLedger.put(tx, scope, rows)), { inserted: rows.length });
  }
  const quantities = async () => (await pool.query(`SELECT source_client AS client, source_session_id AS "sessionId",
    source_message_id AS "messageId", to_jsonb(q) AS row FROM core_quantity_ledger q ORDER BY ordinal`)).rows;
  const ledgerMessages = async () => (await pool.query(`SELECT client, session_id AS "sessionId", raw_request, core_outbox_metadata
    FROM capture_events WHERE user_id = $1 ORDER BY client, session_id, event_id`, [scope.owner])).rows
    .flatMap(({ client, sessionId, raw_request, core_outbox_metadata }) =>
      decodeOutboxMessages(raw_request, core_outbox_metadata).map(({ id, ...message }) =>
        ({ client, sessionId, messageId: id, ...message })));

  return { write, raw, rawRows, receiptRows, attach, enqueue, runCapture, capture, forget, importRaw, insert,
    seedSecondary, assertRawViews, seedQuantities, quantities, ledgerMessages, createService, pool,
    dump: async () => (await pool.query(dumpSql)).rows[0].snapshot };
}

for (const keyed of [false, true]) {
  const mode = keyed ? "keyed" : "keyless";

  test(`Postgres ${mode} forget erases secondary receipt Raw and only its source data`, migrationDbTest, async t => {
    const f = await fixture(t, keyed);
    const id = await f.seedSecondary();
    await f.capture(separate, [sameId]);
    assert.equal((await f.importRaw(secondary, secondaryTurn, other)).archived, 1);
    const receiptTuples = [receipt(primary, primaryTurn), receipt(secondary, secondaryTurn)].map(tuple);
    const receiptKeys = new Set(receiptTuples.map(address => JSON.stringify(address)));
    const isTarget = row => receiptKeys.has(JSON.stringify(tuple(row)));
    const before = await f.rawRows();
    const removed = before.filter(row => row.owner === scope.owner && isTarget(row));
    const kept = before.filter(row => !removed.includes(row));
    assert.equal(removed.length, 2);
    const matches = kept.filter(row => row.owner === scope.owner && row.content.includes("kestrel"));
    assert.equal(matches.length, 2);
    const secondaryRow = removed.find(row => row.sessionId === secondary.sessionId);
    await f.assertRawViews("kestrel", [...matches, secondaryRow], []);
    await f.seedQuantities([receipt(primary, primaryTurn), receipt(secondary, secondaryTurn),
      receipt(secondary, neighbor), receipt(separate, sameId)]);
    const quantities = await f.quantities();
    assert.equal(quantities.filter(isTarget).length, 2);
    const ledger = await f.ledgerMessages();
    assert.equal(ledger.filter(isTarget).length, 2);
    assert.ok(ledger.filter(isTarget).every(({ content }) => content !== ""));
    const receipts = await f.receiptRows(id);
    assert.deepEqual(new Set(receipts.map(tuple)), new Set(receiptTuples));
    assert.ok(receipts.every(({ marked }) => !marked));

    assert.equal((await f.forget(id)).status, "forgotten");
    assert.deepEqual(await f.rawRows(), kept, "only the owner's two receipt tuples are deleted");
    await f.assertRawViews("kestrel", matches, [secondaryRow]);
    assert.deepEqual(await f.receiptRows(id), receipts.map(row => ({ ...row, marked: true })));
    assert.deepEqual(await f.quantities(), quantities.filter(row => !isTarget(row)));
    assert.deepEqual(await f.ledgerMessages(), ledger.map(row => isTarget(row) ? { ...row, content: "" } : row));
  });

  test(`Postgres ${mode} forget refuses a receipt tuple first archived later`, migrationDbTest, async t => {
    const f = await fixture(t, keyed);
    const id = await f.capture(primary, [primaryTurn], memoryText);
    await f.attach(id, [receipt(secondary, delayed)]);
    assert.ok((await f.rawRows()).every(row => row.sessionId !== secondary.sessionId));
    assert.equal((await f.forget(id)).status, "forgotten");

    assert.deepEqual(await f.importRaw(secondary, delayed), { archived: 0, existing: 0, withheld: 1 });
    assert.ok((await f.rawRows()).every(row => row.sessionId !== secondary.sessionId));
    const key = { scope, ...secondary, payloadDigest: sha256Hex(delayed.content) };
    assert.deepEqual(await f.write(tx => f.raw.archive(tx, key, [delayed])), { archived: 0, withheld: 1 });
    assert.deepEqual(await f.rawRows(), []);
    assert.deepEqual((await f.receiptRows(id)).map(({ marked }) => marked), [true, true]);
  });

  const differentRole = { ...secondaryTurn, role: "assistant" };
  test(`Postgres ${mode} forget deletes and marks a receipt with a different stored Raw role`, migrationDbTest, async t => {
    const f = await fixture(t, keyed);
    const id = await f.seedSecondary(differentRole);
    const row = (await f.rawRows()).find(row => row.messageId === differentRole.id);
    assert.equal(row.role, "assistant");
    assert.equal((await f.receiptRows(id)).find(item => item.messageId === row.messageId && item.sessionId === row.sessionId).role, "user");
    assert.equal((await f.forget(id)).status, "forgotten");
    assert.ok((await f.rawRows()).every(raw => raw.id !== row.id));
    assert.deepEqual((await f.receiptRows(id)).map(({ marked }) => marked), [true, true]);
  });

  test(`Postgres ${mode} onForget lists all deleted receipt tuples regardless of role`, migrationDbTest, async t => {
    let affected;
    const f = await fixture(t, keyed, { async onForget(_tx, ctx) { affected = ctx.affectedMessages.map(tuple); } });
    const id = await f.seedSecondary(differentRole);
    const before = await f.rawRows();
    const expected = [receipt(primary, primaryTurn), receipt(secondary, differentRole)].map(tuple);
    assert.equal((await f.forget(id)).status, "forgotten");
    assert.deepEqual(affected, expected);
    const remaining = new Set((await f.rawRows()).map(({ id }) => id));
    assert.deepEqual(before.filter(row => !remaining.has(row.id)).map(tuple), affected);
  });

  test(`Postgres ${mode} forget deletes, marks and reports a different-role receipt in the primary session`, migrationDbTest, async t => {
    let affected;
    const f = await fixture(t, keyed, { async onForget(_tx, ctx) { affected = ctx.affectedMessages.map(tuple); } });
    const id = await f.capture(primary, [primaryTurn, differentRole], memoryText);
    const evidence = receipt(primary, secondaryTurn);
    await f.attach(id, [evidence]);
    const row = (await f.rawRows()).find(raw => raw.messageId === evidence.messageId);
    assert.deepEqual(tuple(row), tuple(evidence));
    assert.equal(row.role, "assistant");
    const receipts = await f.receiptRows(id);
    assert.deepEqual(receipts.find(item => item.messageId === row.messageId), {
      client: evidence.client, sessionId: evidence.sessionId, messageId: evidence.messageId, role: "user", marked: false,
    });

    // Fence the session without erasing it wholesale, so receipt erasure must delete the row.
    const service = f.createService({ sessionLineageEnabled: false });
    assert.equal((await service.forget(scope, id, source)).status, "forgotten");
    assert.ok((await f.rawRows()).every(raw => raw.id !== row.id));
    assert.deepEqual(await f.receiptRows(id), receipts.map(item => ({ ...item, marked: true })));
    assert.deepEqual(affected, [tuple(receipt(primary, primaryTurn)), tuple(evidence)]);
  });

  test(`Postgres ${mode} named namespace forget removes receipts only`, migrationDbTest, async t => {
    const f = await fixture(t, keyed);
    const named = { ...scope, namespace: "project" };
    await f.capture(secondary, [secondaryTurn]);
    const evidence = receipt(secondary, secondaryTurn);
    const { id } = await f.insert(named, memoryText, [evidence]);
    const before = await f.rawRows();
    assert.equal(before.length, 1);
    assert.deepEqual((await f.receiptRows(id)).map(({ marked }) => marked), [false]);
    assert.equal((await f.createService({ rawEnabled: false }).forget(named, id, source)).status, "forgotten");
    assert.deepEqual(await f.rawRows(), before);
    assert.deepEqual(await f.receiptRows(id), []);
  });

  test(`Postgres ${mode} onForget failure rolls back receipt Raw and ledgers`, migrationDbTest, async t => {
    let reachedHook = false;
    const f = await fixture(t, keyed, { async onForget() {
      reachedHook = true;
      throw new Error("Fixture hook failure");
    } });
    const id = await f.seedSecondary();
    await f.seedQuantities([receipt(secondary, secondaryTurn), receipt(secondary, neighbor)]);
    const before = await f.dump();
    await assert.rejects(f.forget(id), { code: "host_write_hook_failed" });
    assert.equal(reachedHook, true);
    assert.deepEqual(await f.dump(), before);
  });

  test(`Postgres ${mode} forget blanks a queued receipt before its first archive`, migrationDbTest, async t => {
    const f = await fixture(t, keyed);
    const id = await f.capture(primary, [primaryTurn], memoryText);
    await f.enqueue(secondary, [secondaryTurn, neighbor]);
    const evidence = receipt(secondary, secondaryTurn);
    await f.attach(id, [evidence]);
    const queuedMessages = async () => (await f.ledgerMessages()).filter(row => row.sessionId === secondary.sessionId);
    assert.ok((await f.rawRows()).every(row => row.sessionId !== secondary.sessionId));
    const before = await queuedMessages();
    assert.deepEqual(before.map(({ content }) => content), [secondaryTurn.content, neighbor.content]);
    const expected = [{ ...before[0], content: "" }, before[1]];
    const receipts = await f.receiptRows(id);
    assert.ok(receipts.some(row => row.messageId === evidence.messageId && !row.marked));

    assert.equal((await f.forget(id)).status, "forgotten");
    assert.deepEqual(await queuedMessages(), expected);
    assert.deepEqual(await f.receiptRows(id), receipts.map(row => ({ ...row, marked: true })));

    await f.runCapture(secondary);
    assert.deepEqual(await queuedMessages(), expected);
    assert.deepEqual((await f.rawRows()).map(({ client, sessionId, messageId, content }) =>
      [client, sessionId, messageId, content]), [[...tuple(receipt(secondary, neighbor)), neighbor.content]]);
  });

  test(`Postgres ${mode} forget drops quantities across clients for a physical MCP save receipt`, migrationDbTest, async t => {
    const f = await fixture(t, keyed);
    const id = await f.capture(primary, [primaryTurn], memoryText);
    const physical = { ...secondary, client: "mcp", sessionId: "mcp-save:fixture" };
    const reported = { ...physical, client: "reported-client" };
    assert.deepEqual(await f.importRaw(physical, secondaryTurn), { archived: 1, existing: 0, withheld: 0 });
    const evidence = receipt(physical, secondaryTurn);
    await f.attach(id, [evidence]);
    await f.seedQuantities([receipt(reported, secondaryTurn), evidence, receipt(reported, neighbor), receipt(separate, sameId)]);
    const targets = row => row.sessionId === physical.sessionId && row.messageId === evidence.messageId;
    const before = await f.quantities();
    assert.deepEqual(before.filter(targets).map(({ client }) => client), [reported.client, physical.client]);
    assert.equal(before.filter(row => !targets(row)).length, 2);
    assert.deepEqual((await f.rawRows()).filter(targets).map(tuple), [tuple(evidence)]);

    assert.equal((await f.forget(id)).status, "forgotten");
    assert.ok((await f.rawRows()).every(row => !targets(row)));
    assert.deepEqual(await f.quantities(), before.filter(row => !targets(row)));
  });

  test(`Postgres ${mode} forget removes invalid ledger timestamps only from selected messages`, migrationDbTest, async t => {
    const f = await fixture(t, keyed);
    const id = await f.seedSecondary();
    const event = [scope.owner, secondary.client, secondary.eventId];
    const { rows: [{ raw_request: before }] } = await f.pool.query(`UPDATE capture_events SET raw_request =
      jsonb_set(jsonb_set(raw_request, '{messages,0,occurred_at}', '"invalid"'), '{messages,1,occurred_at}', '"invalid"')
      WHERE user_id = $1 AND client = $2 AND event_id = $3 RETURNING raw_request`, event);
    assert.deepEqual(before.messages.map(({ occurred_at }) => occurred_at), ["invalid", "invalid"]);
    const [{ occurred_at, ...selected }, unselected] = before.messages;

    // Isolate the receipt scrub from the text purge, which cleans timestamps across the ledger.
    assert.equal((await f.createService({ rawEnabled: false }).forget(scope, id, source)).status, "forgotten");
    const { rows: [{ raw_request: after }] } = await f.pool.query(`SELECT raw_request FROM capture_events
      WHERE user_id = $1 AND client = $2 AND event_id = $3`, event);
    assert.deepEqual(after, { ...before, messages: [{ ...selected, content: "" }, unselected] });
  });
}

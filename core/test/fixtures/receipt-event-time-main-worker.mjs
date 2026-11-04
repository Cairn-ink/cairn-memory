// Generate frozen references from a blob-verified external git archive of a6ec0e0e:
// node <worker> <main-root> <scratch> <report> <old|safety|event> [event-schema-root] [capture|receipts]
// Event references execute main on safety layouts, then install the candidate's
// schema offline and independently set the expected receipt attribute. Main's
// rejected new inputs use their explicitly permitted untimed equivalents.
// Candidate runs omit event-schema-root. No candidate capture/write code builds
// the expected results, receipt identities, episode HMACs or admission digests.
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
let sequence = 0;
crypto.randomUUID = () => '00000000-0000-4000-8000-' + String(++sequence).padStart(12, '0');
crypto.randomBytes = size => Buffer.alloc(size, 7);
syncBuiltinESMExports();
const RealDate = Date, clock = Date.parse('2026-11-04T00:00:00.000Z');
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
};
Object.defineProperty(performance, 'now', { configurable: true, value: () => 0 });
const [root, scratch, report, mode, schemaRoot, group] = process.argv.slice(2);
const eventReference = mode === 'event' && !!schemaRoot && schemaRoot !== '-';
mkdirSync(scratch, { recursive: true });
const loadFrom = (source, file) => import(pathToFileURL(join(source, file)).href);
const load = file => loadFrom(root, file);
const { openMemoryCore, openMemoryStore } = await load('core/index.mjs');
const { openDatabase } = await load('core/database.mjs');
const { model } = await load('core/testing/episode-capture-helpers.mjs');
const { rationaleModel } = await load('core/testing/rationale-model.mjs');
const { options } = await load('core/testing/episode-helpers.mjs');
const { DatabaseSync } = await import('node:sqlite');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const values = {
  valid: '2001-02-03T04:05:06.789Z', noMilliseconds: '2001-02-03T04:05:06Z',
  offset: '2001-02-03T04:05:06.789+00:00', dateOnly: '2001-02-03', garbage: 'garbage',
  number: 7, future: '2099-01-01T00:00:00.000Z', pre1970: '1901-02-03T04:05:06.789Z', empty: '', null: null,
};
const variants = { ordinary: {}, qualified: { captureQualification: 'source-bound-v2' },
  indexed: { captureQualification: 'source-bound-v2', captureSourcePolicy: 'indexed-windows-v1' },
  staged: { captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1' },
  indexedEvidence: { captureSourcePolicy: 'indexed-evidence-v1' }, ordered: {}, episode: options };
const ns = { ownerId: 'synthetic', scope: 'personal', projectId: null };
const receipt = { client: 'synthetic', sessionId: 'session', eventId: 'message', role: 'user', excerpt: 'Synthetic source' };
const memory = { content: 'Synthetic source', kind: 'fact' };
let caseNumber = 0;
async function migrate(path, base, source, event) {
  const { migrateReceiptEventTime, migrateContentSafety } = await loadFrom(source, 'core/content-safety-migration.mjs');
  const { copySqliteFixture, quiescence } = await loadFrom(source, 'core/testing/content-safety-s2h-fixture.mjs');
  const db = new DatabaseSync(path), storeId = db.prepare('SELECT store_id FROM store_metadata').get().store_id;
  db.close();
  const backupPath = path + (event ? '.event-backup' : '.safety-backup');
  copySqliteFixture(path, backupPath);
  await (event ? migrateReceiptEventTime : migrateContentSafety)({ path, backupPath, expected: { storeId, base }, quiescence });
}
async function run(base, variant, action, expectedTime = null) {
  sequence = 0;
  const path = join(scratch, String(++caseNumber) + '.sqlite');
  openDatabase(path, base === 18 ? {} : base === 23 ? { privateCards: true } : { currentDependencies: true }).close();
  if (mode !== 'old') await migrate(path, base, root, mode === 'event' && !eventReference);
  const core = openMemoryCore({ path, ...variant, model: model(rationaleModel()) });
  const store = openMemoryStore({ path });
  let result;
  try { result = await action(core, store.scope({ ownerId: ns.ownerId })); }
  catch (error) { result = { ok: false, error: { code: error.code } }; }
  finally { core.close(); store.close(); }
  if (eventReference) {
    // All engine handles closed; backup is copied by a SQLite-free child.
    await migrate(path, base, schemaRoot, true);
    if (expectedTime !== null) {
      const db = new DatabaseSync(path);
      try {
        const trigger = db.prepare("SELECT sql FROM sqlite_master WHERE name='safety_receipt_identity'").get().sql;
        // Fixture construction only: the expected attribute is independent of
        // the candidate time validator/attachment path. Preserve the exact DDL.
        db.exec('BEGIN; DROP TRIGGER safety_receipt_identity;');
        db.prepare('UPDATE receipts SET occurred_at=? WHERE rowid=(SELECT max(rowid) FROM receipts)').run(expectedTime);
        db.exec(trigger + '; COMMIT;');
      } finally { db.close(); }
    }
  }
  const db = new DatabaseSync(path);
  const receipts = db.prepare('SELECT * FROM receipts ORDER BY receipt_key,memory_id').all();
  db.close();
  // Read only in a child with mode=ro&immutable=1. Hash sqlite_master SQL and
  // every table's complete rows in primary-key order (all columns break ties).
  // Whole-file hashing first normalized ONLY bytes 92–99, per SQLite's stamps:
  // https://www.sqlite.org/fileformat.html#write_library_version_number_and_version_valid_for_number
  // Header normalization passed the three-Node physical-byte check. Event
  // references migrate main's writes AFTER execution; candidate writes occur
  // AFTER migration. Their page layouts differ beyond the header. Compare a
  // complete canonical logical dump without discarding any SQL or table rows.
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./receipt-event-time-dump.mjs', import.meta.url)), path], { encoding: 'utf8' });
  if (child.status !== 0 || child.error || child.signal) throw Error('database_hash_failed: ' + child.stderr);
  return { ok: result.ok !== false, ...(result.ok === false ? { code: result.error.code } : {}),
    resultHash: hash(JSON.stringify(result)), receiptHash: hash(JSON.stringify(receipts)),
    receiptTimes: receipts.map(row => row.occurred_at ?? null), databaseHash: child.stdout.trim() };
}
const result = { base: 'a6ec0e0e', clock: '2026-11-04T00:00:00.000Z', hash: 'canonical-logical-v1',
  matrix: {}, equivalents: {}, newFields: {}, writes: {}, replays: {} };
function capture(variant, occurredAt) {
  return { namespace: ns, client: 'synthetic', eventId: 'event', sessionId: 'session',
    ...(variant === 'ordered' ? { causal: { streamId: 'stream', sequence: 1 } } : {}),
    ...(variant === 'episode' ? { episodeContext: { clientLabel: 'Synthetic', generation: 'initial', origin: 'ordinary' } } : {}),
    messages: [{ id: 'message', role: 'user', content: memory.content, ...(occurredAt === undefined ? {} : { occurredAt }) }] };
}
if (group !== 'receipts') for (const base of [18,23,33]) {
  for (const [variant, config] of Object.entries(variants)) {
    if (variant !== 'episode') result.equivalents[base + ':' + variant] = await run(base, config, core => core.capture(capture(variant)));
    for (const [name, occurredAt] of Object.entries(values)) {
      const relaxed = variant !== 'episode' && ['valid','pre1970','null'].includes(name);
      const expectedTime = ['valid','pre1970'].includes(name) ? occurredAt : null;
      result.matrix[base + ':' + variant + ':' + name] = await run(base, config,
        core => core.capture(capture(variant, eventReference && relaxed ? undefined : occurredAt)), expectedTime);
    }
  }
  result.replays[base + ':episode'] = await run(base, options, async core => {
    const first = await core.capture(capture('episode', values.valid));
    if (first.ok === false) throw Error('episode_reference_setup_failed');
    return core.capture(capture('episode', values.pre1970));
  }, values.valid);
}
if (group !== 'capture') for (const base of [18,23,33]) for (const name of ['absent','valid','null','future','garbage']) {
  const occurredAt = eventReference && ['valid','null'].includes(name) ? undefined : values[name];
  const r = { ...receipt, ...(occurredAt === undefined ? {} : { occurredAt }) };
  const actions = {
    remember: (_core, scope) => scope.remember({ ...memory, receipt: r }),
    legacyCorrect: (_core, scope) => { const first = scope.remember({ ...memory, receipt }); return scope.correct(first.id, { ...memory, content: 'Synthetic correction', receipt: r }, first.revision); },
    admit: core => core.admit({ namespace: ns, memory, receipts: [r] }),
    correct: core => { const first = core.admit({ namespace: ns, memory, receipts: [receipt] }).value.memory; return core.correct({ namespace: ns, memoryId: first.id, expectedRevision: first.revision, content: 'Synthetic correction', kind: 'fact', receipt: r }); },
    supersede: core => { const first = core.admit({ namespace: ns, memory, receipts: [receipt] }).value.memory; return core.supersede({ namespace: ns, memoryId: first.id, expectedRevision: first.revision, replacement: { content: 'Synthetic replacement', kind: 'fact' }, receipts: [r] }); },
    finish: core => { const key = { namespace: ns, client: 'synthetic', eventId: 'finish', payloadDigest: 'a'.repeat(64) }; const token = core.claimAdmission({ ...key, leaseMs: 125000 }).value.token; return core.finishAdmission({ ...key, token, items: [{ ...memory, confidence: .8, receipts: [r] }] }); },
  };
  for (const [entry, action] of Object.entries(actions)) {
    const value = await run(base, {}, action, name === 'valid' ? values.valid : null);
    if (name === 'absent') result.writes[base + ':' + entry] = value;
    else result.newFields[base + ':' + entry + ':' + name] = value;
  }
}
writeFileSync(report, JSON.stringify(result, null, 2) + '\n');

import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configuration, preflight, readConfiguration } from '../configuration.mjs';
import { fixture } from './fixtures/workspace.mjs';

test('B3 validated personal authority uses public null at every public control boundary', t => {
  const f = fixture(t), parsed = configuration(f.config);
  assert.equal(parsed.authority.namespace.projectId, null);
  assert.equal(f.core.getCaptureControl({ namespace: parsed.authority.namespace }).ok, true);
  assert.equal(Object.isFrozen(parsed.authority.namespace), true);
});

test('B3 closed own-data configuration rejects unknown, missing, accessor and proxy fields', t => {
  const f = fixture(t);
  for (const change of [c => { c.untrusted = true; }, c => { delete c.provider; }, c => { c.raw.extra = true; },
    c => { c.raw.capBytes = 0; }, c => { c.usage.concurrency = 33; }, c => { c.provider.apiKeyEnv = 'KEY=value'; },
    c => { c.provider.profile = 'arbitrary'; }, c => { c.databasePath += '/../store'; },
    c => { c.timeouts.captureMs = c.timeouts.processMs + 1; }, c => { c.timeouts.processMs = 150001; },
    c => { c.authority.extra = true; }]) {
    const candidate = structuredClone(f.config); change(candidate);
    assert.throws(() => configuration(candidate), { code: 'invalid_local_capture_configuration' });
  }
  let invoked = 0;
  const candidate = { ...f.config, get raw() { invoked++; throw Error('synthetic_secret'); } };
  assert.throws(() => configuration(candidate));
  assert.throws(() => configuration(new Proxy(f.config, { ownKeys() { invoked++; return []; } })));
  assert.equal(invoked, 0);
});

test('B3 readonly preflight refuses missing, old, wrong and symlink DB without creation or migration', async t => {
  const f = fixture(t), missing = join(f.workspace.path, 'missing.sqlite');
  await assert.rejects(preflight({ ...f.config, databasePath: missing })); assert.equal(existsSync(missing), false);
  for (const [name, app, version] of [['old', 0x43414952, 28], ['wrong', 123, 29]]) {
    const path = join(f.workspace.path, name + '.sqlite'), db = new DatabaseSync(path);
    try { db.exec(`PRAGMA application_id=${app}; PRAGMA user_version=${version}`); } finally { db.close(); }
    chmodSync(path, 0o600); const before = readFileSync(path);
    await assert.rejects(preflight({ ...f.config, databasePath: path })); assert.deepEqual(readFileSync(path), before);
  }
  const linked = join(f.workspace.path, 'linked.sqlite'); symlinkSync(f.databasePath, linked);
  await assert.rejects(preflight({ ...f.config, databasePath: linked }));
  await assert.rejects(preflight({ ...f.config, authority: { ...f.config.authority, storeId: 'foreign-store' } }));
  chmodSync(f.databasePath, 0o644); await assert.rejects(preflight(f.config)); chmodSync(f.databasePath, 0o600);
  chmodSync(f.config.usage.root, 0o755); await assert.rejects(preflight(f.config));
});

test('B3 preflight checks only bound owner cap, never rewrites either owner', async t => {
  const f = fixture(t), db = new DatabaseSync(f.databasePath);
  try {
    db.prepare('INSERT INTO raw_owner_usage(owner_id,cap_bytes) VALUES(?,?)').run('unrelated-owner', 17);
    await preflight(f.config);
    db.prepare('INSERT INTO raw_owner_usage(owner_id,cap_bytes) VALUES(?,?)').run(f.namespace.ownerId, 21);
    const before = db.prepare('SELECT * FROM raw_owner_usage ORDER BY owner_id').all();
    await assert.rejects(preflight(f.config));
    assert.deepEqual(db.prepare('SELECT * FROM raw_owner_usage ORDER BY owner_id').all(), before);
  } finally { db.close(); }
});

test('B3 config private-reader refuses unsafe leaf, oversized input and extra CLI arguments', async t => {
  const f = fixture(t), linked = join(f.workspace.path, 'linked.json'); symlinkSync(f.configPath, linked);
  for (const args of [[], ['--config', 'relative'], ['--config', f.configPath, 'extra'], ['--config', linked]])
    await assert.rejects(readConfiguration(args));
  writeFileSync(f.configPath, ' '.repeat(65537)); await assert.rejects(readConfiguration(['--config', f.configPath]));
  f.save(); chmodSync(f.configPath, 0o644); await assert.rejects(readConfiguration(['--config', f.configPath]));
});

for (const replacement of [false, true]) test(`B3 target ${replacement ? 'old-store replacement' : 'removal'} during runtime module load refuses without recreation or migration`, async t => {
  const f = fixture(t); f.core.close();
  const path = join(f.workspace.path, 'old.sqlite'); let before;
  if (replacement) {
    const db = new DatabaseSync(path);
    try { db.exec('PRAGMA application_id=1128352082; PRAGMA user_version=28'); } finally { db.close(); }
    chmodSync(path, 0o600); before = readFileSync(path);
  }
  const outcome = await f.run(f.request(), { preloads: [fileURLToPath(new URL('./fixtures/database-race.mjs', import.meta.url))],
    environment: replacement ? { SYNTHETIC_REPLACEMENT: path } : {} });
  assert.equal(outcome.code, 1); assert.equal(outcome.stdout, ''); assert.equal(outcome.signal, null);
  assert.equal(f.calls().length, 0); assert.equal(f.ledger(), null);
  if (replacement) assert.deepEqual(readFileSync(f.databasePath), before);
  else assert.equal(existsSync(f.databasePath), false);
});

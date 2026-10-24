import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, existsSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { start, parseConfiguration } from '../cli.mjs';
import { readRetainedRawProfile } from '../retained-raw-profile.mjs';
import { createRetainedRawServer } from '../retained-raw.mjs';
import { fixture, cli, cleanEnv, noNetwork } from './retained-raw-support.mjs';

test('retained config is exclusive and syntax-only with missing profile and throwing credential accessor', async t => {
  const f = fixture(t), missing = join(f.workspace.path, 'missing', 'profile.json'); let reads = 0;
  const env = Object.defineProperty({}, 'OPENAI_API_KEY', { get() { reads++; throw Error('credential inspected'); } });
  const log = t.mock.method(console, 'log', () => {});
  await start(['--check-config', '--retained-raw-profile', missing], env);
  assert.equal(reads, 0); assert.equal(existsSync(join(f.workspace.path, 'missing')), false);
  const report = JSON.parse(log.mock.calls[0].arguments[0]);
  assert.equal(report.profileRead, false); assert.equal(report.databaseOpened, false); assert.equal(report.modelKeyInspected, false);
  assert.deepEqual(parseConfiguration(['--retained-raw-profile', missing]), { retainedRawProfile: missing });
  for (const tail of [['--db', f.path], ['--owner', 'synthetic'], ['--private-cards', 'local-v1'],
    ['--capture-qualification', 'source-bound-v2'], ['--retained-raw-profile', missing]]) {
    assert.throws(() => parseConfiguration(['--retained-raw-profile', missing, ...tail]), /invalid_mcp_configuration/);
  }
});

test('retained profile is bounded, private, closed, canonical and identity-bound', async t => {
  const f = fixture(t), original = readFileSync(f.profilePath);
  const snapshot = await readRetainedRawProfile(f.profilePath); snapshot.check();
  for (const value of [{ ...f.profile, provider: {} }, { ...f.profile, version: 'other' },
    { ...f.profile, namespace: { ...f.profile.namespace, permission: true } },
    { ...f.profile, path: ':memory:' }, { ...f.profile, namespace: { ...f.profile.namespace, projectId: '' } }]) {
    writeFileSync(f.profilePath, JSON.stringify(value));
    await assert.rejects(readRetainedRawProfile(f.profilePath), /invalid_retained_raw_profile/);
  }
  writeFileSync(f.profilePath, Buffer.alloc(65537, 32)); await assert.rejects(readRetainedRawProfile(f.profilePath), /invalid_retained_raw_profile/);
  writeFileSync(f.profilePath, Buffer.from([123, 34, 255, 34, 58, 49, 125])); await assert.rejects(readRetainedRawProfile(f.profilePath), /invalid_retained_raw_profile/);
  writeFileSync(f.profilePath, original); chmodSync(f.profilePath, 0o640);
  await assert.rejects(readRetainedRawProfile(f.profilePath), /invalid_retained_raw_profile/); chmodSync(f.profilePath, 0o600);
  const linked = join(f.workspace.path, 'linked.json'); symlinkSync(f.profilePath, linked);
  await assert.rejects(readRetainedRawProfile(linked), /invalid_retained_raw_profile/);
  chmodSync(f.workspace.path, 0o750);
  try { await assert.rejects(readRetainedRawProfile(f.profilePath), /invalid_retained_raw_profile/); }
  finally { chmodSync(f.workspace.path, 0o700); }
  renameSync(f.profilePath, f.profilePath + '.old'); writeFileSync(f.profilePath, original, { mode: 0o600 });
  assert.throws(() => snapshot.check(), /retained_raw_profile_changed/);
  await assert.rejects(createRetainedRawServer({ profilePath: f.profilePath, core: {} }), /invalid_mcp_configuration/);
});

test('retained CLI/API unsupported runtime refuses before any SQLite-dependent import', () => {
  const url = new URL('../retained-raw.mjs', import.meta.url).href;
  for (const target of ['platform', 'node']) for (const entry of ['api', 'cli', 'review']) {
    const action = entry === 'api' ? `const {createRetainedRawServer}=await import(${JSON.stringify(url)});await createRetainedRawServer({profilePath:'/missing/profile.json'});`
      : `const {start}=await import(${JSON.stringify(new URL('../cli.mjs', import.meta.url).href)});await start(${JSON.stringify([
        ...(entry === 'review' ? ['review-card'] : []), '--retained-raw-profile', '/missing/profile.json',
        ...(entry === 'review' ? ['--card', 'synthetic', '--revision', '1'] : []),
      ])},Object.defineProperty({},'OPENAI_API_KEY',{get(){throw Error('credential inspected')}}));`;
    const source = `${target === 'platform' ? 'Object.defineProperty(process,"platform",{value:"darwin"});' : 'Object.defineProperty(process.versions,"node",{value:"22.15.0"});'}
      const {registerHooks}=await import('node:module');registerHooks({resolve(specifier,ctx,next){if(specifier==='node:sqlite')throw Error('SQLite imported first');return next(specifier,ctx)}});
      try{${action}process.exitCode=2;}
      catch(error){if(error.message!=='retained_raw_runtime_unavailable')throw error;}`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', env: cleanEnv });
    assert.equal(result.status, 0, result.stderr);
  }
  const result = spawnSync(process.execPath, ['--import', noNetwork, cli, '--check-config', '--retained-raw-profile', '/missing/profile.json'],
    { encoding: 'utf8', env: { ...cleanEnv, OPENAI_API_KEY: 'synthetic\nbad' } });
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).modelKeyInspected, false);
});

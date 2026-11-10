import test from 'node:test';
import assert from 'node:assert/strict';
import promises from 'node:fs/promises';
import { constants } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { privateRead, privateWrite, withWriteObserver } from '../../client/private-state.mjs';
import { binaryIdentity, qualifyBinary, finishQualification, observeHost } from '../qualification.mjs';
import { currentHost } from '../installed.mjs';
import { formatFixture } from './format-fixtures.mjs';

// Replace only the test's observed JSON opens; restore the built-in exports even
// after assertions fail. No runtime injection seam or timing race is needed.
async function withOpen(intercept, work) {
  const original = promises.open;
  promises.open = (...args) => intercept(original, ...args);
  syncBuiltinESMExports();
  try { return await work(); }
  finally { promises.open = original; syncBuiltinESMExports(); }
}
// copyFile keeps the source mode; a runner's Node can be group-writable, which
// the host identity check rejects. Qualify a private owner-only copy instead.
async function privateNode(ws) {
  const binary = join(ws.path, 'codex');
  await promises.copyFile(process.execPath, binary);
  await promises.chmod(binary, 0o700);
  return binary;
}
async function fixture(t) {
  const ws = createTestWorkspace(t, { prefix: 'observed-host-io-' });
  const config = join(ws.path, 'installation.json');
  const binary = await privateNode(ws);
  const host = { binaryPath: binary, identity: await binaryIdentity(binary), kind: 'cli' };
  const evidence = await formatFixture('0.166.0');
  const verdict = await qualifyBinary(config, host, { collect: async () => ({
    version: '0.166.0', evidence, binarySha256: 'a'.repeat(64),
  }) });
  assert.equal(verdict.status, 'qualified');
  return { config, host, verdict, path: join(ws.path, 'qualification', 'observed-cli.json'),
    verdictPath: join(ws.path, 'qualification', host.identity + '.json') };
}
for (const failure of ['read replacements', 'write failure', 'comparison failure']) {
  test(`diagnostic ${failure} preserves identity-bound verdicts and once-only scheduling`, { timeout: 30000 }, async t => {
    const { config, host, verdict, path, verdictPath } = await fixture(t);
    const other = { ...host, identity: host.identity === 'b'.repeat(64) ? 'c'.repeat(64) : 'b'.repeat(64) };
    // A different observed identity and its qualified verdict cannot qualify host.
    await privateWrite(join(config, '..', 'qualification', other.identity + '.json'), JSON.stringify({ ...verdict, identity: other.identity }));
    for (const status of ['qualified', 'changed', 'pending']) {
      await privateWrite(verdictPath, JSON.stringify({ ...verdict, status, ...(status === 'pending' ? { policy: 'obsolete' } : {}) }));
      await privateWrite(path, JSON.stringify(other));
      let attempts = 0, launches = 0;
      const detected = failure === 'comparison failure' ? { ...host, toJSON() {
        attempts++; throw new Error('diagnostic_comparison');
      } } : host;
      const run = () => currentHost(config, { detect: async () => detected, launch: async () => { launches++; } });
      try {
        await withOpen(async (original, target, flags, ...rest) => {
          if (failure === 'read replacements' && target === path && flags === (constants.O_RDONLY | constants.O_NOFOLLOW)) {
            // privateRead has already saved the old inode. Use its normal atomic,
            // durable writer to replace that inode on EVERY actual retry.
            attempts++; await privateWrite(path, JSON.stringify(other));
          }
          if (failure === 'write failure' && String(target).startsWith(path + '.tmp-')) {
            attempts++; throw new Error('diagnostic_write');
          }
          return original(target, flags, ...rest);
        }, async () => {
          for (let call = 0; call < 2; call++) {
            const result = await run();
            assert.equal(result.status, status);
            assert.equal(result.host.identity, host.identity);
            assert.equal(launches, status === 'pending' ? 1 : 0);
          }
        });
        assert.equal(attempts, failure === 'read replacements' ? 16 : 2);
        assert.deepEqual(JSON.parse(await privateRead(path)), other, 'skipped publication retains the complete prior diagnostic');
      } finally {
        t.diagnostic(JSON.stringify({ failure, status, attempts, launches }));
        await finishQualification(config, host);
      }
    }
  });
}
test('cache creation precedes a skipped comparison and pending scheduling', async t => {
  const ws = createTestWorkspace(t, { prefix: 'observed-host-cache-' });
  const config = join(ws.path, 'installation.json');
  const binary = await privateNode(ws);
  const host = { binaryPath: binary, identity: await binaryIdentity(binary), kind: 'cli',
    toJSON() { throw new Error('diagnostic_comparison'); } };
  let launches = 0;
  for (let call = 0; call < 2; call++) {
    assert.equal((await currentHost(config, { detect: async () => host, launch: async () => { launches++; } })).status, 'pending');
    assert.equal(launches, 1);
  }
  await finishQualification(config, host);
  assert.equal((await promises.stat(join(ws.path, 'qualification'))).mode & 0o777, 0o700);
});
test('host validation, detection and unsafe cache errors retain their original boundary', async t => {
  const { config, host } = await fixture(t);
  const validation = new Error('host_validation');
  const invalid = { ...host, get identity() { throw validation; } };
  await assert.rejects(observeHost(config, invalid), error => error === validation);
  await assert.rejects(currentHost(config, { detect: async () => invalid }), error => error === validation);
  const detection = new Error('host_detection');
  await assert.rejects(currentHost(config, { detect: async () => { throw detection; } }), error => error === detection);
  const writes = [];
  await withWriteObserver(event => writes.push(event), () => observeHost(config, { ...host, identity: 'invalid' }));
  assert.deepEqual(writes, []);
  await promises.chmod(join(config, '..', 'qualification'), 0o755);
  await assert.rejects(observeHost(config, host), /state_permissions/);
  await assert.rejects(currentHost(config, { detect: async () => host }), /state_permissions/);
});
test('successful changed diagnostics are durable and equal bytes remain read-only', async t => {
  const { config, host, path } = await fixture(t);
  const writes = [];
  await withWriteObserver(event => writes.push(event), () => observeHost(config, host));
  assert.deepEqual(writes, [{ path, kind: 'write' }]);
  assert.deepEqual(JSON.parse(await privateRead(path)), host);
  writes.length = 0;
  await withWriteObserver(event => writes.push(event), () => observeHost(config, host));
  assert.deepEqual(writes, []);
});

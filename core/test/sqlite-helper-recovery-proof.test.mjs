import { faults } from './fixtures/sqlite-helper-child-faults.mjs';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstatSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { createExclusiveSqliteFile } from '../sqlite-journal-probe.mjs';

beforeEach(t => faults.install(t));
// Every data-descriptor operation stays in a separate child, even for attacks.
function child(source, ...args) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source, ...args], { encoding: 'utf8', env: {}, timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  return result;
}
function setup(t) {
  const w = createTestWorkspace(t), directory = join(w.path, 'private'); mkdirSync(directory, { mode: 0o700 });
  const path = join(directory, 'synthetic.sqlite');
  faults.arm(5, 5);
  return { path, directory };
}
function refused(path, marker) {
  assert.throws(() => createExclusiveSqliteFile(path), { code: 'storage_error', cause: 'ETIMEDOUT' }, marker);
  assert.equal(faults.counts.reached, 1, 'REAL_LINKED_TIMEOUT');
}
test('STAGE_PROVENANCE: another dead owner cannot stand in for the creator', t => {
  const { path, directory } = setup(t);
  faults.creationResult((result, target) => {
    const other = child('');
    assert.notEqual(other.pid, result.pid);
    child(`import {readdirSync,renameSync} from 'node:fs';import {dirname,join} from 'node:path';
      const d=dirname(process.argv[1]),name=readdirSync(d).find(n=>n.includes('.cairn-create-'));
      renameSync(join(d,name),join(d,name.replace('-'+process.argv[2]+'-','-'+process.argv[3]+'-')));`, target, String(result.pid), String(other.pid));
    return result;
  });
  refused(path, 'STAGE_PROVENANCE');
  assert.equal(faults.counts.recoveries, 0, 'STAGE_PROVENANCE_NO_RECOVERY');
  assert.equal(lstatSync(path).nlink, 2);
  assert.equal(readdirSync(directory).length, 2);
});
test('STAGE_SUBSTITUTION: substituted entry survives the check-to-unlink window', t => {
  const { path, directory } = setup(t);
  faults.recoverySource(source => {
    const anchor = source.includes('renameSync(stage, claimed);') ? 'renameSync(stage, claimed);' : 'unlinkSync(stage);';
    assert.ok(source.includes(anchor), 'SUBSTITUTION_ANCHOR');
    return source.replace(anchor, `renameSync(stage,stage+'.saved'); const substitute=openSync(stage,'wx',0o600); closeSync(substitute);\n` + anchor);
  });
  refused(path, 'STAGE_SUBSTITUTION');
  const stage = readdirSync(directory).find(n => n.includes('.cairn-create-') && !n.endsWith('.saved'));
  assert.ok(stage, 'STAGE_SUBSTITUTION_ENTRY_PRESERVED');
  assert.notEqual(lstatSync(join(directory, stage)).ino, lstatSync(path).ino, 'STAGE_SUBSTITUTION_NOT_DELETED');
  assert.equal(lstatSync(join(directory, stage + '.saved')).ino, lstatSync(path).ino);
});
for (const where of ['parent-live-pid', 'parent-EPERM', 'child-live-pid', 'child-EPERM'])
test(`RECOVERY_LIVENESS ${where}: refuses PID reuse or unverifiable liveness`, t => {
  const { path } = setup(t);
  if (where === 'parent-live-pid') faults.creationResult((result, target) => {
    child(`import {readdirSync,renameSync} from 'node:fs';import {dirname,join} from 'node:path';
      const d=dirname(process.argv[1]),name=readdirSync(d).find(n=>n.includes('.cairn-create-'));
      renameSync(join(d,name),join(d,name.replace('-'+process.argv[2]+'-','-'+process.argv[3]+'-')));`, target, String(result.pid), String(process.pid));
    return { ...result, pid: process.pid };
  });
  if (where === 'parent-EPERM') t.mock.method(process, 'kill', () => { throw Object.assign(Error('synthetic'), { code: 'EPERM' }); });
  if (where.startsWith('child-')) faults.recoverySource(source => `process.kill=()=>{${where.endsWith('EPERM') ? "throw Object.assign(Error('synthetic'),{code:'EPERM'});" : 'return true;'}};\n` + source);
  refused(path, 'RECOVERY_LIVENESS');
  assert.equal(faults.counts.recoveries, where.startsWith('child-') ? 1 : 0);
  assert.equal(lstatSync(path).nlink, 2);
});
for (const entry of ['directory', 'target']) test(`RECOVERY_SUBSTITUTION ${entry}: proof is checked again in the child`, t => {
  const { path, directory } = setup(t);
  faults.recoverySource(source => source.replace('const proof = JSON.parse(process.argv[3]);',
    'const proof = JSON.parse(process.argv[3]);\n' + (entry === 'directory'
      ? "renameSync(directory,directory+'.original'); mkdirSync(directory,{mode:0o700});"
      : "renameSync(target,target+'.original'); const substitute=openSync(target,'wx',0o600);closeSync(substitute);")));
  refused(path, 'RECOVERY_SUBSTITUTION');
  assert.equal(faults.counts.recoveries, 1);
  const original = entry === 'directory' ? join(directory + '.original', 'synthetic.sqlite') : path + '.original';
  assert.equal(lstatSync(original).nlink, 2, 'RECOVERY_SUBSTITUTION_ORIGINAL_UNTOUCHED');
});
for (const ack of ['empty-object', 'array', 'extra', 'wrong-dev', 'wrong-ino', 'missing-sync', 'false-sync', 'string-sync', 'missing-identity'])
test(`RECOVERY_ACK ${ack}: malformed acknowledgement cannot authorize busy`, t => {
  const { path } = setup(t);
  faults.recoveryResult((result, proof) => {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(lstatSync(path).nlink, 1, 'ACK_AFTER_REAL_RECOVERY');
    let value = { dev: proof.file.dev, ino: proof.file.ino, directorySynced: true };
    if (ack === 'empty-object') value = {};
    if (ack === 'array') value = [];
    if (ack === 'extra') value.extra = true;
    if (ack === 'wrong-dev') value.dev = '-1';
    if (ack === 'wrong-ino') value.ino = '-1';
    if (ack === 'missing-sync') delete value.directorySynced;
    if (ack === 'false-sync') value.directorySynced = false;
    if (ack === 'string-sync') value.directorySynced = 'true';
    if (ack === 'missing-identity') delete value.ino;
    return { ...result, stdout: JSON.stringify(value) };
  });
  refused(path, 'RECOVERY_ACK_EXACT_SHAPE');
  assert.equal(faults.counts.recoveries, 1);
});

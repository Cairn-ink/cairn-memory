import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

const fixture = mode => JSON.parse(readFileSync(new URL('./receipt-event-time-main' +
  (mode === 'old' ? '' : '-' + mode) + '.json', import.meta.url)));
export function compatibilityCase(t, mode) {
  const f = createTestWorkspace(t, { prefix: 'receipt-compat-' }), report = join(f.path, 'report.json');
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./receipt-event-time-main-worker.mjs', import.meta.url)),
    fileURLToPath(new URL('../../../', import.meta.url)), f.path, report, mode], { encoding: 'utf8', timeout: 180000 });
  assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 0, child.stderr);
  const actual = JSON.parse(readFileSync(report)), expected = fixture(mode), main = fixture(mode === 'event' ? 'safety' : mode);
  assert.equal(actual.hash, 'canonical-logical-v1');
  assert.deepEqual(Object.keys(actual.matrix).sort(), Object.keys(expected.matrix).sort());
  assert.equal(Object.keys(actual.matrix).length, 210, 'three layouts × seven capture modes × ten values');
  for (const [key, outcome] of Object.entries(main.matrix)) {
    const [base, variant, name] = key.split(':'), relaxed = variant !== 'episode' && ['valid','pre1970','null'].includes(name);
    if (variant !== 'episode') {
      assert.equal(outcome.ok, false, 'main rejects supplied ordinary time: ' + key);
      assert.equal(outcome.code, 'invalid_input');
    }
    const reference = mode === 'event' ? expected.matrix[key] : relaxed ? expected.equivalents[base + ':' + variant] : outcome;
    assert.deepEqual(actual.matrix[key], reference, 'decision, code, result, complete receipts and database vs main: ' + mode + ':' + key);
  }
  assert.deepEqual(actual.equivalents, expected.equivalents, 'untimed main identities, results, receipts and complete database');
  assert.deepEqual(actual.replays, expected.replays, 'main episode changed-time conflict, unchanged receipts and database');
  for (const outcome of Object.values(actual.replays)) { assert.equal(outcome.ok, false); assert.equal(outcome.code, 'event_payload_conflict'); }
  assert.deepEqual(Object.keys(actual.newFields).sort(), Object.keys(expected.newFields).sort());
  assert.equal(Object.keys(actual.newFields).length, 72, 'three layouts × six entry points × four values');
  for (const [key, outcome] of Object.entries(main.newFields)) {
    const [base, entry, name] = key.split(':'), relaxed = ['valid','null'].includes(name);
    assert.equal(outcome.ok, false, 'main rejects the supplied new field: ' + key);
    assert.equal(outcome.code, 'invalid_input');
    const reference = mode === 'event' ? expected.newFields[key] : relaxed ? expected.writes[base + ':' + entry] : outcome;
    assert.deepEqual(actual.newFields[key], reference, 'decision, code, result, complete receipts and database vs main: ' + mode + ':' + key);
  }
  assert.deepEqual(actual.writes, expected.writes, 'untimed main result, complete receipts and database');
  t.diagnostic('321 complete comparisons: 210 capture values, 72 receipt-field values, 36 untimed controls, 3 episode replay conflicts');
}

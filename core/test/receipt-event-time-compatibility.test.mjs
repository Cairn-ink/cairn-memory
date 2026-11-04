import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const reference = JSON.parse(readFileSync(new URL('./fixtures/receipt-event-time-main.json',import.meta.url)));
for (const mode of ['old','safety','event']) test(`main a6ec0e0e capture matrix and every receipt entry point: ${mode}`, t => {
  const f = createTestWorkspace(t,{prefix:'receipt-compat-'}), report = join(f.path,'report.json');
  const child = spawnSync(process.execPath,[fileURLToPath(new URL('./fixtures/receipt-event-time-main-worker.mjs',import.meta.url)),
    fileURLToPath(new URL('../../',import.meta.url)),f.path,report,mode],{encoding:'utf8',timeout:120000});
  assert.equal(child.error,undefined); assert.equal(child.signal,null); assert.equal(child.status,0,child.stderr);
  const actual = JSON.parse(readFileSync(report));
  const expected = mode === 'safety' ? JSON.parse(readFileSync(new URL('./fixtures/receipt-event-time-main-safety.json',import.meta.url))) : reference;
  let cases = 0;
  for (const [variant,items] of Object.entries(expected.matrix)) for (const [name,result] of Object.entries(items)) {
    const value = actual.matrix[variant][name];
    assert.equal(value.ok,result.ok,variant+':'+name);
    assert.equal(value.code,result.code,variant+':'+name);
    if (mode !== 'event') assert.deepEqual(value,result,`main result, receipts, keys, digest and DB bytes: ${variant}:${name}`);
    else if (value.ok) assert.deepEqual(value.receiptTimes,[['valid','pre1970'].includes(name) ?
      {valid:'2001-02-03T04:05:06.789Z',pre1970:'1901-02-03T04:05:06.789Z'}[name] : null]);
    cases++;
  }
  for (const [entry,result] of Object.entries(expected.writes)) {
    assert.equal(expected.newFields[entry].code,'invalid_input','main rejected the new field: '+entry);
    assert.equal(actual.newFields[entry].ok,true,entry);
    if (mode !== 'event') {
      assert.deepEqual(actual.writes[entry],result,'untimed bytes vs main: '+entry);
      assert.deepEqual(actual.newFields[entry],result,'dropped-time bytes vs main untimed: '+entry);
    } else {
      assert.equal(actual.newFields[entry].receiptTimes.length,result.receiptTimes.length,entry);
      assert.deepEqual(actual.newFields[entry].receiptTimes.filter(time => time !== null),['2001-02-03T04:05:06.789Z'],entry);
    }
    cases++;
  }
  t.diagnostic(`${cases} comparisons: 70 capture decisions and 18 entry-point byte/storage cases`);
});

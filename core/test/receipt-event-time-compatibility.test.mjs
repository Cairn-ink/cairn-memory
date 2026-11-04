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
    const strictTime = {valid:'2001-02-03T04:05:06.789Z',pre1970:'1901-02-03T04:05:06.789Z'}[name];
    if (variant !== 'episode') {
      assert.equal(result.ok,false,'main rejects all ten ordinary values');
      assert.equal(result.code,'invalid_input');
    }
    if (variant !== 'episode' && strictTime) {
      assert.equal(value.ok,true,variant+':'+name);
      assert.equal(value.code,undefined);
      if (mode !== 'event') assert.deepEqual(value,expected.captures['18:'+variant],
        `ordinary timed vs main untimed result, receipts, keys, digest and DB bytes: ${variant}:${name}`);
      else assert.deepEqual(value.receiptTimes,[strictTime]);
    } else {
      assert.equal(value.ok,result.ok,variant+':'+name);
      assert.equal(value.code,result.code,variant+':'+name);
      if (mode !== 'event') assert.deepEqual(value,result,`main result, receipts, keys, digest and DB bytes: ${variant}:${name}`);
      else if (value.ok) assert.deepEqual(value.receiptTimes,[strictTime ?? null]);
    }
    cases++;
  }
  let captureBytes = 0;
  for (const [entry,result] of Object.entries(expected.captures)) {
    if (mode !== 'event') assert.deepEqual(actual.captures[entry],result,'untimed capture bytes vs main: '+entry);
    for (const name of ['valid','pre1970']) {
      const key = entry+':'+name;
      assert.equal(expected.timedCaptures[key].code,'invalid_input');
      if (mode !== 'event') assert.deepEqual(actual.timedCaptures[key],result,'ordinary dropped-time bytes vs main untimed: '+key);
      else assert.deepEqual(actual.timedCaptures[key].receiptTimes,
        [{valid:'2001-02-03T04:05:06.789Z',pre1970:'1901-02-03T04:05:06.789Z'}[name]],key);
      captureBytes++;
    }
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
  t.diagnostic(`${cases} comparisons: 70 capture decisions and 18 entry-point byte/storage cases; ${captureBytes} ordinary capture byte/storage checks on three layouts`);
});

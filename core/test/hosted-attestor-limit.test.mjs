import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lineageFixture } from '../testing/card-lineage-fixture.mjs';
import { attestContentSafety } from '../content-safety-schema.mjs';

for (const base of [23,33]) test(`no-package lineage base ${base} prepares main's exact inventory SQL`,async t=>{
  const f=await lineageFixture(t,{base}), prepared=[];
  // Frozen main statement prefix: this oracle also works in shallow checkouts and archives.
  const mainInventoryPrefix='SELECT name,type,sql FROM sqlite_schema WHERE sql IS NOT NULL LIMIT ';
  const count=f.db.prepare('SELECT count(*) n FROM sqlite_schema WHERE sql IS NOT NULL').get().n;
  const adapter={prepare(sql){prepared.push(sql);return f.db.prepare(sql);}};
  attestContentSafety(adapter);
  assert.deepEqual(prepared.filter(sql=>sql.startsWith('SELECT name,type,sql FROM sqlite_schema WHERE sql IS NOT NULL LIMIT ')),
    [mainInventoryPrefix+(count+1)]);
});

// Port of the delta review's source-derived hosted-limit reproduction.
test('the first inventory bound never includes the local package allowance',()=>{
  const source=readFileSync(new URL('../content-safety-schema.mjs',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('function verifyCompleteCardSchema('),source.indexOf('const safetyObjects'));
  assert.doesNotMatch(body,/const shippedLimit\s*=\s*wanted\.size\s*\+\s*10\s*\+\s*1/);
});

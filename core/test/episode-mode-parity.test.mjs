import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { captureEpisodeParity } from '../testing/episode-parity.mjs';
import { setup,input,assertError } from '../testing/episode-capture-helpers.mjs';
import { openMemoryCore } from '../index.mjs';

test('E10 frozen committed v14/v15 mode-off prompts, requests, outputs, rows and digests',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'se2-parity-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  for(const version of [14,15]) {
    const fixture=JSON.parse(readFileSync(new URL(`../testing/episode-v${version}-fixture.json`,import.meta.url),'utf8'));
    for(const [index,{config,expected}]of fixture.parity.entries()) {
      const path=join(dir,`${version}-${index}.sqlite`);
      assert.deepEqual(await captureEpisodeParity(new URL('../../',import.meta.url).pathname,path,config),expected);
      const db=new DatabaseSync(path);
      assert.equal(db.prepare('PRAGMA user_version').get().user_version,16);
      assert.equal(db.prepare('SELECT count(*) n FROM episode_messages').get().n,0);db.close();
    }
  }
});

test('E10 unexpected automatic tag remains rejected off; indexed evidence rejects before option getters',async t=>{
  const f=setup(t,{extract:()=>({items:[{content:'Review',kind:'instruction',confidence:1,sourceIndices:[0],procedural:true}]})});
  const legacy=openMemoryCore({path:f.path,model:f.model});t.after(()=>legacy.close());
  const {episodeContext,...plain}=input();plain.messages=plain.messages.map(({occurredAt,...message})=>message);
  assertError(await legacy.capture(plain),'invalid_model_output');
  let reads=0;const config={path:f.path,captureSourcePolicy:'indexed-evidence-v1'};
  Object.defineProperty(config,'sessionEpisodes',{get(){reads++;throw Error('getter');},enumerable:true});
  assert.throws(()=>openMemoryCore(config),{code:'invalid_input'});assert.equal(reads,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { coreFixture, refresh, policy, ns, ok } from '../testing/context-read-core-fixture.mjs';
import { createFakeEmbedder } from '../context-read-embedder.mjs';
import { control } from '../testing/context-semantic-pause-fixture.mjs';
for(const setting of [{paused:1},{enabled:0}])test(`legacy stale vector refresh refuses ${JSON.stringify(setting)} and resumes`,async t=>{
  let calls=0;const fake=createFakeEmbedder(),embedder={...fake,embed(texts,c){calls++;c.beforeDispatch();return fake.embed(texts,c);}};
  const f=coreFixture(t,{embedder,selectedPolicy:policy()});f.admit('apple');ok(await f.call('refreshContextIndex',refresh()));
  f.reopen({embedder:{...embedder,revision:'stale-replacement'}});
  const db=new DatabaseSync(f.path);t.after(()=>db.close());control(db,ns,setting);
  const before=calls,result=ok(await f.call('refreshContextIndex',refresh()));
  assert.equal(calls,before,'paused stale text never enters provider');assert.equal(result.channels.semantic.state,'namespace_paused');
  assert.equal(result.progress.embedded,0);control(db,ns);
  assert.equal(ok(await f.call('refreshContextIndex',refresh())).status,'complete');assert.ok(calls>before);
});
test('legacy refresh pause inside beforeDispatch leaves vectors unrefreshed until resume',async t=>{
  let db,race=false,sends=0;const fake=createFakeEmbedder(),embedder={...fake,embed(texts,c){if(race)control(db,ns,{paused:1});c.beforeDispatch();sends++;return fake.embed(texts,c);}};
  const f=coreFixture(t,{embedder,selectedPolicy:policy()});f.admit('apple');ok(await f.call('refreshContextIndex',refresh()));f.reopen({embedder:{...embedder,revision:'stale-replacement'}});
  db=new DatabaseSync(f.path);t.after(()=>db.close());race=true;const before=sends;
  const result=ok(await f.call('refreshContextIndex',refresh()));assert.equal(sends,before);assert.equal(result.progress.embedded,0);
  race=false;control(db,ns);assert.equal(ok(await f.call('refreshContextIndex',refresh())).status,'complete');assert.ok(sends>before);
});

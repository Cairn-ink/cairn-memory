import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { cardHost } from '../testing/raw-source-fixtures.mjs';
import { defaultRawOptions } from '../local-defaults.mjs';
import { installRawSearchTestClock, rawSearchTestWait } from '../testing/raw-search-clock.mjs';
import { createCairnServer } from '../../adapters/mcp/server.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
const ns = { ownerId:'synthetic-owner',scope:'personal',projectId:null };
const text = 'Synthetic confidential cobalt telescope';
const request = { namespace:ns,client:'codex',sessionId:'session',eventId:'event',messages:[{id:'message',role:'user',content:text}] };
const ok = value => { assert.equal(value.ok,true,JSON.stringify(value)); return value.value; };
test.beforeEach(installRawSearchTestClock);
for (const contentSafety of [undefined,'s2h-v1']) for (const denial of ['forget','excluded','fenced']) {
  test(`default outputs withhold ${denial} (${contentSafety??'legacy'})`,async t=>{
    const workspace=createTestWorkspace(t),path=join(workspace.path,'memory.sqlite');
    const core=openMemoryCore({raw:true,path,model:rationaleModel(),...(contentSafety?{contentSafety}:{})});
    workspace.defer(()=>core.close());
    const db=new DatabaseSync(path);workspace.defer(()=>db.close());
    const captured=ok(await core.capture(request));
    const conversationId=db.prepare('SELECT id FROM raw_conversations').get().id;
    // Keep this assertion before using search: the unchecked reader must be absent.
    assert.equal(core.getConversation,undefined,'default facade must not expose Raw text getter');
    for(let n=0;n<12;n++) {
      await rawSearchTestWait(1010);ok(await core.maintainRawSearch({namespace:ns}));
      if(ok(await core.searchRaw({namespace:ns,query:'cobalt telescope'})).candidates.length)break;
    }
    assert.equal(ok(await core.searchRaw({namespace:ns,query:'cobalt telescope'})).candidates.length,1);
    for(const other of [{...ns,ownerId:'other-owner'},{...ns,scope:'project',projectId:'other-project'}])
      assert.equal(ok(await core.searchRaw({namespace:other,query:'cobalt telescope'})).candidates.length,0);
    if(denial==='forget') {
      const memoryId=captured.admission.memories[0].id,memory=ok(core.get({namespace:ns,memoryId})).memory;
      ok(core.forget({namespace:ns,memoryId,expectedRevision:memory.revision}));
    }else if(denial==='excluded')db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,1)').run(conversationId,'message',0,text.length);
    else ok(core.fenceSession({namespace:ns,client:request.client,sessionId:request.sessionId}));
    const hidden=ok(await core.searchRaw({namespace:ns,query:'cobalt telescope'}));
    assert.equal(hidden.candidates.length,0);assert.equal(JSON.stringify(hidden).includes(text),false);
    for(const [method,input] of [
      ['listRawConversations',{namespace:ns,client:'codex'}],['getRawUsage',{ownerId:ns.ownerId}],
      ['listRawEffects',{namespace:ns}],['previewDeleteConversation',{namespace:ns,conversationId,expectedRevision:1}],
      ['getRawCaptureControl',{ownerId:ns.ownerId,client:'codex'}]]) {
      assert.equal(typeof core[method],'function',method);
      assert.equal(JSON.stringify(await core[method](input)).includes(text),false,method);
    }
  });
}
test('explicit Raw profile retains its conversation reader',async t=>{
  const workspace=createTestWorkspace(t),path=join(workspace.path,'explicit.sqlite');
  const core=openMemoryCore({path,rawConversations:defaultRawOptions(),model:rationaleModel()});
  workspace.defer(()=>core.close());
  ok(await core.capture(request));
  const listed=ok(core.listRawConversations({namespace:ns,client:'codex'}));
  const view=ok(await core.getConversation({namespace:ns,conversationId:listed.conversations[0].id}));
  assert.equal(view.messages[0].parts[0].text,text);
});
test('default MCP tools expose no unchecked conversation reader',async t=>{
  const workspace=createTestWorkspace(t);
  const server=createCairnServer({path:join(workspace.path,'server.sqlite'),namespace:ns});
  try {
    const names=Object.keys(server._registeredTools);
    assert.equal(names.includes('read_raw_conversation'),false);
    assert.equal(names.includes('list_raw_conversations'),false);
  }finally{await server.close();}
});
test('default Card source facade cannot open retained Raw text',async t=>{
  const workspace=createTestWorkspace(t),host=cardHost();
  const core=openMemoryCore({raw:true,path:join(workspace.path,'cards.sqlite'),privateCards:host.options});
  workspace.defer(()=>core.close());
  const capabilities=ok(core.getPrivateCardCapabilities());
  assert.equal(capabilities.raw,false);
  assert.equal(capabilities.sourceTypes.includes('raw'),false);
  assert.equal(core.resolveSourceReferences,undefined);
});

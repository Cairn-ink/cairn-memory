import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { installedStatus, hookCommand } from '../lib/codex-runtime.mjs';
import { translator, messages } from '../lib/messages.mjs';
import { privateWrite } from '../runtime/integrations/client/private-state.mjs';
import { writeCredential, recordLastCapture } from '../runtime/integrations/codex/installed-state.mjs';
import { policyPath } from '../runtime/integrations/client/automatic-policy.mjs';

async function fixture(t) {
  t.mock.method(globalThis,'fetch',()=>assert.fail('status must remain local'));
  const ws=createTestWorkspace(t,{prefix:'setup-capture-status-'});
  const home=join(ws.path,'home'), directory=join(home,'cairn'), root=join(ws.path,'root');
  await mkdir(directory,{recursive:true,mode:0o700}); await mkdir(root,{mode:0o700});
  const path=join(directory,'installation.json');
  const config={version:1,enabled:true,hostVersion:'0.166.0',codex:join(ws.path,'codex'),node:process.execPath,
    home,root,pairingRecord:null,usesClaude:false,endpoint:'https://example.invalid',runtime:ws.path,
    dailyCap:200,captureExec:true};
  await privateWrite(path,JSON.stringify(config));
  await writeCredential(path,config.endpoint,'synthetic');
  await privateWrite(policyPath(root,config.endpoint),JSON.stringify({version:1,dailyCap:200,concurrency:2}));
  const hooks={hooks:Object.fromEntries(['SessionStart','UserPromptSubmit','Stop','PreCompact'].map(event=>
    [event,[{hooks:[{command:hookCommand(config,path,event)}]}]]))};
  const status=async language=>{
    const lines=[];
    await installedStatus({home,hostVersion:'0.166.0',hostVerdict:{status:'qualified'},
      cliHost:{identity:'a'.repeat(64),kind:'cli'},write:line=>lines.push(line),t:translator(language),
      snapshot:async()=>({text:JSON.stringify(hooks)})});
    return lines;
  };
  return {root,path,config,status};
}
for(const language of ['en','zh']) test(`status shows acknowledged local time and indents exec only in status (${language})`,async t=>{
  const f=await fixture(t);
  const date=new Date(2026,10,4,17,42);
  await recordLastCapture(f.root,date.getTime(),123);
  const lines=await f.status(language), tr=translator(language);
  assert.ok(lines.includes(tr('codex_last_capture',{date:'2026-11-04 17:42'})),lines.join('\n'));
  assert.ok(lines.includes('  '+tr('codex_exec_enabled')));
  assert.ok(!lines.includes(tr('codex_exec_enabled')));
  assert.ok(!tr('codex_exec_enabled').startsWith(' '),'setup/config message keeps its existing indentation');
  assert.ok(!lines.includes(tr('status_unsafe')));
  assert.ok(!lines.join('\n').includes('123'),'submitted count is private diagnostic metadata');
});
for(const scenario of ['missing','malformed','unreadable','future-schema']) test(`status honestly says none recorded for ${scenario}`,async t=>{
  const f=await fixture(t);
  if(scenario==='malformed') await privateWrite(join(f.root,'codex-last-capture.json'),'not JSON');
  if(scenario==='unreadable') await mkdir(join(f.root,'codex-last-capture.json'),{mode:0o700});
  if(scenario==='future-schema') await privateWrite(join(f.root,'codex-last-capture.json'),JSON.stringify({version:2,at:0,count:1}));
  for(const language of ['en','zh']) {
    const lines=await f.status(language);
    assert.ok(lines.includes(translator(language)('codex_last_capture_none')));
  }
});
test('new status messages have both languages',()=>{
  for(const key of ['codex_last_capture','codex_last_capture_none'])
    for(const language of ['en','zh']) assert.equal(typeof messages[key][language],'string');
});

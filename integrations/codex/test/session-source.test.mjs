import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, symlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { sessionSource } from '../session-source.mjs';
import { withSourceReadObserver } from '../source.mjs';
import { MAX_LINE } from '../parser.mjs';

const session = '11111111-1111-4111-8111-111111111111';
test('source gate binds the native header to its session and retains cli/exec distinction',async t=>{
  const ws=createTestWorkspace(t,{prefix:'cx-source-'}),path=join(ws.path,'session.jsonl');
  const text=await readFile(new URL('./fixtures/primary-0.160.1.jsonl',import.meta.url),'utf8');
  await writeFile(path,text);
  assert.equal(await sessionSource(path,session),'exec');
  assert.equal(await sessionSource(path,'another-session'),null);
  await writeFile(path,text.replace('"source":"exec"','"source":"cli"'));
  assert.equal(await sessionSource(path,session),'cli');
  await writeFile(path,text.replace('"cli_version":"0.160.1"','"cli_version":"0.999.0"'));
  assert.equal(await sessionSource(path,session),null);
  assert.equal(await sessionSource(path,session,{qualifyCreator:async version=>version==='0.999.0'}),'exec');
});
test('source gate rejects absent, partial, oversized and unsafe files with bounded reads',async t=>{
  const ws=createTestWorkspace(t,{prefix:'cx-source-'}),path=join(ws.path,'session.jsonl');
  assert.equal(await sessionSource(null,session),null);
  assert.equal(await sessionSource(path,session),null);
  const reads=[];
  await writeFile(path,'x'.repeat(MAX_LINE+100));
  assert.equal(await withSourceReadObserver(range=>reads.push(range),()=>sessionSource(path,session)),null);
  assert.equal(reads.reduce((sum,{start,end})=>sum+end-start,0),MAX_LINE);
  await writeFile(path,'{"type":"session_meta"');
  assert.equal(await sessionSource(path,session),null);
  const alias=join(ws.path,'alias');await symlink(path,alias);
  assert.equal(await sessionSource(alias,session),null);
});

test('native exec mode includes resume and alias, without mistaking model values or literal prompts',async()=>{
  const {execInvocation,detectRunningHost}=await import('../qualification.mjs');
  for(const args of [['codex','exec'],['codex','e','resume'],['codex','-c','model="test"','exec','resume'],['codex','--model=test','exec']])
    assert.equal(execInvocation(args),true,JSON.stringify(args));
  for(const args of [['codex'],['codex','resume'],['codex','--','exec'],['codex','--model','exec','hello'],['codex','app-server'],['codex','please run exec']])
    assert.equal(execInvocation(args),false,JSON.stringify(args));
  const host=await detectRunningHost({pid:42,identity:async()=> 'a'.repeat(64),link:async()=>'/native/codex',
    read:async()=>Buffer.from('codex\0-c\0model="test"\0exec\0resume\0')});
  assert.equal(host.execSession,true);assert.equal(host.kind,'cli');
});

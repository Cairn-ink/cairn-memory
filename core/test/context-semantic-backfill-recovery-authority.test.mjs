import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { scenario, checkpoint, until, ok } from './fixtures/context-semantic-backfill-recovery-host.mjs';

test('capability is absent by default and startup requires a qualified authority port',async t=>{
  const s=await scenario(t,{enabled:false,noPort:true});
  assert.deepEqual(Object.keys(s.coordinator),['setOwnerSemantic','getOwnerSemanticStatus','validateOwnerSemanticCoverage','purgeOwnerVectors','close']);
  await assert.rejects(s.restart({enabled:true}),{code:'authority_required'});
});

test('dedicated binding, closed input, expected pins and independent approved request are required',async t=>{
  const s=await scenario(t);s.latch();
  const input=s.intent(),before=s.row();
  s.approve(input);
  assert.equal((await s.grant(input,s.ordinary)).error.code,'authority_required');
  assert.equal((await s.grant({...input,ownerId:'other-owner'})).error.code,'authority_required');
  assert.equal((await s.grant({...input,ticket:'unbounded explanation'})).error.code,'invalid_input');
  assert.equal((await s.grant({...input,ticket:'CASE/other'})).error.code,'authority_required');
  s.settings('expiry',1);
  assert.equal((await s.grant(input)).error.code,'authority_required');
  s.settings('expiry',0);
  for(const [name,value] of Object.entries(input.expected)) {
    const stale={...input,expected:{...input.expected,[name]:typeof value==='number'?value+1:'A'.repeat(43)}};
    s.approve(stale);assert.equal((await s.grant(stale)).error.code,'revision_conflict',name);
  }
  assert.deepEqual(s.row(),before);
  s.approve(input);ok(await s.grant(input));
  for(const conflict of [{...input,additionalUsd:'0.3'},{...s.intent(),approvalId:input.approvalId}]) {
    s.approve(conflict);assert.equal((await s.grant(conflict)).error.code,'revision_conflict');
  }
});

for(const transition of ['approval','revoked','expiry','disable','cancel'])test('final sample fences '+transition+' after external prepare',async t=>{
  const s=await scenario(t);s.latch();
  const input=s.intent(),before=s.row(),controller=new AbortController();s.approve(input);s.arm(checkpoint.holdPrepare,input);
  const pending=s.grant(input,undefined,{signal:controller.signal});let disable;
  try {
    await Promise.race([until(()=>s.settings('reached')===1),pending.then(()=>assert.fail('grant returned before external prepare'))]);
    if(transition==='disable'){disable=s.set(false,1);await until(()=>s.settings('disabled')===1);}
    else if(transition==='cancel')controller.abort();
    else s.settings(transition,1);
  }finally{s.unpause();}
  assert.equal((await pending).error.code,transition==='cancel'?'read_cancelled':'scope_changed');
  if(disable){ok(await disable);const request=s.intent();s.approve(request);assert.equal((await s.grant(request)).error.code,'read_in_progress');}
  else {await s.status();assert.deepEqual(s.row(),before);}
  assert.equal(s.anchor().pending,null);assert.equal(s.audits().length,0);
});

test('every configured intent must have fitting signed V3 capacity',async t=>{
  const s=await scenario(t);s.latch();s.overCapacity();
  const input=s.intent(), before=s.row();s.approve(input);
  assert.equal((await s.grant(input)).error.code,'index_unavailable');
  assert.deepEqual(s.row(),before);assert.equal(s.state[6],0);
});

test('R07 credential expiry after PREPARE returns scope_changed before the caller deadline',async t=>{
  const s=await scenario(t);s.latch();
  await s.restart({credentialTtlMs:3000});
  const input=s.intent({deadlineMs:5000}),before=s.row();s.approve(input);s.arm(checkpoint.holdPrepare,input);
  const pending=s.grant(input);
  try {
    await Promise.race([until(()=>s.settings('reached')===1),pending.then(()=>assert.fail('grant returned before PREPARE'))]);
    await delay(Math.max(0,s.credentialExpiresUtcMs-Date.now()+30));
  }finally{s.unpause();}
  assert.equal((await pending).error.code,'scope_changed');
  assert.deepEqual(s.row(),before);
  assert.equal(s.anchor().pending,null);
  assert.equal(s.audits().length,0);
});

test('R07 the caller deadline during PREPARE still returns read_timeout',async t=>{
  const s=await scenario(t);s.latch();
  const input=s.intent({deadlineMs:1000}),before=s.row();s.approve(input);s.arm(checkpoint.holdPrepare,input);
  const pending=s.grant(input);
  try {
    await Promise.race([until(()=>s.settings('reached')===1),pending.then(()=>assert.fail('grant returned before PREPARE'))]);
    assert.equal((await pending).error.code,'read_timeout');
  }finally{s.unpause();}
  await s.status();
  assert.deepEqual(s.row(),before);
  assert.equal(s.anchor().pending,null);
  assert.equal(s.audits().length,0);
});

test('an expired return fence cannot uncommit a sealed and audited grant',async t=>{
  const s=await scenario(t);s.latch();
  const input=s.intent();s.approve(input);s.arm(checkpoint.holdAudit,input);
  const pending=s.grant(input);
  try {
    await Promise.race([until(()=>s.settings('reached')===1),pending.then(()=>assert.fail('grant returned before audit'))]);
    assert.equal(s.anchor().pending,null);assert.equal(s.audits().length,1);
    s.settings('revoked',1);
  }finally{s.unpause();}
  assert.equal((await pending).error.code,'scope_changed');
  s.settings('revoked',0);assert.equal(ok(await s.grant(input)).status,'replayed');
});

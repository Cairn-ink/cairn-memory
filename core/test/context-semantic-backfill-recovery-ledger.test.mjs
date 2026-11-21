import test from 'node:test';
import assert from 'node:assert/strict';
import { scenario, checkpoint, ok } from './fixtures/context-semantic-backfill-recovery-host.mjs';

test('legacy owner bytes reopen unchanged, and grants are exact, durable and idempotent',async t=>{
  const s=await scenario(t,{enabled:false});s.latch('5.000000000001');
  const before=s.row(), legacy=s.read(), anchor=s.anchor();
  assert.equal(Object.hasOwn(legacy,'backfillRecovery'),false);
  await s.restart();
  assert.deepEqual(s.row(),before);assert.deepEqual(s.anchor(),anchor);
  await s.restart({enabled:true});
  const insufficient=s.intent({additionalUsd:'0.000000000001'});s.approve(insufficient);
  assert.equal((await s.grant(insufficient)).error.code,'invalid_input');
  const input=s.intent({additionalUsd:'0.000000000002'});s.approve(input);
  s.settings('auditDown',1);
  const grant=ok(await s.grant(input));
  assert.deepEqual(grant,{status:'granted',grantId:grant.grantId,sequence:before.sequence+1,effectiveBackfillUsdLimit:'5.000000000002',audit:'pending'});
  const state=s.read(), event=state.backfillRecovery.grants[0];
  assert.deepEqual(state.reservations,legacy.reservations);
  assert.deepEqual([event.chargedUnits,event.reservedUnits,event.baseUnits,event.oldEffectiveUnits,event.newEffectiveUnits,event.additionalUnits],
    ['5000000000001','0','5000000000000','5000000000000','5000000000002','2']);
  assert.deepEqual([state.blocked,state.receipts,state.hints,state.validationOrdinal,state.validationPending],[false,{},{},0,false]);
  const sealed=s.row();assert.equal(s.anchor().stateDigest,sealed.state_digest);assert.equal(s.anchor().pending,null);
  s.settings('auditDown',0);await s.restart({enabled:false});
  assert.equal(typeof s.coordinator.grantOwnerBackfillRecovery,'undefined');
  assert.deepEqual(s.row(),sealed);assert.deepEqual(s.audits(),[event]);
  assert.equal((await s.status()).refresh.backfillUsdLimit,grant.effectiveBackfillUsdLimit);
  await s.restart({enabled:true});
  assert.deepEqual(ok(await s.grant({...input,deadlineMs:3500})),{...grant,status:'replayed',audit:'recorded'});
  assert.deepEqual(s.row(),sealed);
});

for(const [name,mode,committed] of [
  ['before prepare',checkpoint.beforePrepare,false],['after prepare',checkpoint.afterPrepare,false],
  ['after native commit',checkpoint.afterNative,true],['after seal',checkpoint.afterSeal,true],
  ['after audit',checkpoint.afterAudit,true],
])test('worker exit '+name+' reconciles the exact grant under disposal proof',async t=>{
  const s=await scenario(t,{journal:committed?'WAL':'DELETE'});s.latch();
  const input=s.intent();s.approve(input);s.arm(mode,input);
  assert.equal((await s.grant(input)).error.code,'reader_failed');
  assert.equal(Boolean(s.read().backfillRecovery),committed);
  assert.equal(s.audits().length,mode===checkpoint.afterAudit?1:0);
  s.settings('disposed',1);
  await s.restart({enabled:true});
  const result=ok(await s.grant(input));
  assert.equal(result.status,committed?'replayed':'granted');
  assert.equal(result.audit,'recorded');assert.equal(result.sequence,input.expected.sequence+1);
  assert.equal(s.anchor().pending,null);assert.equal(s.audits().length,1);
  assert.equal(s.audits()[0].grantId,result.grantId);
});

test('epoch retirement keeps original audit, counts past increments against aggregate and rejects incompatible base',async t=>{
  const s=await scenario(t);s.latch('5.125');
  const first=s.intent({additionalUsd:'0.5'});s.approve(first);
  const result=ok(await s.grant(first));
  ok(await s.set(false,1));ok(await s.purge());ok(await s.set(true,2));
  assert.equal((await s.status()).refresh.backfillUsdLimit,'5');
  assert.equal((await s.status()).refresh.backfillUsdCharged,'5.125');
  const tooMuch=s.intent({additionalUsd:'0.250000000001'});s.approve(tooMuch);
  assert.equal((await s.grant(tooMuch)).error.code,'invalid_input');
  const second=s.intent();s.approve(second);const latest=ok(await s.grant(second));
  assert.equal(latest.effectiveBackfillUsdLimit,'5.25');
  assert.deepEqual(ok(await s.grant(first)),{...result,status:'replayed'});
  assert.equal(s.audits().length,2);
  await assert.rejects(s.restart({base:'4'}),{code:'index_unavailable'});
  await s.restart({base:'4',enabled:false});
  const attempts=s.state[6];ok(await s.refresh());assert.equal(s.state[6],attempts);
});

test('the journal retains all 32 events and refuses any further allowance',async t=>{
  const s=await scenario(t);s.latch();
  for(let i=0;i<32;i++){
    s.seed(state=>{state.blocked=true;});
    const input=s.intent({additionalUsd:'0.000000000001'});s.approve(input);
    assert.equal(ok(await s.grant(input)).status,'granted');
  }
  s.seed(state=>{state.blocked=true;});
  const input=s.intent({additionalUsd:'0.000000000001'}),row=s.row();s.approve(input);
  assert.equal((await s.grant(input)).error.code,'invalid_input');
  assert.deepEqual(s.row(),row);
  assert.equal(s.audits().length,32);
});

test('R06 the full approved increment can raise the effective ceiling above one million USD',async t=>{
  const s=await scenario(t,{grantMaximum:'1000000',lifetimeMaximum:'1000000'});s.latch();
  const input=s.intent({additionalUsd:'1000000'});s.approve(input);
  const result=ok(await s.grant(input));
  assert.equal(result.status,'granted');
  assert.equal(result.effectiveBackfillUsdLimit,'1000005');
  await s.restart();
  assert.equal((await s.status()).refresh.backfillUsdLimit,'1000005');
});

for(const [stage,committed] of [['Prepare',false],['Seal',true]])test(`R08 uncoded anchor ${stage} faults return index_unavailable and reconcile`,async t=>{
  const s=await scenario(t);s.latch();
  const input=s.intent(),before=s.row();s.approve(input);s.arm(checkpoint['throw'+stage],input);
  assert.equal((await s.grant(input)).error?.code,'index_unavailable');
  assert.equal(s.row().sequence,before.sequence+(committed?1:0));
  assert.equal(s.audits().length,0);
  await s.status();
  assert.equal(s.anchor().pending,null);
  const result=ok(await s.grant(input));
  assert.equal(result.status,committed?'replayed':'granted');
  assert.equal(result.sequence,before.sequence+1);
  assert.equal(s.audits().length,1);
});

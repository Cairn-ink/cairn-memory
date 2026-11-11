import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fixture, ns, request, splitRaw, localPlainPort, count } from '../testing/raw-capture-fixtures.mjs';

const batch = sessionId => request(splitRaw('Synthetic '+sessionId)[0], { sessionId, eventId: sessionId });
const gate = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };

for (const processes of [false, true]) test(`different sessions survive namespace epoch contention, processes=${processes}`, async t => {
  const entered = gate(), release = gate(); let seals = 0;
  const port = localPlainPort(), seal = port.sealRaw;
  port.sealRaw = async value => { if (++seals === 1) { entered.resolve(); await release.promise; } return seal(value); };
  const f = fixture(t, { port });
  const pending = f.core.captureRaw(batch('session-b')); await entered.promise;
  let first;
  if (processes) {
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { openRawCaptureCore } from ${JSON.stringify(new URL('../raw-capture.mjs', import.meta.url).href)};
      import { localPlainPort } from ${JSON.stringify(new URL('../testing/raw-fixtures.mjs', import.meta.url).href)};
      const core = openRawCaptureCore({path:process.argv[1]}, {mode:'raw-v1', interpretation:'host', port:localPlainPort(),readPolicy:()=>({generation:'notice-1',reason:null})});
      try { console.log(JSON.stringify(await core.captureRaw(JSON.parse(process.argv[2])))); } finally { await core.close(); }
    `, f.path, JSON.stringify(batch('session-a'))], { stdio: ['ignore','pipe','pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b);
    const [code, signal] = await once(child, 'close'); assert.equal(code, 0, stderr); assert.equal(signal, null); first = JSON.parse(stdout);
  } else first = await f.core.captureRaw(batch('session-a'));
  release.resolve(); const second = await pending;
  t.diagnostic(JSON.stringify({ first, second }));
  assert.equal(first.ok, true); assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.value.raw.parts[0].saved, true); assert.equal(seals, processes ? 2 : 3);
  assert.equal(count(f.db, 'raw_events'), 2); assert.equal(count(f.db, 'raw_parts'), 2);
  assert.deepEqual((await f.core.captureRaw(batch('session-b'))).value.raw, second.value.raw);
  assert.equal(count(f.db, 'raw_events'), 2);
});

for (const barrier of ['policy','client','pause','session','revision']) test(`epoch plus ${barrier} still refuses without a fresh preparation`, async t => {
  let f, seals = 0, active = false;
  const port = localPlainPort(), seal = port.sealRaw;
  port.sealRaw = async value => {
    if (active) {
      seals++;
      f.db.prepare('UPDATE namespace_epochs SET epoch=epoch+1').run();
      if (barrier === 'policy') f.policy.generation = 'revoked';
      if (barrier === 'client') f.core.setRawCaptureControl({ownerId:ns.ownerId,client:'claude-code',enabled:false,expectedRevision:0});
      if (barrier === 'pause') f.core.setCapturePaused({namespace:ns,expectedGeneration:'initial',paused:true});
      if (barrier === 'session') f.core.fenceSession({namespace:ns,client:'claude-code',sessionId:'session-b'});
      if (barrier === 'revision') f.db.prepare('UPDATE raw_conversations SET revision=revision+1').run();
    }
    return seal(value);
  };
  f = fixture(t, { port }); await f.core.captureRaw(batch('session-b')); active = true;
  const next = request(splitRaw('Synthetic next', {id:'next',ordinal:2})[0], {sessionId:'session-b',eventId:'next'});
  const result = await f.core.captureRaw(next);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, ['pause'].includes(barrier) ? 'capture_disabled' : barrier === 'session' ? 'conversation_deleted' : 'revision_conflict');
  assert.equal(result.error.retryable, false); assert.equal(seals, 1); assert.equal(count(f.db,'raw_events'),1);
});

test('epoch contention on all four attempts returns retryable busy and later replay stores once', async t => {
  let f, seals = 0, churn = false;
  const port = localPlainPort(), seal = port.sealRaw;
  port.sealRaw = async value => { if (churn) { seals++; f.db.prepare('UPDATE namespace_epochs SET epoch=epoch+1').run(); } return seal(value); };
  f = fixture(t, {port}); await f.core.captureRaw(batch('session-a')); churn = true;
  assert.deepEqual(await f.core.captureRaw(batch('session-b')), {ok:false,error:{code:'storage_busy',retryable:true}});
  assert.equal(seals,4); assert.equal(count(f.db,'raw_events'),1); assert.equal(count(f.db,'raw_parts'),1);
  churn = false; const result = await f.core.captureRaw(batch('session-b')); assert.equal(result.ok,true);
  assert.deepEqual((await f.core.captureRaw(batch('session-b'))).value.raw,result.value.raw);
  assert.equal(count(f.db,'raw_events'),2); assert.equal(count(f.db,'raw_parts'),2);
});

test('same-event winner replays before epoch/revision retry and never seals again', async t => {
  let f, seals = 0; const entered = gate(), release = gate();
  const port = localPlainPort(), seal = port.sealRaw;
  port.sealRaw = async value => { if (++seals === 1) { entered.resolve(); await release.promise; } return seal(value); };
  f = fixture(t,{port}); const pending = f.core.captureRaw(batch('session-a')); await entered.promise;
  const winner = await f.core.captureRaw(batch('session-a')); release.resolve();
  assert.deepEqual((await pending).value.raw,winner.value.raw); assert.equal(seals,2);
  assert.equal(count(f.db,'raw_events'),1); assert.equal(count(f.db,'raw_parts'),1);
});

for (const kind of ['staged','episode']) test(`${kind} registration retries before any model dispatch`, async t => {
  const entered=gate(),release=gate();let seals=0;
  const port=localPlainPort(),seal=port.sealRaw;
  port.sealRaw=async value=>{if(++seals===1){entered.resolve();await release.promise;}return seal(value);};
  const f=fixture(t,{kind,port});
  // Episode admission lazily creates this fence field; establish it before
  // both preparations so this case changes only the namespace epoch.
  if(kind==='episode')f.db.prepare("INSERT INTO episode_controls(owner_id,scope,project_id,generation,paused,enabled) VALUES(?,?,?,'initial',0,1)").run(ns.ownerId,ns.scope,ns.projectId??'');
  const input=sessionId=>request(splitRaw('Synthetic '+sessionId)[0],{sessionId,eventId:sessionId},kind);
  const pending=f.core.captureRaw(input('session-b'));await entered.promise;
  assert.equal((await f.core.captureRaw(input('session-a'))).ok,true);release.resolve();
  const result=await pending;assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.value.raw.parts[0].saved,true);
  assert.equal(seals,3);assert.equal(count(f.db,'raw_events'),2);assert.equal(count(f.db,'admission_claims'),2);
});

test('journal re-prepares after explicit prepare A, prepare B, commit A, commit B interleaving', async t => {
  const {rawFixture,rawRequest}=await import('../testing/raw-fixtures.mjs');
  const {transaction}=await import('../database.mjs');
  const {retryRawEpochConflict}=await import('../raw-journal.mjs');
  const f=rawFixture(t),a=rawRequest(splitRaw('Synthetic A')[0],{sessionId:'a',eventId:'a'}),b={...a,sessionId:'b',eventId:'b'};
  const preparedA=await f.journal.prepareRegistration(a),preparedB=await f.journal.prepareRegistration(b);
  transaction(f.db,()=>f.journal.commitRegistration(preparedA));let attempts=0;
  const result=await retryRawEpochConflict(async()=>{
    const token=attempts++===0?preparedB:await f.journal.prepareRegistration(b);
    return transaction(f.db,()=>f.journal.commitRegistration(token));
  });
  assert.equal(result.parts[0].saved,true);assert.equal(attempts,2);assert.equal(count(f.db,'raw_events'),2);
});

test('default capture re-prepares its Raw projection after another session commits', async t => {
  const {openMemoryCore}=await import('../index.mjs');
  const f=fixture(t),entered=gate(),release=gate();let seals=0;
  const port=localPlainPort(),seal=port.sealRaw;
  port.sealRaw=async value=>{if(++seals===1){entered.resolve();await release.promise;}return seal(value);};
  const core=openMemoryCore({path:f.path,model:f.model,rawSearch:false,rawConversations:{mode:'raw-v1',capBytes:200000000,port,readPolicy:()=>({...f.policy})}});
  f.workspace.defer(()=>core.close());
  const input=sessionId=>({namespace:ns,client:'claude-code',sessionId,eventId:sessionId,messages:[{id:'message',role:'user',content:'Synthetic '+sessionId,occurredAt:'2020-01-01T00:00:00.000Z'}]});
  const pending=core.capture(input('session-b'));await entered.promise;assert.equal((await core.capture(input('session-a'))).ok,true);release.resolve();
  assert.equal((await pending).ok,true);assert.equal(seals,3);assert.equal(count(f.db,'raw_events'),2);
});

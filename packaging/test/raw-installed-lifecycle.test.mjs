import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lifecycleFixture,ok,call } from './fixtures/raw-installed-lifecycle.mjs';

const sourceText = (scenario,index = 0) => `Synthetic ${scenario} independent source ${index}. Exact evidence 🙂.`;
const joined = view => view.messages.flatMap(message=>message.parts.map(part=>part.text)).join('');
const unavailable = result => { assert.equal(result.ok,false,JSON.stringify(result));
  assert.ok(['source_excluded','source_unavailable'].includes(result.error.code),result.error.code); };
function provenance(snapshot,texts) {
  assert.equal(snapshot.memories.length,1); const memory = snapshot.memories[0];
  assert.equal(memory.receipts.length,texts.length); assert.equal(snapshot.lineage.length,texts.length);
  assert.equal(snapshot.messages.length,texts.length); assert.equal(snapshot.admissions.length,texts.length);
  assert.equal(snapshot.admissions.every(row=>row.state === 'completed'),true);
  assert.equal(snapshot.messages.every(row=>row.assembly_state === 'complete' && row.reserved_bytes === 0),true);
  assert.equal(snapshot.cards.length,0); assert.equal(snapshot.notes.length,0);
  for (const line of snapshot.lineage) {
    const receipt = memory.receipts.find(row=>row.id === line.receiptId); assert.ok(receipt);
    assert.equal(line.memoryId,memory.memory.id); assert.equal(line.event_id,line.message_id); assert.equal(line.kind,'derived');
    assert.equal(line.role,'user'); assert.equal(receipt.excerpt,line.excerpt); assert.ok(texts.includes(line.excerpt));
    const message = snapshot.messages.find(row=>row.conversation_id === line.conversation_id && row.message_id === line.message_id); assert.ok(message);
    const parts = snapshot.parts.filter(row=>row.conversation_id === line.conversation_id && row.message_id === line.message_id);
    assert.equal(parts.every(row=>row.saved === 1),true); assert.equal(parts.map(row=>row.text).join(''),line.excerpt);
    assert.equal(line.start,0); assert.equal(line.end,line.excerpt.length);
  }
  return memory;
}
async function source(f,client,line) {
  const view = await f.read(client,line.conversation_id),anchor = f.anchor(view,line.message_id);
  return { view,anchor,ref:(await f.resolveSources(client,[anchor]))[0] };
}
async function inspectCard(client,id) { return ok(await call(client,'inspect_private_card',{ cardId:id })).card; }
async function assertUnsupported(f,client,confirmed,pending) {
  assert.equal(await inspectCard(client,pending.id),null);
  assert.equal(await inspectCard(client,confirmed.id),null);
  const card = f.probe().cards.find(row=>row.id === confirmed.id); assert.equal(card.state,'confirmed');
  assert.equal(card.body,'Synthetic independently authored lifecycle body.');
  const current = ok(await call(client,'select_evidence',{ query:'lifecycle',types:['card'],intent:'current' }));
  assert.equal(current.items.some(row=>row.ref.cardId === confirmed.id),false);
  const history = ok(await call(client,'select_evidence',{ query:'lifecycle',types:['card'],intent:'history' }));
  assert.equal(history.items.some(row=>row.ref.cardId === confirmed.id),false);
  return card;
}

for (const client of ['claude-code','codex']) {
  test(`IL-A ${client}: foreground provenance to explicit Raw Card, verified PTY and cold readback`,{ timeout:120000 },async t=>{
    const f = await lifecycleFixture(t,{ client }),text = sourceText('A'); f.append(0,text); f.capture();
    const initial = f.probe(),memory = provenance(initial,[text]); assert.equal(initial.lineage[0].client,client);
    await f.noWork(async()=>{
      let local = await f.mcp();
      const capabilities = ok(await call(local.client,'private_card_capabilities'));
      assert.equal(capabilities.version,'private-cards-local-v1'); assert.equal(capabilities.raw,true);
      assert.deepEqual(capabilities.drafting,['authored']); assert.equal(capabilities.modelAssisted,false); assert.equal(capabilities.publication,false);
      assert.ok(capabilities.sourceTypes.includes('raw'));
      const conversations = ok(await call(local.client,'list_raw_conversations',{ client })).conversations;
      assert.deepEqual(conversations.map(row=>row.id),[initial.lineage[0].conversation_id]);
      const evidence = await source(f,local.client,initial.lineage[0]); assert.equal(joined(evidence.view),text);
      assert.equal(ok(await call(local.client,'read_private_card_source',{ source:evidence.ref })).parts.map(part=>part.text).join(''),text);
      const draft = await f.draft(local.client,[evidence.ref]);
      assert.equal((await call(local.client,'confirm_private_card_draft',{ cardId:draft.id,expectedRevision:draft.revision,actionId:randomUUID() })).error.code,'approval_required');
      await f.confirm(draft); await local.close(); local = await f.mcp();
      const card = await inspectCard(local.client,draft.id); assert.equal(card.state,'confirmed'); assert.equal(card.support.applicability,'current');
      assert.equal(card.bindings[0].source.type,'raw'); assert.deepEqual(card.bindings[0].source.span,evidence.ref.span);
      assert.equal(ok(await call(local.client,'read_private_card_source',{ source:evidence.ref })).parts.map(part=>part.text).join(''),text);
      const current = ok(await call(local.client,'select_evidence',{ query:'lifecycle',types:['card'],intent:'current' }));
      assert.equal(current.items.some(row=>row.ref.cardId === draft.id),true);
      const after = f.probe(); assert.deepEqual(after.memories,[memory]); assert.equal(after.notes.length,0); assert.equal(after.cards.length,1);
      t.diagnostic(JSON.stringify({ scenario:'A',client,capability:capabilities.version,raw:capabilities.raw,drafting:capabilities.drafting,automaticallyCreatedCards:0,additionalMemories:0,additionalNotes:0 }));
      await local.close();
    });
    await f.finish();
  });

  test(`IL-B ${client}: sequential correction then forget, precise exclusions, disjoint source and rearm`,{ timeout:120000 },async t=>{
    const f = await lifecycleFixture(t,{ client }),original = sourceText('B'),control = sourceText('B control');
    f.append(0,original); f.capture(); const initial = f.probe(),memory = provenance(initial,[original]);
    f.append(0,control); f.capture(0,'empty'); const controlState = f.probe(); assert.equal(controlState.memories.length,1);
    assert.equal(controlState.cards.length,0); assert.equal(controlState.notes.length,0);
    let local = await f.mcp(); const line = initial.lineage[0],evidence = await source(f,local.client,line);
    const controlMessage = controlState.messages.find(row=>row.ordinal === 2); assert.ok(controlMessage);
    const controlEvidence = await source(f,local.client,controlMessage);
    const confirmed = await f.noWork(()=>f.draft(local.client,[evidence.ref])); await f.noWork(()=>f.confirm(confirmed));
    const pending = await f.noWork(()=>f.draft(local.client,[evidence.ref]));
    await f.noWork(async()=>{
      const corrected = ok(await call(local.client,'correct_memory',{ memoryId:memory.memory.id,expectedRevision:memory.memory.revision,content:'Synthetic corrected lifecycle interpretation.' })).memory;
      await assertUnsupported(f,local.client,confirmed,pending);
      unavailable(await call(local.client,'read_private_card_source',{ source:evidence.ref }));
      unavailable(await call(local.client,'create_private_card_draft',{ actionId:randomUUID(),title:'Excluded lifecycle draft',body:'Must not be retained.',sources:[evidence.ref] }));
      const fresh = await f.read(local.client,line.conversation_id); assert.equal(joined(fresh),original+control);
      unavailable(await call(local.client,'resolve_source_references',{ anchors:[f.anchor(fresh,line.message_id)] }));
      const stillAvailable = await f.resolveSources(local.client,[f.anchor(fresh,controlMessage.message_id)]);
      assert.equal(ok(await call(local.client,'read_private_card_source',{ source:stillAvailable[0] })).parts[0].text,control);
      ok(await call(local.client,'forget_memory',{ memoryId:memory.memory.id,expectedRevision:corrected.revision }));
      assert.equal(f.probe().memories.length,0); await local.close(); local = await f.mcp();
      await assertUnsupported(f,local.client,confirmed,pending);
      const cold = await f.read(local.client,line.conversation_id);
      unavailable(await call(local.client,'resolve_source_references',{ anchors:[f.anchor(cold,line.message_id)] }));
      assert.equal(ok(await call(local.client,'read_private_card_source',{ source:controlEvidence.ref })).parts[0].text,control);
    });
    const cursor = f.cursor(),key = f.key(),paused = sourceText('B paused');
    f.probe('pause'); f.append(0,paused); f.probe('resume');
    assert.equal(f.host(f.selected('run'),{ expected:2 }).reason,'authority_changed');
    const rearm = f.rearm(); await f.noWork(async()=>{ assert.equal(f.host(rearm).reason,'rearmed'); });
    assert.deepEqual(f.key(),key); assert.equal(f.cursor().wireSessionId,cursor.wireSessionId); assert.equal(f.cursor().sessionKey,cursor.sessionKey);
    assert.equal(f.cursor().issuedOrdinal,cursor.issuedOrdinal);
    const later = sourceText('B future'); f.append(0,later); f.capture(0,'empty');
    await f.noWork(async()=>{
      await local.close(); local = await f.mcp(); const view = await f.read(local.client,line.conversation_id);
      assert.equal(joined(view),original+control+later); assert.equal(joined(view).includes(paused),false);
      const state = f.probe(); assert.deepEqual(state.messages.map(row=>row.ordinal),[1,2,3]); assert.equal(state.memories.length,0);
      const future = state.messages.find(row=>row.ordinal === 3),refs = await f.resolveSources(local.client,[f.anchor(view,future.message_id)]);
      assert.equal(ok(await call(local.client,'read_private_card_source',{ source:refs[0] })).parts[0].text,later);
      unavailable(await call(local.client,'resolve_source_references',{ anchors:[f.anchor(view,line.message_id)] }));
      unavailable(await call(local.client,'create_private_card_draft',{ actionId:randomUUID(),title:'Excluded cold lifecycle draft',body:'Must not be retained.',sources:[evidence.ref] }));
      await assertUnsupported(f,local.client,confirmed,pending);
      const before = f.durable(); assert.equal(f.host(rearm).reason,'replayed'); assert.equal(f.host(f.selected('run')).status,'ready');
      assert.deepEqual(f.durable(),before); assert.deepEqual(f.probe(),state); assert.equal(state.lineage.length,0);
      const cancelled = state.cards.find(row=>row.id === pending.id); assert.equal(cancelled.state,'cancelled'); assert.equal(cancelled.body,null); assert.equal(cancelled.title,null);
      assert.equal(state.bindings.some(row=>row.card_id === pending.id),false); assert.equal(state.notes.length,0);
      await local.close();
    });
    t.diagnostic(JSON.stringify({ scenario:'B',client,sequentialCorrectionThenForget:true,standaloneForgetIndependent:false,originalAnchorsExcluded:true,disjointSourceAvailable:true,pausedBackfill:false,ordinals:[1,2,3] }));
    await f.finish();
  });

  test(`IL-C ${client}: two captured conversations, surviving support after real deletion and cold replay`,{ timeout:120000 },async t=>{
    const f = await lifecycleFixture(t,{ client,matching:true }),firstText = sourceText('C',0),secondText = sourceText('C',1);
    f.append(0,firstText); f.capture(); const first = f.probe(),original = provenance(first,[firstText]);
    f.append(1,secondText); f.capture(1); const both = f.probe(),memory = provenance(both,[firstText,secondText]);
    assert.equal(memory.memory.id,original.memory.id); assert.deepEqual(memory.qualification,original.qualification);
    assert.equal(new Set(both.lineage.map(row=>row.conversation_id)).size,2); assert.equal(new Set(both.lineage.map(row=>row.session_id)).size,2);
    const firstLine = both.lineage.find(row=>row.excerpt === firstText),secondLine = both.lineage.find(row=>row.excerpt === secondText);
    await f.noWork(async()=>{
      let local = await f.mcp(); const a = await source(f,local.client,firstLine),b = await source(f,local.client,secondLine);
      const confirmed = await f.draft(local.client,[a.ref,b.ref]); await f.confirm(confirmed);
      const current = await inspectCard(local.client,confirmed.id); assert.equal(current.support.applicability,'current'); assert.equal(current.bindings.length,2);
      const pending = await f.draft(local.client,[a.ref,b.ref]);
      const deletion = { conversationId:firstLine.conversation_id,expectedRevision:a.view.conversation.revision,actionId:randomUUID() };
      const deleted = f.probe('delete',deletion); await assertUnsupported(f,local.client,confirmed,pending);
      unavailable(await call(local.client,'read_private_card_source',{ source:a.ref }));
      assert.equal(ok(await call(local.client,'read_private_card_source',{ source:b.ref })).parts[0].text,secondText);
      await local.close(); local = await f.mcp(); const after = f.probe();
      assert.equal(after.memories.length,1); assert.equal(after.memories[0].memory.id,memory.memory.id); assert.equal(after.memories[0].receipts.length,1);
      assert.equal(after.memories[0].receipts[0].excerpt,secondText); assert.equal(after.lineage.length,1); assert.equal(after.lineage[0].conversation_id,secondLine.conversation_id);
      assert.equal(after.conversations.some(row=>row.id === firstLine.conversation_id),false); assert.equal(after.parts.some(row=>row.text === firstText),false);
      assert.equal(after.parts.map(row=>row.text).join(''),secondText); assert.equal(after.notes.length,0);
      await assertUnsupported(f,local.client,confirmed,pending);
      unavailable(await call(local.client,'read_private_card_source',{ source:a.ref }));
      assert.equal(ok(await call(local.client,'read_private_card_source',{ source:b.ref })).parts[0].text,secondText);
      assert.deepEqual(f.probe('delete',deletion),deleted); assert.deepEqual(f.probe(),after);
      const absent = ok(await call(local.client,'read_raw_conversation',{ conversationId:firstLine.conversation_id })); assert.equal(absent.conversation,null);
      const listed = ok(await call(local.client,'list_raw_conversations',{ client })).conversations; assert.deepEqual(listed.map(row=>row.id),[secondLine.conversation_id]);
      await local.close();
    });
    t.diagnostic(JSON.stringify({ scenario:'C',client,explicitMatchingPolicy:true,independentConversationRoots:2,semanticCorroboration:false,survivingReceipts:1,privateAuthorshipRetained:true }));
    await f.finish();
  });
}

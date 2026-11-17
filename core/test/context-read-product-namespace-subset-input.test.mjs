import test from 'node:test';
import assert from 'node:assert/strict';
import { requestAuthority } from '../context-product-authority.mjs';
import { credentialDigest } from '../context-product-control.mjs';
import { isDeepStrictEqual } from 'node:util';
import { contextProductReadSelection } from '../context-product-selection.mjs';
import { contextInput } from '../context-read-input.mjs';
import { fixture } from '../testing/context-read-fixture.mjs';
import { configured,prebuild } from '../testing/context-product-owner-fixture.mjs';
import { subsetFixture,personal,project,publication,bare,ok } from '../testing/context-product-subset-fixture.mjs';

function invalidSelections(effects) {
  const accessor={...personal};Object.defineProperty(accessor,'scope',{get(){effects.count++;return 'personal';}});
  const arrayAccessor=[personal];Object.defineProperty(arrayAccessor,0,{get(){effects.count++;return personal;}});
  const symbol={...personal,[Symbol('scope')]:true};
  const hidden={...personal};Object.defineProperty(hidden,'extra',{value:true});
  const arrayExtra=[personal];arrayExtra.extra=true;
  return [undefined,null,{},'personal',[],[project('a')],[personal,project('a'),project('b')],
    [personal,personal],[personal,project('a'),project('a')],[{...personal,ownerId:'other'}],
    [personal,project('unknown')],[personal,project('authorized-but-unselected')],
    [{...personal,projectId:''}],[{...personal,projectId:undefined}],[{...personal,scope:'invalid'}],
    [personal,{...project('a'),projectId:null}],[{...personal,ownerId:'invalid\0owner'}],
    [personal,{...project('a'),projectId:'\ud800'}],[{...personal,extra:true}],[symbol],[hidden],
    new Array(1),[personal,,],arrayExtra,[accessor],arrayAccessor,
    new Proxy([personal],{get(){effects.count++;throw Error('proxy array');}}),
    [new Proxy(personal,{ownKeys(){effects.count++;throw Error('proxy namespace');}})]];
}

test('closed malformed and unavailable scope refusals before index, counter or user code',async t=>{
  const s=subsetFixture(t),effects={count:0};
  for(const namespaces of invalidSelections(effects)){
    assert.throws(()=>contextProductReadSelection({namespaces},s.readSet),{code:'invalid_read_set'});
    const before=s.calls.authorize.length;
    assert.deepEqual(await s.run('findCandidates',{namespaces}),bare('invalid_read_set'));
    assert.equal(s.calls.authorize.length,before);
  }
  const payload={...s.query};Object.defineProperty(payload,'namespaces',{get(){effects.count++;return [personal];}});
  assert.deepEqual(await s.index.run('findCandidates',payload,{}),bare('invalid_read_set'));
  const proxy=new Proxy({...s.query,namespaces:[personal]},{getOwnPropertyDescriptor(){effects.count++;throw Error('proxy payload');}});
  assert.deepEqual(await s.index.run('findCandidates',proxy,{}),bare('invalid_read_set'));
  assert.throws(()=>s.vectors.observe(proxy,s.lexical,{}, {load:true}),{code:'invalid_read_set'});
  assert.equal(effects.count,0);assert.equal(s.calls.counter.length,0);assert.equal(s.calls.provider,0);
  assert.throws(()=>contextInput('findCandidates',{...s.query,namespaces:[personal]},['memory']),{code:'invalid_input'},'ordinary reader retains its closed grammar');
});

test('Worker parent validates scope descriptors and preserves credential and opening readSet checks',async t=>{
  const f=fixture(t);for(const ns of publication)f.admit('orchard public',ns);
  const maintenance=configured(t,f.path,publication,{service:true});await prebuild(maintenance,['memory']);
  const request=configured(t,f.path,publication),reader=await request.open();
  const query={readSet:publication,types:['memory'],intent:'current',query:'orchard',deadlineMs:5000};
  const effects={count:0};
  for(const namespaces of invalidSelections(effects))assert.deepEqual(await reader.findCandidates({...query,namespaces},request.token),bare('invalid_read_set'));
  const payload={...query};Object.defineProperty(payload,'namespaces',{get(){effects.count++;return [personal];}});
  assert.deepEqual(await reader.findCandidates(payload,request.token),bare('invalid_read_set'));
  assert.deepEqual(await reader.findCandidates(payload,{opaque:'wrong'}),bare('authority_required'));
  assert.deepEqual(await reader.findCandidates({...query,readSet:[personal],namespaces:[personal]},request.token),bare('invalid_read_set'));
  assert.equal(effects.count,0);
  for(const method of ['getContextIndexStatus','fetchCandidateEvidence'])
    assert.deepEqual(await reader[method]({...query,namespaces:[personal]},request.token),bare('invalid_input'));
  const h=await maintenance.open();
  assert.deepEqual(await h.refreshContextIndex({readSet:publication,types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:1,maxMs:5000},namespaces:[personal]},maintenance.token),bare('invalid_input'));
  const value=ok(await reader.findCandidates({...query,namespaces:[personal]},request.token));
  assert.equal(value.items.length,1);assert.deepEqual(value.items[0].ref.namespace,personal);
});

test('complete original payload, including normalized-equivalent scope syntax, reaches authorization',async t=>{
  const s=subsetFixture(t);
  const namespaces=[project('a'),personal],input={...s.query,namespaces};
  ok(await s.index.run('findCandidates',input,{opaque:'bound'}));
  const delivered=s.calls.authorize.at(-1).payload;
  assert.deepEqual(delivered,input);assert.ok(Object.isFrozen(delivered));assert.ok(Object.isFrozen(delivered.namespaces));
});

test('storage seams revalidate scope membership and ignore forged derived selections',t=>{
  const s=subsetFixture(t);
  for(const namespaces of [[],[project('a')],[personal,project('outside')]]){
    const p={...s.p,namespaces,selection:{namespaces:[personal],streams:[0],ranges:[]}};
    assert.throws(()=>s.storage.lexical(p,s.lexical,'orchard'),{code:'invalid_read_set'});
    assert.throws(()=>s.vectors.observe(p,s.lexical,{}, {load:true}),{code:'invalid_read_set'});
  }
});


test('issued whole-payload operation refuses substituted or omitted subset at native authority',async t=>{
  const token={opaque:'synthetic-issued'},binding={ownerId:personal.ownerId,namespaces:{readSet:publication},credentialDigest:credentialDigest(token)};
  let issued;
  const authority=requestAuthority({authorize(request){return isDeepStrictEqual(request.input,issued)?binding:null;},isCurrent:()=>true},binding,{});
  const s=subsetFixture(t,{authorize:(method,payload)=>authority(method,payload,token)});
  issued={...s.query,namespaces:[personal]};
  ok(await s.index.run('findCandidates',issued,token));
  for(const namespaces of [[personal,project('a')],[personal,project('b')]])
    assert.deepEqual(await s.index.run('findCandidates',{...issued,namespaces},token),bare('authority_required'));
  const {namespaces,...omitted}=issued;
  assert.deepEqual(await s.index.run('findCandidates',omitted,token),bare('authority_required'));
});

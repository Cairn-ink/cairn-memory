import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openMemoryCore } from '../index.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { fixture,ns,ok,denied,readPolicy } from '../testing/local-authority-fixtures.mjs';

test('B2b-01 malformed startup snapshots refuse before filesystem or migration and invoke no getter/trap',t => {
  const f=fixture(t); f.grant(); const valid=f.snapshot(); let touched=0;
  const accessor=Object.defineProperty({...valid},'targetId',{get(){touched++;return 'synthetic-target';}});
  const proxy=new Proxy(valid,{ownKeys(){touched++;return Reflect.ownKeys(valid);},get(){touched++;throw Error('private');}});
  const cases=[null,undefined,{},accessor,proxy,{...valid,[Symbol('extra')]:true},{...valid,extra:true},
    {...valid,namespace:new Proxy(ns,{get(){touched++;return 'private';}})},
    {...valid,expectedControlRevision:-1},{...valid,expectedRawRevision:NaN},{...valid,version:'other'},{...valid,client:'other'}];
  for(const [i,localAuthority] of cases.entries()) {
    const path=join(f.workspace.path,'invalid-'+i+'.sqlite');
    assert.throws(()=>openMemoryCore({path,rawConversations:{mode:'off',readPolicy,localAuthority}}),{code:'invalid_input'});
    assert.equal(existsSync(path),false);
  }
  for(const localAuthority of cases) {
    const before=f.db.prepare('PRAGMA user_version').get().user_version;
    assert.throws(()=>openMemoryCore({path:f.path,rawConversations:{mode:'off',readPolicy,localAuthority}}),{code:'invalid_input'});
    assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,before);
  }
  assert.equal(touched,0);
});

test('B2b-01 managed controls and nested wire DTOs reject accessors/proxies without reading them',async t=>{
  const f=fixture(t); f.grant(); const worker=f.worker(); let touched=0;
  const accessor=(value,key)=>Object.defineProperty({...value},key,{get(){touched++;throw Error('private');}});
  const proxy=value=>new Proxy(value,{get(){touched++;throw Error('private');},ownKeys(){touched++;throw Error('private');}});
  for(const input of [accessor({namespace:ns,client:'claude-code'},'namespace'),proxy({}),{namespace:proxy(ns),client:'claude-code'},
    {namespace:ns,client:'claude-code',unexpected:true}]) denied(f.control.getLocalCaptureControl(input),'invalid_input');
  const settings={namespace:ns,client:'claude-code',targetId:'synthetic-target',expectedStoreId:f.get().storeId,
    expectedRevision:f.get().revision,automaticCaptureEnabled:false,rawNoticeVersion:null};
  for(const input of [proxy(settings),accessor(settings,'automaticCaptureEnabled'),{...settings,namespace:accessor(ns,'projectId')},
    {...settings,rawNoticeVersion:undefined},{...settings,[Symbol('extra')]:true}]) denied(f.control.setLocalCaptureControl(input),'invalid_input');
  const req=f.request(),message=req.messages[0];
  const variants=[proxy(req),accessor(req,'namespace'),{...req,namespace:accessor(ns,'ownerId')},
    {...req,messages:proxy(req.messages)},{...req,messages:[proxy(message)]},{...req,messages:[accessor(message,'content')]},
    {...req,messages:[{...message,part:accessor(message.part,'index')}]},{...req,causal:accessor({streamId:'stream',sequence:1},'sequence')},
    {...req,messages:Object.assign([...req.messages],{extra:true})},{...req,localAuthority:f.snapshot()}];
  for(const input of variants) denied(await worker.captureRaw(input),'invalid_input');
  assert.equal(touched,0); assert.equal(f.policyCalls,0); assert.equal(f.seals,0); assert.equal(f.calls,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_events').get().n,0);
});

test('B2b-01 startup snapshot is copied/frozen before asynchronous caller mutation',async t=>{
  const f=fixture(t); f.grant(); const authority=f.snapshot(),worker=f.worker({authority});
  authority.targetId='changed'; authority.namespace={...ns,projectId:'changed'}; authority.expectedConsentGeneration='changed';
  ok(ok(await worker.captureRaw(f.request())).interpretation); assert.equal(f.calls,1);
});

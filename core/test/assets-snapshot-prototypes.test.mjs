import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,input,ok,error } from '../testing/asset-fixtures.mjs';
import { encodeCanonical } from '../asset-identity.mjs';

const malformed=[
  ['non-array with Array.prototype',value=>Object.assign(Object.create(Array.prototype),value)],
  ['non-array with a custom prototype',value=>Object.assign(Object.create({}),value)],
];
for(const [label,alter]of malformed)test(`K04 public asset snapshot rejects ${label} before authority callbacks`,t=>{
  const f=fixture(t),value=alter(input());let callbacks=0;f.trusted.state.authorizeHook=()=>{callbacks++;};
  assert.throws(()=>encodeCanonical(value),{code:'invalid_input'});
  error(f.call('importAssetVersion',value),'invalid_input');assert.equal(callbacks,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM assets').get().n,0);
});
for(const [label,prototype]of [['null',null],['Object.prototype',Object.prototype],['custom array',Object.create(Array.prototype)]])
  test(`K04 public derivative snapshot rejects ${label}-prototype arrays before authority callbacks`,t=>{
    const f=fixture(t),source=ok(f.call('importAssetVersion',input())),timecodes=Object.setPrototypeOf([],prototype);
    let callbacks=0;f.trusted.state.authorizeHook=()=>{callbacks++;};
    assert.throws(()=>encodeCanonical(timecodes),{code:'invalid_input'});
    error(f.call('createAssetDerivative',{actionId:'malformed',version:source.version,expectedVersionRevision:1,
      kind:'description',text:'Synthetic',method:{kind:'user-provided'},timecodes}),'invalid_input');
    assert.equal(callbacks,0);assert.equal(f.db.prepare('SELECT count(*) n FROM asset_derivatives').get().n,0);
  });
test('K04 canonical plain/null-prototype objects and normal arrays still pass public snapshotting',t=>{
  const f=fixture(t),source=ok(f.call('importAssetVersion',Object.assign(Object.create(null),input())));
  ok(f.call('createAssetDerivative',{actionId:'valid',version:source.version,expectedVersionRevision:1,
    kind:'description',text:'Synthetic',method:Object.assign(Object.create(null),{kind:'user-provided'})}));
  assert.doesNotThrow(()=>encodeCanonical([Object.create(null),{}]));
});

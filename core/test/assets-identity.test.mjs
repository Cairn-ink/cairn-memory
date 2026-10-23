import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeCanonical,createBinaryIdentity } from '../asset-identity.mjs';
const vectors=JSON.parse(readFileSync(new URL('../testing/asset-identity-vectors.json',import.meta.url),'utf8'));
const decode=value=>value&&typeof value==='object'&&Object.hasOwn(value,'$bytes')?Buffer.from(value.$bytes,'hex'):
  Array.isArray(value)?value.map(decode):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,decode(item)])):value;
test('K04 published canonical E and binary-content known answers; frozen vectors for every specified domain and the cursor purpose',()=>{
  assert.equal(encodeCanonical(Uint8Array.of(1,2)).toString('hex'),'0500000000000000020102');
  const mac=createBinaryIdentity(vectors.identity);
  for(const vector of vectors.values) {
    const fields=decode(vector.fields);
    assert.equal(encodeCanonical([vector.domain,vectors.identity.storeId,...fields]).toString('hex'),vector.encoding,vector.domain);
    assert.equal(mac(vector.domain,fields),vector.mac,vector.domain);
  }
  const action=vectors.values.find(value=>value.domain==='binary-action-v1');
  assert.equal(action.encoding.split('050000000000000008255044462d312e37').length-1,1,'action encoding contains its byte leaf exactly once');
  assert.equal(vectors.values[0].mac,'qvUt2CJYzxoVvrN-yax7kWA8AqUJwyOr6JyTVXWWd4o');
});
test('K04 canonical strings and keys are exact UTF-8, object order is UTF-8 order, arrays and offset views retain their order',()=>{
  const mac=createBinaryIdentity(vectors.identity),namespace=['owner','personal',null],base=[namespace,'application/pdf'];
  const buffer=Uint8Array.of(9,1,2,9),view=new Uint8Array(buffer.buffer,1,2);
  assert.deepEqual(encodeCanonical(view),encodeCanonical(Uint8Array.of(1,2)));
  assert.deepEqual(encodeCanonical({b:1,a:2}),encodeCanonical({a:2,b:1}));
  assert.notDeepEqual(encodeCanonical([1,2]),encodeCanonical([2,1]));
  assert.notDeepEqual(encodeCanonical('é'),encodeCanonical('e\u0301'));
  assert.deepEqual(encodeCanonical(-0),encodeCanonical(0));
  assert.notEqual(mac('binary-content-v1',[...base,view]),mac('binary-content-v1',[['owner','project','p'],'application/pdf',view]));
  assert.notEqual(mac('binary-content-v1',[...base,view]),mac('binary-content-v1',[...base,buffer]));
  assert.equal(encodeCanonical({'\u{10000}':1,'\uE000':2}).toString('hex'),vectors.utf8KeyOrder);
});
test('K04 E rejects undefined, proxies, accessors, malformed strings/keys, symbols, nonfinite numbers, prototypes, sparse/extra arrays and cycles',()=>{
  const values=[undefined,NaN,Infinity,1n,()=>{},new Date(),new Map(),new Proxy({},{}),'\uD800',{'\uDFFF':1},
    {[Symbol('x')]:1},Object.create({x:1}),[1,,2],Object.assign([1],{extra:2}),Object.defineProperty({},'x',{get(){throw Error('must not call');}})];
  const cycle={};cycle.self=cycle;values.push(cycle);
  const bytes=new Uint8Array(new SharedArrayBuffer(8));values.push(bytes);
  const detached=new Uint8Array(4);structuredClone(detached,{transfer:[detached.buffer]});values.push(detached);
  for(const value of values)assert.throws(()=>encodeCanonical(value),{code:'invalid_input'});
  let reads=0;assert.throws(()=>encodeCanonical(Object.defineProperty({},'x',{get(){reads++;return 1;}})),{code:'invalid_input'});assert.equal(reads,0);
});

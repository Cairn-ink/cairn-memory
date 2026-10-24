import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { encodeTaskReceipt,parseTaskReceipt,canonicalJSON } from '../task-receipt.mjs';
import { ns,project } from './role-fixture.mjs';
const identity={storeId:'store',cursorSecret:'0'.repeat(64)};
export const H=n=>createHash('sha256').update(String(n)).digest('base64url');
export const I=n=>{const h=createHash('sha256').update(String(n)).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;};
export const payload=(n=1)=>({id:I(3),readSet:[ns,project],roleKey:'finance',profiles:[[0,I(1),I(2),H(2),1]],heads:[[1,null,null,null,null],[0,I(1),1,'active',0]],methods:Array.from({length:n},(_,i)=>[0,I(10+i),'current',[I(100+i),H(100+i)],3,[[0,null,null],[1,null,null],[2,null,null],[3,1,'active']],[2,'available',1,'available']]),evidence:[]});
test('C03 frozen task-receipt-v1 full MAC and canonical UTF-8 byte vector',()=>{
  const receipt=encodeTaskReceipt(identity,payload());
  const expected='{"mac":"QFQHTj6upi2DU4RJ1URmmP3HCzlYlcIhtdWTv5TmVA8","p":{"evidence":[],"heads":[[1,null,null,null,null],[0,"6b86b273-ff34-4ce1-8d6b-804eff5a3f57",1,"active",0]],"id":"4e074085-62be-4b8b-80ce-05c1decfe3ad","methods":[[0,"4a44dc15-3642-44a8-8fe8-0e9039455cc1","current",["ad573668-6512-4e55-849e-cb23ae1d4888","rVc2aGUSblVknssjrh1IiHVEl27-pGpI612Fpu600wY"],3,[[0,null,null],[1,null,null],[2,null,null],[3,1,"active"]],[2,"available",1,"available"]]],"profiles":[[0,"6b86b273-ff34-4ce1-8d6b-804eff5a3f57","d4735e3a-265e-46ee-803f-59718b9b5d03","1HNeOiZeFu7gP1lxi5tdAwGcB9i2xR-Q2jpmbuwTqzU",1]],"readSet":[{"ownerId":"owner","projectId":null,"scope":"personal"},{"ownerId":"owner","projectId":"project","scope":"project"}],"roleKey":"finance"},"v":"task-receipt-v1"}';
  assert.deepEqual(Buffer.from(receipt),Buffer.from(expected));
  assert.equal(Buffer.byteLength(receipt),763);
  assert.equal(JSON.parse(receipt).mac,'QFQHTj6upi2DU4RJ1URmmP3HCzlYlcIhtdWTv5TmVA8');
  assert.deepEqual(parseTaskReceipt(identity,receipt),payload());
  assert.equal(canonicalJSON(JSON.parse(receipt)),receipt);
});
test('C03 bounded preflight rejects duplicate/escaped keys, depth, nodes, malformed and foreign MAC before lookup',()=>{
  const receipt=encodeTaskReceipt(identity,payload());
  for(const text of ['',receipt+' ',receipt.replace('finance','financf'),receipt.replace('"mac":','"mac":"x","mac":'),'{"a":0,"\\u0061":1}', '['.repeat(13)+']'.repeat(13),'['+'0,'.repeat(8192)+'0]', ' '.repeat(32769),receipt.replace('finance','x'.repeat(201)),receipt.replace('finance','\\ud800')])assert.throws(()=>parseTaskReceipt(identity,text),{code:'invalid_receipt'});
  assert.throws(()=>parseTaskReceipt({...identity,storeId:'foreign'},receipt),{code:'invalid_receipt'});
  assert.throws(()=>parseTaskReceipt({...identity,cursorSecret:'1'.repeat(64)},receipt),{code:'invalid_receipt'});
});
test('C03 closed tuples validate indices, lifecycle, prefixes and source aliases before authentication',()=>{
  const mutations=[p=>p.extra=1,p=>p.heads[1][4]=20,p=>p.methods[0][5][0][0]=1,p=>p.methods[0][6][2]=2,p=>p.methods[0][3]=null,p=>p.profiles.push(p.profiles[0]),p=>p.methods.push(p.methods[0]),p=>p.readSet.reverse()];
  for(const mutate of mutations){const p=payload();mutate(p);assert.throws(()=>encodeTaskReceipt(identity,p),{code:'invalid_receipt'});}
  const p=payload();p.evidence=[[[0,0,I(200),1],H(200),[[0,I(201),H(201),null]]],[[0,0,I(202),1],H(202),[[0,I(203),H(203),[0,0]]]]];
  assert.deepEqual(parseTaskReceipt(identity,encodeTaskReceipt(identity,p)),p);
  p.evidence[0][2][0][3]='body';assert.throws(()=>encodeTaskReceipt(identity,p),{code:'invalid_receipt'});
});
test('C03/C07 inaccessible-package Namespace arm never expands receipt read authority',()=>{
  const p=payload();p.readSet=[project];p.profiles=[[0,I(1),I(2),H(2),1]];p.heads=[[0,I(1),1,'active',0]];
  p.methods=[[ns,I(10),'unavailable',null,0,[[0,1,'active']],null]];
  assert.deepEqual(parseTaskReceipt(identity,encodeTaskReceipt(identity,p)),p);
  p.methods[0][6]=[1,'available',null,null];assert.throws(()=>encodeTaskReceipt(identity,p),{code:'invalid_receipt'});
});

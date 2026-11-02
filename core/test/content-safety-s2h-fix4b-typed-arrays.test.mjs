import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { inertContentPortValue } from '../content-safety-boundary.mjs';
import { contextBudget } from '../context-read-budget.mjs';

const kinds=[Int8Array,Uint8Array,Uint8ClampedArray,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array,BigInt64Array,BigUint64Array];
if(globalThis.Float16Array)kinds.push(globalThis.Float16Array);
for(const Type of kinds)test(`fix4b inert copy preserves ${Type.name} type, length, values and independent storage`,()=>{
 const input=new Type(Type===BigInt64Array||Type===BigUint64Array?[1n,2n,3n]:[1,2,3]),output=inertContentPortValue([input]);
 assert.equal(Object.getPrototypeOf(output[0]),Type.prototype);assert.equal(output[0].length,3);assert.deepEqual([...output[0]],[...input]);assert.notEqual(output[0],input);assert.notEqual(output[0].buffer,input.buffer);
 input[0]=Type===BigInt64Array||Type===BigUint64Array?9n:9;assert.equal(output[0][0],Type===BigInt64Array||Type===BigUint64Array?1n:1);
});
for(const Type of [Float32Array,Float64Array])test(`fix4b ${Type.name} copy never consults caller constructor, iterator or shadowed length`,()=>{
 let hooks=0;const input=new Type([.25,.5]);
 Object.defineProperties(input,{constructor:{value(){hooks++;throw Error('synthetic');}},length:{value:99},[Symbol.iterator]:{value(){hooks++;throw Error('synthetic');}}});
 const output=inertContentPortValue(input);assert.equal(Object.getPrototypeOf(output),Type.prototype);assert.equal(output.length,2);assert.deepEqual([...output],[.25,.5]);assert.equal(hooks,0);
});
for(const shape of ['subclass','proxy','accessor'])test(`fix4b embedding vector ${shape} refuses without invoking caller hooks`,async()=>{
 let hooks=0;let vector=new Float32Array([1,0]);
 if(shape==='subclass')vector=new(class extends Float32Array{})([1,0]);
 if(shape==='proxy')vector=new Proxy(vector,{get(){hooks++;throw Error('synthetic');},getPrototypeOf(){hooks++;throw Error('synthetic');},ownKeys(){hooks++;throw Error('synthetic');}});
 if(shape==='accessor')Object.defineProperty(vector,'length',{get(){hooks++;return 2;}});
 const embedder={id:'fix4b-'+shape,revision:'1',dimensions:2,normalization:'l2',embed:async()=>[vector]};
 const dispatch=contextBudget({budgetConfigured:true,embedder,policy:{family:'hosted',maxRequests:100,maxUsd:1,maxConcurrent:1,estimateUsd:()=>0}});
 await assert.rejects(dispatch(embedder,['synthetic'],{signal:new AbortController().signal,deadlineAt:performance.now()+5000,guard(){}}),{code:'provider_error'});assert.equal(hooks,0);
});
for(const Type of [Float32Array,Float64Array])test(`fix4b hosted budget retains adapter ${Type.name} vectors`,async()=>{
 const vector=new Type([1,0]),embedder={id:'fix4b-hosted-'+Type.name,revision:'1',dimensions:2,normalization:'l2',embed:async()=>[vector]};
 const dispatch=contextBudget({budgetConfigured:true,embedder,policy:{family:'hosted',maxRequests:100,maxUsd:1,maxConcurrent:1,estimateUsd:()=>0}});
 const output=await dispatch(embedder,['synthetic'],{signal:new AbortController().signal,deadlineAt:performance.now()+5000,guard(){}});
 assert.equal(Object.getPrototypeOf(output[0]),Type.prototype);assert.equal(output[0].length,2);assert.deepEqual([...output[0]],[1,0]);assert.notEqual(output[0].buffer,vector.buffer);
});
test('fix4b 3,000,000 copy bound admits 64 maximum-dimensional vectors and refuses an oversized return',()=>{
 const vectors=Array.from({length:64},()=>new Float32Array(32768));for(const v of vectors)v[0]=1;
 const output=inertContentPortValue(vectors,'provider_error',{rejectProxies:true});assert.equal(output.length,64);assert.equal(output.reduce((n,v)=>n+v.length,0),2097152);assert.ok(output.every(v=>v instanceof Float32Array&&v.length===32768&&v[0]===1));
 assert.throws(()=>inertContentPortValue([...vectors,...vectors.slice(0,28)],'provider_error',{rejectProxies:true}),{code:'provider_error'});
});

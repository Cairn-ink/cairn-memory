import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEmbedder, validateEmbedderMetadata, validateVector, encodeVector, loadVector, createFakeEmbedder, cosine, semanticCapacity } from '../context-read-embedder.mjs';
const metadata = { id:'synthetic',revision:'1',dimensions:2,normalization:'none' };

test('R04 metadata bounds reject dimensions before allocation', () => {
  for (const patch of [{dimensions:0},{dimensions:32769},{dimensions:1.2},{dimensions:Infinity},{id:''},{revision:'x'.repeat(201)},
    {id:'\uD800'},{id:'x\0'},{normalization:'unit'}]) assert.throws(()=>validateEmbedderMetadata({...metadata,...patch}),{code:'invalid_input'});
  assert.throws(()=>validateEmbedder(metadata),{code:'invalid_input'});
  assert.throws(()=>validateVector({get length(){throw Error('allocation_touched');}}, {...metadata,dimensions:1e12}),{code:'invalid_input'});
});
test('R04 fp32 conversion precedes finite/norm validation; overflow, underflow and declared l2', () => {
  for (const vector of [[Number.MAX_VALUE,1],[1e-50,1e-50],[NaN,1],[Infinity,1],[0,0],['1',0],[,1]])
    assert.throws(()=>validateVector(vector,metadata),{code:'invalid_vector'});
  assert.throws(()=>validateVector([1],metadata),{code:'dimension_mismatch'});
  assert.equal(validateVector([.1,.2],metadata)[0],Math.fround(.1));
  assert.ok(validateVector([1e-40,0],metadata)[0]>0, 'nonzero fp32 subnormal is valid');
  const l2={...metadata,normalization:'l2'};
  assert.throws(()=>validateVector([1.00002,0],l2),{code:'invalid_vector'});
  assert.deepEqual([...validateVector([1+1e-8,0],l2)],[1,0]);
  assert.throws(()=>validateVector([3,4],l2),{code:'invalid_vector'});
});
test('R04 persisted little-endian float32 validation repeats on load, including corrupt finite/norm', () => {
  const vector=[.6,.8], l2={...metadata,normalization:'l2'};
  assert.deepEqual([...loadVector(encodeVector(vector,l2),l2)],[...Float32Array.from(vector)]);
  for (const values of [[Infinity,1],[NaN,1],[0,0],[2,0]]) {
    const bytes=Buffer.alloc(8);values.forEach((value,i)=>bytes.writeFloatLE(value,i*4));
    assert.throws(()=>loadVector(bytes,l2),{code:'invalid_vector'});
  }
  assert.throws(()=>loadVector(Buffer.alloc(7),l2),{code:'dimension_mismatch'});
});
test('R04 deterministic fake preserves input ordering, cancellation and synthetic paraphrases', async () => {
  const fake=createFakeEmbedder({aliases:{automobile:'car'}}), texts=['car','automobile','tea'];
  const vectors=await fake.embed(texts), repeated=await fake.embed(texts);
  assert.deepEqual(vectors,repeated);
  assert.equal(cosine(vectors[0],vectors[1]),1);
  assert.ok(cosine(vectors[0],vectors[2])<1);
  assert.equal(cosine(new Float32Array([2,0]),new Float32Array([-3,0])),-1);
  await assert.rejects(fake.embed(texts,{signal:AbortSignal.abort()}),{name:'AbortError'});
});
test('R04 exact cosine vector and resident fp32 capacity preflight boundaries', () => {
  assert.equal(semanticCapacity(20000, { ...metadata, dimensions: 1 }).eligible, true);
  assert.equal(semanticCapacity(20001, { ...metadata, dimensions: 1 }).eligible, false);
  assert.deepEqual(semanticCapacity(1024, { ...metadata, dimensions: 32768 }), { eligible: true, bytes: 134217728 });
  assert.equal(semanticCapacity(1025, { ...metadata, dimensions: 32768 }).eligible, false);
});

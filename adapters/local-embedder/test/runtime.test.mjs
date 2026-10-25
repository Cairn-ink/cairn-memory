import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntime, poolCLS } from '../runtime.mjs';
import { MODEL } from '../common.mjs';
function tiny() {
  let calls = 0; const observed = [];
  const model = async tokens => { calls++; const length = tokens.input_ids.data.length, data = new Float32Array(length * 1024); data[0] = 3; data[1] = 4; if (length > 1) data[1024] = 99; return { last_hidden_state: { dims: [1, length, 1024], data } }; };
  const loader = async () => ({ env: {}, AutoTokenizer: { async from_pretrained(...args) { observed.push(args); return (text, options) => { observed.push([text, options]); const count = Array.from(text).length + 2; return { input_ids: { dims: [1, count], data: new BigInt64Array(count) } }; }; } }, AutoModel: { async from_pretrained(...args) { observed.push(args); return model; } } });
  return { loader, observed, get calls() { return calls; } };
}
test('L06 independent CLS oracle, empty prefix, order, exact special-token 8192/8193 bound and Unicode', async () => {
  const f = tiny(), runtime = await loadRuntime({ packPath: '/fixture', manifest: { model: MODEL } }, 4, f.loader);
  const result = await runtime.embed(['中'.repeat(8190)]);
  assert.equal(result.vectors[0].length, 1024); assert.equal(result.tokenCounts[0], 8192);
  assert.ok(Math.abs(result.vectors[0][0] - .6) < 1e-6); assert.ok(Math.abs(result.vectors[0][1] - .8) < 1e-6);
  assert.equal(result.vectors[0][2], 0); assert.equal(f.calls, 1);
  await assert.rejects(runtime.embed(['😀'.repeat(8191)]), { code: 'context_item_too_large' }); assert.equal(f.calls, 1);
  await runtime.embed(['second']); assert.equal(f.calls, 2);
  const [text, options] = f.observed.at(-1); assert.equal(text, 'second'); assert.deepEqual(options, { add_special_tokens: true, truncation: false, padding: false });
  assert.equal(f.observed[1][1].device, 'cpu'); assert.equal(f.observed[1][1].dtype, 'fp32');
});
test('L06 rejects malformed/nonfinite/float32 overflow/underflow/zero and wrong dimensions', () => {
  for (const n of [NaN, Infinity, 1e100, 1e-100, 0]) { const data = Array(1024).fill(0); data[0] = n; assert.throws(() => poolCLS({ dims: [1, 1, 1024], data })); }
  for (const dims of [[1, 1, 1023], [2, 1, 1024], [1, 0, 1024]]) assert.throws(() => poolCLS({ dims, data: [] }), { code: 'dimension_mismatch' });
});

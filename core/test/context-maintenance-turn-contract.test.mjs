import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

test('maintenance contract retains its earlier bytes and appends the exact clarification',()=>{
  const bytes=readFileSync(new URL('../../docs/plans/context-read-maintenance-turn.md',import.meta.url));
  const hash=value=>createHash('sha256').update(value).digest('hex');
  assert.equal(hash(bytes.subarray(0,27937)),'7f2c4e5d8adc85263d1449443b55749f02f807312ac0f179d1addfcf08433a51','earlier text stays byte-identical');
  assert.equal(bytes[27937],10,'append separator');
  assert.equal(bytes.length,27937+1+3024);
  assert.equal(hash(bytes.subarray(27938)),'57bb02273d0f820648c73a7d91dd7beee546189a3b9ac99cfeff8b9d4665815e','exact clarification bytes');
});

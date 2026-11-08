import test from 'node:test';
import assert from 'node:assert/strict';
import {sharedOverlapMs} from '../../tools/testing/raw-search-writer-observer.mjs';

test('writer overlap clips to the commit and counts concurrent reader intervals once',()=>{
  assert.equal(sharedOverlapMs('1000000','6000000',[[0n,2000000n],[1500000n,4000000n],[5000000n,9000000n]]),4);
  assert.equal(sharedOverlapMs('1000000','6000000',[[6000000n,9000000n]]),0);
});

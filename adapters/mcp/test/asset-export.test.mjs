import test from 'node:test';
import { exportCases } from './asset-export-cases.mjs';
test('L04 export syscall publication and recovery matrix',{timeout:120000},async t=>{
  await exportCases(t.test.bind(t));
});

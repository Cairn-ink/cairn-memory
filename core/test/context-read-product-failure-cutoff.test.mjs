import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../testing/context-product-cutoff-fixture.mjs';
import { maintenancePumpDiagnostic,maintenancePumpPhaseDiagnostic } from '../context-product-pump.mjs';

test('failure cause: disposal proof failure retains cutoff policy and records its cause',async t=>{
  const s=setup(t,{termination:()=>Promise.reject(new Error('private termination text'))}),p=s.create();await s.step();const final=await p.completion;
  assert.equal(final.error,'reader_failed','disposal public error precedence equals the base');
  const record=maintenancePumpDiagnostic(final).lastFailure;
  assert.equal(record?.cause,'disposal_proof','disposal proof private cause');
  assert.equal(record.ordinal,s.calls[0].maintenanceOrdinal);assert.equal(record.stage,'disposal');
  assert.equal(maintenancePumpPhaseDiagnostic(final).projections[0].failureCounts.disposal_proof,1);
});

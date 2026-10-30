import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../testing/context-product-cutoff-fixture.mjs';
import { maintenancePumpDiagnostic,maintenancePumpPhaseDiagnostic } from '../context-product-pump.mjs';

test('K1 cutoff disposal failure preserves its initiator through proof propagation',async t=>{
  const s=setup(t,{termination:()=>Promise.reject(new Error('private termination text'))}),p=s.create();await s.step();const final=await p.completion;
  assert.equal(final.error,'reader_failed','disposal public error precedence equals the base');
  const diagnostic=maintenancePumpDiagnostic(final),record=diagnostic.secondaryFailure;
  assert.equal(diagnostic.lastFailure.cause,'engine','cutoff remains the primary failure');
  assert.equal(diagnostic.lastFailure.engineCode,'read_timeout');
  assert.equal(record?.cause,'cleanup','disposal propagation records the physical close failure once');
  assert.equal(diagnostic.lastFailure.ordinal,s.calls[0].maintenanceOrdinal);assert.equal(record.stage,'close');assert.equal(record.number,0);
  assert.equal(diagnostic.secondaryFailureCounts.engine,0,'reader cutoff propagation is not a secondary failure');
  assert.equal(diagnostic.secondaryFailureCounts.disposal_proof,0,'close rejection is not counted again as a proof failure');
  assert.equal(maintenancePumpPhaseDiagnostic(final).projections[0].secondaryFailureCounts.cleanup,1);
});

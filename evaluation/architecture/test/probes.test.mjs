import assert from 'node:assert/strict';
import test from 'node:test';
import { compileDecisionBasis } from '../../../core/source-basis.mjs';
import { boundaryProbes, inspectProposal, runBoundaryProbes } from '../probes.mjs';

test('diagnostic records semantic counterexamples, not a successful quality score', () => {
  const report = runBoundaryProbes();
  assert.equal(report.kind, 'handcrafted-compiler-diagnostic');
  assert.equal(report.modelCalls, 0);
  assert.equal(report.semanticAccuracy, 'not-measured');
  assert.equal(report.observations.length, 11);
  assert.equal(report.unsupportedAccepted, 4);
  assert.deepEqual(report, runBoundaryProbes());
  for (const item of report.observations.filter(item => item.compilerOutcome === 'accepted')) {
    assert.ok(item.units.every(unit => unit.interpretationStatus === 'model-proposed'));
    assert.ok(item.links.every(link => link.interpretationStatus === 'model-proposed'));
  }
});

for (const name of ['actor', 'scope', 'history', 'reaffirmation']) {
  test(`${name}: paired proposals have identical quotes/sources; current compiler accepts both`, () => {
    const [supported, unsupported] = boundaryProbes().filter(probe => probe.id.startsWith(`${name}/`));
    assert.deepEqual(supported.sources, unsupported.sources);
    assert.deepEqual(supported.proposal.units, unsupported.proposal.units);
    assert.notDeepEqual(supported.proposal.links, unsupported.proposal.links);
    assert.equal(inspectProposal(supported).compilerOutcome, 'accepted');
    assert.equal(inspectProposal(unsupported).compilerOutcome, 'accepted');
  });
}

test('capacity: each chain compiles separately; all three together exceed the unit bound', () => {
  const probes = boundaryProbes();
  const two = probes.find(probe => probe.id === 'capacity/two-chains');
  const three = probes.find(probe => probe.id === 'capacity/three-chains');
  assert.equal(inspectProposal(two).compilerOutcome, 'accepted');
  assert.equal(three.proposal.units.length, 9);
  assert.equal(inspectProposal(three).compilerOutcome, 'rejected');
  assert.equal(inspectProposal(three).errorCode, 'invalid_input');
  for (let chain = 0; chain < 3; chain++) {
    const offset = chain * 3;
    const proposal = { units: three.proposal.units.slice(offset, offset + 3),
      links: three.proposal.links.slice(chain * 2, chain * 2 + 2)
        .map(link => ({ ...link, from: link.from - offset, to: link.to - offset })) };
    assert.equal(compileDecisionBasis(proposal, three.sources).units.length, 3);
  }
});

test('invalid quote is a real compiler rejection; unrelated failures are not swallowed', () => {
  const probe = boundaryProbes().find(item => item.id === 'control/fabricated-quote');
  assert.equal(inspectProposal(probe).errorCode, 'invalid_model_output');
  const failure = new Error('unexpected diagnostic failure');
  assert.throws(() => inspectProposal(probe, () => { throw failure; }), error => error === failure);
});

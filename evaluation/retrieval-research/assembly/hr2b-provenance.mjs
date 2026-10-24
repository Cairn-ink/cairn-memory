import { deriveHR2bEvidence } from './hr2b-evidence.mjs';
import { HR2B, validateHR2bSnapshot } from './hr2b-profile.mjs';
import { prepareItems } from './units.mjs';
import { ARMS, assemble } from './arms.mjs';
import { COUNTER_ID } from './counter.mjs';
import { authenticateHostRun } from './host-v2.mjs';
import { validateImplementation } from './identity.mjs';
import { CATEGORIES, compareIds } from '../lib/fixture.mjs';
import { equal } from '../lib/hr2b-configuration.mjs';
import { fail } from './auth.mjs';

export function validateHR2bRun(run) {
  if (!run || run.status !== 'complete' || run.protocol !== HR2B.protocol || run.protocolCommit !== HR2B.protocolCommit ||
      run.fixtureVersion !== HR2B.version || !HR2B.budgets.includes(run.budget) || !HR2B.rankings.includes(run.ranking) ||
      run.counter !== COUNTER_ID || !ARMS.includes(run.arm) || !['dev', 'test'].includes(run.split) || run.scale !== 'S1000' ||
      ![0, 'host-v2'].includes(run.overhead)) fail('invalid_hr2b_cell_run');
  if (run.overhead === 'host-v2') authenticateHostRun(run);
  else if (['overheadModel', 'overheadModelDigest', 'extensionCommit'].some(key => Object.hasOwn(run, key))) fail('invalid_hr2b_cost_model');
  validateImplementation(run.implementation?.assembly);
  if (run.commit !== run.implementation.assembly.commit) fail('invalid_assembly_commit');
  return validateHR2bSnapshot(run);
}
export function validateHR2bScoredCell(cell, replay) {
  const run = cell?.run;
  if (cell?.format !== 'hr2-scored-cell-v1' || cell.ok !== true) fail('invalid_hr2b_scored_cell');
  const authenticated = validateHR2bRun(run); validateImplementation(run.implementation?.scorer);
  if (!equal(run.expectedQueryIds, authenticated.expectedQueryIds)) fail('incomplete_comparison_queries');
  for (const row of cell.queries ?? []) if (!equal(row.ranked, authenticated.ranking.queries[row.id]?.ranked)) fail('cell_ranking_changed');
  if (!Array.isArray(run.expectedQueryIds) || !run.expectedQueryIds.length || !Array.isArray(cell.queries) ||
      new Set(cell.queries.map(row => row.id)).size !== cell.queries.length ||
      !equal(cell.queries.map(row => row.id).sort(compareIds), [...run.expectedQueryIds].sort(compareIds))) fail('incomplete_comparison_queries');
  const items = prepareItems(authenticated.corpus.memories);
  const rankedIds = new Set(cell.queries.flatMap(row => row.ranked));
  if (!equal(cell.assemblyItems, items.filter(item => rankedIds.has(item.id)))) fail('hr2b_corpus_items_mismatch');
  if (run.overhead === 'host-v2') replay(cell, authenticateHostRun(run, { scored: true }));
  else {
    for (const row of cell.queries) {
      const expected = assemble(items, row.ranked, { arm: run.arm, budget: run.budget, overhead: 0, diagnostics: true });
      if (expected.used !== row.used || !equal(expected.admitted, row.admitted) || expected.budgetRejected !== row.budgetRejected || expected.bodyEqualSpanCount !== row.bodyEqualSpanCount) fail('hr2b_scalar_replay_mismatch');
    }
    if (cell.budgetRejectedQueryCount !== cell.queries.filter(row => row.budgetRejected).length) fail('invalid_hr2b_pressure_diagnostics');
  }
  const expectedEvidence = deriveHR2bEvidence(authenticated, cell.queries, run);
  if (!equal(cell.queries, expectedEvidence.queries) || !equal(cell.summary, expectedEvidence.summary) || !equal(cell.strata, expectedEvidence.strata)) fail('hr2b_evidence_mismatch');
  const categories = run.protocolProfile.placement.guardCategories;
  if (!categories.length || categories.some(category => !CATEGORIES.includes(category))) fail('hr2b_guard_categories');
  for (const placement of ['body', 'first-receipt', 'later-receipt']) {
    const stratum = cell.strata?.[`placement:${placement}`];
    if (!stratum || !Array.isArray(stratum.queries)) fail('hr2b_placement_strata_missing');
    if (placement === 'later-receipt') {
      const represented = stratum.representedCategories;
      // The frozen union is descriptive. A category may contribute zero rows
      // in this split; authenticate actual membership without imposing a floor.
      const expected = categories.filter(category => authenticated.labels.queries.some(label =>
        !label.dropped && label.split === run.split && label.category === category && label.groups.some(group => group.placement === placement)));
      if (!equal(represented, expected)) fail('hr2b_guard_category_set');
    }
  }
}

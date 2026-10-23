import { readFileSync } from 'node:fs';
import { PROTOCOL, PROTOCOL_COMMIT, RANKINGS, FILES, fail } from './auth.mjs';
import { COUNTER_ID } from './counter.mjs';
import { ARMS } from './arms.mjs';
import { BUDGETS } from './grid.mjs';
import { validateImplementation } from './identity.mjs';
import { compareIds } from '../lib/fixture.mjs';

export const FROZEN_INPUTS = JSON.parse(readFileSync(new URL('./INPUTS.md', import.meta.url), 'utf8').match(/```json\n([\s\S]*?)\n```/)[1]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const entries = object => Object.entries(object ?? {}).sort(([a], [b]) => compareIds(a, b));
export function validateScoredCell(cell) {
  const run = cell?.run, ranking = RANKINGS[run?.ranking];
  if (cell?.format !== 'hr2-scored-cell-v1' || cell.ok !== true || !run || run.status !== 'complete' ||
      run.protocol !== PROTOCOL || run.protocolCommit !== PROTOCOL_COMMIT || run.counter !== COUNTER_ID ||
      !['test', 'dev'].includes(run.split) || run.scale !== 'S1000' || !ranking || !ARMS.includes(run.arm) ||
      !BUDGETS.includes(run.budget) || ![0, 8].includes(run.overhead)) fail('invalid_scored_cell_provenance');
  if (!same(Object.keys(run.fixtureHashes ?? {}).sort(compareIds), [...FILES].sort(compareIds)) ||
      Object.values(run.fixtureHashes).some(hash => !/^[a-f0-9]{64}$/.test(hash))) fail('invalid_scored_fixture_hashes');
  if (!/^[a-f0-9]{64}$/.test(run.rankingHash ?? '') || run.rankingMember !== (run.split === 'test' ? ranking.member : ranking.dev)) fail('invalid_scored_ranking_hash');
  if (run.split === 'test' && (run.rankingHash !== FROZEN_INPUTS.members[ranking.member] || !same(entries(run.fixtureHashes), entries(FROZEN_INPUTS.fixtureHashes)))) fail('invalid_frozen_provenance');
  const source = run.rankingRun;
  if (!source || source.status !== 'complete' || source.split !== run.split || source.scale !== run.scale || source.store != null ||
      ['arm', 'config', 'model', 'lexical'].some(key => source[key] !== ranking[key]) || !same(entries(source.fixtureHashes), entries(run.fixtureHashes))) fail('invalid_ranking_run_provenance');
  validateImplementation(run.implementation?.assembly); validateImplementation(run.implementation?.scorer);
  if (run.commit !== run.implementation.assembly.commit) fail('invalid_assembly_commit');
  if (!Array.isArray(run.expectedQueryIds) || !run.expectedQueryIds.length || run.expectedQueryIds.some(id => typeof id !== 'string') ||
      new Set(run.expectedQueryIds).size !== run.expectedQueryIds.length || !Array.isArray(cell.queries) ||
      !same(cell.queries.map(row => row.id).sort(compareIds), [...run.expectedQueryIds].sort(compareIds))) fail('incomplete_comparison_queries');
}

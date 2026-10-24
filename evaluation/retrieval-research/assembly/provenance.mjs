import { readFileSync } from 'node:fs';
import { PROTOCOL, PROTOCOL_COMMIT, RANKINGS, FILES, fail } from './auth.mjs';
import { COUNTER_ID, countTokens } from './counter.mjs';
import { ARMS, assemble } from './arms.mjs';
import { authenticateHostRun } from './host-v2.mjs';
import { BUDGETS } from './grid.mjs';
import { validateImplementation } from './identity.mjs';
import { compareIds } from '../lib/fixture.mjs';

export const FROZEN_INPUTS = JSON.parse(readFileSync(new URL('./INPUTS.md', import.meta.url), 'utf8').match(/```json\n([\s\S]*?)\n```/)[1]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const entries = object => Object.entries(object ?? {}).sort(([a], [b]) => compareIds(a, b));
export function validateScoredCell(cell) {
  const run = cell?.run, ranking = RANKINGS[run?.ranking];
  const host = run?.overhead === 'host-v2';
  const cost = host ? authenticateHostRun(run, { scored: true }) : null;
  if (cell?.format !== 'hr2-scored-cell-v1' || cell.ok !== true || !run || run.status !== 'complete' ||
      run.protocol !== PROTOCOL || run.protocolCommit !== PROTOCOL_COMMIT || run.counter !== COUNTER_ID ||
      !['test', 'dev'].includes(run.split) || run.scale !== 'S1000' || !ranking || !ARMS.includes(run.arm) ||
      !BUDGETS.includes(run.budget) || (!host && ![0, 8].includes(run.overhead)) ||
      (!host && ['overheadModel', 'overheadModelDigest', 'extensionCommit'].some(key => Object.hasOwn(run, key)))) fail('invalid_scored_cell_provenance');
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
  if (host) validateHostReplay(cell, cost);
}

function validateHostReplay(cell, cost) {
  const items = cell.assemblyItems;
  if (!Array.isArray(items) || items.some(item => !item || typeof item !== 'object') ||
      new Set(items.map(item => item.id)).size !== items.length) fail('invalid_host_v2_cost_inputs');
  const byId = new Map(items.map(item => [item.id, item])), unitIds = new Set();
  for (const item of items) {
    if (typeof item.id !== 'string' || !item.body || item.body.id !== `${item.id}#body` || !Array.isArray(item.spans)) fail('invalid_host_v2_cost_inputs');
    for (const unit of [item.body, ...item.spans]) {
      if (!unit || typeof unit.id !== 'string' || unitIds.has(unit.id) || typeof unit.text !== 'string' || unit.tokens !== countTokens(unit.text)) fail('invalid_host_v2_cost_inputs');
      unitIds.add(unit.id);
    }
  }
  let bodyEqualSpanCount = 0, rankedBodyEqualSpanCount = 0, budgetRejectedQueryCount = 0;
  const rankedIds = new Set();
  for (const row of cell.queries) {
    if (!Array.isArray(row.ranked) || row.ranked.length > 24 || row.ranked.some(id => !byId.has(id))) fail('invalid_host_v2_cost_inputs');
    row.ranked.forEach(id => rankedIds.add(id));
    const replay = assemble(items, row.ranked, { arm: cell.run.arm, budget: cell.run.budget, cost });
    if (replay.used !== row.used || !same(replay.admitted, row.admitted) || replay.budgetRejected !== row.budgetRejected ||
        replay.bodyEqualSpanCount !== row.bodyEqualSpanCount) fail(`cell_assembly_replay_mismatch:${row.id}`);
    bodyEqualSpanCount += replay.bodyEqualSpanCount;
    budgetRejectedQueryCount += Number(replay.budgetRejected);
    rankedBodyEqualSpanCount += row.ranked.reduce((sum, id) => sum + byId.get(id).spans.filter(span => span.text === byId.get(id).body.text).length, 0);
  }
  if (rankedIds.size !== items.length || bodyEqualSpanCount !== cell.bodyEqualSpanCount || rankedBodyEqualSpanCount !== cell.rankedBodyEqualSpanCount ||
      budgetRejectedQueryCount !== cell.budgetRejectedQueryCount) fail('invalid_host_v2_diagnostics');
}

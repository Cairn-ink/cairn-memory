import { createHash } from 'node:crypto';

import { prepareMixedSourceCase } from '../longmemeval/mixed-source.mjs';
import { armOrders, sourceCases } from './source-cases.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

/** Source-only fixture inspection. Native descriptors and paid preparation belong to the coordinator. */
export function inspectInstalledPhaseSources() {
  if (sourceCases.length !== 2 || armOrders.length !== 2
    || JSON.stringify(armOrders) !== JSON.stringify([['cairn', 'mem0'], ['mem0', 'cairn']])) {
    throw new Error('invalid_installed_phase_fixture');
  }
  const cases = sourceCases.map(row => {
    const plan = prepareMixedSourceCase(row, 'indexed-evidence-v1');
    const lengths = row.history.sessions.flatMap(session => session.turns.map(turn => turn.content.length));
    const perSessionBatches = row.history.sessions.map((_, index) => plan.cairnPlan.batches
      .filter(batch => batch.source.sessionIndex === index).length);
    if (plan.counts.originalSessions !== 16 || plan.counts.eligibleSessions !== 16
      || plan.counts.originalTurns !== 512 || plan.counts.renderedTurns !== 512
      || plan.counts.batches !== 32 || perSessionBatches.some(count => count !== 2)
      || plan.cairnPlan.captureSourcePolicy !== 'indexed-evidence-v1'
      || plan.cairnPlan.qualificationStatus !== 'not-requested'
      || !plan.cairnPlan.executable || lengths.some(length => length < 1 || length > 4_000)) {
      throw new Error('invalid_installed_phase_fixture');
    }
    return { questionId: row.question.question_id, sourceDate: row.question.date,
      counts: { ...plan.counts }, perSessionBatches,
      contentUtf16: lengths.reduce((sum, length) => sum + length, 0),
      minimumTurnUtf16: Math.min(...lengths), maximumTurnUtf16: Math.max(...lengths),
      originalHistoryDigest: plan.originalHistoryDigest, caseDigest: plan.caseDigest };
  });
  const sourceJson = JSON.stringify(sourceCases);
  return freeze({ version: 'installed-phase-fresh-sources-v1', comparisonProfile: 'indexed-evidence-v1',
    sourceJsonSha256: sha256(sourceJson), sourceJsonBytes: Buffer.byteLength(sourceJson),
    armOrdersSha256: sha256(JSON.stringify(armOrders)), cases });
}

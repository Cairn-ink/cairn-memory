// Source-only preflight. Call explicitly with inspected native/runtime descriptors.
import { prepareMixedComparison } from '../longmemeval/mixed-generation.mjs';
import { prepareMixedSourceCase } from '../longmemeval/mixed-source.mjs';
import { armOrders, sourceCases } from './source-cases.mjs';

export const comparisonProfile = 'indexed-evidence-v1';

export function prepareLongHistoryLive({ nativeArtifact, nativeConfiguration,
  cairnRuntimeArtifactSha256 }) {
  return prepareMixedComparison({ sourceCases, armOrders, nativeArtifact,
    nativeConfiguration, cairnRuntimeArtifactSha256, comparisonProfile });
}

export function inspectLongHistorySources() {
  return sourceCases.map((row, index) => {
    const plan = prepareMixedSourceCase(row, comparisonProfile);
    const lengthsUtf16 = row.history.sessions.flatMap(session =>
      session.turns.map(turn => turn.content.length));
    return { caseIndex: index, questionId: row.question.question_id,
      originalMessages: lengthsUtf16.length,
      longestOriginalMessageUtf16: Math.max(...lengthsUtf16),
      batches: plan.counts.batches, renderedMessages: plan.counts.renderedTurns,
      caseDigest: plan.caseDigest };
  });
}

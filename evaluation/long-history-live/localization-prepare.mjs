// Source-only preflight: no evaluator, credential, store, or provider access.
import { prepareMixedComparison } from '../longmemeval/mixed-generation.mjs';
import { prepareMixedSourceCase } from '../longmemeval/mixed-source.mjs';
import { armOrders, sourceCases, sourceProbes } from './localization-source-cases.mjs';

export const comparisonProfile = 'indexed-evidence-v1';

const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

export function inspectLocalizationSources() {
  return freeze(sourceCases.map((row, caseIndex) => {
    const plan = prepareMixedSourceCase(row, comparisonProfile);
    const probe = sourceProbes[caseIndex];
    const matching = plan.cairnPlan.batches.flatMap(batch => batch.indexedWindows
      .filter(window => window.content.includes(probe.routingCue))
      .map(window => ({ batchIndex: batch.batchIndex, windowIndex: window.index,
        messageIndex: window.messageIndex, startUtf16: window.start, endUtf16: window.end })));
    if (matching.length !== 1 || matching[0].batchIndex !== probe.batchIndex
      || matching[0].windowIndex !== probe.windowIndex) {
      throw new Error('localization_source_probe_mismatch');
    }
    const originalMessages = row.history.sessions.flatMap(session => session.turns);
    return { caseIndex, questionId: row.question.question_id,
      originalMessages: originalMessages.length,
      longestOriginalMessageUtf16: Math.max(...originalMessages.map(turn => turn.content.length)),
      batches: plan.counts.batches, renderedMessages: plan.counts.renderedTurns,
      selectedWindow: matching[0],
      originalHistoryDigest: plan.originalHistoryDigest, caseDigest: plan.caseDigest };
  }));
}

export function prepareLocalizationComparison({ nativeArtifact, nativeConfiguration,
  cairnRuntimeArtifactSha256 }) {
  inspectLocalizationSources();
  return prepareMixedComparison({ sourceCases, armOrders, sourceProbes,
    nativeArtifact, nativeConfiguration, cairnRuntimeArtifactSha256,
    comparisonProfile });
}

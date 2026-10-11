// Post-run evaluator integration only. Nothing here is imported by model execution.
import { randomBytes, randomInt } from 'node:crypto';
import { validateEvaluatorRubric } from './corpus.mjs';

export const JUDGING_PROTOCOL = Object.freeze({
  version: 'algorithm-development-blind-judging-v1',
  instructions: [
    'Judge each answer independently; arm identity and aggregate results are withheld.',
    'Correctness uses the question, full original source history and required rubric propositions; optional details are not required.',
    'A qualified answer or abstention can be correct. Do not invent a definite answer when the source leaves it open.',
    'Count factual answer claims. Unsupported means the actual packed evidence does not support that factual claim; generic caution/advice is not a factual source claim.',
    'Stale-use means the answer applies a superseded or scope-inapplicable state, judged against the full original history.',
    'Judge severe errors against the case rubric; use null only if genuinely unknown. Empty severe-error lists do not invent additional severe cases.',
    'Use verdict correct, incorrect or unresolved; provide reviewedClaims, unsupportedClaims, staleClaims, severeError and a concise rationale.',
    'Return one JSON object per opaque label. Do not infer arm identity, read experiment output/mapping or consult the other judge.',
  ],
  aggregation: 'agreement-only; disagreements/missing judgments unresolved; no adjudication or favorable picking',
});

export function buildBlindDevelopmentPacket({ observations, modelInputs, evaluatorRubric }) {
  validateEvaluatorRubric(evaluatorRubric, modelInputs);
  const rows = new Map(observations.map(row => [row.id, row]));
  if (rows.size !== observations.length || observations.some(row => !modelInputs.some(input => input.id === row.id))) {
    throw new TypeError('invalid observation identities');
  }
  const mapping = [], items = [];
  for (const source of modelInputs) for (const arm of ['baseline', 'full']) {
    const row = rows.get(source.id), attempt = row?.arms?.[arm];
    if (row?.capture?.status !== 'completed' || attempt?.status !== 'completed') continue;
    const label = randomBytes(16).toString('hex');
    const packed = JSON.parse(attempt.packed.request.messages[1].content);
    mapping.push({ label, id: source.id, arm });
    items.push({ label, question: source.question, sourceHistory: source.sessions,
      rubric: evaluatorRubric.cases[source.id], packedEvidence: packed.evidence, answer: attempt.answer });
  }
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1); [items[i], items[j]] = [items[j], items[i]];
  }
  return { mapping, packet: { protocol: JUDGING_PROTOCOL, items } };
}

export function unblindDevelopmentJudgments(mapping, judgments) {
  const identities = new Map(mapping.map(row => [row.label, row]));
  if (identities.size !== mapping.length) throw new TypeError('duplicate blind labels');
  const seen = new Set();
  return judgments.map(({ label, ...judgment }) => {
    const identity = identities.get(label);
    if (!identity || seen.has(label) || Object.hasOwn(judgment, 'id') || Object.hasOwn(judgment, 'arm')) {
      throw new TypeError('invalid blind judgment identity');
    }
    seen.add(label);
    return { id: identity.id, arm: identity.arm, ...judgment };
  });
}

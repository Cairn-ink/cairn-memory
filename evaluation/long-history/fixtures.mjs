// Frozen synthetic inputs and expectations. This file is intentionally independent
// of the scripted model and the gate runner.
export const VERSION = 1;

const window = (marker, description) => {
  const passage = `${marker} ${description}`;
  if (passage.length > 800) throw new Error('fixture_window_too_large');
  return passage + 'x'.repeat(799 - passage.length) + ' ';
};

export const longSource = [
  window('frontmarker', 'The front observation is filed in the first source window. '),
  window('middlemarker', 'The middle observation is filed in the second source window. '),
  window('tailmarker', 'The tail observation is filed in the third source window. '),
].join('');

export const longCase = Object.freeze({
  name: 'long-windows',
  messages: [{ id: 'long-source', role: 'user', content: longSource }],
  questions: [
    { key: 'front', query: 'frontmarker', marker: 'frontmarker' },
    { key: 'middle', query: 'middlemarker', marker: 'middlemarker' },
    { key: 'tail', query: 'tailmarker', marker: 'tailmarker' },
  ],
  expectedWindowCount: 3,
  classification: 'first extracted memory proposed as new L1; front must be a filed ref',
});

export const capacityCase = Object.freeze({
  name: 'capacity-1025', count: 1025, batchSize: 5,
  source: index => `capacity${String(index).padStart(4, '0')} retained original source ${index}.`,
  targetRule: 'greatest-admitted-memory-id-after-all-writes',
  expected: { default: 'candidate-invisible', 'bounded-keyset-v1': 'answer-context-present' },
});

export const datedCase = Object.freeze({
  name: 'dated-a-b',
  sources: [
    { id: 'choice-a', role: 'user', content: 'datedalpha On 2024-02-01 I chose A because it keeps the trip short.' },
    { id: 'choice-b', role: 'user', content: 'datedbeta On 2024-03-01 I chose B because the schedule changed.' },
  ],
  questions: [
    { key: 'a', query: 'datedalpha', marker: 'datedalpha' },
    { key: 'b', query: 'datedbeta', marker: 'datedbeta' },
  ],
  expected: 'both-source-evidence-without-current-choice-judgment',
});

export const faultControls = Object.freeze({
  malformedExtraction: 'capture-error-before-admission',
  failedClassification: 'explicit-post-admission-failure',
  omittedSource: 'retained-absent',
  emptySelection: 'selected-absent',
  emptyRank: 'ranked-absent',
  correction: 'cold-revision-and-source-updated',
  forgetting: 'cold-source-absent',
  namespace: 'cold-cross-namespace-read-denied',
});

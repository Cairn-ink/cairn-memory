// Synthetic, pre-grant demonstration only. The explicit native local gate
// exercises actual X/Y/Cairn execution; this command never starts a provider.
import { packMixedAnswer } from './mixed-answer.mjs';
import { prepareMixedComparison } from './mixed-generation.mjs';
import { sourceRow } from './testing/mixed-fixture.mjs';

const prepared = prepareMixedComparison({ sourceCases: [sourceRow()],
  armOrders: [['cairn', 'mem0']],
  nativeArtifact: { sourceTreeSha256: '1'.repeat(64), dependencyLockSha256: '2'.repeat(64) },
  nativeConfiguration: { configurationSha256: '3'.repeat(64), configuration: {} },
  cairnRuntimeArtifactSha256: '4'.repeat(64) });
const packed = packMixedAnswer({ question: { text: 'What synthetic fact?',
  date: '2024-01-02 10:00' }, units: [{ text: 'Synthetic memory fact.' }],
countTokens: text => text.length });
console.log(JSON.stringify({ version: 'mixed-pregrant-demo-v1',
  fixedN: prepared.counts.fixedN, preflight: prepared.preflight.map(row => row.status),
  selectedIndices: packed.selectedIndices, transportDispatched: false }));

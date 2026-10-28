import './p2e-offline.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, deriveLabels, auditGold, cells, eligible, readSet, namespace } from '../../evaluation/context-read-p2e/fixtures.mjs';
import { dependencePower } from '../../evaluation/context-read-p2e/statistics.mjs';
import { semanticCapacity, MAX_VECTORS, MAX_CACHE_BYTES } from '../../core/context-read-embedder.mjs';
import { checkSafety } from '../../evaluation/context-read-p2e/safety.mjs';
import { executeSafety } from './p2e-safety.mjs';

// These use only pre-existing APIs so the unchanged tests exercise defects on
// the reviewed revision, rather than failing for a missing new import/export.
test('fix2 gold: every location exposes expanded-vocabulary omissions across all 20 locations', () => {
  const fixture = generate(), labels = deriveLabels(fixture);
  assert.equal(auditGold(fixture, labels).failures.length, 0);
  const overlaps = [
    [1120, 1720, 'narrow paddled watercraft'],
    [560, 2720, 'finger covering'],
    [4600, 4660, 'seasoned ground meat casing'],
    [4540, 4560, 'long thin flour paste strands'],
  ];
  for (const [assigned, compatible, description] of overlaps) {
    const ambiguous = structuredClone(fixture);
    for (let location = 0; location < 20; location++) {
      const q = ambiguous.queries.find(q => q.language === 'en' && q.id.endsWith(`-${assigned + location}`) && q.masks.includes('paraphrase'));
      q.text = q.text.replace(/^Find the .+ beside the /, `Find the ${description} beside the `);
      // Gold must be inferred from bytes and independent attributes even when
      // generator fact labels and numeric query IDs are misleading.
      q.fact = 'unrelated-label';
    }
    const failures = auditGold(ambiguous, labels).failures;
    assert.equal(failures.length, 240, description);
    assert.ok(failures.every(f => f.expected.includes(`memory-${compatible + Number(f.query.split('-').at(-1)) % 20}`)));
    const allValidGold = structuredClone(labels);
    for (const f of failures) allValidGold.find(row => row.cell === f.cell).queries.find(q => q.id === f.query).relevant = f.expected;
    assert.equal(auditGold(ambiguous, allValidGold).failures.length, 0, 'all compatible targets may be gold');
  }
  const decoupled = structuredClone(fixture), renamedLabels = structuredClone(labels);
  const renamed = new Map(decoupled.queries.map((q, i) => [q.id, `opaque-query-${i}`]));
  for (const d of decoupled.documents) d.fact = 'misleading-generator-assignment';
  for (const q of decoupled.queries) { q.id = renamed.get(q.id); q.fact = null; }
  for (const row of renamedLabels) for (const q of row.queries) q.id = renamed.get(q.id);
  assert.equal(auditGold(decoupled, renamedLabels).failures.length, 0, 'resolve canonical bytes without generator assignments or numeric query IDs');
  const audit = auditGold(fixture, labels);
  assert.equal(audit.nouns, 240);
  assert.equal(audit.descriptions, 262);
  assert.equal(audit.nounComparisons, 62880);
  assert.equal(audit.checked, 43701);
  assert.equal(audit.comparisons, 524412);
  assert.equal(audit.ambiguousQueries, 0);
});

const id = 'forget/embedding/fresh/memory/current';
const ref = (memoryId, ns = namespace(0)) => ({ type: 'memory', memoryId, revision: 1, namespace: ns });
const identify = r => r.memoryId ? `${r.memoryId}@${r.revision}` : `${r.cardId}@${r.revision}:${r.bodyRevision}`;
const target = { type: 'memory', ref: ref('safety-target'), content: 'The synthetic cedar key opens the blue cabinet.' };
const history = { type: 'memory', ref: ref('history-eligible'), content: 'A qualified historical amber key belonged to the archive.' };
const trace = () => ({ effective: 'hybrid', semantic: { coverage: 'complete', queryEmbeddingAttempts: 1, degradedReason: null } });
const envelope = (items = []) => ({ ok: true, value: { items, trace: trace() } });

async function collect(leakRole, payload = 'target') {
  let removed = false, surface, calls = 0;
  const inject = value => {
    if (payload === 'target') value.value.items.push(target);
    if (payload === 'text') value.value.diagnostics = { note: target.content };
    if (payload === 'scope-ref') value.value.items.push({ ref: ref('foreign-owner', { ownerId: 'synthetic-other-owner', scope: 'personal', projectId: null }) });
    if (payload === 'scope-text') value.value.diagnostics = { note: 'PRIVATE_NAMESPACE_CANARY cedar key blue cabinet' };
    if (payload === 'unknown') value.value.diagnostics = { nested: { ref: ref('unregistered') } };
    return value;
  };
  const setup = { credential: {}, input: { readSet, intent: 'current' },
    fixtureIdentity: r => ['safety-target', 'history-eligible', 'foreign-owner'].includes(r.memoryId) ? identify(r) : null,
    prepareSurface: async s => { removed = false; surface = s; },
    readerOptions: async () => ({}), historyReaderOptions: async () => ({}),
    atMutationBoundary: async (s, operation) => { removed = true; await operation(); return { canonicalSnapshot: 'after', mutationAcknowledged: true, stoppedAndDrained: true }; }, close() {} };
  return executeSafety({ prepareSafetyCell: async cell => cell === id ? setup : { close() {} } }, {
    semanticCallCount: () => calls,
    withReader: async (options, credential, operation) => operation({
      getContextReadCapabilities: async () => {
        const result = { ok: true, value: { items: [], channels: { semantic: { configured: true } } } };
        return removed && leakRole === 'capabilities' ? inject(result) : result;
      },
      findCandidates: async input => {
        calls++;
        const result = envelope(input.intent === 'history' ? [history] : removed ? [] : [target]);
        return removed && (input.intent === 'history' && leakRole === 'history-candidates'
          || input.intent !== 'history' && surface === 'evidence' && leakRole === 'semantic-execution') ? inject(result) : result;
      },
      contextRead: async () => { calls++; return { ok: true, value: { items: [], diagnostics: { candidates: { trace: trace() } } } }; },
      fetchCandidateEvidence: async input => {
        assert.ok(input.refs.length > 0);
        if (input.refs[0].memoryId === 'history-eligible') {
          const result = envelope([history]);
          return leakRole === 'history-evidence' ? inject(result) : result;
        }
        return removed ? { ok: false, error: { code: 'revision_conflict' } } : envelope([target]);
      },
    }, credential),
  });
}
for (const role of ['history-candidates', 'history-evidence', 'semantic-execution']) {
  test(`fix2 safety: forgotten target in ${role} fails through actual collector`, async () => {
    assert.equal(checkSafety(await collect())[id].status, 'passed');
    const observations = await collect(role);
    const result = checkSafety(observations)[id];
    assert.equal(result.status, 'failed');
    assert.ok(result.violations > 0);
    assert.equal(observations[id].postMutationReads.length, 26, '13 reads plus their 13 capability envelopes');
    // Failure cannot be hidden by deleting the observation from the ledger.
    observations[id].postMutationReads.pop();
    assert.equal(checkSafety(observations)[id].status, 'incomplete');
  });
}
test('fix2 safety: auxiliary capability envelopes reject forgotten targets', async () => {
  const result = checkSafety(await collect('capabilities'))[id];
  assert.equal(result.status, 'failed');
  assert.ok(result.violations > 0);
});
test('fix2 safety: every auxiliary role rejects forbidden bytes and scope canaries', async () => {
  for (const role of ['history-candidates', 'history-evidence', 'semantic-execution', 'capabilities']) {
    for (const payload of ['text', 'scope-ref', 'scope-text', 'unknown']) {
      const result = checkSafety(await collect(role, payload))[id];
      assert.equal(result.status, 'failed', `${role}/${payload}`);
      assert.ok(result.violations > 0);
    }
  }
});

test('fix2 capacity: every registered projection counts Memories and Cards with E.4 headroom and retains dependent power', () => {
  const fixture = generate();
  const metadata = { id: 'capacity-test', revision: '1', dimensions: 1536, normalization: 'l2' };
  for (const cell of cells()) {
    const selected = fixture.documents.filter(d => eligible(d, cell));
    const capacity = semanticCapacity(selected.length, metadata);
    assert.equal(capacity.eligible, true, cell.id);
    assert.ok(selected.length <= MAX_VECTORS - 1000, cell.id);
    assert.ok(capacity.bytes <= MAX_CACHE_BYTES - 12 * 1024 * 1024, cell.id);
    const queries = fixture.queries.filter(q => q.language === cell.language && !q.negative && !q.control);
    const positives = new Set(queries.map(q => q.fact));
    assert.ok([...positives].every(fact => selected.some(d => d.fact === fact)), cell.id);
  }
  for (const direction of ['cross-zh-en', 'cross-en-zh']) {
    const n = new Set(fixture.queries.filter(q => q.masks.includes(direction) && !q.negative).map(q => q.fact)).size;
    assert.equal(n, 2400);
    for (const rho of [0, .1, .2, .3]) for (const discordance of [.1, .2]) {
      assert.ok(dependencePower({ n, nounSize: 10, nounCorrelation: rho, discordance }).power >= .8);
    }
  }
  const n = new Set(fixture.queries.filter(q => q.masks.includes('paraphrase') && !q.negative).map(q => q.fact)).size;
  assert.equal(n, 4800);
  assert.ok(dependencePower({ n, nounSize: 20, viewSize: 4, nounCorrelation: .3, viewCorrelation: .3, discordance: .2 }).power >= .8);
});

test('fix2 safety: post-purge lexical auxiliary read is scoped while canonical targets remain allowed', async () => {
  const purgeId = 'owner-purge/all-catalogs';
  for (const leak of [false, true]) {
    let purged = false;
    const setup = { input: { readSet }, credential: {}, fixtureIdentity: identify, close() {},
      independentInventory: async () => ({ catalog: ['current', 'history'], rows: purged ? [] : [{ ownerId: 'synthetic-owner' }],
        otherOwner: [{ ownerId: 'other', vectorHash: 'preserved' }], independent: true, noPendingWriters: true,
        coverage: ['all-identities','both-intents','all-types','staging','obsolete'] }),
      lexicalReaderOptions: async () => ({}), drainWriters: async () => {},
      coordinator: { setOwnerSemantic: async () => ({ ok: true }), purgeOwnerVectors: async () => { purged = true; return { ok: true, value: { status: 'complete' } }; } },
    };
    const observations = await executeSafety({ prepareSafetyCell: async cell => cell === purgeId ? setup : { close() {} } }, {
      // Both lexical envelopes contain the same data, so equality alone cannot
      // catch a scope leak. An owned canonical target is valid after vector purge.
      withReader: async (options, credential, operation) => operation({ findCandidates: async () => envelope([
        target, ...(leak ? [{ ref: ref('foreign-owner', { ownerId: 'synthetic-other-owner', scope: 'personal', projectId: null }) }] : []),
      ]) }, credential),
    });
    assert.equal(checkSafety(observations)[purgeId].status, leak ? 'failed' : 'passed');
  }
});

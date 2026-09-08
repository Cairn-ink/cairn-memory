import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMemoryCore } from '../core/contract.mjs';
import { createOpenAIModel } from '../adapters/openai/index.mjs';
import { createBudgetedFetch, LIVE_MODEL } from '../adapters/openai/live-harness.mjs';
import { cases, fixtureVersion } from './semantic-cases.mjs';
import { summarizeEvaluation, validateEvidence } from './score.mjs';
import { measurePeakRss } from './resources.mjs';

export const namespaces = Object.freeze({
  personal: Object.freeze({ ownerId: 'synthetic-owner-a', scope: 'personal', projectId: null }),
  project: Object.freeze({ ownerId: 'synthetic-owner-a', scope: 'project', projectId: 'synthetic-harbor' }),
  otherOwner: Object.freeze({ ownerId: 'synthetic-owner-b', scope: 'personal', projectId: null }),
});
const unwrap = (result) => { if (!result?.ok) throw new Error('evaluation_operation_failed'); return result.value; };
const size = (path) => ['', '-wal', '-shm'].reduce((total, suffix) => {
  try { return total + statSync(path + suffix).size; } catch (error) {
    if (error.code === 'ENOENT') return total;
    throw new Error('evaluation_measurement_failed');
  }
}, 0);

export async function runEvaluation({ apiKey, budgetUsd, fetchImpl = globalThis.fetch,
  onProgress } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n]/.test(apiKey) ||
    !Number.isFinite(budgetUsd) || budgetUsd <= 0 || budgetUsd > 4.80 || typeof fetchImpl !== 'function') {
    throw new Error('invalid_evaluation_configuration');
  }
  const budgetUnits = Math.floor(budgetUsd * 1e6);
  let reservedUnits = 0;
  let exhausted = false;
  const results = [];
  for (const fixture of cases) {
    for (let repetition = 1; repetition <= 3; repetition++) {
      const run = { caseId: fixture.id, repetition, status: 'unrun', queries: [],
        semanticReview: fixture.mode === 'capture' || fixture.organize ? 'pending' : 'not_required',
        safetyViolations: [], databasePath: null };
      results.push(run);
      if (exhausted || budgetUnits - reservedUnits < 4448) { exhausted = true; continue; }
      const guard = createBudgetedFetch({ budgetUsd: (budgetUnits - reservedUnits) / 1e6,
        maxRequests: 40, fetchImpl });
      const model = createOpenAIModel({ apiKey, fetchImpl: guard.fetchImpl });
      const started = performance.now();
      let core;
      const ids = new Map();
      const trustedReceipts = [];
      const forgottenIds = [];
      const currentRecords = () => {
        const records = [];
        for (const namespace of Object.values(namespaces)) {
          const listed = unwrap(core.list({ namespace, limit: 100 }));
          for (const memory of listed.memories) records.push(unwrap(core.get({ namespace,
            memoryId: memory.id, receiptLimit: 100 })));
        }
        return records;
      };
      try {
        run.status = 'failed';
        run.databasePath = join(mkdtempSync(join(tmpdir(), 'cairn-semantic-')), 'memory.sqlite');
        core = openMemoryCore({ path: run.databasePath, model });
        if (fixture.mode === 'capture') {
          for (const message of fixture.messages) trustedReceipts.push({ client: 'semantic-fixture',
            sessionId: fixture.id, eventId: message.id, role: message.role, excerpt: message.content });
          const captureNamespace = namespaces[fixture.memories[0].namespace];
          const captured = unwrap(await core.capture({ namespace: captureNamespace,
            client: 'semantic-fixture', sessionId: fixture.id, eventId: `${fixture.id}-capture`,
            messages: fixture.messages }));
          run.classificationStatus = captured.classification.status;
          run.captured = currentRecords();
          run.safetyViolations.push(...validateEvidence({ returned: run.captured,
            readSet: [captureNamespace], currentRecords: run.captured, trustedReceipts }));
          if (captured.classification.status !== 'applied') throw new Error('evaluation_classification_failed');
        } else {
          for (const memory of fixture.memories) {
            const receipt = { client: 'semantic-fixture', sessionId: fixture.id,
              eventId: memory.id, role: 'user', excerpt: memory.content };
            trustedReceipts.push(receipt);
            const admitted = unwrap(core.admit({ namespace: namespaces[memory.namespace],
              memory: { content: memory.content, kind: memory.kind }, receipts: [receipt] }));
            ids.set(memory.id, admitted.memory.id);
          }
          if (fixture.organize) {
            const namespace = namespaces[fixture.memories[0].namespace];
            const records = currentRecords();
            const classified = unwrap(await core.classifyPlacement({ namespace,
              memoryIds: records.map(({ memory }) => memory.id),
              expectedMemoryRevisions: records.map(({ memory }) => ({ memoryId: memory.id, revision: memory.revision })),
              mapRevision: unwrap(core.map({ namespace, purpose: 'classification' })).indexRevision }));
            unwrap(core.applyPlacement({ namespace, proposal: classified.proposal,
              expectedMemoryRevisions: classified.basedOn.memoryRevisions,
              expectedIndexRevision: classified.basedOn.indexRevision }));
            run.classificationStatus = 'applied';
            run.organization = { proposal: classified.proposal,
              map: unwrap(core.map({ namespace, purpose: 'classification' })), records: currentRecords() };
          }
        }
        if (fixture.mutation) {
          const mutation = fixture.mutation;
          const memoryId = ids.get(mutation.memoryId);
          const memoryFixture = fixture.memories.find((memory) => memory.id === mutation.memoryId);
          const namespace = namespaces[memoryFixture.namespace];
          const old = unwrap(core.get({ namespace, memoryId }));
          if (mutation.type === 'correct') {
            const receipt = { client: 'semantic-fixture', sessionId: fixture.id,
              eventId: `${mutation.memoryId}-correction`, role: 'user', excerpt: mutation.content };
            trustedReceipts.push(receipt);
            unwrap(core.correct({ namespace, memoryId, expectedRevision: old.memory.revision,
              content: mutation.content, kind: memoryFixture.kind, receipt }));
          } else {
            unwrap(core.forget({ namespace, memoryId, expectedRevision: old.memory.revision }));
            forgottenIds.push(memoryId);
            if (core.get({ namespace, memoryId }).error?.code !== 'memory_not_found' ||
              unwrap(core.list({ namespace })).memories.some((memory) => memory.id === memoryId)) {
              run.safetyViolations.push('forgotten_reference');
            }
          }
        }
        run.records = currentRecords();
        run.logicalIds = Object.fromEntries(ids);
        for (const query of fixture.queries) {
          const result = { id: query.id, status: 'failed', returnedIds: [],
            semanticPending: fixture.mode === 'capture', safetyViolations: [], evidence: [] };
          run.queries.push(result);
          const queryStarted = performance.now();
          try {
            const readSet = [namespaces[query.namespace]];
            const recalled = unwrap(await core.recall({ readSet, query: query.query }));
            result.evidence = recalled.memories;
            result.returnedIds = recalled.memories.map(({ memory }) =>
              [...ids].find(([, id]) => id === memory.id)?.[0] ?? `unreviewed:${memory.id}`);
            result.safetyViolations = validateEvidence({ returned: recalled.memories,
              readSet, currentRecords: currentRecords(), trustedReceipts, forgottenIds });
            result.status = 'completed';
          } catch { result.error = 'evaluation_query_failed'; }
          finally { result.elapsedMs = Math.round(performance.now() - queryStarted); }
          if (guard.snapshot().rejection === 'budget_exceeded') { exhausted = true; break; }
        }
        run.status = run.queries.length === fixture.queries.length &&
          run.queries.every((query) => query.status === 'completed') ? 'completed' : 'failed';
      } catch { run.error = 'evaluation_case_failed'; }
      finally {
        run.accounting = guard.snapshot();
        reservedUnits += run.accounting.requestCount * 4448;
        if (run.accounting.rejection === 'budget_exceeded') exhausted = true;
        run.elapsedMs = Math.round(performance.now() - started);
        try {
          run.resources = { retainedBytes: run.databasePath ? size(run.databasePath) : 0,
            peakRssBytes: measurePeakRss(),
            measurementScope: 'Linux /proc/self/status VmHWM current executable peak RSS; SQLite plus WAL plus SHM before close',
            seededMemoryCount: fixture.mode === 'admit' ? fixture.memories.length : 0,
            sourceMessageCount: fixture.messages?.length ?? fixture.memories.length,
            fixtureBytes: Buffer.byteLength(JSON.stringify(fixture)),
            currentMemoryCount: core ? currentRecords().length : 0 };
        } catch { run.status = 'failed'; run.error = 'evaluation_measurement_failed'; }
        try { core?.close(); } catch { run.status = 'failed'; run.error = 'evaluation_close_failed'; }
        if (typeof onProgress === 'function') {
          try { onProgress({ caseId: fixture.id, repetition, status: run.status, reservedUsd: reservedUnits / 1e6 }); }
          catch { /* Observers do not control evaluation authority. */ }
        }
      }
    }
  }
  const report = { fixtureVersion, model: LIVE_MODEL, runtime: process.version, budgetUsd,
    reservedUsd: reservedUnits / 1e6, results, summary: summarizeEvaluation(cases, results) };
  // Synthetic model text is retained for review, but the process credential is never an artifact.
  const scrub = (value) => {
    if (typeof value === 'string') return value.replaceAll(apiKey, '[REDACTED]');
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === 'object') return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, scrub(item)]));
    return value;
  };
  return scrub(report);
}

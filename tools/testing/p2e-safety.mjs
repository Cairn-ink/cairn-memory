import { isDeepStrictEqual } from 'node:util';
import { readSet } from '../../evaluation/context-read-p2e/fixtures.mjs';
import { SAFETY_CELLS } from '../../evaluation/context-read-p2e/safety.mjs';
import { safetyFixtures } from '../../evaluation/context-read-p2e/inventory.mjs';
import { withProductReader } from './p2e-product.mjs';

const surfaces = ['candidates','assembly','evidence','private-metadata'];
export async function publicRead(setup, surface, options, semantic = true, withReader = withProductReader, observe) {
  return withReader(options, setup.credential, async (reader, token) => {
    const capture = async (kind, response) => {
      const envelope = await response;
      observe?.(kind, envelope);
      return envelope;
    };
    if (semantic) {
      const caps = await capture('capabilities', reader.getContextReadCapabilities({}, token));
      if (!caps.ok || caps.value.channels?.semantic?.configured !== true) throw Error('safety_semantic_capability_missing');
    }
    const input = { ...setup.input, query: safetyFixtures().query, semantic };
    if (surface === 'evidence') {
      if (!Array.isArray(setup.evidenceInput?.refs) || !setup.evidenceInput.refs.length) throw Error('safety_evidence_refs_required');
      return capture('result', reader.fetchCandidateEvidence(setup.evidenceInput, token));
    }
    if (surface === 'assembly') return capture('result', reader.contextRead({ ...input, budget: { maxTokens: 4000, maxItems: 12 } }, token));
    return capture('result', reader.findCandidates(input, token));
  });
}
export function inspect(envelope, setup, forbidden) {
  const identities = [], scopeCanaries = [], text = JSON.stringify(envelope), fixture = safetyFixtures();
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (['memory', 'card'].includes(value.type) && (value.memoryId !== undefined || value.cardId !== undefined)) {
      const identity = setup.fixtureIdentity(value);
      if (identity) identities.push(identity); else scopeCanaries.push('unknown-ref');
      const namespaces = readSet;
      if (value.namespace && !namespaces.some(ns => isDeepStrictEqual(ns, value.namespace))) scopeCanaries.push('out-of-scope-ref');
    }
    for (const v of Object.values(value)) if (v !== value) walk(v);
  }
  walk(envelope);
  for (const word of ['PRIVATE_OWNER_CANARY','PRIVATE_NAMESPACE_CANARY']) if (text.includes(word)) scopeCanaries.push(word);
  for (const canary of fixture.canaries.filter(c => c.namespace.ownerId !== fixture.ownerId || c.namespace.projectId === 'unselected')) {
    const key = `${canary.id}@${canary.revision}${canary.type === 'card' ? `:${canary.bodyRevision}` : ''}`;
    if (identities.includes(key) || text.includes(canary.text)) scopeCanaries.push(key);
  }
  for (const key of forbidden) {
    const canary = fixture.canaries.find(c => `${c.id}@${c.revision}${c.type === 'card' ? `:${c.bodyRevision}` : ''}` === key);
    if (canary && text.includes(canary.text)) identities.push(key);
  }
  return { identities, scopeCanaries, envelope };
}

// All returned envelopes below are captured inside withProductReader. A host
// binding can coordinate canonical writes/rendezvous and read independent
// storage inventories; it cannot supply a precomputed safety pass or ranking.
export async function executeSafety(prepared, { withReader = withProductReader, semanticCallCount } = {}) {
  const read = (setup, surface, options, semantic = true) => publicRead(setup, surface, options, semantic, withReader);
  const observations = {}, scenarios = safetyFixtures().scenarios;
  if (typeof prepared.prepareSafetyCell !== 'function') return observations;
  for (const id of SAFETY_CELLS) {
    const setup = await prepared.prepareSafetyCell(id);
    try {
      if (id.startsWith('semantic-false/')) {
        const surface = id.endsWith('assembly') ? 'assembly' : 'candidates';
        const start = await setup.semanticCallCount();
        const lexical = await read(setup, surface, await setup.lexicalReaderOptions(), false);
        const explicitFalse = await read(setup, surface, await setup.readerOptions(), false);
        observations[id] = { lexical, explicitFalse, semanticCalls: await setup.semanticCallCount() - start };
      } else if (id === 'owner-purge/all-catalogs') {
        const before = await setup.independentInventory();
        const lexicalBefore = await read(setup, 'candidates', await setup.lexicalReaderOptions(), false);
        const off = await setup.coordinator.setOwnerSemantic(setup.disableInput, setup.serviceCredential);
        let completed = false;
        if (off.ok) for (let quantum = 0; quantum < 128; quantum++) {
          const result = await setup.coordinator.purgeOwnerVectors({ ownerId: 'synthetic-owner', budget: { maxItems: 1024, maxMs: 5000 } }, setup.serviceCredential);
          if (!result.ok) break;
          if (result.value.status === 'complete') { completed = true; break; }
        }
        await setup.drainWriters();
        const after = await setup.independentInventory();
        const lexicalAfter = await read(setup, 'candidates', await setup.lexicalReaderOptions(), false);
        observations[id] = { completed, ownerId: 'synthetic-owner', catalogBefore: before.catalog, catalogAfter: after.catalog,
          rowsBefore: before.rows, rowsAfter: after.rows, otherOwnerBefore: before.otherOwner, otherOwnerAfter: after.otherOwner,
          independentInventory: before.independent === true && after.independent === true, inventoryCoverage: after.coverage,
          noPendingWriters: after.noPendingWriters, lexicalBefore, lexicalAfter,
          // Owner vector purge deliberately preserves canonical lexical data;
          // its auxiliary read still must respect the frozen scope inventory.
          lexicalAfterInspection: inspect(lexicalAfter, setup, []) };
      } else if (id.startsWith('scope/')) {
        const forbidden = scenarios.find(s => s.id === id).forbidden;
        const returns = [], scopeComparisons = [];
        for (const surface of surfaces) {
          const observe = (kind, envelope) => returns.push({ surface, kind, ...inspect(envelope, setup, forbidden) });
          const withCanary = await publicRead(setup, surface, await setup.withCanaryOptions(surface), true, withReader, observe);
          const withoutCanary = await publicRead(setup, surface, await setup.withoutCanaryOptions(surface), true, withReader, observe);
          scopeComparisons.push({ surface, withCanary, withoutCanary });
        }
        observations[id] = { returns, forbidden, scopeComparisons };
      } else {
        const forbidden = scenarios.find(s => s.id === id).forbidden, returns = [];
        const receipts = [], initial = [], historyControls = [], postMutationReads = [];
        // Every post-mutation public read goes through this collector, including
        // controls and auxiliary reads. Keep the full envelope and inspection.
        const readAfter = async (readSetup, surface, options, raceSurface, role) => {
          return publicRead(readSetup, surface, options, true, withReader, (kind, envelope) => {
            postMutationReads.push({ surface: raceSurface, role, kind, ...inspect(envelope, setup, forbidden) });
          });
        };
        if (typeof semanticCallCount !== 'function') throw Error('independent_semantic_observer_required');
        for (const surface of surfaces) {
          // Reset before each independent race, then prove the target can be
          // retrieved and refetched through the selected semantic handle.
          await setup.prepareSurface(surface);
          const start = semanticCallCount();
          const before = await read(setup, 'candidates', await setup.readerOptions(surface));
          const refs = before.value?.items?.map(i => i.ref) ?? [];
          const targetRefs = refs.filter(ref => forbidden.includes(setup.fixtureIdentity(ref)));
          const evidence = await read({ ...setup, evidenceInput: { readSet: setup.input.readSet, intent: setup.input.intent, refs: targetRefs } },
            'evidence', await setup.readerOptions(surface));
          initial.push({ surface, ...inspect(before, setup, forbidden), evidence: inspect(evidence, setup, forbidden), semanticCalls: semanticCallCount() - start });
          let envelope, semanticExecution, entered = 0;
          const boundaryStart = semanticCallCount();
          const receipt = await setup.atMutationBoundary(surface, async () => {
            if (++entered !== 1) throw Error('duplicate_safety_read');
            if (surface === 'evidence') semanticExecution = await readAfter(setup, 'candidates', await setup.readerOptions(surface), surface, 'semantic-execution');
            const boundarySetup = surface === 'evidence' ? { ...setup, evidenceInput: { readSet: setup.input.readSet, intent: setup.input.intent, refs: targetRefs } } : setup;
            envelope = await readAfter(boundarySetup, surface, await setup.readerOptions(surface), surface, 'boundary');
            semanticExecution ??= envelope;
          });
          if (entered !== 1 || envelope === undefined) throw Error('missing_public_safety_read');
          receipts.push(receipt);
          returns.push({ surface, ...inspect(envelope, setup, forbidden), semanticExecution, semanticCalls: semanticCallCount() - boundaryStart });
          const historySetup = { ...setup, input: { ...setup.input, intent: 'history' }, evidenceInput: undefined };
          const history = await readAfter(historySetup, 'candidates', await setup.historyReaderOptions(surface), surface, 'history-candidates');
          const historyRefs = (history.value?.items ?? []).map(i => i.ref).filter(ref => setup.fixtureIdentity(ref) === 'history-eligible@1');
          const historyEvidence = await readAfter({ ...historySetup, evidenceInput: { readSet: setup.input.readSet, intent: 'history', refs: historyRefs } }, 'evidence', await setup.historyReaderOptions(surface), surface, 'history-evidence');
          historyControls.push({ surface, ...inspect(history, setup, forbidden), evidence: inspect(historyEvidence, setup, forbidden) });
        }
        const o = { returns, initial, historyControls, postMutationReads, forbidden, canonicalSnapshot: receipts.map(r => r.canonicalSnapshot),
          mutationAcknowledged: receipts.every(r => r.mutationAcknowledged === true && r.stoppedAndDrained === true),
          qualifiedHistoryControl: receipts.every(r => r.qualifiedHistoryControl === 'history-eligible@1') ? 'history-eligible@1' : null };
        observations[id] = o;
      }
    } catch { observations[id] = {}; }
    finally { await setup.close(); }
  }
  return observations;
}

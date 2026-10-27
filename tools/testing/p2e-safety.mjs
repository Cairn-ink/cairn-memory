import { SAFETY_CELLS } from '../../evaluation/context-read-p2e/safety.mjs';
import { safetyFixtures } from '../../evaluation/context-read-p2e/inventory.mjs';
import { withProductReader } from './p2e-product.mjs';

const surfaces = ['candidates','assembly','evidence','private-metadata'];
export async function publicRead(setup, surface, options, semantic = true, withReader = withProductReader) {
  return withReader(options, setup.credential, async (reader, token) => {
    if (semantic) {
      const caps = await reader.getContextReadCapabilities({}, token);
      if (!caps.ok || caps.value.channels?.semantic?.configured !== true) throw Error('safety_semantic_capability_missing');
    }
    const input = { ...setup.input, query: safetyFixtures().query, semantic };
    if (surface === 'evidence') {
      if (!Array.isArray(setup.evidenceInput?.refs) || !setup.evidenceInput.refs.length) throw Error('safety_evidence_refs_required');
      return reader.fetchCandidateEvidence(setup.evidenceInput, token);
    }
    if (surface === 'assembly') return reader.contextRead({ ...input, budget: { maxTokens: 4000, maxItems: 12 } }, token);
    return reader.findCandidates(input, token);
  });
}
export function inspect(envelope, setup, forbidden) {
  const identities = [], scopeCanaries = [], text = JSON.stringify(envelope), fixture = safetyFixtures();
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (['memory', 'card'].includes(value.type) && (value.memoryId !== undefined || value.cardId !== undefined)) {
      const identity = setup.fixtureIdentity(value);
      if (identity) identities.push(identity); else scopeCanaries.push('unknown-ref');
    }
    for (const v of Object.values(value)) if (v !== value) walk(v);
  }
  walk(envelope);
  for (const word of ['PRIVATE_OWNER_CANARY','PRIVATE_NAMESPACE_CANARY']) if (text.includes(word)) scopeCanaries.push(word);
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
          noPendingWriters: after.noPendingWriters, lexicalBefore, lexicalAfter };
      } else if (id.startsWith('scope/')) {
        const forbidden = scenarios.find(s => s.id === id).forbidden;
        const returns = [], scopeComparisons = [];
        for (const surface of surfaces) {
          const withCanary = await read(setup, surface, await setup.withCanaryOptions(surface));
          const withoutCanary = await read(setup, surface, await setup.withoutCanaryOptions(surface));
          returns.push({ surface, ...inspect(withCanary, setup, forbidden) });
          scopeComparisons.push({ surface, withCanary, withoutCanary });
        }
        observations[id] = { returns, forbidden, scopeComparisons };
      } else {
        const forbidden = scenarios.find(s => s.id === id).forbidden, returns = [];
        const receipts = [], initial = [], historyControls = [];
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
            if (surface === 'evidence') semanticExecution = await read(setup, 'candidates', await setup.readerOptions(surface));
            const boundarySetup = surface === 'evidence' ? { ...setup, evidenceInput: { readSet: setup.input.readSet, intent: setup.input.intent, refs: targetRefs } } : setup;
            envelope = await read(boundarySetup, surface, await setup.readerOptions(surface));
            semanticExecution ??= envelope;
          });
          if (entered !== 1 || envelope === undefined) throw Error('missing_public_safety_read');
          receipts.push(receipt);
          returns.push({ surface, ...inspect(envelope, setup, forbidden), semanticExecution, semanticCalls: semanticCallCount() - boundaryStart });
          const historySetup = { ...setup, input: { ...setup.input, intent: 'history' }, evidenceInput: undefined };
          const history = await read(historySetup, 'candidates', await setup.historyReaderOptions(surface));
          const historyRefs = (history.value?.items ?? []).map(i => i.ref).filter(ref => setup.fixtureIdentity(ref) === 'history-eligible@1');
          const historyEvidence = await read({ ...historySetup, evidenceInput: { readSet: setup.input.readSet, intent: 'history', refs: historyRefs } }, 'evidence', await setup.historyReaderOptions(surface));
          historyControls.push({ surface, ...inspect(history, setup, []), evidence: inspect(historyEvidence, setup, []) });
        }
        const o = { returns, initial, historyControls, forbidden, canonicalSnapshot: receipts.map(r => r.canonicalSnapshot),
          mutationAcknowledged: receipts.every(r => r.mutationAcknowledged === true && r.stoppedAndDrained === true),
          qualifiedHistoryControl: receipts.every(r => r.qualifiedHistoryControl === 'history-eligible@1') ? 'history-eligible@1' : null };
        observations[id] = o;
      }
    } catch { observations[id] = {}; }
    finally { await setup.close(); }
  }
  return observations;
}

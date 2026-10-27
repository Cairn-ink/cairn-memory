import { SAFETY_CELLS } from '../../evaluation/context-read-p2e/safety.mjs';
import { safetyFixtures } from '../../evaluation/context-read-p2e/inventory.mjs';
import { withProductReader } from './p2e-product.mjs';

const surfaces = ['candidates','assembly','evidence','private-metadata'];
async function publicRead(setup, surface, options, semantic = true) {
  return withProductReader(options, setup.credential, async (reader, token) => {
    const input = { ...setup.input, query: safetyFixtures().query, semantic };
    if (surface === 'evidence' && setup.evidenceInput) return reader.fetchCandidateEvidence(setup.evidenceInput, token);
    if (surface === 'assembly') return reader.contextRead({ ...input, budget: { maxTokens: 4000, maxItems: 12 } }, token);
    const candidates = await reader.findCandidates(input, token);
    if (surface !== 'evidence' || !candidates.ok || !candidates.value.items.length) return candidates;
    return reader.fetchCandidateEvidence({ readSet: input.readSet, intent: input.intent, refs: candidates.value.items.map(i => i.ref), deadlineMs: 5000 }, token);
  });
}
function inspect(envelope, setup, forbidden) {
  const identities = [], scopeCanaries = [], text = JSON.stringify(envelope), fixture = safetyFixtures();
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (value.ref) {
      const identity = setup.fixtureIdentity(value.ref);
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
export async function executeSafety(prepared) {
  const observations = {}, scenarios = safetyFixtures().scenarios;
  if (typeof prepared.prepareSafetyCell !== 'function') return observations;
  for (const id of SAFETY_CELLS) {
    const setup = await prepared.prepareSafetyCell(id);
    try {
      if (id.startsWith('semantic-false/')) {
        const surface = id.endsWith('assembly') ? 'assembly' : 'candidates';
        const start = await setup.semanticCallCount();
        const lexical = await publicRead(setup, surface, await setup.lexicalReaderOptions(), false);
        const explicitFalse = await publicRead(setup, surface, await setup.readerOptions(), false);
        observations[id] = { lexical, explicitFalse, semanticCalls: await setup.semanticCallCount() - start };
      } else if (id === 'owner-purge/all-catalogs') {
        const before = await setup.independentInventory();
        const lexicalBefore = await publicRead(setup, 'candidates', await setup.lexicalReaderOptions(), false);
        const off = await setup.coordinator.setOwnerSemantic(setup.disableInput, setup.serviceCredential);
        let completed = false;
        if (off.ok) for (let quantum = 0; quantum < 128; quantum++) {
          const result = await setup.coordinator.purgeOwnerVectors({ ownerId: 'synthetic-owner', budget: { maxItems: 1024, maxMs: 5000 } }, setup.serviceCredential);
          if (!result.ok) break;
          if (result.value.status === 'complete') { completed = true; break; }
        }
        await setup.drainWriters();
        const after = await setup.independentInventory();
        const lexicalAfter = await publicRead(setup, 'candidates', await setup.lexicalReaderOptions(), false);
        observations[id] = { completed, ownerId: 'synthetic-owner', catalogBefore: before.catalog, catalogAfter: after.catalog,
          rowsBefore: before.rows, rowsAfter: after.rows, otherOwnerBefore: before.otherOwner, otherOwnerAfter: after.otherOwner,
          independentInventory: before.independent === true && after.independent === true, inventoryCoverage: after.coverage,
          noPendingWriters: after.noPendingWriters, lexicalBefore, lexicalAfter };
      } else {
        const forbidden = scenarios.find(s => s.id === id).forbidden, returns = [];
        const receipts = [];
        for (const surface of surfaces) {
          let envelope, entered = 0;
          const receipt = await setup.atMutationBoundary(surface, async () => {
            if (++entered !== 1) throw Error('duplicate_safety_read');
            envelope = await publicRead(setup, surface, await setup.readerOptions(surface));
          });
          if (entered !== 1 || envelope === undefined) throw Error('missing_public_safety_read');
          receipts.push(receipt);
          returns.push({ surface, ...inspect(envelope, setup, forbidden) });
        }
        const o = { returns, forbidden, canonicalSnapshot: receipts.map(r => r.canonicalSnapshot),
          mutationAcknowledged: receipts.every(r => r.mutationAcknowledged === true && r.stoppedAndDrained === true),
          qualifiedHistoryControl: receipts.every(r => r.qualifiedHistoryControl === 'history-eligible@1') ? 'history-eligible@1' : null };
        if (id.startsWith('scope/')) {
          o.withCanary = await publicRead(setup, 'private-metadata', await setup.withCanaryOptions());
          o.withoutCanary = await publicRead(setup, 'private-metadata', await setup.withoutCanaryOptions());
        }
        observations[id] = o;
      }
    } catch { observations[id] = {}; }
    finally { await setup.close(); }
  }
  return observations;
}

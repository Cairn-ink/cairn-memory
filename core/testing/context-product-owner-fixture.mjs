import { randomUUID } from 'node:crypto';
import { openContextProductReader, openContextIndexMaintainer, createContextReadSupervisor } from '../index.mjs';
import { contextReadSet } from '../context-read-input.mjs';
import { credentialDigest, PRODUCT_PROFILE } from '../context-product-control.mjs';
import { ok } from './context-read-fixture.mjs';

export const owner = 'synthetic-owner-wide';
export const personal = { ownerId: owner, scope: 'personal', projectId: null };
export const project = projectId => ({ ownerId: owner, scope: 'project', projectId });
export const four = [personal, project('a'), project('z'), project('é')];
export const descriptor = (readSet, omitted = 0, revision = 'inventory-1') => ({ policy: 'recent-projects-v1', selectionRevision: revision,
  requestedNamespaces: readSet.length + omitted, selectedNamespaces: readSet.length, omittedNamespaces: omitted });
export function configured(t, path, readSet = four, { service = false, ownerCoverage = descriptor(readSet), supervisor = createContextReadSupervisor() } = {}) {
  t.after(() => supervisor.close());
  const token = { opaque: randomUUID() }, ids = { requestId: randomUUID(), handleId: randomUUID(), credentialBindingId: randomUUID(), credentialExpiresUtcMs: null };
  const binding = { kind: service ? 'service' : 'request', ...(service ? { serviceId: randomUUID(), credentialBindingId: ids.credentialBindingId, credentialExpiresUtcMs: null } : ids),
    credentialDigest: credentialDigest(token), ownerId: readSet[0].ownerId, namespaces: { readSet, ownerCoverage }, issuedAt: 0 };
  const state = new SharedArrayBuffer(32), view = new Int32Array(state); view[0] = 1;
  const options = { supervisor, path, version: 'context-read-v1', profile: PRODUCT_PROFILE, readSet, ownerCoverage, diagnostics: true,
    ...(service ? { sidecarJournalMode: 'DELETE' } : { requestControl: { ...ids, requestMaxMs: 5000 } }),
    host: { moduleUrl: new URL('./context-product-index-host.mjs', import.meta.url).href,
      configuration: { [service ? 'serviceBinding' : 'requestBinding']: binding, state, ...(!service ? { requestReservation: new SharedArrayBuffer(4) } : {}) } } };
  return { options, token, view, binding, supervisor, async open() {
    const handle = await (service ? openContextIndexMaintainer : openContextProductReader)(options);
    t.after(() => handle.close()); return handle;
  } };
}
export async function prebuild(config, types = ['memory', 'card']) {
  const h = await config.open(), results = [];
  try {
    for (const intent of ['current', 'history']) {
      let complete = false;
      for (let i = 0; i < 100; i++) {
        const raw = await h.refreshContextIndex({ readSet: config.options.readSet, types, intent, mode: 'lexical', budget: { maxItems: 1024, maxMs: 5000 } }, config.token);
        // A loaded host can overrun one quantum's cutoff; committed checkpoints let the next quantum resume.
        if (!raw.ok && raw.error?.code === 'read_timeout') continue;
        const result = ok(raw);
        if (result.status === 'complete') { results.push(result); complete = true; break; }
      }
      if (!complete) throw Error('fixture prebuild did not complete');
    }
    return results;
  } finally { await h.close(); }
}
export function card(f, namespace, title, body, memory) {
  const draft = ok(f.call('createCardDraft', { namespace, actionId: randomUUID(), drafting: 'authored', input: { title, body,
    ...(memory ? { sourcePolicy: 'retained-receipts-v1', memoryRefs: [{ type: 'memory', namespace, memoryId: memory.id, revision: memory.revision }] }
      : { authoredInput: { text: 'synthetic support', occurredAt: null } }) } }));
  return ok(f.call('confirmCardDraft', { namespace, cardId: draft.id, expectedRevision: draft.revision, actionId: randomUUID(), applicability: 'current' }));
}
export const canonicalSet = value => contextReadSet(value, PRODUCT_PROFILE);
export const denied = (result, code) => {
  if (result.ok || result.error?.code !== code) throw Error('expected ' + code + ': ' + JSON.stringify(result));
};

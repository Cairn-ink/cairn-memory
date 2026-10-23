import { isDeepStrictEqual } from 'node:util';

const reads = new Set(['getCard', 'listCards', 'getSource', 'inspectCardOperation', 'listCardEffects',
  'selectEvidence', 'fetchEvidence', 'revalidateEvidence', 'mapEvidence', 'listEvidenceMappings']);
const methodReads = new Set(['getMethodVersion','listMethodManifest','readMethodFile','listMethodPackages',
  'listMethodVersions','compareMethodVersions','listMethodEffects','getMethodPackageUsage',
  'resolveMethod','resolveMethodsForRole','listMethodBindingEvents']);
const drafts = new Set(['createCardDraft', 'cancelCardDraft']);
const organization = new Set(['applyCardPlacement', 'refreshCardTopic', 'proposeEvidenceMapping']);

// Local process configuration grants only these bounded read/draft/organization operations.
// This module has no explicit-user grant constructor.
export function createScopedCardAccess(namespace, { rawSources = false, methodPackages = false } = {}) {
  const scope = structuredClone(namespace);
  const tokens = new WeakMap(), grants = new WeakMap();
  let closed = false;
  const authority = {
    authorize(request, token) {
      const expected = tokens.get(token);
      if (closed || !expected || !isDeepStrictEqual(request.namespace, scope) ||
          request.method !== expected.method || !isDeepStrictEqual(request.input, expected.input) ||
          !(request.actionClass === 'read' && (reads.has(request.method) || methodPackages && methodReads.has(request.method) || rawSources && request.method === 'resolveSourceReferences') ||
            request.actionClass === 'draft' && drafts.has(request.method) ||
            request.actionClass === 'organization' && organization.has(request.method))) return null;
      const grant = Object.freeze({});
      const { input, ...binding } = request;
      grants.set(grant, { ...binding, accessGeneration: 1 });
      return grant;
    },
    isCurrent(grant) { return closed ? null : grants.get(grant) ?? null; },
  };
  return {
    revoke() { closed = true; },
    configuration: { version: 'private-cards-local-v1', source: 'submitted-note-v1',
      storage: 'local-plain-v1', disclosure: 'explicit-submitted-note-v1', authority },
    ...(methodPackages ? { methodPackageConfiguration: { version: 'method-packages-local-v1', storage: 'local-plain-v1', authority } } : {}),
    call(core, method, input) {
      const refScoped = ['getMethodVersion','listMethodManifest','readMethodFile','listMethodVersions','compareMethodVersions',
        'deleteMethodVersion','deleteMethodPackage','resolveMethod','resolveMethodsForRole','listMethodBindingEvents',
        'adoptMethodVersion','disableMethodBinding'].includes(method);
      const payload = refScoped ? { ...input } : { ...input, namespace: structuredClone(scope) };
      const token = Object.freeze({});
      tokens.set(token, { method, input: structuredClone(payload) });
      try { return core[method](payload, token); }
      finally { tokens.delete(token); }
    },
  };
}

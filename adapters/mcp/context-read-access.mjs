import { isDeepStrictEqual } from 'node:util';
import { cardNamespace } from '../../core/private-card-input.mjs';

export const CONTEXT_TOOL_METHODS = Object.freeze(['findCandidates', 'fetchCandidateEvidence']);
export function createContextReadAccess(namespace, personal = false, { refresh = false } = {}) {
  const scope = Object.freeze(cardNamespace(namespace));
  if (personal && scope.scope !== 'project') throw Error('invalid_mcp_configuration');
  const readSet = Object.freeze(personal ? [Object.freeze({ ownerId: scope.ownerId, scope: 'personal', projectId: null }), scope] : [scope]);
  const methods = refresh ? ['refreshContextIndex'] : CONTEXT_TOOL_METHODS;
  const tokens = new WeakMap(), grants = new WeakMap(); let closed = false;
  const authority = {
    authorize(request, token) {
      const expected = tokens.get(token);
      if (closed || !expected || !methods.includes(request.method) || request.actionClass !== 'read' || request.actionId !== null ||
          request.targetId !== null || request.expectedRevision !== null || !readSet.some(ns => isDeepStrictEqual(ns, request.namespace)) ||
          request.method !== expected.method || !isDeepStrictEqual(request.input, expected.input)) return null;
      const grant = Object.freeze({}), { input, ...binding } = request;
      grants.set(grant, { ...binding, accessGeneration: 1 }); return grant;
    },
    isCurrent(grant) { return closed ? null : grants.get(grant) ?? null; },
  };
  return { namespace: scope, readSet, configuration: { version: 'context-read-v1', authority },
    revoke() { closed = true; },
    includes(namespace) { return readSet.some(ns => isDeepStrictEqual(ns, namespace)); },
    call(core, method, input) {
      if (closed || !methods.includes(method)) return { ok: false, error: { code: 'authority_required', retryable: false } };
      const token = Object.freeze({}); tokens.set(token, { method, input: structuredClone(input) });
      try { return core[method](input, token); } finally { tokens.delete(token); }
    } };
}

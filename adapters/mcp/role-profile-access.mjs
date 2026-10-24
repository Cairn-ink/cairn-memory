import { isDeepStrictEqual as same } from 'node:util';
import { cardNamespace } from '../../core/private-card-input.mjs';
import { ROLE_WRITES } from '../../core/role-profile-input.mjs';

export function createRoleProfileAccess(namespace, readSet, attribution) {
  const scope = Object.freeze(cardNamespace(namespace));
  const scopes = Object.freeze(readSet.map(ns => Object.freeze(cardNamespace(ns))));
  const labels = Object.freeze({ ...attribution });
  const tokens = new WeakMap(), grants = new WeakMap(); let closed = false;
  const authority = {
    authorize(request, token) {
      const expected = tokens.get(token);
      if (closed || !expected || request.method !== expected.method ||
          !scopes.some(ns => same(ns, request.namespace)) || !same(request.input, expected.commitment)) return null;
      if (request.actionClass === 'write') {
        if (!ROLE_WRITES.includes(request.method) || !same(request.namespace, scope) ||
            request.actionId !== expected.input.actionId ||
            request.targetId !== (request.method === 'deleteRoleProfileRelease' ? expected.input.release.releaseId : expected.input.roleKey) ||
            request.expectedRevision !== (request.method === 'deleteRoleProfileRelease' ? expected.input.expectedRevision : expected.input.expectedRegistryRevision)) return null;
      } else if (request.actionClass !== 'read' || request.actionId !== null || request.targetId !== null || request.expectedRevision !== null) return null;
      const grant = Object.freeze({}), { input, ...binding } = request;
      grants.set(grant, { ...binding, accessGeneration: 1 }); return grant;
    },
    isCurrent(grant) { return closed ? null : grants.get(grant) ?? null; },
  };
  return { namespace: scope, readSet: scopes, authority,
    configuration: { version: 'role-profiles-local-v1', storage: 'local-plain-v1', authority, attribution: labels },
    revoke() { closed = true; },
    call(core, method, input) {
      if (closed || ![...ROLE_WRITES, 'readRoleTaskContext'].includes(method)) return { ok: false, error: { code: 'authority_required', retryable: false } };
      const token = Object.freeze({}), snapshot = structuredClone(input);
      tokens.set(token, { method, input: snapshot,
        commitment: ROLE_WRITES.includes(method) ? { payload: snapshot, attribution: labels } : snapshot });
      try { return core[method](input, token); } finally { tokens.delete(token); }
    },
  };
}

// U4 grants remain separate and confined to its startup namespace. Only this
// exact role file request may obtain metadata authority through the U4 port.
export function roleProfileAssetConfiguration(assets, roles) {
  const port = assets.configuration.authority;
  return { ...assets.configuration, authority: {
    authorize(request, token) {
      if (request.method !== 'readRoleTaskContext') return port.authorize(request, token);
      return assets.authorizeRoleFile(request, token, roles.authority);
    },
    isCurrent(grant, request) {
      return port.isCurrent(grant, request);
    },
  } };
}

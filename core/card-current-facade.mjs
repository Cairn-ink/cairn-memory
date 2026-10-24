import { deepFreeze } from './private-card-input.mjs';
import { verifyPrivateGrant } from './private-card-facade.mjs';
import { currentDeclaration } from './card-current-input.mjs';
import { fail } from './validation.mjs';

// Synchronous authority callbacks finish before entering canonical storage.
export function authorizeCardCurrentDependencies(options, request, token) {
  const declaration = currentDeclaration(request.input.currentDependencies, request.namespace);
  const grants = declaration.context.readSet.map(namespace => {
    const selected = deepFreeze({ ...request, namespace, actionClass: 'read', actionId: null, targetId: null, expectedRevision: null });
    const grant = options.authority.authorize(selected, token);
    if (!grant || typeof grant !== 'object' || typeof grant.then === 'function') fail('authority_required');
    return { namespace, request: selected, grant, accessGeneration: verifyPrivateGrant(options.authority.isCurrent(grant, selected), selected) };
  });
  return { access: grants.map(({ namespace, accessGeneration }) => ({ namespace, accessGeneration })), check() {
    for (const value of grants) {
      let generation;
      try { generation = verifyPrivateGrant(options.authority.isCurrent(value.grant, value.request), value.request); } catch { fail('scope_changed'); }
      if (generation !== value.accessGeneration) fail('scope_changed');
    }
  } };
}

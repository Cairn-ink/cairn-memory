import { roleProfileOptions } from '../../core/role-profile-input.mjs';

// Shared by the CLI and programmatic constructor; no store/model access.
export function roleProfileHostConfiguration(options, client = 'cairn-local-mcp') {
  const configured = Object.hasOwn(options, 'roleProfiles');
  if (!configured) {
    if (Object.hasOwn(options, 'roleProfileAttribution')) throw Error('invalid_mcp_configuration');
    return null;
  }
  if (options.roleProfiles !== 'local-v1' || options.methodPackages !== 'local-v1' ||
      options.contextRead !== 'context-read-v1' ||
      Boolean(options.methodReadPersonal) !== Boolean(options.contextReadPersonal)) throw Error('invalid_mcp_configuration');
  const attribution = Object.hasOwn(options, 'roleProfileAttribution') ? options.roleProfileAttribution : { actorId: 'cairn-local-mcp', agentId: client };
  try {
    return roleProfileOptions({ version: 'role-profiles-local-v1', storage: 'local-plain-v1',
      authority: { authorize() {}, isCurrent() {} }, attribution }).attribution;
  } catch { throw Error('invalid_mcp_configuration'); }
}

export function roleProfileCheckConfiguration(config) {
  return { roleProfiles: config.roleProfiles, methodPackages: config.methodPackages,
    methodReadPersonal: config.methodReadPersonal ?? false, roleProfileAttribution: roleProfileHostConfiguration(config, config.client),
    roleProfileMutations: 'direct-agent-write', roleProfileTokenizer: 'o200k_base' };
}

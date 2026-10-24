// SQLite-free configuration shared by CLI and programmatic hosts.
export function cardCurrentHostConfiguration(options) {
  if (!Object.hasOwn(options, 'privateCardCurrentDependencies')) return false;
  if (options.privateCardCurrentDependencies !== 'local-v1' || options.privateCards !== 'local-v1' || options.methodPackages !== 'local-v1') throw Error('invalid_mcp_configuration');
  return true;
}

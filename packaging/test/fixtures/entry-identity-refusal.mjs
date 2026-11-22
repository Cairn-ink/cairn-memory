import { runEntry } from '../../bin/cairn-memory.mjs';

// Use the real CLI in a child, with only the identity import rejected.
process.exitCode = await runEntry(process.argv.slice(2), { platform: 'linux', load: async specifier => {
  if (specifier.endsWith('local-daemon-identity.mjs')) throw Error('synthetic_import_failure');
  if (specifier === '../adapters/mcp/cli.mjs') return import('../../../adapters/mcp/cli.mjs');
  throw Error('unexpected_import');
} });

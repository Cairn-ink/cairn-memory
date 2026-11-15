#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function loadModule(specifier) {
  switch (specifier) {
    case '../integrations/client/raw/local-setup-cli.mjs': return import('../integrations/client/raw/local-setup-cli.mjs');
    case '../adapters/mcp/local-daemon-identity.mjs': return import('../adapters/mcp/local-daemon-identity.mjs');
    case '../adapters/mcp/local-forwarder.mjs': return import('../adapters/mcp/local-forwarder.mjs');
    case '../adapters/mcp/cli.mjs': return import('../adapters/mcp/cli.mjs');
    default: throw Error('cairn_entry_module');
  }
}
// The loader seam lets routing tests observe imports without starting a server.
export async function runEntry(args = process.argv.slice(2), {
  platform = process.platform, load = loadModule,
  stderr = line => process.stderr.write(line),
} = {}) {
  if (args[0] === 'local') {
    const { runLocalSetupCli } = await load('../integrations/client/raw/local-setup-cli.mjs');
    return await runLocalSetupCli(args.slice(1));
  }
  if (platform === 'linux') {
    const { daemonVector } = await load('../adapters/mcp/local-daemon-identity.mjs');
    if (daemonVector(args).eligible) {
      let forwarder, result;
      try {
        forwarder = await load('../adapters/mcp/local-forwarder.mjs');
      } catch { result = { refused: 'daemon_build' }; }
      if (forwarder) result = await forwarder.runForwarder(args);
      if (!result?.refused) {
        if (result) { stderr(result + '\n'); return 1; }
        return 0;
      }
      stderr('cairn_daemon_fallback:' + result.refused + '\n');
    }
  }
  const { start } = await load('../adapters/mcp/cli.mjs');
  await start();
  return 0;
}
const entryPath = fileURLToPath(import.meta.url);
if (process.argv[1] && (process.argv[1] === entryPath || realpathSync(process.argv[1]) === entryPath)) {
  try { process.exitCode = await runEntry(); }
  catch {
    console.error('cairn_mcp_start_failed: check documented startup arguments and dependencies');
    process.exitCode = 1;
  }
}

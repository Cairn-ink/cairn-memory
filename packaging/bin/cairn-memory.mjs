#!/usr/bin/env node
try {
  if (process.argv[2] === 'local') {
    const { runLocalSetupCli } = await import('../integrations/client/raw/local-setup-cli.mjs');
    process.exitCode = await runLocalSetupCli(process.argv.slice(3));
  } else {
    const { start } = await import('../adapters/mcp/cli.mjs');
    await start();
  }
}
catch {
  console.error('cairn_mcp_start_failed: check documented startup arguments and dependencies');
  process.exitCode = 1;
}

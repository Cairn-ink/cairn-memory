#!/usr/bin/env node
import { start } from '../adapters/mcp/cli.mjs';

try { await start(); }
catch {
  console.error('cairn_mcp_start_failed: check documented startup arguments and dependencies');
  process.exitCode = 1;
}

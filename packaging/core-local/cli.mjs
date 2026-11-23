#!/usr/bin/env node
import { serveStdio } from './host.mjs';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('Usage: cairn-memory-core-local [--stdio | --help]\nStaging MCP handshake. The storage adapter is pending.');
} else if (args.length === 0 || (args.length === 1 && args[0] === '--stdio')) {
  await serveStdio(process.stdin, process.stdout);
} else {
  console.error('Invalid candidate arguments. Run with --help.');
  process.exitCode = 2;
}

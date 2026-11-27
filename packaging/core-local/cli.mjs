#!/usr/bin/env node
import { serveStdio } from './host.mjs';

function config(args) {
  const fields = new Map([['--db', 'database'], ['--owner', 'owner'], ['--project', 'project']]);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const field = fields.get(args[index]), value = args[index + 1];
    if (!field || Object.hasOwn(options, field) || !value || value.startsWith('--') || value.includes('\0') ||
        (field !== 'database' && (value.trim() !== value || value.length > 200))) return;
    options[field] = value;
  }
  if (options.database && options.owner) return options;
}

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('Usage: cairn-memory-core-local [--stdio | --help | --db PATH --owner OWNER [--project PROJECT]]');
} else if (args[0] === '--check-config') {
  const { checkProvider } = await import('./provider-check.mjs');
  checkProvider(config(args.slice(1)));
} else if (args[0] === 'raw') {
  const { runRaw } = await import('./raw-cli.mjs');
  await runRaw(args.slice(1));
} else if (args.length === 0 || (args.length === 1 && args[0] === '--stdio')) {
  await serveStdio(process.stdin, process.stdout);
} else {
  const options = config(args);
  if (options) {
    if (/\/engine\/[^/]+\/app\/node_modules\/cairn-memory-core-local-candidate\/packaging\/core-local\/cli\.mjs$/u.test(import.meta.url)) {
      const { serveManaged } = await import('./daemon-entry.mjs');
      await serveManaged(args, options);
    } else await serveStdio(process.stdin, process.stdout, options);
  } else {
    console.error('Invalid candidate arguments. Run with --help.');
    process.exitCode = 2;
  }
}

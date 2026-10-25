#!/usr/bin/env node
// Paid HR-3 stage runner: identical to harness/cli.mjs but with the real OpenAI transport.
// Only the primary runs this, outside any worker sandbox.
import { useInstalledDependencies } from '../harness/dependencies.mjs';
import { OpenAITransport } from './openai-transport.mjs';
const args = process.argv.slice(2), options = {};
const allowed = ['--stage', '--inputs', '--out', '--key-file', '--carry-forward', '--mcp-dependencies', '--tokenizer-dependencies'];
try {
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || !args[i + 1] || Object.hasOwn(options, args[i])) throw Error('Invalid option');
    options[args[i]] = args[i + 1];
  }
  if (!options['--inputs'] || !options['--out'] || !options['--key-file'] || !['smoke', 'pilot'].includes(options['--stage']))
    throw Error('Usage: cli-real.mjs --stage smoke|pilot --inputs DIR --out EMPTY_DIR --key-file FILE');
  useInstalledDependencies({ mcp: options['--mcp-dependencies'], tokenizer: options['--tokenizer-dependencies'] });
  const { run } = await import('../harness/runner.mjs');
  const transport = new OpenAITransport({ keyFile: options['--key-file'] });
  const result = await run({ stage: options['--stage'], inputs: options['--inputs'], out: options['--out'], transport,
    carryForward: options['--carry-forward'] ?? null,
    progress: p => process.stdout.write(JSON.stringify({ progress: p.family, batch: p.batch, scored: p.observations }) + '\n') });
  process.stdout.write(JSON.stringify({ complete: true, observations: result.observations.length, ledger: result.ledger }) + '\n');
} catch (error) {
  process.stderr.write((error.code ?? 'error') + ': ' + error.message + '\n');
  process.exitCode = 1;
}

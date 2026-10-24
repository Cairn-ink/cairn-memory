#!/usr/bin/env node
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { score, validateGold } from './scorer.mjs';

async function main() {
  const args = process.argv.slice(2), options = {};
  if (args.length !== 6) throw new TypeError('Usage: node evaluation/hr3/scorer/cli.mjs --gold FILE --answers FILE --out FILE');
  for (let i = 0; i < args.length; i += 2) {
    if (!['--gold', '--answers', '--out'].includes(args[i]) || Object.hasOwn(options, args[i]) || !args[i + 1]) throw new TypeError('Invalid or duplicate CLI option');
    options[args[i]] = resolve(args[i + 1]);
  }
  if (new Set(Object.values(options)).size !== 3) throw new TypeError('Input and output paths must differ');
  const gold = JSON.parse(await readFile(options['--gold'], 'utf8'));
  validateGold(gold);
  let result;
  try {
    const submission = JSON.parse(await readFile(options['--answers'], 'utf8'));
    result = score(gold, submission);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    // A malformed reader response is a scored observation (§7), not a retry.
    result = score(gold, null);
    result.errors = ['Malformed answers JSON'];
  }
  const tmp = options['--out'] + `.${process.pid}.tmp`;
  let created = false;
  try {
    await writeFile(tmp, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    created = true;
    await rename(tmp, options['--out']);
  } finally { if (created) await unlink(tmp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });

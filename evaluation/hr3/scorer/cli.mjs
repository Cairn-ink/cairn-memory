#!/usr/bin/env node
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { score, validateGold } from './scorer.mjs';
import { stable } from './canonical.mjs';
import { createTriviaAuthority, createTriviaCase, adaptGeneratorTrivia, compileTrivia,
  createUnlicensedTriviaAuthority, createUnlicensedTriviaCase } from './support.mjs';

const usage = 'Usage: node evaluation/hr3/scorer/cli.mjs --gold FILE --answers FILE --out FILE --trivia-binding FILE --trivia-freeze FILE --trivia-freeze-sha256 SHA256';
const bindingFlags = ['--trivia-binding', '--trivia-freeze', '--trivia-freeze-sha256'];
async function authenticate(gold, options) {
  if (!bindingFlags.some(flag => Object.hasOwn(options, flag))) return { gold, scoringOptions: {} };
  if (!bindingFlags.every(flag => Object.hasOwn(options, flag))) throw new TypeError('All three trusted trivia binding options are required');
  const binding = JSON.parse(await readFile(options['--trivia-binding'], 'utf8'));
  const freezeBytes = await readFile(options['--trivia-freeze']);
  if (binding?.mode === 'unlicensed' && Object.keys(binding).length === 2 && Object.hasOwn(binding, 'target')) {
    const authority = createUnlicensedTriviaAuthority(freezeBytes, options['--trivia-freeze-sha256']);
    const unlicensedCase = createUnlicensedTriviaCase({ authority, target: binding.target, gold });
    return { gold, scoringOptions: { unlicensedCase } };
  }
  const fields = ['family', 'caseId', 'question', 'registry'];
  if (!binding || typeof binding !== 'object' || Array.isArray(binding) || Object.keys(binding).length !== fields.length ||
      !fields.every(field => Object.hasOwn(binding, field))) throw new TypeError('Invalid trusted trivia binding file');
  const authority = createTriviaAuthority(freezeBytes, options['--trivia-freeze-sha256']);
  // Expected family/case/question come only from this separate trusted input.
  const target = { family: binding.family, authority, caseId: binding.caseId, question: binding.question };
  const triviaCase = createTriviaCase(target);
  const turns = binding.family.batches.flatMap(batch => batch.turns).map(({ turn_id, text }) => ({ turn_id, text }));
  const rules = await readFile(new URL('../generator/trivia-rules.json', import.meta.url));
  const proof = adaptGeneratorTrivia(binding.registry, rules, turns, target);
  const authentication = compileTrivia(proof, validateGold(gold), triviaCase, gold.question).authentication;
  if (authentication.status !== 'authenticated') throw new TypeError('Invalid trivia binding: ' + authentication.reason);
  // Rehydration must reproduce exactly the gold's declared normalized registry.
  // Do not silently replace mismatched or stripped metadata with another proof.
  if (stable(proof) !== stable(gold.supportTrivia)) throw new TypeError('Trivia binding does not match gold registry');
  return { gold: { ...gold, supportTrivia: proof }, scoringOptions: { triviaCase } };
}

async function main() {
  const args = process.argv.slice(2), options = {};
  if (!args.length || args.length % 2) throw new TypeError(usage);
  for (let i = 0; i < args.length; i += 2) {
    if (!['--gold', '--answers', '--out', ...bindingFlags].includes(args[i]) || Object.hasOwn(options, args[i]) || !args[i + 1]) throw new TypeError('Invalid or duplicate CLI option');
    options[args[i]] = args[i] === '--trivia-freeze-sha256' ? args[i + 1] : resolve(args[i + 1]);
  }
  if (!['--gold', '--answers', '--out'].every(flag => Object.hasOwn(options, flag))) throw new TypeError(usage);
  const paths = Object.entries(options).filter(([flag]) => flag !== '--trivia-freeze-sha256').map(([, path]) => path);
  if (new Set(paths).size !== paths.length) throw new TypeError('Input and output paths must differ');
  const serializedGold = JSON.parse(await readFile(options['--gold'], 'utf8'));
  validateGold(serializedGold);
  const { gold, scoringOptions } = await authenticate(serializedGold, options);
  let result;
  try {
    const submission = JSON.parse(await readFile(options['--answers'], 'utf8'));
    result = score(gold, submission, scoringOptions);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    // A malformed reader response is a scored observation (§7), not a retry.
    result = score(gold, null, scoringOptions);
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

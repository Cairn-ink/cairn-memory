#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

import { prepareLongMemEval, PreparationError } from './prepare.mjs';

const VALUE_OPTIONS = new Map([
  ['--input', 'inputPath'],
  ['--sha256', 'expectedSha256'],
  ['--revision', 'datasetRevision'],
  ['--variant', 'datasetVariant'],
  ['--question-id', 'questionIds'],
  ['--output', 'outputDirectory'],
]);

export const parseArguments = (args) => {
  const options = { questionIds: [] };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!VALUE_OPTIONS.has(flag) || value === undefined || value.startsWith('--')) {
      throw new PreparationError('invalid_options');
    }
    const key = VALUE_OPTIONS.get(flag);
    if (key === 'questionIds') {
      options.questionIds.push(value);
    } else {
      if (seen.has(key)) throw new PreparationError('invalid_options');
      seen.add(key);
      options[key] = value;
    }
  }
  return options;
};

export async function main(args = process.argv.slice(2)) {
  try {
    const result = await prepareLongMemEval(parseArguments(args));
    process.stdout.write(`${JSON.stringify(result.summary)}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof PreparationError ? error.code : 'preparation_failed';
    process.stderr.write(`${JSON.stringify({ error: code })}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}

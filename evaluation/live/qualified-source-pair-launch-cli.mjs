#!/usr/bin/env node
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { QualifiedSourcePairLaunchError, publicQualifiedSourcePairLaunchCode,
  runQualifiedSourcePairLaunch } from './qualified-source-pair-launch.mjs';

export function parseArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== 3) throw new QualifiedSourcePairLaunchError('invalid_arguments');
  let planPath = null;
  let mode = null;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--plan') {
      if (planPath !== null || index + 1 >= argv.length || argv[index + 1].startsWith('--')) {
        throw new QualifiedSourcePairLaunchError('invalid_arguments');
      }
      planPath = argv[++index];
    } else if (flag === '--dry-run' || flag === '--launch') {
      if (mode !== null) throw new QualifiedSourcePairLaunchError('invalid_arguments');
      mode = flag.slice(2);
    } else throw new QualifiedSourcePairLaunchError('invalid_arguments');
  }
  if (!planPath || !mode) throw new QualifiedSourcePairLaunchError('invalid_arguments');
  return { planPath, mode };
}

export async function main(argv, { stdout = process.stdout, stderr = process.stderr,
  fetchImpl = globalThis.fetch, readKey } = {}) {
  try {
    const { planPath, mode } = parseArguments(argv);
    const report = await runQualifiedSourcePairLaunch({ planPath, mode, fetchImpl, readKey });
    stdout.write(`${JSON.stringify(report)}\n`);
    return mode === 'launch' && report.status !== 'completed' ? 1 : 0;
  } catch (error) {
    stderr.write(`${publicQualifiedSourcePairLaunchCode(error)}\n`);
    return 1;
  }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((status) => { process.exitCode = status; }, () => {
    process.stderr.write('launch_failed\n'); process.exitCode = 1;
  });
}

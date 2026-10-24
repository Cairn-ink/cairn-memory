#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { mechanical } from './mechanical.mjs';
import { calibrationGate } from './gate.mjs';
async function main() {
  const [command, ...args] = process.argv.slice(2), opts = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--out', '--index', '--judgments'].includes(args[i]) || !args[i + 1] || opts[args[i]]) throw new Error('Invalid/duplicate CLI option');
    opts[args[i]] = args[i + 1];
  }
  if (command === 'mechanical' && opts['--out'] && Object.keys(opts).length === 1) {
    const s = await mechanical(opts['--out']);
    console.log(JSON.stringify({ pilot: s.pilot, challenge: s.challenge, population: s.population, referralQuotasMet: s.qualification.allQuotasMet, pooledMechanics: s.pooledMechanics }));
    if (s.failures.length) process.exitCode = 1;
  } else if (command === 'gate' && opts['--out'] && opts['--index'] && opts['--judgments'] && Object.keys(opts).length === 3) {
    const index = JSON.parse(await readFile(opts['--index'], 'utf8'));
    const judgments = (await readFile(opts['--judgments'], 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
    const result = calibrationGate(index, judgments);
    await writeFile(opts['--out'], JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ status: result.status, gates: result.gates }));
    process.exitCode = result.status === 'pass' ? 0 : result.status === 'pending' ? 2 : 1;
  } else throw new Error('Usage: cli.mjs mechanical --out NEW_DIR | gate --index private-index.json --judgments judgments.jsonl --out NEW_FILE');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });

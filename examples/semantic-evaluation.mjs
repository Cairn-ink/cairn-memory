import { pathToFileURL } from 'node:url';
import { runEvaluation } from '../evaluations/semantic-runner.mjs';

export async function main(args = process.argv.slice(2), env = process.env) {
  if (args.length !== 3 || args[0] !== '--live' || args[1] !== '--budget-usd' ||
    !/^\d+(?:\.\d+)?$/.test(args[2]) || Number(args[2]) <= 0 || Number(args[2]) > 4.80 ||
    typeof env.OPENAI_API_KEY !== 'string' || !env.OPENAI_API_KEY.trim()) {
    return { ok: false, error: 'Require --live --budget-usd VALUE (0 < VALUE <= 4.80) and OPENAI_API_KEY.' };
  }
  try { return await runEvaluation({ apiKey: env.OPENAI_API_KEY, budgetUsd: Number(args[2]) }); }
  catch { return { ok: false, error: 'evaluation_configuration_failed' }; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await main();
  console.log(JSON.stringify(report, null, 2));
  if (report.summary?.status !== 'passed') process.exitCode = 1;
}

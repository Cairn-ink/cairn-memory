// Opt-in near-deadline measurement; timing qualification stays out of CI suites.
import { tailInvocation } from '../../plugins/cairn-memory/test/fixtures/pause-recall-tail-harness.mjs';
const attempts = Number(process.argv[2] ?? 5);
let pass = 0, fail = 0;
for (const responseMs of [2300, 2450, 2499]) for (const contended of [false, true]) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { const result = await tailInvocation(null, responseMs, contended);
      console.log(JSON.stringify({ attempt, ...result })); pass++;
    } catch (error) { console.log(JSON.stringify({ attempt, responseMs, contended, failure: error.code ?? error.name })); fail++; }
  }
}
console.log(JSON.stringify({ pass, fail }));
process.exitCode = fail ? 1 : 0;

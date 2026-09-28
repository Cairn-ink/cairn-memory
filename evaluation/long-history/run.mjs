import { runGate } from './gate.mjs';

try {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.length === 1 && ![
    '--fault=capacity-second-malformed-extraction',
    '--fault=capacity-second-classification-failure',
  ].includes(args[0])) throw new Error('invalid_gate_arguments');
  const report = await runGate({ fault: args[0]?.slice('--fault='.length) ?? null });
  console.log(JSON.stringify(report));
  if (report.unexpectedCount) {
    console.error(report.failure);
    process.exitCode = 1;
  } else {
    console.error(`Long-history gate: ${report.denominators.requiredPassages} passage checks, `
      + `${report.expectedNegativeCount} expected negative controls, `
      + `${report.stages.answerContextPresent} packed passages; capacity default-prefix control is expected red.`);
  }
} catch (error) {
  // The public command never emits arbitrary exceptions, paths or fixture text.
  console.error(/^gate_[a-z_]+$/u.test(error?.message ?? '') ? error.message : 'long_history_gate_failed');
  process.exitCode = 1;
}

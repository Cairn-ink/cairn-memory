import { runAblation } from './candidate-ablation.mjs';

const report = await runAblation();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

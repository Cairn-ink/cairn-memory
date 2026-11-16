// Synthetic CLI: the supervisor must preserve the failure without a prompt.
import { writeSync } from 'node:fs';

writeSync(1, 'synthetic discarded prefix\n');
writeSync(1, 'sk-synthetic-' + 'x'.repeat(5000) + '\n');
writeSync(1, '界'.repeat(1100) + '\n');
for (const marker of ['sk-', 'ghp_', 'Bearer', 'token=', 'crn_pat_']) {
  writeSync(1, marker + 'synthetic-sensitive-line\n');
}
writeSync(2, 'synthetic diagnostic tail\n');
if (process.argv.includes('--synthetic-signal')) process.kill(process.pid, 'SIGTERM');
else process.exit(process.argv.includes('--synthetic-zero') ? 0 : 23);

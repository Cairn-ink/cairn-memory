import { faults } from './sqlite-helper-child-faults.mjs';
faults.install();
faults.arm(4);
process.on('exit', () => console.error(JSON.stringify({ marker: 'CLI_REAL_HELPER_TIMEOUT', ...faults.counts })));

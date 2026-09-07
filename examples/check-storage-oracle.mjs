import { readFileSync } from 'node:fs';
import { runStorageScenario, storageCaseIds } from '../core/testing/storage-scenarios.mjs';

// Explicit local test input only. No bundled private fixtures, network or secrets.
if (process.argv.length !== 3) throw new Error('usage: node examples/check-storage-oracle.mjs /absolute/path/to/oracle.json');
const corpus = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const id of storageCaseIds) console.log(JSON.stringify(runStorageScenario(corpus, id)));
console.log(JSON.stringify({ passed: storageCaseIds.length, scope: 'storage subset only; no model/MOC/MCP conformance' }));

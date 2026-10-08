#!/usr/bin/env node
// Print the A7 verdict table and certificate in Markdown. Exit 1 unless the
// strict certificate (certify.mjs) passes.
// Usage: node evaluation/codex-a7/report.mjs evaluation/codex-a7/results/<file>.json
import { readFile } from 'node:fs/promises';
import { SCENARIOS } from './scenarios.mjs';
import { certify } from './certify.mjs';

const data = JSON.parse(await readFile(process.argv[2], 'utf8'));
const records = Array.isArray(data.records) ? data.records : [];
console.log(`Host ${data.host}; model ${data.model} (${data.effort}); finished ${data.finishedAt ?? 'unrecorded'}.`);
console.log(`Real ~/.codex config/hooks unchanged: ${data.realCodexUnchanged}; unattributed non-API hits: ${data.unattributedNonApiHits}.\n`);
console.log('| Scenario | Family | Runs | Delivered | Harmful runs | Model mentioned the memory |');
console.log('|---|---|---|---|---|---|');
for (const scenario of SCENARIOS) {
  const runs = records.filter(record => record.scenario === scenario.id);
  const served = scenario.memories.length;
  const delivered = runs.filter(record => record.injected === true && record.memoriesDelivered === `${served}/${served}`).length;
  const harmful = runs.filter(record => record.harmful?.length);
  const kinds = [...new Set(harmful.flatMap(record => record.harmful.map(item => item.kind)))];
  const outcome = scenario.positive ? `${runs.filter(record => record.positivePass).length}/${runs.length} used bun` :
    `${runs.filter(record => record.warned).length}/${runs.length}`;
  console.log(`| ${scenario.id} | ${scenario.family ?? 'positive control'} | ${runs.length} | ${delivered}/${runs.length} (${served}/${served} each) | ` +
    `${harmful.length}${kinds.length ? ` (${kinds.join(', ')})` : ''} | ${outcome} |`);
}
const flags = {};
for (const record of records) for (const flag of record.flags ?? []) flags[flag.kind] = (flags[flag.kind] ?? 0) + 1;
console.log(`\nInformational flags: ${Object.entries(flags).map(([kind, count]) => `${kind} ×${count}`).join(', ') || 'none'}.`);
const { pass, reasons } = certify(data);
console.log(`\nCertificate: **${pass ? 'PASS' : 'FAIL'}** (${records.length} records).`);
for (const reason of reasons.slice(0, 40)) console.log(`- ${reason}`);
if (reasons.length > 40) console.log(`- … ${reasons.length - 40} more`);
process.exitCode = pass ? 0 : 1;

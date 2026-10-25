import { getPriority, cpus, totalmem } from 'node:os';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { run } from './runner.mjs';
import { powerCells, coverageCells } from './design.mjs';
import { mean } from './statistics.mjs';
import { ROOT, atomicJSON } from './storage.mjs';
import { exactEnvelope } from './judgment.mjs';

if (getPriority() < 10) throw Error('Run benchmark with nice -n 10 (or lower CPU priority)');
const out = resolve(process.argv[2] ?? join(ROOT, 'reports', 'benchmark-run'));
const power = powerCells();
const selected = [power.find(c => c.effect === .05 && c.discordance === .3 && c.icc === 0 && !c.guardHarm),
  power.find(c => c.effect === .08 && c.discordance === .5 && c.icc === .3 && c.guardHarm),
  power.find(c => c.effect === 0 && c.discordance === .5 && c.icc === .1 && !c.guardHarm),
  ...coverageCells().filter(c => c.distribution === 'heteroscedastic-normal')];
const start = performance.now();
const manifest = await run({ engineeringSmoke: true, datasets: 1, draws: 10000, cells: selected.map(c => c.id), workers: 1, out });
const wallMs = performance.now() - start;
const measurements = [];
for (const c of manifest.cells) for (const d of JSON.parse(await readFile(join(out, c.resultArtifact), 'utf8')).datasets) {
  const summary = JSON.parse(await readFile(join(out, d.artifact), 'utf8'));
  measurements.push({ cell: c.design, ...summary.timings, bytes: summary.replicateArtifact.bytes });
}
const powerRows = measurements.filter(m => m.cell.kind === 'power'), coverageRows = measurements.filter(m => m.cell.kind === 'coverage');
const powerMs = mean(powerRows.map(m => m.primaryMs + m.lineageMs));
const primaryPowerMs = mean(powerRows.map(m => m.primaryMs)), lineagePowerMs = mean(powerRows.map(m => m.lineageMs));
const coverageMs = mean(coverageRows.map(m => m.primaryMs));
// Each allocation represents 4/12 coverage cells. Normal count-route timing
// is intentionally the conservative representative for all four distributions.
const resamplingHours = (120000 * powerMs + 24000 * coverageMs) / 3600000;
const generationHours = (120000 * mean(powerRows.map(m => m.generationMs)) + 24000 * mean(coverageRows.map(m => m.generationMs))) / 3600000;
const overheadMs = Math.max(0, wallMs - measurements.reduce((s, m) => s + m.primaryMs + m.lineageMs + m.generationMs, 0));
const measuredRuntime = manifest.runtime.timings;
const steadyOverheadMs = Math.max(0, overheadMs - measuredRuntime.fingerprintMs - measuredRuntime.workerStartupMs);
const ioAndRunnerHours = 144000 * steadyOverheadMs / measurements.length / 3600000;
const fixedStartupHours = (measuredRuntime.fingerprintMs + measuredRuntime.workerStartupMs) / 3600000;
const judgmentStart = performance.now();
const keys = Array.from({ length: 8 }, (_, i) => ({ id: `key${i}`, verdict: 1, stratum: 'synthetic', parentRule: 'synthetic-parent' }));
const optimization = exactEnvelope({ keys, strata: { synthetic: .125 }, draws: 10000,
  parentScenarios: [{ name: 'synthetic-parent', keys: keys.map(k => k.id) }],
  buildData: verdicts => ({ names: ['P'], lineages: keys.map(k => ({ id: k.id, type: 'synthetic', weights: [1 / 8], values: [[verdicts.get(k.id)], [verdicts.get(k.id)]] })) }) });
const judgmentMs = performance.now() - judgmentStart;
const report = { status: 'ENGINEERING THROUGHPUT ONLY; NOT A VALIDATION CERTIFICATE', measuredAt: new Date().toISOString(),
  implementationSHA256: manifest.implementation.sha256, node: process.version, nice: getPriority(), workers: 1,
  peakRSSKiB: process.resourceUsage().maxRSS,
  host: { logicalCPUs: cpus().length, cpu: cpus()[0].model, totalMemoryBytes: totalmem() }, wallMs, measurements,
  measuredRuntime, judgmentOptimization: { wallMs: judgmentMs, keys: 8, budget: 1, assignments: optimization.assignments, parentScenarios: optimization.parentScenarios,
    drawsPerAssignment: 10000, note: 'Synthetic exact-optimization throughput only; exponential key-space scaling forbids a production projection without a frozen key registry.' },
  observedMeansMs: { correctedPower: primaryPowerMs, lineagePower: lineagePowerMs, coverage: coverageMs, overheadPerDataset: overheadMs / measurements.length,
    steadyOverheadPerDataset: steadyOverheadMs / measurements.length },
  projection: { powerDatasets: 120000, primaryReplicates: 1200000000, lineageReplicates: 1200000000,
    coverageDatasets: 24000, coverageReplicates: 240000000, serialResamplingHours: resamplingHours, generationHours, ioAndRunnerHours,
    fixedStartupHours, serialTotalHours: resamplingHours + generationHours + ioAndRunnerHours + fixedStartupHours,
    planningHours: Math.max(36, 1.5 * (resamplingHours + generationHours + ioAndRunnerHours)),
    fourWorkerIdealHours: (resamplingHours + generationHours + ioAndRunnerHours) / 4,
    retainedReplicateBytes: 120000 * 10000 * 8 * 10 + 24000 * 10000 * 8 * 13,
    exclusions: ['Production judgment-error optimization, adjudication/subscription benchmarking, audit/review, shared-machine contention; four-worker speedup is unmeasured.'],
    caveats: ['Six full-draw datasets, one per selected cell; noisy throughput, not full-cell validation.', 'Coverage projection uses three normal cells (one per allocation); binary distribution timing can differ.', 'Fixed fingerprint/worker startup separated from projected steady overhead; checkpoint scan and growing manifests on the full run can be slower.', 'I/O phases include encoding, hashing and filesystem calls; hot-cache microbenchmarks do not guarantee sustained disk throughput.'] } };
await atomicJSON(join(ROOT, 'reports', 'benchmark.json'), report);
console.log(JSON.stringify(report, null, 2));

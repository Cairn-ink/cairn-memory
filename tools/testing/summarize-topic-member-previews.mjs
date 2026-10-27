// Read-only report analysis. Never print page data, profiles, SQL or full records.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function analyzeReport(report, minimumMs = 50) {
  const blocks = [], seriesTally = {}, matrix = {}, nonPassChecks = {};
  for (const [cellIndex, entry] of report.cells.entries()) {
    const shape = ['count','schema','journal','selection','limit','load'].map(k => entry.cell[k]).join('/');
    const group = ['count','schema','journal'].map(k => entry.cell[k]).join('/');
    matrix[group] ??= {};
    for (const d of [...(entry.decisions ?? []), ...(entry.retained?.decision ? [{ ...entry.retained, series: 'retained' }] : [])]) {
      const tally = seriesTally[d.series] ??= { pass: 0, inconclusive: 0, fail: 0 };
      tally[d.decision]++;
      const key = `${d.series}:${d.decision}`;
      matrix[group][key] = (matrix[group][key] ?? 0) + 1;
      if (d.decision !== 'pass') for (const [check, value] of Object.entries(d.checks ?? {})) {
        if (value === true) continue;
        const key = `${d.decision}:${check}=${value}`;
        nonPassChecks[key] = (nonPassChecks[key] ?? 0) + 1;
      }
    }
    const scan = (series, attempt, record) => {
      for (const kind of ['hostLoop','launcherLoop']) {
        const loop = record?.[kind];
        if (!loop || loop.maxMs <= minimumMs) continue;
        const known = (loop.blocks ?? []).filter(b => b.gapMs > minimumMs);
        // Older reports retain only >100ms gaps: a maximum is not a timestamped gap.
        const rows = known.length ? known : [{ gapMs: loop.maxMs, startedAt: null, finishedAt: null }];
        for (const b of rows) blocks.push({ cell: cellIndex, shape, series, attempt, kind,
          ...b, intervalStart: loop.startedAt ?? record.startedAt, intervalEnd: loop.finishedAt ?? record.finishedAt,
          precision: b.startedAt == null ? 'interval-maximum-only' : 'timestamped',
          attribution: b.attribution ?? null });
      }
    };
    for (const series of ['warmups','main','cold']) for (const [i, record] of (entry[series] ?? []).entries()) scan(series, i, record);
    if (entry.retained) scan('retained', null, entry.retained);
  }
  blocks.sort((a,b) => (a.startedAt ?? a.intervalStart) - (b.startedAt ?? b.intervalStart));
  const byCell = {}, bySeries = {};
  for (const row of blocks) {
    byCell[row.cell] = (byCell[row.cell] ?? 0) + 1;
    const key = `${row.series}/${row.kind}`;
    bySeries[key] = (bySeries[key] ?? 0) + 1;
  }
  return { seriesTally, matrix, nonPassChecks, blocks, byCell, bySeries };
}

export function printSummary(report, write = line => console.log(line)) {
  const result = analyzeReport(report);
  write(JSON.stringify({ status: report.status, node: report.node, cells: report.cells.length,
    seriesTally: result.seriesTally, matrix: result.matrix, nonPassChecks: result.nonPassChecks }));
  write('Blocks >50ms; old reports provide only one interval maximum when individual gaps were not saved.');
  write('UTC start (or observation interval) | cell | shape | series/attempt | loop | ms | phases | precision | attribution');
  for (const b of result.blocks) write([
    b.startedAt == null ? `${new Date(b.intervalStart).toISOString()}..${new Date(b.intervalEnd).toISOString()}` : new Date(b.startedAt).toISOString(),
    b.cell, b.shape, `${b.series}/${b.attempt ?? '-'}`, b.kind, b.gapMs.toFixed(3),
    `${b.phaseStart ?? '?'} -> ${b.phaseEnd ?? '?'}`, b.precision, JSON.stringify(b.attribution),
  ].join(' | '));
  write(JSON.stringify({ rows: result.blocks.length, byCell: result.byCell, bySeries: result.bySeries }));
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = JSON.parse(await readFile(process.argv[2], 'utf8'));
  printSummary(report);
}

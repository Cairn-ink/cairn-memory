// Read-only report analysis. Never print page data, profiles, SQL or full records.
import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function accumulator(minimumMs) {
  const blocks = [], seriesTally = {}, matrix = {}, nonPassChecks = {};
  function cell(entry, cellIndex) {
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
  function finish() {
    blocks.sort((a,b) => (a.startedAt ?? a.intervalStart ?? Infinity) - (b.startedAt ?? b.intervalStart ?? Infinity));
    const byCell = {}, bySeries = {};
    for (const row of blocks) {
      byCell[row.cell] = (byCell[row.cell] ?? 0) + 1;
      const key = `${row.series}/${row.kind}`;
      bySeries[key] = (bySeries[key] ?? 0) + 1;
    }
    return { seriesTally, matrix, nonPassChecks, blocks, byCell, bySeries };
  }
  return { cell, finish };
}

export function analyzeReport(report, minimumMs = 50) {
  const analysis = accumulator(minimumMs);
  report.cells.forEach((entry, i) => analysis.cell(entry, i));
  return analysis.finish();
}

function printAnalysis(header, cells, result, write) {
  write(JSON.stringify({ status: header.status, node: header.node, cells,
    seriesTally: result.seriesTally, matrix: result.matrix, nonPassChecks: result.nonPassChecks }));
  write('Blocks >50ms; old reports provide only one interval maximum when individual gaps were not saved.');
  write('UTC start (or observation interval) | cell | shape | series/attempt | loop | ms | phases | precision | attribution');
  for (const b of result.blocks) write([
    b.startedAt == null ? `${formatTime(b.intervalStart)}..${formatTime(b.intervalEnd)}` : formatTime(b.startedAt),
    b.cell, b.shape, `${b.series}/${b.attempt ?? '-'}`, b.kind, b.gapMs.toFixed(3),
    `${b.phaseStart ?? '?'} -> ${b.phaseEnd ?? '?'}`, b.precision, JSON.stringify(b.attribution),
  ].join(' | '));
  write(JSON.stringify({ rows: result.blocks.length, byCell: result.byCell, bySeries: result.bySeries }));
  return result;
}

const formatTime = value => {
  if (!Number.isFinite(value)) return 'unavailable';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : 'unavailable';
};

export function printSummary(report, write = line => console.log(line)) {
  return printAnalysis(report, report.cells.length, analyzeReport(report), write);
}

// Parse one top-level field or cell at a time. A cell's raw text and object
// are released before the next cell. Strings/escapes/nesting can cross any
// chunk boundary. No report-sized string or object graph is constructed.
async function* reportParts(chunks) {
  let state = 'root', key, capture, seenCells = false;
  for await (const chunk of chunks) {
    let start = capture ? 0 : -1;
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (capture) {
        const primitiveEnd = capture.primitive && /[\s,}\]]/.test(c);
        if (!primitiveEnd) {
          if (capture.string) {
            if (capture.escape) capture.escape = false;
            else if (c === '\\') capture.escape = true;
            else if (c === '"') capture.string = false;
          } else if (c === '"') capture.string = true;
          else if (c === '{' || c === '[') capture.depth++;
          else if (c === '}' || c === ']') capture.depth--;
        }
        const complete = primitiveEnd || !capture.primitive && !capture.string && capture.depth === 0;
        if (!complete) continue;
        capture.parts.push(chunk.slice(start, primitiveEnd ? i : i + 1));
        const value = JSON.parse(capture.parts.join('')), type = capture.type;
        capture = undefined; start = -1;
        if (type === 'key') {
          if (typeof value !== 'string') throw Error('invalid_report_key');
          key = value; state = 'colon';
        } else if (type === 'cell') { state = 'cell-separator'; yield { type, value }; }
        else { state = 'field-separator'; yield { type, key, value }; }
        if (primitiveEnd) i--;
        continue;
      }
      if (/\s/.test(c)) continue;
      if (state === 'root' && c === '{') { state = 'key-or-end'; continue; }
      if (['key-or-end','field-separator'].includes(state) && c === '}') { state = 'done'; continue; }
      if (state === 'field-separator' && c === ',') { state = 'key'; continue; }
      if (state === 'colon' && c === ':') { state = 'value'; continue; }
      if (state === 'value' && key === 'cells' && c === '[' && !seenCells) {
        seenCells = true; state = 'cell-or-end'; continue;
      }
      if (['cell-or-end','cell-separator'].includes(state) && c === ']') { state = 'field-separator'; continue; }
      if (state === 'cell-separator' && c === ',') { state = 'cell'; continue; }
      const type = ['key','key-or-end'].includes(state) && c === '"' ? 'key' :
        ['cell','cell-or-end'].includes(state) && c === '{' ? 'cell' :
          state === 'value' && key !== 'cells' ? 'header' : null;
      if (!type) throw Error('invalid_report_structure');
      capture = { type, parts: [], depth: 0, string: false, escape: false, primitive: !'{["'.includes(c) };
      start = i; i--; // Consume the value's first character with the same scanner.
    }
    if (capture) capture.parts.push(chunk.slice(start));
  }
  if (capture || state !== 'done' || !seenCells) throw Error('incomplete_report');
}

export async function analyzeReportStream(chunks, minimumMs = 50) {
  const analysis = accumulator(minimumMs), header = {};
  let cells = 0;
  for await (const part of reportParts(chunks)) {
    if (part.type === 'cell') analysis.cell(part.value, cells++);
    else if (['status','node'].includes(part.key)) header[part.key] = part.value;
  }
  return { header, cells, result: analysis.finish() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = createReadStream(process.argv[2], { encoding: 'utf8', highWaterMark: 65536 });
  const { header, cells, result } = await analyzeReportStream(input);
  printAnalysis(header, cells, result, line => console.log(line));
}

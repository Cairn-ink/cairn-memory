import { appendFileSync, writeFileSync } from 'node:fs';

// Node's destination is stdout, but this reporter yields nothing. Own all file
// I/O so an open, write or flush error cannot escape into the test runner.
export default async function* fileTimingReporter(source) {
  const timingsFile = process.env.CORE_SHARD_TIMINGS_FILE;
  let recording = Boolean(timingsFile);
  let records = 0;
  let failedTopLevel = 0;
  let runnerFailed = null;
  const stop = () => {
    recording = false;
    // Invalidate even an end record whose write succeeded but flush failed.
    try { writeFileSync(timingsFile, '{"type":"incomplete"}\n', { flush: true }); } catch {}
  };
  try { if (recording) writeFileSync(timingsFile, '', { flush: true }); } catch { stop(); }
  const append = record => {
    if (!recording) return;
    try { appendFileSync(timingsFile, `${JSON.stringify(record)}\n`, { flush: true }); } catch { stop(); }
  };
  for await (const { type, data } of source) {
    if ((type === 'test:pass' || type === 'test:fail') && data.nesting === 0) {
      records++;
      if (type === 'test:fail') failedTopLevel++;
      append({ file: data.file ?? null, name: data.name,
        durationMs: data.details?.duration_ms ?? 0, outcome: type === 'test:pass' ? 'pass' : 'fail' });
    }
    // Both supported Node versions emit root diagnostics and test:summary.
    // File-level summaries/diagnostics must not stand in for the runner total.
    if (type === 'test:diagnostic' && data.nesting === 0 && !data.file && /^fail \d+$/.test(data.message)) {
      runnerFailed = Number(data.message.slice(5));
    }
    if (type === 'test:summary' && !data.file) runnerFailed = data.counts?.failed ?? null;
  }
  append({ type: 'end', failedTopLevel, records, runnerFailed, evidenceId: process.env.CORE_SHARD_EVIDENCE_ID });
}

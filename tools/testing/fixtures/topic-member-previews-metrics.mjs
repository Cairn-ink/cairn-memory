// Measurement-only preload. Only numeric extraction coverage leaves this Worker.
import { channel } from 'node:diagnostics_channel';
import { workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { PREVIEW_SOURCE_SQL } from '../../../core/topic-member-previews-storage.mjs';
const prepare = DatabaseSync.prototype.prepare;
let extractions = [0,0,0,0], bytes = [0,0,0,0], mismatches = 0;
DatabaseSync.prototype.prepare = function(sql) {
  const statement = Reflect.apply(prepare, this, [sql]);
  if (sql !== PREVIEW_SOURCE_SQL) return statement;
  const get = statement.get;
  statement.get = function(...args) {
    const row = Reflect.apply(get, this, args), expected = workerData.previewSourceCases?.[args[0]];
    if (expected) {
      const i = expected.caseIndex;
      extractions[i]++;
      bytes[i] += row?.source?.byteLength ?? 0;
      if (row?.source_type !== 'text' || row.source_bytes !== expected.bytes || row.source?.byteLength !== expected.bytes) mismatches++;
    }
    return row;
  };
  return statement;
};
channel('cairn.topic-member-previews.metrics').subscribe(value => {
  workerData.previewMetricsPort.postMessage({ ...value, edgeCaseExtractions: extractions,
    edgeCaseSourceBytes: bytes, edgeCaseMismatches: mismatches });
  extractions = [0,0,0,0]; bytes = [0,0,0,0]; mismatches = 0;
});

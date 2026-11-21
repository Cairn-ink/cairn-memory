import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { compareWideTraces, hash, reconstructWideTrace, reviseSQL, summary, wideArchiveMode } from '../testing/card-lineage-off-wide-compare.mjs';
import { assertArchivedOpeners, assertCurrentOpenerCensus, callOffsetHash, currentOpenerPins, filterOpenerTrace, openerPins,
  reconstructOpenerTrace, run, validateOpenerData } from '../testing/card-lineage-off-wide-opener.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
// Qualification can supply an unpacked archive. Shallow CI replays the frozen pins.
const archiveSource = process.env.CAIRN_WIDE_OPENER_ARCHIVE_SOURCE;
const archiveMode = wideArchiveMode(Boolean(archiveSource));
validateOpenerData(openerPins);

for (const [key, pin] of Object.entries(openerPins.filtered)) {
  const [mode, cell] = key.split(':');
  test(`lineage-zero ${key}: actual deferred opener and exact reconstruction`, t => {
    const { path } = createTestWorkspace(t, { prefix: 'lineage-off-wide-opener-' });
    const current = run(root, join(path, 'current.sqlite'), mode, cell);
    const filtered = filterOpenerTrace(key, current);
    assertCurrentOpenerCensus(key, current, openerPins);
    assert.equal(hash(filtered.statements), pin.sql, `${key} pre-211 SQL and bindings`);
    const reconstructed = reconstructOpenerTrace(key, filtered);
    assert.deepEqual(reconstructed.calls, current.calls, `${key} reconstructed call results and offsets`);
    assert.equal(hash(reconstructed.statements), hash(current.statements), `${key} reconstructed deferred SQL and bindings`);
    assert.deepEqual(summary(current), currentOpenerPins(key, summary(filtered), openerPins), `${key} deferred trace pins`);

    if (archiveMode === 'archive') {
      const archived = run(archiveSource, join(path, 'archived.sqlite'), mode, cell);
      assertArchivedOpeners(key, archived, openerPins);
      assert.deepEqual({
        statements: archived.statements.length, sql: hash(archived.statements), callOffsets: callOffsetHash(archived.calls),
      }, openerPins.rawArchive[key], `${key} raw archived opener pins before any revision`);
      if (mode === 'open') {
        reviseSQL(key, archived.statements, openerPins.sqlRevisions);
        compareWideTraces({ key, current, archived, sqlAdditionPolicy: { openerProbes: openerPins.openerProbes } });
        return;
      }
      const revised = reconstructWideTrace(key, archived, [], [], { openerProbes: openerPins.openerProbes });
      reviseSQL(key, revised.statements, openerPins.sqlRevisions);
      let inserted = 0;
      for (const { archivedIndex, index } of pin.openers) {
        const rows = openerPins.openerProbes.sqlAdditions.filter(entry => entry.key === key && entry.index === archivedIndex);
        const start = archivedIndex + inserted - 1;
        const live = index + inserted - 1;
        assert.deepEqual(current.statements.slice(live, live + rows.length + 2),
          revised.statements.slice(start, start + rows.length + 2), `${key} deferred opener reconstructed from raw archive`);
        inserted += rows.length;
      }
    }
  });
}

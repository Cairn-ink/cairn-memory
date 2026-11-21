import assert from 'node:assert/strict';
import test from 'node:test';
import { compareWideTraces, receiptWalkSQL } from '../testing/card-lineage-off-wide-compare.mjs';

const secretRead = ['SELECT secret FROM episode_identity WHERE singleton=1', 'get', []];
const denialRead = [
  'SELECT s.fingerprint FROM json_each(?) w CROSS JOIN suppressed s WHERE s.owner_id=? AND s.scope=? AND s.project_id=? AND s.fingerprint=w.value',
  'all',
  ['["rs1:i:synthetic"]', 'synthetic-owner', 'personal', ''],
];
const result = { ok: true };

function traces(key, method) {
  const opener = ['PRAGMA user_version', 'get', []];
  const read = ['SELECT 1', 'get', []];
  const make = (inside, outside = []) => ({
    statements: [opener, read, ...inside, ...outside],
    calls: [['open', result, 1], [method, result, 1, 2 + inside.length]],
    dump: [],
    effectWitnesses: [],
  });
  const compare = (inside, outside) => compareWideTraces({
    key,
    current: make(inside, outside),
    archived: make([]),
    receiptWalk: true,
    checkArchivedCardTexts: false,
    receiptWalkRecords: {
      additions: [{ key, callIndex: 1, method, statement: secretRead, archivedCount: 0, currentCount: 1 }],
      removals: [],
    },
  });
  return compare;
}

test('wide correct rejects an unreviewed namespace-bound denial read', () => {
  const compare = traces('workload:52', 'correct');
  compare([secretRead]);
  // The tag predates the denial SQL classifier. Both gates must reject the row.
  const message = receiptWalkSQL(denialRead)
    ? /correct reviewed receipt row multiplicity: .* archive 0, current 1/
    : /correct statement count cannot rise after removing exactly ledger rows/;
  assert.throws(() => compare([secretRead, denialRead]), { code: 'ERR_ASSERTION', message });
});

test('wide correct rejects a reviewed receipt addition with the wrong count', () => {
  const compare = traces('workload:52', 'correct');
  compare([secretRead]);
  assert.throws(() => compare([secretRead, secretRead]), {
    code: 'ERR_ASSERTION', message: /correct reviewed receipt row multiplicity: .* archive 0, current 2/,
  });
  assert.throws(() => compare([]), {
    code: 'ERR_ASSERTION', message: /correct reviewed receipt row multiplicity: .* archive 0, current 0/,
  });
});

test('wide legacy total rejects one unreviewed statement over the archive after receipt credit', () => {
  const compare = traces('workload:23', 'capture');
  compare([secretRead]);
  assert.throws(() => compare([secretRead], [['SELECT 2', 'get', []]]), {
    code: 'ERR_ASSERTION', message: 'receipt batching only reduces SQL after removing ledger rows',
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as suppression from '../../../core/content-suppression-storage.mjs';
import { transaction } from '../../../core/database.mjs';
import { layouts, label, paired, correction, rows, noEcho, sql } from './fixtures/survivor-correction.mjs';
import { checkpoint, bytes } from './fixtures/forget-episode-assertions.mjs';

for (const options of layouts.filter(o => o.layout >= 48)) {
  test('correction denials identify only the Memory decision path ' + label(options), { concurrency: false }, async t => {
    const f = await paired(t, options, 'forget');
    sql(f.path, db => transaction(db, () => {
      const target = { memoryId: f.survivor.id, revision: f.survivor.revision };
      const raw = suppression.memoryCorrectionDenialsInside(db, f.namespace, target);
      assert.equal(raw.length, 1, 'the sibling receipt and memory facts are not own facts on this target');
      assert.deepEqual(Object.keys(raw[0]).sort(), ['factId', 'kind', 'matchMode', 'matchPath', 'reason']);
      assert.match(raw[0].factId, /^[a-f0-9]{64}$/);
      assert.deepEqual({ ...raw[0], factId: null }, { factId: null, kind: 'raw', matchMode: 'span',
        matchPath: 'raw-ancestry', reason: 'user_forget' });
      for (const [kind, key] of [['memory', f.survivor.id], ['receipt', f.receipt.id]])
        suppression.writeContentSuppressionInside(db, { namespace: f.namespace, kind, key,
          reason: 'user_forget', actionId: 'same-reason-own-' + kind });
      const mixed = suppression.memoryCorrectionDenialsInside(db, f.namespace, target);
      assert.deepEqual(mixed.map(({ kind, matchMode, matchPath, reason }) => [kind, matchMode, matchPath, reason]).sort(), [
        ['memory', 'incarnation', 'target', 'user_forget'], ['raw', 'span', 'raw-ancestry', 'user_forget'],
      ], 'a direct receipt marker is outside the receipt-less Memory decision');
    }));
  });
  test('survivor correction refuses a non-span Raw fact ' + label(options), { concurrency: false }, async t => {
    const f = await paired(t, options, 'forget');
    sql(f.path, db => transaction(db, () => suppression.writeContentSuppressionInside(db, {
      namespace: f.namespace, kind: 'raw', key: f.conversation.id, reason: 'user_forget', actionId: 'whole-raw-denial' })));
    checkpoint(f); const before = rows(f), oldBytes = bytes(f);
    const result = await f.core.correct(correction(f));
    noEcho(result, f.needles);
    assert.deepEqual(result, { ok: false, error: { code: 'memory_suppressed', retryable: false } });
    assert.deepEqual(rows(f), before);
    assert.deepEqual(bytes(f), oldBytes);
  });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { splitSources } from '../testing/content-safety-split-audit.mjs';

const reviewed = JSON.parse(readFileSync(new URL('./fixtures/receipt-event-time-static-gate.json', import.meta.url), 'utf8'));
const digest = value => createHash('sha256').update(value).digest('hex');

// A closed, sink-oriented gate: metadata defines/attests the tuple; serving
// consumers are byte-pinned receipt writes/validation, the receipts column
// check, and capabilities. Pin whole regions so a local flag alias cannot
// escape or select another S2h path inside an otherwise approved module.
// Unknown syntax/consumers require review, rather than guessed dataflow.
function assertFeatureConsumers(sources) {
  for (const pin of reviewed) {
    const source = sources.get(pin.file);
    assert.equal(typeof source, 'string', 'missing reviewed feature region: ' + pin.file);
    const start = pin.start === null ? 0 : source.indexOf(pin.start);
    const end = pin.end === null ? source.length : source.indexOf(pin.end, start + (pin.start?.length ?? 0));
    assert.ok(start >= 0 && end > start, 'missing feature region: ' + pin.purpose);
    if (pin.start !== null) assert.equal(source.indexOf(pin.start, start + 1), -1, 'ambiguous feature region');
    assert.equal(digest(source.slice(start, end)), pin.sha256, 'review feature consumer: ' + pin.purpose);
  }
  for (const [file, original] of sources) {
    let source = original;
    const regions = reviewed.filter(pin => pin.file === file).map(pin => {
      const start = pin.start === null ? 0 : original.indexOf(pin.start);
      return [start, pin.end === null ? original.length : original.indexOf(pin.end, start + (pin.start?.length ?? 0))];
    }).sort((a,b) => b[0] - a[0]);
    for (const [start,end] of regions) source = source.slice(0,start) + ' '.repeat(end-start) + source.slice(end);
    // The input normalizer has the same name as the attested property. Only
    // unaliased imports from validation.mjs and direct calls are unrelated to
    // the flag. Property reads, computed string keys and destructuring remain.
    let inputValidator = false;
    source = source.replace(/import\s*\{([^{}]*)\}\s*from\s*(['"])([^'"]*\/validation\.mjs)\2\s*;/g, (declaration, bindings) => {
      if (!bindings.split(',').some(binding => binding.trim() === 'receiptEventTime')) return declaration;
      inputValidator = true;
      return declaration.replace(/\breceiptEventTime\b/g, 'inputTimeValidator');
    });
    if (inputValidator) source = source.replace(/(?<![\w.$'"?])\breceiptEventTime(?=\s*\()/g, 'inputTimeValidator');
    assert.doesNotMatch(source, /\breceiptEventTime\b|\breceipt_event_time\b|\battestedFeatures\b/,
      'unreviewed attested feature consumer: ' + file);
  }
}

test('static gate: only receipt writes/validation, receipts columns and capabilities consume the attested flag', t => {
  const sources = splitSources();
  assertFeatureConsumers(sources);
  t.diagnostic(`scanned ${sources.size} production modules; ${reviewed.length} pinned metadata/validator/consumer regions`);
});

for (const [name, code] of [
  ['direct read', 'if (layout.receiptEventTime) chooseOtherS2hPath();'],
  ['optional read', 'if (cachedContentLayout(db)?.receiptEventTime) chooseOtherS2hPath();'],
  ['computed key', "if (layout['receiptEventTime']) chooseOtherS2hPath();"],
  ['destructured alias', 'const {receiptEventTime: enabled} = layout;'],
  ['snake-case control read', 'const enabled = row.receipt_event_time;'],
  ['family used as feature', 'if (layout.attestedFeatures) chooseOtherS2hPath();'],
]) test('static gate rejects another S2h consumer: ' + name, () => {
  const sources = splitSources();
  sources.set('core/unreviewed-feature-consumer.mjs', code);
  assert.throws(() => assertFeatureConsumers(sources), /unreviewed attested feature consumer/);
});

test('static gate rejects an alias escaping the reviewed receipts insert', () => {
  const sources = splitSources();
  sources.set('core/runtime.mjs', sources.get('core/runtime.mjs').replace(
    '    const eventTime = cachedContentLayout(db)?.receiptEventTime === true;',
    '    const eventTime = cachedContentLayout(db)?.receiptEventTime === true; chooseOtherS2hPath(eventTime);'));
  assert.throws(() => assertFeatureConsumers(sources), /review feature consumer/);
});

test('static gate rejects a new branch inside the approved capabilities region', () => {
  const sources = splitSources();
  sources.set('core/context-product-worker.mjs', sources.get('core/context-product-worker.mjs').replace(
    'function capabilities() {', 'function capabilities() { chooseOtherS2hPath(facade.capabilities.receiptEventTime);'));
  assert.throws(() => assertFeatureConsumers(sources), /review feature consumer/);
});

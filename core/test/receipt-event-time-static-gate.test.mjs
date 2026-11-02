import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { featureSources, assertFeatureImports } from '../testing/receipt-event-time-audit.mjs';
import { resolveContentLayout } from '../content-safety-layout.mjs';

const reviewed = JSON.parse(readFileSync(new URL('./fixtures/receipt-event-time-static-gate.json', import.meta.url), 'utf8'));
const digest = value => createHash('sha256').update(value).digest('hex');

// A closed, sink-oriented gate: metadata defines/attests the tuple; serving
// consumers are byte-pinned receipt writes/validation, the receipts column
// check, and capabilities. Pin whole regions so a local flag alias cannot
// escape or select another S2h path inside an otherwise approved module.
// Unknown syntax/consumers require review, rather than guessed dataflow.
function assertFeatureConsumers(sources) {
  assertFeatureImports(sources);
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
    // The proof rests on private storage and the closed accessor graph above.
    // Also reject stale public-property spellings, including the review's
    // concatenated literal, rather than silently accepting dead feature reads.
    let previous;
    do {
      previous = source;
      source = source.replace(/(['"])([\w$]+)\1\s*\+\s*(['"])([\w$]+)\3/g, (_, quote, left, other, right) => quote + left + right + quote);
    } while (source !== previous);
    // Only the three exact named imports may introduce this accessor binding.
    source = source.replace(/import\s*\{[^{}]*\}\s*from\s*(['"])[^'"]*\/content-safety-schema\.mjs\1\s*;/g,
      declaration => declaration.replace(/\breceiptEventTimeEnabled\b/g, 'approvedFeatureImport'));
    assert.doesNotMatch(source, /\breceiptEventTimeEnabled\b|\breceiptEventTime\b|\breceipt_event_time\b|\battestedFeatures\b/,
      'unreviewed attested feature consumer: ' + file);
  }
}

test('static gate: only receipt writes/validation, receipts columns and capabilities consume the attested flag', t => {
  const sources = featureSources();
  assertFeatureConsumers(sources);
  t.diagnostic(`scanned ${sources.size} production modules; ${reviewed.length} pinned metadata/validator/consumer regions`);
});

for (const [name, code] of [
  ['direct read', 'if (layout.receiptEventTime) chooseOtherS2hPath();'],
  ['optional read', 'if (cachedContentLayout(db)?.receiptEventTime) chooseOtherS2hPath();'],
  ['review concatenated key', "if (layout['receipt' + 'EventTime']) chooseOtherS2hPath();"],
  ['computed key', "if (layout['receiptEventTime']) chooseOtherS2hPath();"],
  ['layout alias', "const alias = layout; if (alias['receipt' + 'EventTime']) chooseOtherS2hPath();"],
  ['layout spread', "const copy = { ...layout }; if (copy['receipt' + 'EventTime']) chooseOtherS2hPath();"],
  ['computed destructuring', "const { ['receipt' + 'EventTime']: enabled } = layout;"],
  ['destructured alias', 'const {receiptEventTime: enabled} = layout;'],
  ['snake-case control read', 'const enabled = row.receipt_event_time;'],
  ['family used as feature', 'if (layout.attestedFeatures) chooseOtherS2hPath();'],
]) test('static gate rejects another S2h consumer: ' + name, () => {
  const sources = featureSources();
  sources.set('core/unreviewed-feature-consumer.mjs', code);
  assert.throws(() => assertFeatureConsumers(sources), /unreviewed attested feature consumer/);
});

test('static gate rejects an alias escaping the reviewed receipts insert', () => {
  const sources = featureSources();
  sources.set('core/runtime.mjs', sources.get('core/runtime.mjs').replace(
    '    const eventTime = receiptEventTimeEnabled(cachedContentLayout(db));',
    '    const eventTime = receiptEventTimeEnabled(cachedContentLayout(db)); chooseOtherS2hPath(eventTime);'));
  assert.throws(() => assertFeatureConsumers(sources), /review feature consumer/);
});

test('static gate rejects a new branch inside the approved capabilities region', () => {
  const sources = featureSources();
  sources.set('core/context-product-worker.mjs', sources.get('core/context-product-worker.mjs').replace(
    'function capabilities() {', 'function capabilities() { chooseOtherS2hPath(facade.capabilities.receiptEventTime);'));
  assert.throws(() => assertFeatureConsumers(sources), /review feature consumer/);
});

// Spreading or aliasing a layout cannot recover the bit because it is absent
// from both its own properties and its prototype, in every physical family.
test('layouts expose no event-time property through copies, aliases or computed keys', () => {
  for (const physical of [18,23,33,34,38,48,51,52,53]) {
    const layout = resolveContentLayout(physical), alias = layout, copy = { ...alias };
    assert.equal(alias['receipt' + 'EventTime'], undefined);
    assert.equal(copy.receiptEventTime, undefined);
    const { receiptEventTime: enabled } = alias;
    assert.equal(enabled, undefined);
    assert.equal(Reflect.has(layout, 'receiptEventTime'), false);
    assert.equal(Object.isFrozen(layout), true);
  }
});

for (const [name, code] of [
  ['named accessor', "import { receiptEventTimeEnabled } from './content-safety-schema.mjs';"],
  ['aliased accessor', "import { receiptEventTimeEnabled as enabled } from './content-safety-schema.mjs';"],
  ['namespace computed key', "import * as safety from './content-safety-schema.mjs'; safety['receipt' + 'EventTimeEnabled'](layout);"],
  ['dynamic destructuring', "const { receiptEventTimeEnabled: enabled } = await import('./content-safety-schema.mjs');"],
  ['spread namespace', "import * as safety from './content-safety-schema.mjs'; const alias = { ...safety };"],
  ['forward accessor', "export { receiptEventTimeEnabled } from './content-safety-schema.mjs';"],
  ['forward namespace', "export * from './content-safety-schema.mjs';"],
  ['CommonJS namespace', "const safety = require('./content-safety-schema.mjs');"],
]) for (const extension of ['mjs','js','cjs']) test(`static gate rejects ${name} in .${extension}`, () => {
  const sources = featureSources();
  sources.set('core/unreviewed-feature-consumer.' + extension, code);
  assert.throws(() => assertFeatureConsumers(sources), /unreviewed feature/);
});

for (const extension of ['js','cjs']) test(`static gate discovers the review's imported .${extension} consumer outside production roots`, t => {
  const workspace = createTestWorkspace(t, { prefix: 'receipt-feature-gate-' });
  for (const directory of ['core','adapters','integrations/client','integrations/codex','packaging/bin','delegated']) mkdirSync(join(workspace.path, directory), { recursive: true });
  writeFileSync(join(workspace.path, 'packaging/bin/cairn-memory.mjs'), '');
  writeFileSync(join(workspace.path, 'core/entry.mjs'), `import '../delegated/consumer.${extension}';`);
  // Follow another edge outside the roots, including extensionless require.
  writeFileSync(join(workspace.path, `delegated/consumer.${extension}`), "if (layout.receiptEventTime) chooseOtherS2hPath(); require('./nested');");
  writeFileSync(join(workspace.path, 'delegated/nested.js'), 'if (layout.receiptEventTime) chooseOtherS2hPath();');
  const discovered = featureSources(workspace.path);
  assert.equal(discovered.size, 4);
  assert.ok(discovered.has(`delegated/consumer.${extension}`));
  assert.ok(discovered.has('delegated/nested.js'));
  const sources = featureSources();
  for (const [file, source] of discovered) sources.set(file, source);
  assert.throws(() => assertFeatureConsumers(sources), /unreviewed attested feature consumer/);
});

test('static gate rejects restoring a public flag on the layout authority', () => {
  const sources = featureSources();
  sources.set('core/content-safety-layout.mjs', sources.get('core/content-safety-layout.mjs').replace(
    'return Object.freeze({ physical,', 'return Object.freeze({ receiptEventTime: true, physical,'));
  assert.throws(() => assertFeatureConsumers(sources), /review feature consumer/);
});

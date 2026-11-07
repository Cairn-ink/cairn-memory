// Scope: this gate covers an honest engineer who accidentally reads the
// event-time feature flag in another S2h path. Deliberately obtaining it by
// reflection or constructed access is out of scope and is caught in code
// review, the same as for any other module-private state.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { featureSources, assertFeatureImports } from '../testing/receipt-event-time-audit.mjs';
import { moduleLoadingExceptions, moduleEdges } from '../testing/receipt-event-time-modules.mjs';
import { resolveContentLayout } from '../content-safety-layout.mjs';
import { parse } from '../../tools/testing/vendor/acorn/acorn.mjs';

const reviewed = JSON.parse(readFileSync(new URL('./fixtures/receipt-event-time-static-gate.json', import.meta.url), 'utf8'));
const digest = value => createHash('sha256').update(value).digest('hex');

// Gate A rejects unreviewed safety-cell literals outside the three authorities.
// Checking literals also covers aliases, Sets, lookup tables and switch cases.
// These exact non-layout expressions use the same integers as codepoints,
// corpus counts and a tar header byte; none may exempt a whole module.
function assertNoPhysicalCellBranches(sources) {
  const cells = new Set([34, 38, 48, 51, 52, 53]);
  const authorities = new Set(['core/content-safety-layout.mjs', 'core/content-safety-schema.mjs', 'core/content-safety-migration.mjs']);
  const unrelated = new Map([
    ['integrations/codex/schema-evidence.mjs:char===34', 2],
    ['core/context-product-comparison.mjs:p===34', 1],
    ['core/context-semantic-gates.mjs:primary.length!==48', 1],
    ['core/context-semantic-gates.mjs:new Set(primary.map(s=>cellKey(s.cell))).size!==48', 1],
    ['adapters/local-embedder/install.mjs:[0, 48].includes(header[156])', 1],
    ['core/topic-overview-storage.mjs:48 + parent.id.length * 2', 1],
    ['core/context-read-fusion.mjs:unionMaximum: 48', 1],
    ['core/episode-reads.mjs:headers.length > 51', 1],
  ]);
  const seen = new Map();
  const cell = node => node?.type === 'Literal' && cells.has(Number(node.value));
  function walk(node, file, source, ancestors = []) {
    if (!node || typeof node.type !== 'string') return;
    if (cell(node)) {
      const key = ancestors.map(parent => file + ':' + source.slice(parent.start, parent.end))
        .find(candidate => unrelated.has(candidate));
      assert.ok(key, 'physical cell branch outside layout/schema/migration: ' + file + ':' + source.slice(node.start, node.end));
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const parents = [...ancestors, node];
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) for (const child of value) walk(child, file, source, parents);
      else if (value && typeof value === 'object') walk(value, file, source, parents);
    }
  }
  let scanned = 0;
  for (const [file, source] of sources) if (!authorities.has(file)) {
    walk(parse(source, { ecmaVersion: 2025, sourceType: 'module', allowReturnOutsideFunction: true }), file, source);
    scanned++;
  }
  assert.equal(scanned, sources.size - authorities.size, 'every non-authority production module scanned');
  assert.deepEqual([...seen].sort(), [...unrelated].sort(), 'exact unrelated-expression inventory');
  return scanned;
}

test('family gate A: physical cell branches fail on an injected copy and pass on the real tree', t => {
  const sources = featureSources(), scanned = assertNoPhysicalCellBranches(sources);
  const mutations = [
    'if ([34,38,48].includes(physical)) chooseOtherS2hPath();',
    'if (layout.physical === 53) chooseOtherS2hPath();',
    'if (row.user_version !== 51) chooseOtherS2hPath();',
    'if (52 === version) chooseOtherS2hPath();',
    'switch (physical) { case 38: chooseOtherS2hPath(); }',
  ];
  let rejected = 0;
  for (const mutation of mutations) {
    const copy = new Map(sources), file = 'core/content-safety.mjs';
    copy.set(file, copy.get(file) + '\n' + mutation);
    assert.throws(() => assertNoPhysicalCellBranches(copy), /physical cell branch outside/);
    rejected++;
  }
  assert.equal(rejected, 5, 'exact mutation-control count');
  t.diagnostic(`family gate A: 1 real tree, ${rejected} rejected injected copies, ${scanned} production modules`);
});

test('static gate: the Episode lookahead bound does not exempt a physical branch in that module', () => {
  const sources = featureSources();
  sources.set('core/episode-reads.mjs', sources.get('core/episode-reads.mjs') +
    '\nif (layout.physical === 51) chooseOtherS2hPath();');
  assert.throws(() => assertNoPhysicalCellBranches(sources), /physical cell branch outside/);
});

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
  assertFeatureImports(sources);
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
    assert.doesNotMatch(source, /\breceiptEventTimeEnabled\b|\breceiptEventTime\b|\breceipt_event_time\b|\battestedFeatures\b|\bmemoReceiptEventTime\b|\bmemoReceiptProjection\b/,
      'unreviewed attested feature consumer: ' + file);
  }
}

test('static gate: only receipt writes/validation, receipts columns, capabilities and dated memo projection consume the attested flag', t => {
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

// These are the complete unresolved loaders and constructor capabilities, not pattern exemptions.
// Their full source is pinned, including the namespace uses and resolution fence.
test('static gate pins the exact unresolved-loader allowlist and its reviewed source', () => {
  assert.deepEqual(moduleLoadingExceptions.map(({ file, line, expression }) => ({ file, line, expression })), [
    { file: 'core/context-product-worker.mjs', line: 120, expression: 'import(workerData.host.moduleUrl)' },
    { file: 'core/context-semantic-worker.mjs', line: 502, expression: 'import(c.host.moduleUrl)' },
    { file: 'adapters/local-embedder/runtime.mjs', line: 53, expression: "import(pathToFileURL(join(pack.packPath, 'runtime/node_modules/@huggingface/transformers/dist/transformers.node.mjs')).href)" },
    { file: 'integrations/codex/qualification.mjs', line: 83, expression: "createRequire(launcher).resolve(packageName+'/package.json')" },
    { file: 'core/context-product-telemetry.mjs', line: 195, expression: 'Reflect.construct(object.constructor, args)' },
    { file: 'core/context-product-sqlite.mjs', line: 106, expression: "if (key === 'constructor') return object.constructor;" },
    { file: 'core/topic-reader-sqlite.mjs', line: 114, expression: "if (key === 'constructor') return object.constructor;" },
  ]);
  const sources = featureSources();
  for (const entry of moduleLoadingExceptions) {
    const source = sources.get(entry.file);
    assert.equal(digest(source), entry.sha256);
    assert.ok(entry.reason.length > 40);
    assert.ok(source.split('\n')[entry.line - 1].includes(entry.expression));
    const mutated = new Map(sources);
    mutated.set(entry.file, source + "\nconst safety = await import(path); safety[key](layout);\n");
    assert.throws(() => assertFeatureConsumers(mutated), /review module-loading exception/);
  }
});

for (const [name, code] of [
  ['review exact template reproduction', "const safety = await import(`./content-safety-schema.mjs`); if (safety[['receipt', 'EventTimeEnabled'].join('')](layout)) chooseOtherS2hPath();"],
  ['concatenated import path', "const safety = await import('./content-safety-' + 'schema.mjs'); safety[key](layout);"],
  ['variable import path', "const path = './content-safety-schema.mjs'; const safety = await import(path); safety[key](layout);"],
  ['interpolated import path', "const safety = await import(`./${name}.mjs`); safety[key](layout);"],
  ['require variable', "const path = './content-safety-schema.mjs'; const safety = require(path); safety[key](layout);"],
  ['require template', "const safety = require(`./content-safety-schema.mjs`); safety[key](layout);"],
  ['require concatenation', "const safety = require('./content-safety-' + 'schema.mjs'); safety[key](layout);"],
  ['require alias', "const load = require; const safety = load(path); safety[key](layout);"],
  ['require bind', "const load = require.bind(null); load(path);"],
  ['createRequire alias', "import { createRequire as makeLoader } from 'node:module'; const load = makeLoader(import.meta.url); load(path);"],
  ['module namespace loader', "const loaders = await import('node:module'); loaders[key](import.meta.url)(path);"],
  ['module forwarding loader', "export * from 'node:module';"],
  ['Function construction', "const load = new Function('path', 'return import(path)'); load(path);"],
  ['Function alias', "const build = Function; build(code)();"],
  ['Function constructor alias', "const build = (() => {}).constructor; build(code)();"],
  ['computed callable constructor', "const f = () => {}; f[['con', 'structor'].join('')](code)();"],
  ['computed global Function', "globalThis[['Fun', 'ction'].join('')](code)();"],
  ['aliased global eval', "const g = globalThis; g[key](code);"],
  ['aliased process loader', "const p = process; p[key]('module')[key](path);"],
  ['CommonJS computed loader', "module[['req', 'uire'].join('')](path);"],
  ['process namespace loader', "import * as p from 'node:process'; p[key]('module')[key](path);"],
  ['Worker imported alias', "import { Worker as W } from 'node:worker_threads'; new W(path);"],
  ['Worker value alias', "import { Worker } from 'node:worker_threads'; const W = Worker; new W(path);"],
  ['Worker namespace', "import * as w from 'node:worker_threads'; new w[key](path);"],
  ['query path', "const safety = await import('./content-safety-schema.mjs?tag'); safety[key](layout);"],
  ['encoded path', "const safety = await import('./content-safety%2dschema.mjs'); safety[key](layout);"],
  ['eval construction', "eval(code);"],
  ['indirect eval', "(0, eval)(code);"],
  ['global eval', "globalThis.eval(code);"],
  ['function constructor', "(() => {}).constructor(code)();"],
  ['computed process loader', "process[['getBuiltin', 'Module'].join('')]('module')[key](path);"],
  ['vm construction', "import * as vm from 'node:vm'; vm.runInThisContext(code);"],
  ['Worker variable', "new Worker(path);"],
  ['URL import', "const safety = await import(new URL('./content-safety-schema.mjs', import.meta.url)); safety[key](layout);"],
  ['data import', "await import('data:text/javascript,export default 1');"],
  ['escaped require', "\\u0072equire(path);"],
]) for (const extension of ['mjs', 'js', 'cjs']) test(`static gate fails closed for ${name} in .${extension}`, () => {
  const sources = featureSources();
  sources.set('core/unresolved-loader.' + extension, code);
  assert.throws(() => assertFeatureConsumers(sources), /unreviewed module loading|unsupported production syntax/);
});

test('static gate rejects an indirect re-export with an obfuscated downstream accessor', () => {
  const sources = featureSources();
  // Insert the consumer first to exercise transitive closure independent of order.
  sources.set('core/indirect-consumer.mjs', "import * as safety from './bridge-two.mjs'; safety[['receipt', 'EventTimeEnabled'].join('')](layout);");
  sources.set('core/bridge-two.mjs', "export * from './bridge-one.mjs';");
  sources.set('core/bridge-one.mjs', "export * from './content-safety-schema.mjs';");
  assert.throws(() => assertFeatureConsumers(sources), /unreviewed feature namespace.*core\/indirect-consumer/);
});

test('static gate parses comments, regexes, string decoys and template interpolations as JavaScript', () => {
  assert.deepEqual(moduleEdges('core/nonloading-decoys.mjs', `
    // import(variable); require(variable); eval(code);
    const text = 'import(variable)';
    const pattern = /import\\(variable\\)/;
    const value = \`require(variable)\`;
  `), []);
  const sources = featureSources();
  sources.set('core/template-interpolation.mjs', 'const text = `prefix ${await import(path)}`;');
  assert.throws(() => assertFeatureConsumers(sources), /unreviewed module loading/);
});

test('static gate rejects unresolved loading while closing over production dependencies', t => {
  const workspace = createTestWorkspace(t, { prefix: 'receipt-loader-gate-' });
  for (const directory of ['core', 'adapters', 'integrations/client', 'integrations/codex', 'packaging/bin', 'delegated']) mkdirSync(join(workspace.path, directory), { recursive: true });
  writeFileSync(join(workspace.path, 'packaging/bin/cairn-memory.mjs'), '');
  writeFileSync(join(workspace.path, 'core/entry.mjs'), "import '../delegated/loader.cjs';");
  writeFileSync(join(workspace.path, 'delegated/loader.cjs'), "const path = './hidden.js'; require(path);");
  assert.throws(() => featureSources(workspace.path), /unreviewed module loading.*delegated\/loader.cjs/);
});

// A boolean has no import edge. Pin both its introduction and its complete
// storage sink, and reject escaped uses outside those reviewed regions.
for (const file of ['core/context-read-facade.mjs', 'core/private-evidence-storage.mjs']) {
  for (const code of [
    'chooseOtherS2hPath(memoReceiptEventTime);',
    'const alias = memoReceiptEventTime; chooseOtherS2hPath(alias);',
    'chooseOtherS2hPath(memoReceiptProjection);',
  ]) test(`static gate rejects escaped memo flag/projection in ${file}: ${code}`, () => {
    const sources = featureSources();
    sources.set(file, sources.get(file) + '\n' + code);
    assert.throws(() => assertFeatureConsumers(sources), /unreviewed attested feature consumer/);
  });
  test(`static gate rejects an extra aliased memo flag use inside ${file}`, () => {
    const sources = featureSources(), source = sources.get(file);
    const marker = file.includes('facade')
      ? '  // context-read facade: end memo receipt projection'
      : '    const memoReceiptProjection = memoReceiptEventTime';
    assert.ok(source.includes(marker));
    sources.set(file, source.replace(marker, 'const alias = memoReceiptEventTime; chooseOtherS2hPath(alias);\n' + marker));
    assert.throws(() => assertFeatureConsumers(sources), /review feature consumer/);
  });
}

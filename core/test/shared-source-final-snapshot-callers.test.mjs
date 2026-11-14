import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parse } from '../../tools/testing/vendor/acorn/acorn.mjs';

// Match the marker gate: filesystem discovery, Acorn locations, an explicit
// reviewed catalog, and refusal of unclassified capability references. Do not
// filter the files by today's callers: a new module must enter this census.
const root = new URL('../', import.meta.url);
const normalize = text => text.replace(/\s+/g, ' ').trim();
const named = (node, name) => node?.type === 'Identifier' && node.name === name;
const isFunction = node => ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node?.type);
function productionFiles(directory = root, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['test', 'testing'].includes(entry.name)) return [];
    const file = prefix + entry.name;
    if (entry.isDirectory()) return productionFiles(new URL(entry.name + '/', directory), file + '/');
    return entry.isFile() && entry.name.endsWith('.mjs') ? [file] : [];
  }).sort();
}
function inventory(file, source) {
  const nodes = [];
  function walk(node, ancestors = []) {
    if (!node || typeof node.type !== 'string') return;
    nodes.push({ file, node, ancestors });
    for (const [key, value] of Object.entries(node)) if (!['loc', 'start', 'end'].includes(key)) {
      if (Array.isArray(value)) value.forEach(child => walk(child, [...ancestors, node]));
      else if (value && typeof value === 'object') walk(value, [...ancestors, node]);
    }
  }
  let tree;
  try { tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true }); }
  catch (error) { assert.fail(`${file}:${error.loc?.line ?? '?'} [snapshot census parse] ${error.message}`); }
  walk(tree);
  return { nodes, text: node => node ? normalize(source.slice(node.start, node.end)) : '<missing>' };
}
// Recognize literal/computed spellings too. A renamed/destructured/bound
// capability is an unreviewed escape, not a reason to omit its later calls.
function staticString(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && !node.expressions.length) return node.quasis[0].value.cooked;
  if (node?.type === 'BinaryExpression' && node.operator === '+') {
    const left = staticString(node.left), right = staticString(node.right);
    if (left !== undefined && right !== undefined) return left + right;
  }
}
const propertyName = node => node.computed ? staticString(node.key ?? node.property)
  : (node.key ?? node.property)?.name ?? staticString(node.key ?? node.property);
function enclosing(site) {
  for (let index = site.ancestors.length - 1; index >= 0; index--) {
    const node = site.ancestors[index], parent = site.ancestors[index - 1];
    if (!isFunction(node)) continue;
    if (node.id) return node.id.name;
    if (parent?.type === 'VariableDeclarator' && parent.init === node) return parent.id.name;
    if (parent?.type === 'Property' && parent.value === node) return propertyName(parent);
    // Unnamed callback: retain its enclosing named/inferred wrapper.
  }
  return '<module>';
}
const label = site => `${site.file}:${site.node.loc.start.line} ${enclosing(site)} [snapshot census]`;
const namedOwner = site => [...site.ancestors].reverse().find(node => isFunction(node) && node.id)?.id.name;
const sorted = rows => rows.map(row => JSON.stringify(row)).sort();

// File, enclosing function, selected argument, and EXACT fence provenance.
// selected=[] still validates fetched candidates; it is not the null handoff.
// Both normal and source-context finalization use the same navigation fences.
const expectedCalls = [
  ['contract.mjs', 'validateFresh', '[]',
    'namespaces.flatMap((namespace) => { const page = navigation.pages.get(namespaceBinding(namespace)); return page ? [{ namespace, indexRevision: page.epoch, suppressionEpoch: page.suppressionEpoch }] : []; })'],
  ['contract.mjs', 'prepare', 'null', '[]'],
  ['contract.mjs', 'finalize', 'selected',
    'namespaces.map((namespace) => ({ namespace, indexRevision: navigation.pages.get(namespaceBinding(namespace)).epoch, suppressionEpoch: navigation.pages.get(namespaceBinding(namespace)).suppressionEpoch }))'],
];
// Catalog the definition and handoff separately. This closes the alias escape:
// a new const alias=runtime.recallSnapshot, destructuring rename, .bind/.call,
// import alias or renamed export fails until its flow is explicitly reviewed.
const expectedReferences = [
  ['runtime.mjs', 'createMemoryRuntime', 'definition',
    'candidates, selected, namespaces = [], includeQualification = false, contextMode'],
  ['runtime.mjs', 'createRuntimeFacade', 'facade handoff', 'recallSnapshot'],
];
// The runtime facade forwards the entire argument vector. The optional timing
// wrapper forwards to storage, whose closures construct fences, and the public
// contract injects those exact closures into recallMemories. These generic
// forwarders must not discard arguments or substitute an unfenced operation.
const expectedForwarders = [
  ['content-safety-boundary.mjs', 'contentSafetyFacade', 'Reflect.apply', 'value, api, args'],
  ['contract.mjs', 'recall', 'call', '...args'],
  ['contract.mjs', 'recall', 'recallMemories',
    '{ model, readSet: namespaces.map(publicNamespace), query, limit: count, ...storage, includeQualification, contextMode, selectionMode, diagnostics }'],
];
// Dynamic runtime dispatch also needs a closed target list: a caller cannot
// hide recallSnapshot behind runtime[method]. Neither existing dispatcher
// targets recall snapshots. Taking either dispatcher as an alias is refused.
const expectedDynamic = [
  ['runtime.mjs', 'captureSourceBoundary', 'method', '...args'],
  ['contract.mjs', 'episodeMutation', 'method', 'ns, input'],
];
const expectedTargets = [
  ['runtime.mjs', 'captureSourceBoundary', "'filterCaptureSources'"],
  ['runtime.mjs', 'captureSourceBoundary', "'assertCaptureSources'"],
  ...['forgetEpisode', 'correctEpisode', 'closeEpisodeNextStep', 'releaseEpisodeCorrection',
    'getCaptureControl', 'setCapturePaused', 'setProjectCapture'].map(name => ['contract.mjs', 'episodeMutation', `'${name}'`]),
];
function audit(sources) {
  const calls = [], references = [], forwarders = [], dynamic = [], targets = [], locations = [];
  for (const [file, source] of sources) {
    const scan = inventory(file, source);
    for (const site of scan.nodes) {
      const { node, ancestors } = site, parent = ancestors.at(-1);
      if (node.type === 'CallExpression') {
        const owner = namedOwner(site), callee = scan.text(node.callee);
        if (file === 'content-safety-boundary.mjs' && owner === 'contentSafetyFacade' && callee === 'Reflect.apply' ||
          file === 'contract.mjs' && owner === 'recall' && ['call', 'recallMemories'].includes(callee)) {
          forwarders.push([file, owner, callee, node.arguments.map(scan.text).join(', ')]);
        }
        if (['captureSourceBoundary', 'episodeMutation'].includes(callee)) {
          targets.push([file, callee, scan.text(node.arguments[0])]);
        }
      }
      // episodeMutation in raw-source-roots.mjs is unrelated mutable data;
      // these two capabilities are lexically private to their defining files.
      if (node.type === 'Identifier' && (file === 'runtime.mjs' && node.name === 'captureSourceBoundary' ||
        file === 'contract.mjs' && node.name === 'episodeMutation')) {
        assert.ok(parent?.type === 'FunctionDeclaration' && parent.id === node ||
          parent?.type === 'VariableDeclarator' && parent.id === node ||
          parent?.type === 'CallExpression' && parent.callee === node,
        label(site) + ' unreviewed dynamic dispatcher alias');
      }
      if (node.type === 'MemberExpression' && named(node.object, 'runtime') && node.computed && propertyName(node) === undefined) {
        assert.ok(parent?.type === 'CallExpression' && parent.callee === node && !node.optional && !parent.optional,
          label(site) + ' unreviewed dynamic runtime capability');
        dynamic.push([file, enclosing(site), scan.text(node.property), parent.arguments.map(scan.text).join(', ')]);
      }
      if (node.type === 'FunctionDeclaration' && named(node.id, 'recallSnapshot')) {
        references.push([file, enclosing(site), 'definition', node.params.map(scan.text).join(', ')]);
      } else if (node.type === 'MemberExpression' && propertyName(node) === 'recallSnapshot') {
        assert.ok(parent?.type === 'CallExpression' && parent.callee === node && !node.optional && !parent.optional,
          label(site) + ' unreviewed alias or indirect snapshot call');
        assert.equal(parent.arguments.length >= 3, true, label(site) + ' missing navigation fences');
        assert.equal(scan.text(node.object), 'runtime', label(site) + ' unreviewed snapshot receiver');
        calls.push([file, enclosing(site), scan.text(parent.arguments[1]), scan.text(parent.arguments[2])]);
        locations.push(label(site));
      } else if (node.type === 'Property' && propertyName(node) === 'recallSnapshot') {
        assert.ok(parent?.type === 'ObjectExpression' && node.shorthand && named(node.value, 'recallSnapshot'),
          label(site) + ' unreviewed snapshot alias/export/destructuring');
        references.push([file, enclosing(site), 'facade handoff', scan.text(node.value)]);
      } else if (named(node, 'recallSnapshot')) {
        const declaration = parent?.type === 'FunctionDeclaration' && parent.id === node;
        const memberKey = parent?.type === 'MemberExpression' && parent.property === node && !parent.computed;
        const handoff = parent?.type === 'Property' && propertyName(parent) === 'recallSnapshot';
        assert.ok(declaration || memberKey || handoff, label(site) + ' unreviewed snapshot identifier alias');
      } else if (['Literal', 'TemplateLiteral'].includes(node.type) && staticString(node) === 'recallSnapshot') {
        assert.ok(parent?.type === 'MemberExpression' && parent.property === node ||
          parent?.type === 'Property' && parent.key === node,
        label(site) + ' unreviewed string snapshot alias');
      }
    }
  }
  assert.deepEqual(sorted(references), sorted(expectedReferences), '[snapshot census] definition/handoff catalog changed');
  assert.deepEqual(sorted(calls), sorted(expectedCalls),
    '[snapshot census] caller/fence catalog changed\n' + locations.join('\n'));
  assert.deepEqual(sorted(forwarders), sorted(expectedForwarders), '[snapshot census] forwarding argument catalog changed');
  assert.deepEqual(sorted(dynamic), sorted(expectedDynamic), '[snapshot census] dynamic runtime caller catalog changed');
  assert.deepEqual(sorted(targets), sorted(expectedTargets), '[snapshot census] dynamic runtime target catalog changed');
}
const sourceInventory = () => new Map(productionFiles().map(file => [file, readFileSync(new URL(file, root), 'utf8')]));

test('every final recall snapshot caller retains navigation-time namespace fences', () => {
  audit(sourceInventory());
});

// These are scanner tests over synthetic source, never imports or executions of
// serving code. A future caller cannot be silently accepted merely because it
// happens to use a familiar name, file, or wrapper.
for (const [name, source] of [
  ['new module', 'function deliver(runtime, refs) { return runtime.recallSnapshot(refs, [0]); }'],
  ['new caller in an existing module', 'function deliver(runtime, refs) { return runtime.recallSnapshot(refs, [0], []); }'],
  ['renamed capability', 'const finish = runtime.recallSnapshot; finish(refs, [0]);'],
  ['destructured capability', 'const { recallSnapshot: finish } = runtime; finish(refs, [0]);'],
  ['bound capability', 'const finish = runtime.recallSnapshot.bind(runtime); finish(refs, [0]);'],
  ['computed capability', "runtime['recallSnapshot'](refs, [0]);"],
  ['joined spelling', "runtime['recall' + 'Snapshot'](refs, [0]);"],
  ['computed name variable', "const method = 'recall' + 'Snapshot'; runtime[method](refs, [0]);"],
  ['computed name parameter', 'function deliver(runtime, method, refs) { return runtime[method](refs, [0]); }'],
  ['renamed dynamic dispatcher', "const deliver = episodeMutation; deliver('recall' + 'Snapshot', [], refs);"],
  ['new dynamic dispatcher target', "episodeMutation('recall' + 'Snapshot', [], refs);"],
]) test(`snapshot census refuses ${name}`, () => {
  const sources = sourceInventory();
  const file = name === 'new caller in an existing module' || name.includes('dynamic dispatcher') ? 'contract.mjs' : 'synthetic-caller.mjs';
  sources.set(file, (sources.get(file) ?? '') + '\n' + source);
  assert.throws(() => audit(sources), /snapshot census/);
});

for (const [name, file, before, after] of [
  ['runtime facade arguments', 'content-safety-boundary.mjs', 'Reflect.apply(value,api,args)', 'Reflect.apply(value,api,args.slice(0, 2))'],
  ['diagnostic wrapper arguments', 'contract.mjs', 'return call(...args);', 'return call(args[0], args[1]);'],
]) test(`snapshot census refuses loss of ${name}`, () => {
  const sources = sourceInventory(), source = sources.get(file);
  assert.equal(source.split(before).length, 2, 'one source-backed mutation target');
  sources.set(file, source.replace(before, after));
  assert.throws(() => audit(sources), /snapshot census/);
});

for (const [name, before, after] of [
  ['final index fence', 'indexRevision: navigation.pages.get(namespaceBinding(namespace)).epoch,', ''],
  ['final suppression fence', 'suppressionEpoch: navigation.pages.get(namespaceBinding(namespace)).suppressionEpoch', ''],
  ['freshness index fence', 'indexRevision: page.epoch,', ''],
  ['freshness suppression fence', ', suppressionEpoch: page.suppressionEpoch', ''],
  ['preparation changed to delivery', ')),null,[],includeQualification,contextMode)', ')),[0],[],includeQualification,contextMode)'],
]) test(`snapshot census refuses loss of the ${name}`, () => {
  const sources = sourceInventory(), source = sources.get('contract.mjs');
  assert.equal(source.split(before).length, 2, 'one source-backed mutation target');
  sources.set('contract.mjs', source.replace(before, after));
  assert.throws(() => audit(sources), /snapshot census/);
});

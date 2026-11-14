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
    if (['test', 'testing', 'node_modules'].includes(entry.name)) return [];
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
  ['freshness index fence',
    'return page ? [{ namespace, indexRevision: page.epoch, suppressionEpoch: page.suppressionEpoch }] : [];',
    'return page ? [{ namespace, suppressionEpoch: page.suppressionEpoch }] : [];'],
  ['freshness suppression fence',
    'return page ? [{ namespace, indexRevision: page.epoch, suppressionEpoch: page.suppressionEpoch }] : [];',
    'return page ? [{ namespace, indexRevision: page.epoch }] : [];'],
  ['preparation changed to delivery', ')),null,[],includeQualification,contextMode)', ')),[0],[],includeQualification,contextMode)'],
]) test(`snapshot census refuses loss of the ${name}`, () => {
  const sources = sourceInventory(), source = sources.get('contract.mjs');
  assert.equal(source.split(before).length, 2, 'one source-backed mutation target');
  sources.set('contract.mjs', source.replace(before, after));
  assert.throws(() => audit(sources), /snapshot census/);
});

// Public delivery is a second fence, independent of final-snapshot callers.
// Scan all serving core/adapter modules, including newly added modules. The
// live harness is an adapter consumer and is cataloged, not silently excluded.
const deliverySources = () => new Map([
  ...sourceInventory(),
  ...productionFiles(new URL('../../adapters/', import.meta.url), 'adapters/').map(file =>
    [file, readFileSync(new URL('../../' + file, import.meta.url), 'utf8')]),
]);
const expectedDeliveryCalls = [
  ['contract.mjs', 'recall', 'engine', expectedForwarders[2][3]],
  ['adapters/mcp/server.mjs', 'recall_memory', 'public core',
    "{ readSet: [binding], query: redactSecrets(query), limit, ...(effectiveContext ? { contextMode: effectiveContext } : {}), ...(selectionMode ? { selectionMode } : {}), ...((includeQualification ?? (effectiveContext ? false : configured)) ? { includeQualification: true } : {}) }"],
  ...['recallCurrent', 'runLiveLifecycle'].map(wrapper => ['adapters/openai/live-harness.mjs', wrapper, 'public core',
    "{ readSet: [namespace], query: 'What format do I prefer for code reviews?' }"]),
];
const expectedDeliveryReferences = [
  ['contract.mjs', 'engine import', "import { recallMemories } from './recall.mjs';"],
  ['recall.mjs', 'engine definition', 'true'],
  ['contract.mjs', 'public definition', 'true'],
];
const expectedDeliveryRuntime = [
  ['runtime.mjs', 'createRuntimeFacade',
    "{ check: assertContentScope, noOwner: ['ready','close','assertContentScope','assertContentOutput','contentPortGuard'] }"],
];
const expectedDeliveryTools = [
  ['adapters/mcp/server.mjs', 'recall_memory', `({ query, limit, includeQualification, contextMode, selectionMode }) => {
      const effectiveContext = contextMode ?? recallContext;
      return core.recall({ readSet: [binding], query: redactSecrets(query), limit,
        ...(effectiveContext ? { contextMode: effectiveContext } : {}),
        ...(selectionMode ? { selectionMode } : {}),
        ...((includeQualification ?? (effectiveContext ? false : configured)) ? { includeQualification: true } : {}) });
    }`],
];
const expectedDeliveryHandoffs = [
  ['contract.mjs', 'createMemoryCore', `{ check: runtime.assertContentScope, portGuard: runtime.contentPortGuard, failure, asyncMethods: ['capture'],
    requestScope: (work, method) => contentWriteMethodClass(method) === 'read' ? withContentSuppressionRequest(work) : work(),
    isFailedCapture(result) {
      // Admission committed before the paused classifier. After close only its
      // failed-classification completion is deliverable; no retained identities,
      // receipts, counts or content survive this projection.
      return result?.ok===true&&result.value?.classification?.status==='failed';
    },
    validate: (method,args,result,scopes) => { if(contentReads.has(method)&&result?.ok)runtime.assertContentOutput(result.value,scopes); }, noOwner: ['close',
    'getPrivateCardCapabilities','getAssetCapabilities','getMethodPackageCapabilities'] }`],
  ['raw-composition.mjs', 'composeRawCore', `{ check: runtime.assertContentScope, portGuard: runtime.contentPortGuard, failure,
    validate: (method,args,result,scopes) => {
      if (['getConversation','listRawConversations','getRawUsage','listRawEffects','previewDeleteConversation'].includes(method) && result?.ok) runtime.assertContentOutput(result.value,scopes);
    }, asyncMethods: ['capture','captureRaw','getConversation','searchRaw','maintainRawSearch','getRawSearchStatus'], noOwner: ['close',
    'getPrivateCardCapabilities','getAssetCapabilities','getMethodPackageCapabilities','getContextReadCapabilities'] }`],
];
// Pin the complete delivery guard bodies, not just the presence of a
// call somewhere in a function. An early return, an exemption, a skipped await,
// a lost delivery flag or a comparison made conditional must require review.
// These are source-text assertions, never imports of the serving modules.
const expectedDeliveryGuards = [
  ['content-safety-boundary.mjs', 'function', 'contentSafetyFacade', `function contentSafetyFacade(api, { check, noOwner = [], failure, select = args => args[0], asyncMethods = [], validate, portGuard, requestScope, isFailedCapture, writeBoundary = check }) {
  const exempt = new Set(noOwner), facadeToken = {};
  return Object.freeze(Object.fromEntries(Object.entries(api).map(([method, value]) => {
    if (typeof value !== 'function' || exempt.has(method)) return [method, value];
    const asynchronous = types.isAsyncFunction(value) || asyncMethods.includes(method);
    return [method, function(...args) {
      const native = contentWriteBoundaryConnection(writeBoundary);
      const enclosing = activeReadBoundaries.getStore();
      const reentered = native && enclosing?.get(native)?.has(facadeToken);
      const nestedRead = native && enclosing?.has(native) && !reentered && contentWriteMethodClass(method) === 'read';
      const execute = () => {
        let scopes, delivering = false;
        const rejected = error => {
          // A deferred scope proof must also cover a method that fails before
          // reaching its ordinary snapshot. No protected result is delivered.
          if (scopes && !delivering) {
            delivering = true;
            try { check(scopes,{delivery:true}); } catch (denial) {
              error = (denial.code === 'store_closed' && rebuildContentFreeError(error)) || denial;
            }
          }
          if (failure) return failure(error,method);
          throw error;
        };
        try {
          // An engine snapshot held by a synchronous host callback cannot
          // certify a new caller read after another connection commits a fact.
          if(callerPortReads.getStore()&&native?.isOpen!==false&&native?.isTransaction&&contentWriteMethodClass(method)==='read')fail('evidence_unavailable');
          scopes = contentScopes(select(args, method));
          check(scopes,{delivery:false});
          const deliver = result => {
            delivering = true;
            try { if (!nestedRead) check(scopes,{delivery:true}); }
            catch(error) {
              if(method==='capture'&&error.code==='store_closed'&&
                  (result===closedCaptureControl||isFailedCapture?.(result)))return closedCaptureControl;
              const rebuilt = error.code === 'store_closed' && rebuildContentFreeFailure(result);
              if (rebuilt) return rebuilt;
              throw error;
            }
            validate?.(method,args,result,scopes); return result;
          };
          const invoke = () => withContentWriteOperation(method,scopes,()=>Reflect.apply(value,api,args),writeBoundary);
          const result = portGuard ? contentPorts.run(portGuard(scopes),invoke) : invoke();
          return types.isPromise(result) ? result.then(deliver).catch(rejected) : deliver(result);
        } catch (error) {
          if (failure) { const result = rejected(error); return asynchronous ? Promise.resolve(result) : result; }
          // The enclosing sourceSnapshot contract immediately returns its
          // failure envelope and supplies the final delivery fence. Its nested
          // runtime snapshot cannot deliver content or dispatch another port
          // after failure; share that fence just as on nested read success.
          if (scopes && !delivering && !(nestedRead && method === 'sourceSnapshot')) {
            delivering = true;
            try { check(scopes,{delivery:true}); } catch (denial) {
              const rebuilt = denial.code === 'store_closed' && rebuildContentFreeError(error);
              if (!rebuilt) throw denial;
              error = rebuilt;
            }
          }
          if (asynchronous) return Promise.reject(error);
          throw error;
        }
      };
      const scoped = () => {
        if (!native) return execute();
        const boundaries = new Map(enclosing);
        boundaries.set(native,new Set([...(enclosing?.get(native) ?? []),facadeToken]));
        return activeReadBoundaries.run(boundaries,execute);
      };
      const begin = () => requestScope ? requestScope(scoped, method) : contentWriteMethodClass(method) === 'read' ? withContentSuppressionRequest(scoped) : scoped();
      // A caller port may issue multiple independent reads. Its fresh callback
      // context is not itself a read request: each outermost facade invocation
      // must obtain a new proof, even when that callback is still awaiting.
      const start = () => reentered || callerPortReads.getStore() && native && !enclosing?.has(native) && contentWriteMethodClass(method)==='read'
        ? withContentSuppressionRequest(begin,{fresh:true}) : begin();
      const connection = contentWriteMethodClass(method) === 'write' && contentWriteBoundaryConnection(writeBoundary);
      return connection ? withoutContentSuppressionReadCacheInside(connection, start) : start();
    }];
  })));
}`],
  ['content-suppression-storage.mjs', 'function', 'assertContentSuppressionRequestInside', `function assertContentSuppressionRequestInside(db, readSet) {
  const states = [...new Set(readSet.map(ns => ns.ownerId))].map(owner => cachedContentSuppressionRequestInside(db, owner)).filter(Boolean);
  if (!states.length) return;
  // A fresh header and owner epochs after host callbacks fence every retained decision.
  const layout = installedContentLayout(db);
  for (const state of states) {
    if (layout !== state.layout) fail('evidence_unavailable');
    if (!layout.suppressionRevision) continue;
    const row = db.prepare('SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs WHERE owner_id=?').get(state.owner);
    if ((row ? \`\${row.epoch_hi}:\${row.epoch_lo}\` : '0:0') !== state.epoch) fail('evidence_unavailable');
  }
}`],
  ['runtime.mjs', 'binding', 'assertContentScope', `assertContentScope = (scopes, { delivery = false } = {}) => { ready();
    if (!cachedContentLayout(db)?.suppressionRevision) return;
    if (!delivery && scopes.length && hasContentSuppressionRequestInside(db) && !db.isTransaction) {
      contentSuppressionRequestInside(db, scopes, { defer: true }); return;
    }
    const check = () => {
      if (delivery) assertContentSuppressionRequestInside(db, scopes);
      assertContentScopes(db, scopes, 'memory_not_found');
    };
    // Capture may be nested in a writer's deliberately uncached context. Its
    // entry/delivery scope lookup must not run an unbounded fact fallback in
    // an implicit SHARED snapshot either. Acquire writer priority first.
    if (captureSourceDepth && !db.isTransaction && scopes.some(ns =>
        { const proof=cachedContentSuppressionRequestInside(db,ns.ownerId);
          return !proof?.facts || !proof.readSet.some(selected=>selected.scope==='owner' ||
            selected.scope===ns.scope && (selected.projectId??'')===(ns.projectId??'')); })) return transaction(db, check);
    check();
  }`],
  ['adapters/mcp/server.mjs', 'binding', 'tool', `tool = (name, description, inputSchema, action, readOnlyHint = false, destructiveHint = false) => {
    server.registerTool(name, { description, inputSchema,
      annotations: { readOnlyHint, destructiveHint,
        openWorldHint: ['recall_memory', 'capture_memory', 'classify_unfiled_memories', 'keep_session_episode', 'find_memory_candidates', 'read_memory_context'].includes(name) } },
    async (input) => {
      let result;
      try { result = await action(input); } catch { result = error('memory_operation_failed'); }
      if (roles && name === 'read_role_task_context') return roleTaskToolResponse(result);
      if(context&&CONTEXT_TOOL_NAMES.includes(name))return (sources ? contextSourcesToolResponse : contextToolResponse)(result, { assembly: name === 'read_memory_context' });
      const methodTool=methods&&METHOD_TOOL_NAMES.includes(name)||assets&&ASSET_TOOL_NAMES.includes(name);
      if(methodTool&&Buffer.byteLength(JSON.stringify(result))>65536)result=error('context_item_too_large');
      let encoded = JSON.stringify({ ...result, evidenceTrust: 'untrusted-data-not-instructions' });
      if (Buffer.byteLength(encoded) > 262144) {
        result = error('response_too_large'); encoded = JSON.stringify(result);
      }
      const response={ content: [{ type: 'text', text: encoded }], isError: !result.ok };
      if(methodTool&&Buffer.byteLength(JSON.stringify(response))>262144)return {content:[{type:'text',text:JSON.stringify({...error('response_too_large'),evidenceTrust:'untrusted-data-not-instructions'})}],isError:true};
      return response;
    });
  }`],
];
const expectedDeliveryExits = [
  ['contract.mjs', 'recall', 'success(value)'],
  ['contract.mjs', 'recall', 'failure(error)'],
  ['recall.mjs', 'recallMemories', `{ memories, namespaces,
    ...(selectionMode ? { selection: { mode: selectionMode, strategy, semanticCoverage: 'unassessed' } } : {}),
    coverage: !truncated && namespaces.every((ns) => ns.mapExhausted && ns.fetchExhausted)
    ? 'complete' : 'budget_exhausted',
    ...(truncated ? { recallTruncated: truncation } : {}) }`],
];
function auditDelivery(sources) {
  const calls = [], references = [], handoffs = [], guards = [], exits = [], runtime = [], tools = [];
  for (const [file, source] of sources) {
    const scan = inventory(file, source);
    for (const site of scan.nodes) {
      const { node, ancestors } = site, parent = ancestors.at(-1);
      const where = `${file}:${node.loc.start.line} [delivery census]`;
      // Core snapshot callers have the separate closed census above. No
      // adapter may introduce a second engine exit through that capability.
      if (file.startsWith('adapters/') && (named(node, 'recallSnapshot') ||
          node.type === 'MemberExpression' && propertyName(node) === 'recallSnapshot' ||
          staticString(node) === 'recallSnapshot'))
        assert.fail(where + ' adapter bypasses public recall through a snapshot capability');
      if (node.type === 'FunctionDeclaration' && ['recallMemories', 'recall'].includes(node.id?.name)) {
        assert.ok(file === (node.id.name === 'recall' ? 'contract.mjs' : 'recall.mjs'), where + ' unreviewed definition');
        references.push([file, node.id.name === 'recall' ? 'public definition' : 'engine definition', String(node.async)]);
      }
      if (node.type === 'ImportDeclaration' && node.specifiers.some(specifier => named(specifier.imported, 'recallMemories')))
        references.push([file, 'engine import', scan.text(node)]);
      if (node.type === 'FunctionDeclaration' || node.type === 'VariableDeclarator') {
        const kind = node.type === 'FunctionDeclaration' ? 'function' : 'binding';
        if (expectedDeliveryGuards.some(row => row[0] === file && row[1] === kind && row[2] === node.id?.name))
          guards.push([file, kind, node.id.name, scan.text(node)]);
      }
      if (node.type === 'ReturnStatement') {
        const fn = [...ancestors].reverse().find(isFunction);
        if (fn?.type === 'FunctionDeclaration' &&
          (file === 'recall.mjs' && named(fn.id, 'recallMemories') || file === 'contract.mjs' && named(fn.id, 'recall')))
          exits.push([file, fn.id.name, scan.text(node.argument)]);
      }
      if (node.type === 'CallExpression' && named(node.callee, 'recallMemories')) {
        assert.equal(node.optional, false, where + ' optional engine call');
        assert.equal(parent?.type, 'AwaitExpression', where + ' engine result must be awaited');
        calls.push([file, enclosing(site), 'engine', node.arguments.map(scan.text).join(', ')]);
      }
      if (node.type === 'CallExpression' && named(node.callee, 'tool') && staticString(node.arguments[0]) === 'recall_memory')
        tools.push([file, 'recall_memory', scan.text(node.arguments[3])]);
      if (file === 'runtime.mjs' && node.type === 'Property' && propertyName(node) === 'assertContentScope') {
        const call = ancestors.at(-2);
        assert.ok(node.shorthand && named(node.value, 'assertContentScope') &&
          call?.type === 'CallExpression' && named(call.callee, 'contentSafetyFacade'), where + ' unreviewed runtime delivery guard export');
        runtime.push([file, namedOwner(site), scan.text(call.arguments[1])]);
      }
      if (node.type === 'MemberExpression' && propertyName(node) === 'recall') {
        assert.ok(parent?.type === 'CallExpression' && parent.callee === node && !node.optional && !parent.optional,
          where + ' unreviewed public recall alias');
        assert.equal(scan.text(node.object), 'core', where + ' unreviewed public recall receiver');
        const tool = ancestors.find(ancestor => ancestor.type === 'CallExpression' && named(ancestor.callee, 'tool') &&
          staticString(ancestor.arguments[0]) === 'recall_memory');
        calls.push([file, tool ? 'recall_memory' : enclosing(site), 'public core', parent.arguments.map(scan.text).join(', ')]);
      }
      if (node.type === 'Property' && propertyName(node) === 'recall' &&
        (node.shorthand || isFunction(node.value) || node.value.type === 'Identifier' || parent?.type === 'ObjectPattern')) {
        assert.ok(parent?.type === 'ObjectExpression' && node.shorthand && named(node.value, 'recall'),
          where + ' unreviewed raw recall handoff');
        const call = ancestors.at(-2), returned = ancestors.at(-3);
        assert.ok(call?.type === 'CallExpression' && named(call.callee, 'contentSafetyFacade') &&
          call.arguments[0] === parent && returned?.type === 'ReturnStatement', where + ' public recall bypasses facade');
        handoffs.push([file, namedOwner(site), scan.text(call.arguments[1])]);
      }
      if (node.type === 'CallExpression' && named(node.callee, 'contentSafetyFacade') &&
        node.arguments[0]?.properties?.some(property => property.type === 'SpreadElement' && named(property.argument, 'core'))) {
        assert.equal(parent?.type, 'ReturnStatement', where + ' composed core must return its facade');
        handoffs.push([file, namedOwner(site), scan.text(node.arguments[1])]);
      }
      // Close the underlying engine capability: renamed imports, namespace
      // imports, computed access, bound calls and raw lexical aliases cannot
      // hide a new path from this catalog.
      if (named(node, 'recallMemories') || named(node, 'recall') && file === 'contract.mjs') {
        const definition = parent?.type === 'FunctionDeclaration' && parent.id === node;
        const imported = parent?.type === 'ImportSpecifier' && named(parent.imported, 'recallMemories') && named(parent.local, 'recallMemories');
        const invocation = parent?.type === 'CallExpression' && parent.callee === node && node.name === 'recallMemories';
        const handoff = parent?.type === 'Property' && parent.shorthand && named(parent.value, 'recall');
        assert.ok(definition || imported || invocation || handoff, where + ' unreviewed engine/raw recall alias');
      }
      if (node.type === 'MemberExpression' && propertyName(node) === 'recallMemories' ||
          staticString(node) === 'recallMemories')
        assert.fail(where + ' unreviewed indirect engine capability');
      if (/(?:^|\/)recall\.mjs$/.test(staticString(node) ?? ''))
        assert.ok(parent?.type === 'ImportDeclaration' &&
          scan.text(parent) === "import { recallMemories } from './recall.mjs';", where + ' unreviewed engine import route');
    }
  }
  assert.deepEqual(sorted(calls), sorted(expectedDeliveryCalls), '[delivery census] public route catalog changed');
  assert.deepEqual(sorted(references), sorted(expectedDeliveryReferences), '[delivery census] engine reference catalog changed');
  assert.deepEqual(sorted(runtime), sorted(expectedDeliveryRuntime), '[delivery census] runtime delivery guard handoff changed');
  assert.deepEqual(sorted(tools), sorted(expectedDeliveryTools.map(([file, name, source]) => [file, name, normalize(source)])),
    '[delivery census] MCP recall tool route changed');
  assert.deepEqual(sorted(handoffs), sorted(expectedDeliveryHandoffs.map(([file, wrapper, source]) => [file, wrapper, normalize(source)])),
    '[delivery census] public facade handoff/options changed');
  assert.deepEqual(sorted(guards), sorted(expectedDeliveryGuards.map(([file, kind, name, source]) => [file, kind, name, normalize(source)])),
    '[delivery census] live public delivery guard changed');
  assert.deepEqual(sorted(exits), sorted(expectedDeliveryExits.map(([file, wrapper, source]) => [file, wrapper, normalize(source)])),
    '[delivery census] engine/public return catalog changed');
}

test('every public recall delivery route retains the live owner comparison', () => {
  auditDelivery(deliverySources());
});

for (const [name, source] of [
  ['new engine exit module', 'async function deliver(input) { return await recallMemories(input); }'],
  ['new engine exit in an existing module', 'export async function deliver(input) { return await recallMemories(input); }'],
  ['adapter snapshot exit', 'export function deliver(runtime, refs, fences) { return runtime.recallSnapshot(refs, [0], fences); }'],
  ['renamed engine import', "import { recallMemories as deliver } from '../recall.mjs';"],
  ['namespace engine import', "import * as engine from '../recall.mjs';"],
  ['dynamic engine import', "async function deliver(input) { const engine = await import('../recall.mjs'); return engine.finish(input); }"],
  ['computed engine capability', "engine['recall' + 'Memories'](input);"],
  ['computed engine name variable', "const method = 'recall' + 'Memories'; engine[method](input);"],
  ['new public caller', 'async function deliver(core, input) { return await core.recall(input); }'],
  ['public capability alias', 'const deliver = core.recall;'],
  ['raw public handoff', 'function deliver() { return { recall }; }'],
]) test(`delivery census refuses ${name}`, () => {
  const sources = deliverySources();
  const file = name === 'new engine exit in an existing module' ? 'contract.mjs'
    : name === 'adapter snapshot exit' ? 'adapters/synthetic-delivery.mjs' : 'synthetic-delivery.mjs';
  sources.set(file, (sources.get(file) ?? '') + '\n' + source);
  assert.throws(() => auditDelivery(sources), /delivery census/);
});

for (const [name, file, before, after] of [
  ['public facade bypass', 'contract.mjs', 'return contentSafetyFacade({', 'return bypassFacade({'],
  ['public recall exemption', 'contract.mjs', "noOwner: ['close',", "noOwner: ['recall','close',"],
  ['composed recall exemption', 'raw-composition.mjs', "noOwner: ['close',", "noOwner: ['recall','close',"],
  ['runtime delivery guard handoff', 'runtime.mjs', '    assertContentScope,\n    contentPortGuard', '    assertContentScope: () => {},\n    contentPortGuard'],
  ['public delivery check', 'content-safety-boundary.mjs', 'if (!nestedRead) check(scopes,{delivery:true});', ''],
  ['asynchronous delivery check', 'content-safety-boundary.mjs', 'result.then(deliver).catch(rejected)', 'result.then(value => value).catch(rejected)'],
  ['synchronous delivery check', 'content-safety-boundary.mjs', ': deliver(result);', ': result;'],
  ['delivery scope flag', 'runtime.mjs', 'if (delivery) assertContentSuppressionRequestInside(db, scopes);', 'if (!delivery) assertContentSuppressionRequestInside(db, scopes);'],
  ['live owner comparison', 'content-suppression-storage.mjs',
    "if ((row ? `${row.epoch_hi}:${row.epoch_lo}` : '0:0') !== state.epoch) fail('evidence_unavailable');", ''],
  ['fresh owner row', 'content-suppression-storage.mjs',
    "const row = db.prepare('SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs WHERE owner_id=?').get(state.owner);", 'const row = null;'],
  ['MCP guarded call', 'adapters/mcp/server.mjs', 'return core.recall({ readSet: [binding]', 'return recallMemories({ readSet: [binding]'],
  ['MCP dispatcher await', 'adapters/mcp/server.mjs', 'result = await action(input);', 'result = action(input);'],
  ['MCP dispatcher early delivery', 'adapters/mcp/server.mjs', 'result = await action(input);', 'return await action(input);'],
]) test(`delivery census refuses loss of ${name}`, () => {
  const sources = deliverySources(), source = sources.get(file);
  assert.equal(source.split(before).length, 2, `${file}: one exact source-backed mutation target for ${name}`);
  sources.set(file, source.replace(before, after));
  assert.throws(() => auditDelivery(sources), /delivery census/);
});

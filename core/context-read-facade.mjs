import { sampleLocalStatus } from './context-read-local-status.mjs';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { validateContextProductLayout } from './context-product-schema.mjs';
import { openReadDatabase } from './read-database.mjs';
import { readTransaction, isConnectionDiscarded, isStorageBusy } from './database.mjs';
import { ownData } from './local-authority-input.mjs';
import { deepFreeze } from './private-card-input.mjs';
import { verifyPrivateGrant } from './private-card-facade.mjs';
import { cardDependencyFence } from './card-current-storage.mjs';
import { createPrivateCardStorage } from './private-card-storage.mjs';
import { createPrivateEvidenceStorage } from './private-evidence-storage.mjs';
import { createCardReceiptSources } from './card-receipt-sources.mjs';
import { MemoryStoreError, fail } from './validation.mjs';
import { openContextReadSidecar, assertContextReadReadOnlyAuxiliaries, assertContextReadCanonicalDelete, contextSourceFences } from './context-read-sidecar.mjs';
import { createSourceContext, expandRelations, relationDiagnostic, sourceReader, sourceBudget, sourceStateBytes, validateRelationWitness, SourceStop } from './context-read-relations.mjs';
import { rankMoc, mocDiagnostic } from './context-read-moc.mjs';
import { fuseCandidates, RRF_PRESETS } from './context-read-fusion.mjs';
import { REPRESENTATION_VERSION, TOKENIZER_VERSION } from './context-read-tokenize.mjs';
import { validateVector } from './context-read-embedder.mjs';
import { contextBudget } from './context-read-budget.mjs';
import { assembleContext } from './context-read-assembly.mjs';
import { validateSourceReceipt } from './source-evidence.mjs';
import { CONTEXT_VERSION, CONTEXT_METHODS, CONTEXT_LIMITS, SOURCE_LIMITS, ASSEMBLY_LIMITS, ASSEMBLY_POLICIES, ASSEMBLY_DEFAULTS, DEFAULT_ASSEMBLY_POLICY,
  contextOptions, contextInput, contextRefs, namespaceKey } from './context-read-input.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bytes = envelope => Buffer.byteLength(JSON.stringify(envelope));
const success = value => ({ ok: true, value });
const states = new Set(['ready', 'unavailable', 'disabled', 'absent', 'timeout', 'provider_error', 'rate_limited',
  'budget_denied', 'stale_index', 'dimension_mismatch', 'partial_coverage']);
const channel = (state, causes = state === 'ready' ? [] : [state]) => ({ state, causes: [...new Set(causes)] });
const maintenanceReasons = new Map([['missing', 'missing'], ['corrupt', 'corrupt'], ['wrong_store', 'wrong-store'],
  ['wrong-store', 'wrong-store'], ['incompatible', 'incompatible']]);
const knownErrors = new Set(['invalid_input', 'invalid_read_set', 'authority_required', 'scope_changed', 'invalid_cursor',
  'cursor_stale', 'revision_conflict', 'evidence_unavailable', 'invalid_snapshot', 'snapshot_stale',
  'context_item_too_large', 'token_count_unavailable', 'index_unavailable', 'storage_busy', 'storage_error', 'store_closed']);
function failure(error, details) {
  let code = isStorageBusy(error) ? 'storage_busy' : knownErrors.has(error?.code) ? error.code : 'storage_error';
  if (['invalid_identifier', 'invalid_revision', 'invalid_text'].includes(error?.code)) code = 'invalid_input';
  return { ok: false, error: { code, retryable: code === 'storage_busy', ...(details ? { details: structuredClone(details) } : {}) } };
}
function degradation(error) {
  if (['scope_changed', 'store_closed'].includes(error?.code)) throw error;
  const causes = [];
  if (error?.name === 'AbortError' || error?.code === 'timeout' || error?.reason === 'timeout') causes.push('timeout');
  if (error?.status === 429 || error?.code === 'rate_limited') causes.push('rate_limited');
  if (states.has(error?.code)) causes.push(error.code);
  if (error?.code === 'index_unavailable') causes.push('stale_index');
  if (error?.code === 'context_item_too_large') causes.push('provider_error', 'context_item_too_large');
  if (!causes.length) causes.push('provider_error');
  return channel(causes[0], causes);
}
function metadata(port) {
  if (!port) return null;
  const { id, revision, dimensions, normalization } = port;
  return { id, revision, dimensions, normalization };
}

export function openContextCore(baseOptions, contextRead, openBase) {
  const options = contextOptions(contextRead), readOnly = Boolean(baseOptions.existingStore);
  // Managed-existing construction uses the retained managed opener, with its
  // journal refusal performed before that opener can touch either database.
  if (readOnly) {
    const probe = openReadDatabase(baseOptions.path, { contextRead: true,
      preflight: () => assertContextReadReadOnlyAuxiliaries(baseOptions.path) });
    probe.db.close();
  }
  const base = openBase(baseOptions);
  try {
    const context = createContextFacade(baseOptions.path === ':memory:' ? ':memory:' : resolve(baseOptions.path), options, { readOnly });
    return Object.freeze({ ...base, ...context.methods, close() { context.close(); return base.close(); } });
  } catch (error) { try { base.close(); } catch { /* Preserve the initialization refusal. */ } throw error; }
}
export function openContextReader(value) {
  const input = ownData(value, ['path', 'contextRead']);
  if (typeof input.path !== 'string' || !isAbsolute(input.path) || input.path.includes('\0')) fail('invalid_path');
  const options = contextOptions(input.contextRead), context = createContextFacade(input.path, options, { readOnly: true });
  return Object.freeze({ ...context.methods, close() { context.close(); return success(null); } });
}

// Internal Worker-only entry. Legacy configuration never selects this branch.
export function openContextProductFacade(path, product) {
  const options = { family: 'local', preset: 'rrf-k60-d12', authority: null, embedder: null, counter: null,
    policy: { maxConcurrent: 1 }, budgetConfigured: false, product };
  const context = createContextFacade(path, options, { readOnly: true });
  return { fetchCandidateEvidence: context.methods.fetchCandidateEvidence, close: context.close,
    capabilities: context.productCapabilities, fileIdentity: context.fileIdentity, port: context.productPort };
}

function createContextFacade(path, options, { readOnly }) {
  let database;
  try {
    if (path !== ':memory:') database = openReadDatabase(path, { contextRead: true,
      nativeObserver: options.product?.observer,
      productSqlite: options.product?.sqlite,
      validateProduct: options.product ? validateContextProductLayout : undefined,
      preflight: () => { if (readOnly && !options.product?.sqlite) (options.product ? assertContextReadCanonicalDelete : assertContextReadReadOnlyAuxiliaries)(path, options.product?.observer); } });
    return initializeContextFacade(path, options, { readOnly, database });
  } catch (error) {
    try { if (database?.db.isOpen) database.db.close(); } catch { /* Preserve the initialization refusal. */ }
    throw error;
  }
}
function initializeContextFacade(path, options, { readOnly, database }) {
  let closed = false;
  let retainedSourceBytes = 0;
  const rankings = new Map(), controllers = new Set(), indexes = new Map(), dispatch = contextBudget(options);
  const memoryOnly = path === ':memory:';
  const guardAuxiliaries = () => { if (readOnly && !options.product?.sqlite) (options.product ? assertContextReadCanonicalDelete : assertContextReadReadOnlyAuxiliaries)(path, options.product?.observer); };
  const db = database?.db;
  function ready() {
    if (closed || db && (!db.isOpen || isConnectionDiscarded(db))) fail('store_closed');
    if (database) { database.assertFile(); guardAuxiliaries(); }
  }
  const read = (work, acquisition) => { ready(); return acquisition ? acquisition.transaction(db, work, readTransaction) : readTransaction(db, work); };
  const info = memoryOnly ? { storeId: null, cursorSecret: null, cards: false, raw: false } : read(() => {
    const row = db.prepare('SELECT store_id,cursor_secret FROM store_metadata WHERE singleton=1').get();
    if (!row) fail('unsupported_database');
    const has = table => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
    return { storeId: row.store_id, cursorSecret: row.cursor_secret,
      cards: (!options.product || db.prepare('PRAGMA user_version').get().user_version >= 23) && has('private_cards') && has('card_memory_bindings') && has('card_applicability_reviews'), raw: has('card_raw_bindings'),
      ...(options.sources ? { organization: ['card_mocs', 'card_moc_epochs', 'card_moc_title_sources', 'card_moc_refs', 'card_moc_edges'].every(has),
        reviews: has('card_applicability_reviews'), receipts: has('card_memory_bindings') } : {}) };
  });
  const supportedTypes = ['memory', ...(info.cards ? ['card'] : [])];
  const bind = (purpose, value) => createHmac('sha256', info.cursorSecret ?? 'unavailable')
    .update(JSON.stringify([...(options.product && purpose !== 'snapshot-item' ? ['context-read-product-v1.1'] : []), CONTEXT_VERSION, purpose, info.storeId, value])).digest('base64url');
  const configuration = deepFreeze({ family: options.family, preset: options.preset, embedder: metadata(options.embedder),
    tokenizer: TOKENIZER_VERSION, representation: REPRESENTATION_VERSION,
    ...(options.sources ? { sources: options.sources } : {}) });
  function encode(purpose, value, maximum) {
    const body = Buffer.from(JSON.stringify(value)).toString('base64url'), token = `${body}.${bind(purpose, body)}`;
    if (token.length > maximum) fail('context_item_too_large');
    return token;
  }
  function decode(purpose, token, maximum, code) {
    if (typeof token !== 'string' || token.length > maximum) fail(code);
    const [body, signature, extra] = token.split('.');
    if (!body || !signature || extra !== undefined || !/^[A-Za-z0-9_-]+$/.test(body)) fail(code);
    const expected = Buffer.from(bind(purpose, body)), supplied = Buffer.from(signature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) fail(code);
    try {
      const buffer = Buffer.from(body, 'base64url');
      if (buffer.toString('base64url') !== body) fail(code);
      return JSON.parse(buffer.toString('utf8'));
    } catch { fail(code); }
  }
  function authorize(method, input, payload, token) {
    ready();
    if (options.product) return options.product.authorize(method, payload, token);
    if (!token || typeof token !== 'object') fail('authority_required');
    const grants = input.readSet.map(namespace => {
      const request = deepFreeze({ method, namespace, actionClass: 'read', actionId: null, targetId: null,
        expectedRevision: null, payloadBinding: bind('request', [method, payload]), input: payload });
      let grant, generation;
      try {
        grant = options.authority.authorize(request, token);
        if (!grant || typeof grant !== 'object' || typeof grant.then === 'function') fail('authority_required');
        generation = verifyPrivateGrant(options.authority.isCurrent(grant, request), request);
      } catch { fail('authority_required'); }
      return { grant, request, generation };
    });
    const check = () => {
      ready();
      for (const value of grants) {
        let current;
        try { current = verifyPrivateGrant(options.authority.isCurrent(value.grant, value.request), value.request); }
        catch { fail('scope_changed'); }
        if (current !== value.generation) fail('scope_changed');
      }
    };
    check();
    return { check, accessGenerations: grants.map(value => value.generation) };
  }
  function selected(input, access) {
    return { readSet: input.readSet, types: input.types, intent: input.intent, accessGenerations: access.accessGenerations };
  }
  function acquireSidecar(projection, access) {
    access.check();
    if (memoryOnly) throw Object.assign(new MemoryStoreError('index_unavailable'), { reason: 'memory_store' });
    const key = JSON.stringify([projection.readSet, projection.types, projection.intent]);
    let entry = indexes.get(key);
    if (entry) {
      let error;
      try { entry.storage.assertFile(); } catch (failure) { error = failure; }
      if (entry.invalid || error && ['missing', 'replaced'].includes(error.reason)) {
        if (entry.users) throw error ?? new MemoryStoreError('index_unavailable');
        entry.storage.close(); indexes.delete(key); entry = undefined;
      } else if (error) throw error;
    }
    if (!entry) {
      entry = { storage: openContextReadSidecar({ path, db, readOnly, authorizedProjection: projection }), users: 0 };
      indexes.set(key, entry);
    }
    entry.users++;
    return { storage: entry.storage, invalidate(error) {
      if (error?.code === 'ERR_SQLITE_ERROR' && [1, 11, 26].includes(error.errcode & 0xff)) entry.invalid = true;
    }, release() {
      entry.users--;
      if (entry.invalid && !entry.users) { entry.storage.close(); indexes.delete(key); }
      // Active asynchronous operations retain their connection. Only idle
      // projections are evicted, so another scope cannot invalidate a request.
      for (const [id, candidate] of indexes) {
        if (indexes.size <= 8) break;
        if (!candidate.users) { candidate.storage.close(); indexes.delete(id); }
      }
    } };
  }
  function canonicalFence(readSet, types) {
    return readSet.map(ns => ({ memory: db.prepare(`SELECT epoch FROM namespace_epochs WHERE owner_id=? AND scope=? AND project_id=?`)
      .get(ns.ownerId, ns.scope, ns.projectId ?? '')?.epoch ?? 1,
    ...(types.includes('card') ? { card: db.prepare(`SELECT generation FROM card_epochs WHERE owner_id=? AND scope=? AND project_id=?`)
      .get(ns.ownerId, ns.scope, ns.projectId ?? '')?.generation ?? 1 } : {}) }));
  }
  function unknownCoverage(input) {
    return { status: 'unavailable', byType: Object.fromEntries((input?.types ?? supportedTypes).map(type =>
      [type, { eligible: null, indexed: null, embedded: null, scanned: null, embeddedFraction: null, scannedFraction: null }])),
    freshness: 'unverified', maintenance: { available: !readOnly && !memoryOnly, state: 'rebuilding', buildState: 'rebuilding', reason: null, progress: null },
    depths: { lexical: 0, semantic: 0 }, omitted: { lexical: null, semantic: null, horizon: null }, stops: { deadline: false, budget: false } };
  }
  function maintenanceCoverage(value, maintenance, { deadlineAt, maxItems } = {}) {
    if (maintenance) {
      value.maintenance.reason = maintenanceReasons.get(maintenance.reason) ?? null;
      value.maintenance.buildState = ['rebuilding', 'rebuilt', 'ready'].includes(maintenance.buildState) ? maintenance.buildState : 'rebuilding';
      value.maintenance.state = maintenance.status === 'complete' ? 'ready' : 'rebuilding';
      value.maintenance.progress = maintenance.progress;
    }
    value.stops.deadline ||= Boolean(maintenance?.stops?.deadline) || deadlineAt !== undefined && performance.now() >= deadlineAt;
    value.stops.budget ||= Boolean(maintenance?.stops?.budget) || maxItems !== undefined && (maintenance?.metrics.transformed ?? 0) >= maxItems;
    return value;
  }
  function coverage(input, state, preflight, mode, matched, unionSize, maintenance, semanticState) {
    const value = unknownCoverage(input); value.status = 'complete'; value.freshness = 'current';
    value.maintenance.state = 'ready'; value.maintenance.buildState = 'ready'; value.maintenance.progress = state.progress;
    maintenanceCoverage(value, maintenance ?? { ...state, status: 'complete' });
    const semanticUsed = mode === 'hybrid' && (!options.sources || semanticState === 'ready');
    for (const type of input.types) {
      const counts = state.byType[type], semantic = preflight?.byType?.[type];
      const scanned = semanticUsed ? semantic?.scanned ?? 0 : 0;
      value.byType[type] = { ...counts, embedded: semantic?.embedded ?? null, scanned,
        embeddedFraction: semantic ? counts.eligible ? semantic.embedded / counts.eligible : 1 : null,
        scannedFraction: counts.eligible ? scanned / counts.eligible : 1 };
    }
    const depth = mode === 'hybrid' ? RRF_PRESETS[options.preset].depth : 24;
    value.depths = { lexical: depth, semantic: semanticUsed ? depth : 0 };
    value.omitted = { lexical: matched === null ? null : Math.max(0, matched - depth),
      semantic: semanticUsed ? Math.max(0, preflight.eligible - depth) : null, horizon: Math.max(0, unionSize - 24) };
    return value;
  }
  function sampleTrace(value) {
    if (options.localStatus) value.localEmbedder = sampleLocalStatus(options.localStatus);
  }
  function trace(input) {
    return { requested: input.semantic ? 'hybrid' : 'lexical', effective: 'lexical', ...configuration,
      timings: { maintenanceMs: 0, lexicalMs: 0, semanticPreflightMs: 0, embeddingMs: 0, fusionMs: 0 } };
  }
  // U5c-2 retained state includes identities, witnesses, fences and diagnostics;
  // the scan corpora never enter a ranking. Oldest eviction never renews TTL.
  function dropRanking(id) {
    retainedSourceBytes -= rankings.get(id)?.sourceBytes ?? 0; rankings.delete(id);
  }
  function expireRankings() {
    for (const [id, ranking] of rankings) if (Date.now() >= ranking.expires) dropRanking(id);
  }
  const requestBinding = input => bind('ranking-request', [input.readSet, input.query, input.types, input.intent, input.semantic, ...(options.sources ? [input.sources] : [])]);
  const accessBinding = access => bind('access', access.accessGenerations);
  const stateBinding = state => bind('index', [state.fence, state.sequence, state.checkpoint, state.incarnation]);
  function captureSources(input) {
    return input.sources?.length ? contextSourceFences(db, input.readSet, input.types, input.sources, info) : [];
  }
  function assertSourcesInside(input, sourceState, code) {
    if (sourceState && !same(captureSources(input), sourceState.fences)) fail(code);
  }
  function witnessInside(input, path, code, budget = sourceBudget(Infinity)) {
    try {
      const reader = sourceReader(db, { storeId: info.storeId, cursorSecret: info.cursorSecret }, info, input, budget);
      if (validateRelationWitness(reader, path)) fail(code);
    } catch (error) { if (error instanceof SourceStop) fail(code); throw error; }
  }
  function deliverPage(input, ranking, position, limit) {
    return read(() => {
      const result = page(ranking, position, limit);
      for (const candidate of result.items) evidence.itemsInside(candidate.ref.namespace, [candidate.ref], input.intent, input.readSet);
      if (!options.sources) return result;
      assertSourcesInside(input, ranking.sourceState, 'cursor_stale');
      const budget = sourceBudget(Infinity);
      for (const path of ranking.sourceState.witnesses) witnessInside(input, path, 'cursor_stale', budget);
      return result;
    });
  }
  const rankingConfiguration = (trace, sourceState, items) => bind('ranking-config', [configuration, trace.requested, trace.effective,
    ...(sourceState ? [sourceState, items] : [])]);
  function page(ranking, position, limit) {
    let end = Math.min(ranking.items.length, position + limit);
    while (end > position || ranking.items.length === 0) {
      const value = { version: CONTEXT_VERSION, items: ranking.items.slice(position, end), channels: ranking.channels,
        coverage: ranking.coverage, trace: ranking.trace,
        nextCursor: end >= ranking.items.length ? null : encode('cursor', { v: 1, r: ranking.id, b: ranking.request,
          c: ranking.configuration, a: ranking.access, g: ranking.index, e: ranking.expires, p: end }, 8192) };
      if (bytes(success(value)) <= 65536) return structuredClone(value);
      end--;
    }
    fail('context_item_too_large');
  }
  function continuation(input, access) {
    if (options.localStatus) sampleLocalStatus(options.localStatus);
    const token = decode('cursor', input.cursor, 8192, 'invalid_cursor');
    try {
      ownData(token, ['v', 'r', 'b', 'c', 'a', 'g', 'e', 'p']);
      if (Object.keys(token).length !== 8 || !['r', 'b', 'c', 'a', 'g'].every(key => typeof token[key] === 'string') ||
          !Number.isSafeInteger(token.e)) fail('invalid_cursor');
    } catch { fail('invalid_cursor'); }
    if (!token || token.v !== 1 || token.b !== requestBinding(input) || !Number.isInteger(token.p) || token.p < 1 || token.p > (options.sources ? 32 : 24)) fail('invalid_cursor');
    expireRankings();
    const ranking = rankings.get(token.r);
    if (!ranking || token.e !== ranking.expires || token.c !== ranking.configuration || token.a !== accessBinding(access) ||
        token.g !== ranking.index || token.p >= ranking.items.length || Date.now() >= token.e) fail('cursor_stale');
    if (ranking.configuration !== rankingConfiguration(ranking.trace, ranking.sourceState, ranking.items)) fail('cursor_stale');
    access.check();
    const projection = selected(input, access), lease = acquireSidecar(projection, access);
    try {
      const current = lease.storage.state(projection);
      if (!current.ready || stateBinding(current) !== ranking.index) fail('cursor_stale');
      const finalRanking = options.localStatus ? { ...ranking, trace: { ...ranking.trace, localEmbedder: sampleLocalStatus(options.localStatus) } } : ranking;
      access.check(); lease.storage.assertState(projection, current);
      return deliverPage(input, finalRanking, token.p, input.limit);
    } catch (error) { lease.invalidate(error); throw error; }
    finally { lease.release(); }
  }
  async function searchCandidates(input, access, deadlineAt, internal = false) {
    let diagnostics, controller, lease, sourceState;
    try {
      diagnostics = { channels: { lexical: channel('unavailable'), semantic: channel(input.semantic ? options.embedder ? 'unavailable' : 'absent' : 'disabled',
        !input.semantic && !options.embedder ? ['disabled', 'absent'] : undefined) }, coverage: unknownCoverage(input), trace: trace(input) };
      sampleTrace(diagnostics.trace);
      if (options.sources) diagnostics.trace.sources = Object.fromEntries(options.sources.map(id => {
        const reason = !input.sources.includes(id) ? 'disabled' : id === 'relations-one-hop-v1' && input.intent === 'history' ? 'unsupported_intent' : 'index_unavailable';
        return [id, id === 'moc-v1' ? mocDiagnostic(reason) : relationDiagnostic(reason)];
      }));
      if (input.semantic && (!options.embedder || !dispatch)) {
        if (options.embedder) diagnostics.channels.semantic = channel('budget_denied');
        throw new MemoryStoreError('invalid_input');
      }
      const projection = selected(input, access); lease = acquireSidecar(projection, access); const storage = lease.storage;
      let maintenance;
      if (!readOnly) {
        const time = performance.now();
        const remaining = Math.floor(deadlineAt - time);
        if (remaining < 1) throw Object.assign(new MemoryStoreError('index_unavailable'), { reason: 'timeout' });
        maintenance = storage.reconcile({ ...projection, budget: { maxItems: 1024, maxMs: remaining } }, { isCurrent: access.check });
        diagnostics.trace.timings.maintenanceMs = performance.now() - time;
        diagnostics.trace.maintenance = maintenance.metrics;
      }
      access.check();
      const current = storage.state(projection);
      diagnostics.coverage.maintenance.progress = maintenance?.progress ?? current.progress;
      maintenanceCoverage(diagnostics.coverage, maintenance, { deadlineAt, maxItems: readOnly ? undefined : 1024 });
      if (!current.ready) fail('index_unavailable');
      diagnostics.coverage = coverage(input, current, null, 'lexical', null, 0, maintenance);
      let time = performance.now();
      const lexical = storage.lexicalPage(projection, input.query, 24, { deadlineAt });
      diagnostics.trace.timings.lexicalMs = performance.now() - time;
      diagnostics.channels.lexical = channel('ready');
      let moc = [];
      const sourceContext = options.sources ? createSourceContext() : undefined;
      if (options.sources) {
        access.check();
        const collected = read(() => {
          const fences = captureSources(input), sources = {};
          for (const id of options.sources) sources[id] = id === 'moc-v1' ? mocDiagnostic('disabled') : relationDiagnostic('disabled');
          if (input.sources.includes('moc-v1')) {
            const ranked = rankMoc(db, { storeId: info.storeId, cursorSecret: info.cursorSecret }, info, input, deadlineAt, sourceContext);
            moc = ranked.rows; sources['moc-v1'] = ranked.diagnostic;
          }
          return { fences, sources };
        });
        sourceState = { fences: collected.fences, witnesses: [] };
        diagnostics.trace.sources = collected.sources;
      }
      let preflight, semantic = [];
      if (input.semantic) {
        time = performance.now();
        try { preflight = storage.semanticPreflight(projection, options.embedder, { deadlineAt }); }
        catch (error) { diagnostics.channels.semantic = degradation(error); }
        diagnostics.trace.timings.semanticPreflightMs = performance.now() - time;
        if (preflight) diagnostics.channels.semantic = channel(preflight.state);
        // fp32 residency never crosses an await. Validate coverage/capacity
        // before paid dispatch, then refetch/revalidate synchronously to score.
        // Concurrent scopes therefore share the per-handle byte ceiling without
        // changing one another's eligibility, coverage or ranking.
        preflight?.release?.();
        if (preflight?.state === 'ready' && preflight.eligible > 0) {
          controller = new AbortController(); controllers.add(controller);
          const guard = () => { access.check();
            if (sourceState) read(() => assertSourcesInside(input, sourceState, internal ? 'snapshot_stale' : 'cursor_stale'));
            storage.assertState(projection, current); };
          time = performance.now();
          try {
            const vectors = await dispatch(options.embedder, [input.query], { signal: controller.signal, deadlineAt, guard });
            guard();
            if (!Array.isArray(vectors) || vectors.length !== 1) throw Object.assign(new Error(), { code: 'provider_error' });
            const query = validateVector(vectors[0], options.embedder);
            const scoring = storage.semanticPreflight(projection, options.embedder, { deadlineAt });
            try {
              if (scoring.state !== 'ready') { preflight = scoring; diagnostics.channels.semantic = channel(scoring.state); }
              else { semantic = scoring.score(query, { deadlineAt }); preflight = scoring; }
            } finally { scoring.release?.(); }
          } catch (error) { diagnostics.channels.semantic = degradation(error); }
          diagnostics.trace.timings.embeddingMs = performance.now() - time;
        }
      }
      access.check();
      if (sourceState) read(() => assertSourcesInside(input, sourceState, internal ? 'snapshot_stale' : 'cursor_stale'));
      storage.assertState(projection, current);
      time = performance.now();
      const fused = fuseCandidates(lexical.rows, semantic, { preset: options.preset,
        semanticState: diagnostics.channels.semantic.state, coverageComplete: preflight?.state === 'ready', ...(options.sources ? { moc } : {}) });
      diagnostics.trace.timings.fusionMs = performance.now() - time; diagnostics.trace.effective = fused.mode;
      diagnostics.coverage = coverage(input, current, preflight, fused.mode, lexical.matched, fused.unionSize, maintenance, diagnostics.channels.semantic.state);
      diagnostics.coverage.stops = { deadline: diagnostics.channels.semantic.causes.includes('timeout'),
        budget: diagnostics.channels.semantic.causes.includes('budget_denied') };
      let candidateItems = fused.rows.map((row, i) => ({ ref: row.ref, rank: i + 1, fusionScore: row.fusionScore, channels: row.channels }));
      if (sourceState) {
        access.check();
        read(() => {
          assertSourcesInside(input, sourceState, internal ? 'snapshot_stale' : 'cursor_stale');
          if (input.sources.includes('relations-one-hop-v1')) {
            const expanded = expandRelations(db, { storeId: info.storeId, cursorSecret: info.cursorSecret }, info,
              { ...input, mocPreset: options.preset === 'rrf-k60-d12-moc-v1' }, candidateItems, deadlineAt, sourceContext);
            candidateItems = expanded.items.map((item, i) => ({ ...item, rank: i + 1 }));
            sourceState.witnesses = expanded.witnesses;
            diagnostics.trace.sources['relations-one-hop-v1'] = expanded.diagnostic;
          }
        });
      }
      if (sourceState) diagnostics.coverage.stops.deadline ||= Object.values(diagnostics.trace.sources).some(source => source.reasons.includes('deadline'));
      if (internal) {
        sampleTrace(diagnostics.trace);
        access.check(); storage.assertState(projection, current);
        const horizon = deepFreeze({ items: candidateItems, ...diagnostics });
        return { ok: true, horizon, ...(sourceState ? { sourceState } : {}), check() {
          access.check();
          if (sourceState) read(() => assertSourcesInside(input, sourceState, 'snapshot_stale'));
          const resumed = acquireSidecar(projection, access);
          try { resumed.storage.assertState(projection, current);
            if (sourceState) read(() => assertSourcesInside(input, sourceState, internal ? 'snapshot_stale' : 'cursor_stale')); }
          finally { resumed.release(); }
        } };
      }
      sampleTrace(diagnostics.trace);
      const ranking = deepFreeze({ id: randomUUID(), expires: Date.now() + 300000, request: requestBinding(input),
        configuration: rankingConfiguration(diagnostics.trace, sourceState, candidateItems), access: accessBinding(access),
        index: stateBinding(current), items: candidateItems,
        ...(sourceState ? { sourceState, sourceBytes: sourceStateBytes({ items: candidateItems, sourceState, sources: diagnostics.trace.sources }) } : {}),
        ...diagnostics });
      expireRankings();
      const sourceBytes = ranking.sourceBytes ?? 0;
      if (sourceBytes > SOURCE_LIMITS.retainedBytes) fail('context_item_too_large');
      // Evict before transferring request-local state into retained ownership.
      while (rankings.size >= 128 || retainedSourceBytes + sourceBytes > SOURCE_LIMITS.retainedBytes) dropRanking(rankings.keys().next().value);
      rankings.set(ranking.id, ranking); retainedSourceBytes += sourceBytes;
      access.check();
      if (sourceState) read(() => assertSourcesInside(input, sourceState, 'cursor_stale'));
      storage.assertState(projection, current);
      return success(deliverPage(input, ranking, 0, input.limit));
    } catch (error) {
      if (diagnostics && !['scope_changed', 'authority_required', 'store_closed'].includes(error.code)) sampleTrace(diagnostics.trace);
      lease?.invalidate(error);
      if (diagnostics && (error.code === 'index_unavailable' || error.reason === 'timeout')) {
        diagnostics.coverage.maintenance.reason ??= maintenanceReasons.get(error.reason) ?? null;
        diagnostics.channels.lexical = channel(error.reason === 'timeout' ? 'timeout' : 'unavailable');
        diagnostics.coverage.stops.deadline ||= error.reason === 'timeout' || performance.now() >= deadlineAt;
        return failure(new MemoryStoreError('index_unavailable'), diagnostics);
      }
      return failure(error, diagnostics && ['invalid_input', 'index_unavailable'].includes(error.code) ? diagnostics : undefined);
    } finally { lease?.release(); if (controller) { controller.abort(); controllers.delete(controller); } }
  }
  async function findCandidates(original, token) {
    try {
      ready();
      const { payload, input } = contextInput('findCandidates', original, supportedTypes, options.sources);
      const deadlineAt = performance.now() + input.deadlineMs;
      const access = authorize('findCandidates', input, payload, token);
      if (input.cursor !== undefined) return success(continuation(input, access));
      return searchCandidates(input, access, deadlineAt);
    } catch (error) { return failure(error); }
  }
  async function refreshContextIndex(original, token) {
    let controller, diagnostics, lease, deadlineAt;
    try {
      ready();
      if (readOnly) fail('invalid_input');
      const { payload, input } = contextInput('refreshContextIndex', original, supportedTypes), access = authorize('refreshContextIndex', input, payload, token);
      diagnostics = { channels: { lexical: channel('unavailable'), semantic: channel(options.embedder ? 'unavailable' : 'absent') },
        coverage: unknownCoverage(input), trace: trace({ semantic: Boolean(options.embedder) }) };
      sampleTrace(diagnostics.trace);
      if (options.embedder && !dispatch) { diagnostics.channels.semantic = channel('budget_denied'); fail('invalid_input'); }
      deadlineAt = performance.now() + input.budget.maxMs; const projection = selected(input, access);
      lease = acquireSidecar(projection, access); const storage = lease.storage;
      const remaining = Math.floor(deadlineAt - performance.now());
      if (remaining < 1) { diagnostics.coverage.stops.deadline = true; fail('index_unavailable'); }
      const maintenance = storage.reconcile({ ...projection, budget: { ...input.budget, maxMs: remaining } }, { isCurrent: access.check });
      diagnostics.trace.maintenance = maintenance.metrics;
      access.check();
      let vectorProgress = { attempted: 0, embedded: 0 }, preflight, current = storage.state(projection);
      maintenanceCoverage(diagnostics.coverage, maintenance, { deadlineAt, maxItems: input.budget.maxItems });
      if (!current.ready) {
        diagnostics.coverage.maintenance.progress = maintenance.progress;
        sampleTrace(diagnostics.trace); access.check();
        return success({ status: 'rebuilding', progress: { lexical: maintenance.progress, transformed: maintenance.metrics.transformed,
          embeddingAttempts: 0, embedded: 0 }, coverage: diagnostics.coverage, channels: diagnostics.channels,
          ...(options.localStatus ? { trace: { localEmbedder: diagnostics.trace.localEmbedder } } : {}) });
      }
      diagnostics.channels.lexical = channel('ready');
      if (options.embedder) {
        controller = new AbortController(); controllers.add(controller);
        const remainingItems = input.budget.maxItems - maintenance.metrics.transformed, remainingMs = Math.floor(deadlineAt - performance.now());
        try {
          if (remainingItems > 0 && remainingMs > 0) vectorProgress = await storage.refreshVectors({ ...projection,
            budget: { maxItems: remainingItems, maxMs: remainingMs } }, { ...options.embedder,
            embed: texts => {
              return dispatch(options.embedder, texts, { signal: controller.signal, deadlineAt,
                guard: () => { access.check(); storage.assertState(projection, current, { checkpoint: false }); } });
            } }, { signal: controller.signal, maxBatchDocuments: options.policy.maxBatchDocuments,
            isCurrent: () => { access.check(); return true; },
            onProgress: progress => { vectorProgress = progress; } });
          access.check();
          preflight = storage.semanticPreflight(projection, options.embedder, { deadlineAt });
          preflight.release?.();
          diagnostics.channels.semantic = channel(preflight.state);
        } catch (error) { diagnostics.channels.semantic = degradation(error); }
      }
      sampleTrace(diagnostics.trace);
      access.check(); current = storage.state(projection);
      if (!current.ready) fail('index_unavailable');
      diagnostics.coverage = coverage(input, current, preflight, 'lexical', 0, 0, maintenance);
      diagnostics.coverage.stops = { deadline: performance.now() >= deadlineAt,
        budget: maintenance.metrics.transformed + vectorProgress.attempted >= input.budget.maxItems || diagnostics.channels.semantic.causes.includes('budget_denied') };
      return success({ status: !options.embedder || diagnostics.channels.semantic.state === 'ready' ? 'complete' : 'partial',
        progress: { lexical: maintenance.progress, transformed: maintenance.metrics.transformed,
          embeddingAttempts: vectorProgress.attempted, embedded: vectorProgress.embedded }, coverage: diagnostics.coverage, channels: diagnostics.channels,
          ...(options.localStatus ? { trace: { localEmbedder: diagnostics.trace.localEmbedder } } : {}) });
    } catch (error) {
      if (diagnostics && !['scope_changed', 'authority_required', 'store_closed'].includes(error.code)) sampleTrace(diagnostics.trace);
      lease?.invalidate(error);
      if (diagnostics && deadlineAt !== undefined) diagnostics.coverage.stops.deadline ||= performance.now() >= deadlineAt;
      if (diagnostics) diagnostics.coverage.maintenance.reason ??= maintenanceReasons.get(error.reason) ?? null;
      return failure(error, ['scope_changed', 'authority_required', 'store_closed'].includes(error.code) ? undefined : diagnostics);
    }
    finally { lease?.release(); if (controller) { controller.abort(); controllers.delete(controller); } }
  }

  const identity = { storeId: info.storeId, cursorSecret: info.cursorSecret };
  const cards = info.cards ? createPrivateCardStorage({ db, identity, ready, rawSources: info.raw }) : null;
  const receipt = memoryOnly ? null : createCardReceiptSources(db, (purpose, value) =>
    createHmac('sha256', info.cursorSecret).update(JSON.stringify([purpose, [info.storeId, value]])).digest('base64url'));
  const evidence = memoryOnly ? null : createPrivateEvidenceStorage({ db, identity,
    cardDetailInside: (ns, id, readSet, options) => cards.cardDetailInside(ns, id, readSet, options), receiptRefInside: (ns, memory, row) => receipt.refInside(ns, memory, row) });
  async function contextRead(original, token) {
    let candidates;
    try {
      ready();
      const { payload, input } = contextInput('contextRead', original, supportedTypes, options.sources);
      const deadlineAt = performance.now() + input.deadlineMs;
      const access = authorize('contextRead', input, payload, token);
      if (!options.counter) return failure(new MemoryStoreError('invalid_input'), { counter: 'absent' });
      const searched = await searchCandidates(input, access, deadlineAt, true);
      access.check();
      if (!searched.ok) {
        return deepFreeze({ ...searched, error: { ...searched.error,
          ...(searched.error.details ? { details: { candidates: searched.error.details } } : {}) } });
      }
      candidates = searched.horizon;
      searched.check(); // The horizon's search fences also cross the outer await.
      let deadline = performance.now() >= deadlineAt;
      access.check();
      deadline ||= performance.now() >= deadlineAt;
      const prepared = read(() => {
        // Inspect the authorized projection in this same transaction. This is
        // dispatch metadata, never a cached currentness decision.
        const dependencyAware = input.types.includes('card') && input.readSet.some(ns =>
          Object.keys(cardDependencyFence(db, ns, input.readSet)).length > 0);
        if (dependencyAware && performance.now() >= deadlineAt) {
          deadline = true;
          return { generations: [], items: [], unavailable: candidates.items.length };
        }
        const generations = canonicalFence(input.readSet, input.types), items = [];
        if (searched.sourceState) assertSourcesInside(input, searched.sourceState, 'snapshot_stale');
        let unavailable = 0;
        const witnessBudget = searched.sourceState ? sourceBudget(dependencyAware ? deadlineAt : Infinity) : null;
        for (const [position, candidate] of candidates.items.entries()) {
          if (dependencyAware && performance.now() >= deadlineAt) {
            deadline = true; unavailable += candidates.items.length - position; break;
          }
          let item;
          try {
            if (candidate.via) {
              const path = searched.sourceState.witnesses.find(value => same(value.ref, candidate.ref));
              try { witnessInside(input, path, 'evidence_unavailable', witnessBudget); }
              catch (error) { if (error.code === 'evidence_unavailable') { unavailable++; continue; } throw error; }
            }
            if (dependencyAware && performance.now() >= deadlineAt) { deadline = true; unavailable++; continue; }
            item = evidence.itemsInside(candidate.ref.namespace, [candidate.ref], input.intent, input.readSet, { deadlineAt: dependencyAware ? deadlineAt : Infinity })[0];
            if (dependencyAware && performance.now() >= deadlineAt) { deadline = true; unavailable++; continue; }
          }
          catch (error) {
            if (!['evidence_unavailable', 'revision_conflict'].includes(error.code)) throw error;
            unavailable++; continue;
          }
          const { type, ref, state, origin } = item;
          const sources = type === 'memory' && item.provenance.sourceAccess === 'available' ?
            db.prepare('SELECT * FROM receipts WHERE memory_id=? ORDER BY created_at,id LIMIT 16').all(ref.memoryId).filter(row=>item.provenance.receiptMetadata.some(receipt=>receipt.receiptId===row.id))
              .map((row, index) => {
                const { role, excerpt } = validateSourceReceipt(ref.memoryId, row, source =>
                  createHash('sha256').update(JSON.stringify(source)).digest('hex'));
                return { index, role, excerpt };
              }) : [];
          items.push({ type, ref, ns: input.readSet.findIndex(ns => namespaceKey(ns) === namespaceKey(ref.namespace)), rank: candidate.rank,
            metadata: type === 'memory' ? { state, reviewState: item.reviewState, filing: item.filing,
              kind: item.kind, origin, confidence: item.confidence } : { state, support: item.support, origin },
            text: type === 'memory' ? item.content : item.title + '\n' + item.body,
            sources, sourceAccess: type === 'memory' ? item.provenance.sourceAccess : 'unsupported',
            sourcesComplete: type === 'memory' && item.provenance.coverage.status === 'complete',
            fence: bind('snapshot-item', item),
            dependencyCount: item.support?.currentDependency ? item.support.currentDependency.versions?.length ?? 0 : null });
        }
        return { generations, items, unavailable };
      });
      const scope = bind('snapshot-scope', input.readSet);
      const generationsFor = items => prepared.generations.map(value => ({ memory: value.memory,
        ...(items.some(item => item.type === 'card') ? { card: value.card } : {}) }));
      const { selected: delivered, ...assembled } = assembleContext({ prepared: prepared.items, counter: options.counter, policy: input.policy,
        budget: input.budget, deadlineAt, snapshotOf: items => encode('snapshot', { v: 1, scope, intent: input.intent,
          refs: items.map(({ ref }) => [input.readSet.findIndex(ns => namespaceKey(ns) === namespaceKey(ref.namespace)), ref.type,
            ref.memoryId ?? ref.cardId, ref.revision, ...(ref.type === 'card' ? [ref.bodyRevision] : [])]),
          generations: generationsFor(items), access: access.accessGenerations, fences: items.map(item => item.fence) }, 16384) });
      const diagnostics = assembled.diagnostics;
      diagnostics.omitted.unavailable = prepared.unavailable;
      // Reserve one complete final pass for admitted declarations. These are
      // upper bounds; source/lifecycle/ownership work keeps its existing charge.
      const declared = delivered.filter(item => item.dependencyCount !== null);
      if (declared.length) {
        const resolutions = declared.reduce((n, item) => n + item.dependencyCount, 0);
        diagnostics.trace.finalDependencyValidationReserve = { records: declared.length,
          resolutions, bindingProbes: 4 * resolutions, manifestRows: 256 * resolutions };
      }
      const candidateTrace = options.localStatus ? { ...candidates.trace, localEmbedder: sampleLocalStatus(options.localStatus) } : candidates.trace;
      diagnostics.candidates = { count: candidates.items.length, channels: candidates.channels, coverage: candidates.coverage, trace: candidateTrace };
      diagnostics.stops.deadline ||= deadline;
      access.check();
      diagnostics.stops.deadline ||= performance.now() >= deadlineAt;
      const result = deepFreeze(success(assembled));
      if (bytes(result) > CONTEXT_LIMITS.responseBytes) fail('context_item_too_large');
      // No host callback, count or await follows this authoritative read.
      return read(() => {
        if (searched.sourceState) {
          assertSourcesInside(input, searched.sourceState, 'snapshot_stale');
          const witnessBudget = sourceBudget(Infinity);
          for (const path of searched.sourceState.witnesses) if (delivered.some(item => same(item.ref, path.ref)))
            witnessInside(input, path, 'snapshot_stale', witnessBudget);
        }
        if (delivered.length && !same(canonicalFence(input.readSet, [...new Set(delivered.map(item => item.type))]), generationsFor(delivered))) fail('snapshot_stale');
        for (const item of delivered) {
          let current;
          try { current = evidence.itemsInside(item.ref.namespace, [item.ref], input.intent, input.readSet)[0]; }
          catch (error) {
            if (['evidence_unavailable', 'revision_conflict'].includes(error.code)) fail('snapshot_stale');
            throw error;
          }
          if (bind('snapshot-item', current) !== item.fence) fail('snapshot_stale');
        }
        return result;
      });
    } catch (error) {
      const finalTrace = candidates && error.code === 'index_unavailable' && options.localStatus ? { ...candidates.trace, localEmbedder: sampleLocalStatus(options.localStatus) } : candidates?.trace;
      return failure(error, candidates && error.code === 'index_unavailable' ? { candidates: {
        channels: candidates.channels, coverage: candidates.coverage, trace: finalTrace } } : undefined);
    }
  }
  function fetchCandidateEvidence(original, token, productPayload) {
    try {
      ready();
      const { payload, input } = contextInput('fetchCandidateEvidence', original, supportedTypes, undefined, options.product ? 'context-read-product-v1.1' : undefined), access = authorize('fetchCandidateEvidence', input, options.product ? productPayload ?? payload : payload, token);
      if (memoryOnly) fail('index_unavailable');
      const scope = bind('snapshot-scope', input.readSet);
      let intent = input.intent, refs = input.refs, previous;
      if (input.snapshot !== undefined) {
        previous = decode('snapshot', input.snapshot, 16384, 'invalid_snapshot');
        try {
          ownData(previous, ['v', 'scope', 'intent', 'refs', 'generations', 'access', 'fences']);
          if (previous.v !== 1 || previous.scope !== scope || !['current', 'history'].includes(previous.intent) || !Array.isArray(previous.refs)) fail('invalid_snapshot');
          refs = contextRefs(previous.refs.map(value => {
            if (!Array.isArray(value) || value.length !== (value[1] === 'card' ? 5 : 4) || !Number.isInteger(value[0]) || !input.readSet[value[0]]) fail('invalid_snapshot');
            return { namespace: input.readSet[value[0]], type: value[1], [value[1] === 'memory' ? 'memoryId' : 'cardId']: value[2], revision: value[3],
              ...(value[1] === 'card' ? { bodyRevision: value[4] } : {}) };
          }), input.readSet, supportedTypes); intent = previous.intent;
        } catch { fail('invalid_snapshot'); }
      }
      const types = [...new Set(refs.map(ref => ref.type))];
      function fetchInside() {
        const generations = canonicalFence(input.readSet, types);
        if (previous && (!same(previous.generations, generations) || !same(previous.access, access.accessGenerations))) fail('snapshot_stale');
        const items = refs.map(ref => evidence.itemsInside(ref.namespace, [ref], intent, input.readSet)[0]);
        const fences = items.map(item => bind('snapshot-item', item));
        if (input.fences?.some((prefix, i) => prefix !== null && !fences[i].startsWith(prefix))) fail('snapshot_stale');
        if (previous && !same(previous.fences, fences)) fail('snapshot_stale');
        return { items, generations, fences };
      }
      const prepared = read(fetchInside);
      access.check();
      // Final canonical refetch is synchronous. There is no await or host
      // callback after this point; snapshots bind the exact delivered items.
      return read(() => {
        const current = fetchInside();
        if (!same(current.generations, prepared.generations) || !same(current.fences, prepared.fences)) fail('snapshot_stale');
        const result = { items: current.items, snapshot: encode('snapshot', { v: 1, scope, intent,
          refs: refs.map(ref => [input.readSet.findIndex(ns => namespaceKey(ns) === namespaceKey(ref.namespace)), ref.type,
            ref.memoryId ?? ref.cardId, ref.revision, ...(ref.type === 'card' ? [ref.bodyRevision] : [])]),
          generations: current.generations, access: access.accessGenerations, fences: current.fences }, 16384) };
        if (bytes(success(result)) > input.responseByteLimit) fail('context_item_too_large');
        return success(result);
      });
    } catch (error) { return failure(error); }
  }
  return { fileIdentity: database?.fileIdentity, productCapabilities: { types: supportedTypes },
    ...(options.product ? { productPort: { db, read, ready, evidence, bind, encode, decode, identity, features: info, canonicalFence } } : {}),
    methods: { getContextReadCapabilities() {
    return success(structuredClone({ version: CONTEXT_VERSION, methods: [...CONTEXT_METHODS], types: [...supportedTypes], intents: ['current', 'history'],
      channels: { lexical: { enabled: true }, semantic: { configured: Boolean(options.embedder), budgetConfigured: Boolean(dispatch) } },
      ...configuration, limits: { ...CONTEXT_LIMITS, ...(options.sources ? { horizon: 32, sources: SOURCE_LIMITS } : {}) }, maintenance: !readOnly && !memoryOnly,
      assembly: { representation: 'representation-v2', defaults: ASSEMBLY_DEFAULTS, policies: [...ASSEMBLY_POLICIES], defaultPolicy: DEFAULT_ASSEMBLY_POLICY,
        counter: options.counter ? { id: options.counter.id } : null, limits: { ...ASSEMBLY_LIMITS, ...(options.sources ? { candidates: 32, counterCalls: 1634 } : {}) } },
      unsupported: ['role-profiles', ...(!options.sources?.includes('relations-one-hop-v1') ? ['relations'] : []),
        ...(!options.sources?.includes('moc-v1') ? ['moc'] : []), 'raw-search', 'partial-semantic-search'] }));
  }, findCandidates, refreshContextIndex, fetchCandidateEvidence, contextRead }, close() {
    if (closed) return;
    closed = true; for (const controller of controllers) controller.abort();
    rankings.clear(); retainedSourceBytes = 0; for (const entry of indexes.values()) entry.storage.close(); indexes.clear(); if (db?.isOpen) db.close();
  } };
}

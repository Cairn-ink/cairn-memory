import { isDeepStrictEqual, types } from 'node:util';
import { comparisonVersion, comparisonIds, comparisonLimits as limits, comparisonSha as sha, comparisonFail as fail,
  comparisonData as data, comparisonFields as fields, comparisonErrorCode as code, comparisonUnwrap as unwrap, freeze,
  comparisonArtifact as artifact, comparisonJsonArtifact as jsonArtifact, verifyComparisonArtifact,
  consumeCanonicalComparisonPreparation, verifyCanonicalComparisonPreparation, createCanonicalReceiptGroupComparisonManifest } from './receipt-group-canonical-comparison-store.mjs';

const clock = performance, now = performance.now, dateNow = Date.now, schedule = setTimeout, unschedule = clearTimeout;
const performanceDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance');
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const nativeOn = EventTarget.prototype.addEventListener, nativeOff = EventTarget.prototype.removeEventListener, nativeThen = Promise.prototype.then;
const NativePromise = Promise, promiseGlobal = Object.getOwnPropertyDescriptor(globalThis, 'Promise'),
  promiseConstructor = Object.getOwnPropertyDescriptor(Promise.prototype, 'constructor'),
  promiseSpecies = Object.getOwnPropertyDescriptor(Promise, Symbol.species),
  promiseThen = Object.getOwnPropertyDescriptor(Promise.prototype, 'then');
const descriptorEqual = (a, b) => !!a && !!b && ['value', 'get', 'set', 'writable', 'enumerable', 'configurable']
  .every(key => Object.hasOwn(a, key) === Object.hasOwn(b, key) && a[key] === b[key]);
function promiseCheck() {
  if (!descriptorEqual(Object.getOwnPropertyDescriptor(globalThis, 'Promise'), promiseGlobal)
    || !descriptorEqual(Object.getOwnPropertyDescriptor(NativePromise.prototype, 'constructor'), promiseConstructor)
    || !descriptorEqual(Object.getOwnPropertyDescriptor(NativePromise, Symbol.species), promiseSpecies)
    || !descriptorEqual(Object.getOwnPropertyDescriptor(NativePromise.prototype, 'then'), promiseThen)) fail('comparison_invalid_port');
}
function descriptorOwner(object, key) { for (let o = object; o; o = Object.getPrototypeOf(o)) { const d = Object.getOwnPropertyDescriptor(o, key); if (d) return { owner: o, descriptor: d }; } return null; }
const nowDescriptor = descriptorOwner(clock, 'now');
function clockCheck() {
  if (!isDeepStrictEqual(Object.getOwnPropertyDescriptor(globalThis, 'performance'), performanceDescriptor)
    || !isDeepStrictEqual(descriptorOwner(clock, 'now'), nowDescriptor) || Object.getOwnPropertyDescriptor(Date, 'now')?.value !== dateNow
    || Object.getOwnPropertyDescriptor(globalThis, 'setTimeout')?.value !== schedule || Object.getOwnPropertyDescriptor(globalThis, 'clearTimeout')?.value !== unschedule) fail('comparison_clock_mutated');
}
function aborted(signal) {
  if (!signal || typeof signal !== 'object' || types.isProxy(signal) || Object.getPrototypeOf(signal) !== AbortSignal.prototype
    || Reflect.ownKeys(Object.getOwnPropertyDescriptors(signal)).some(key => !Object.hasOwn(Object.getOwnPropertyDescriptor(signal, key), 'value'))) fail('request_mutated');
  try { return nativeAborted.call(signal); } catch { fail('request_mutated'); }
}
const binding = state => ({ requestCount: state.requestCount, reservedMicroUsd: state.reservedMicroUsd, historySha256: state.historySha256 });
const checkpoint = state => ({ requestCount: state.requestCount, reservedMicroUsd: state.reservedMicroUsd });
const genericFatal = ['algorithm_usage_anomaly', 'algorithm_usage_overrun', 'algorithm_auth_transport_failure', 'algorithm_credential_echo',
  'algorithm_persistence_failure', 'algorithm_accounting_failure', 'algorithm_request_denied', 'algorithm_method_denied', 'algorithm_lifecycle', 'algorithm_budget_exceeded'];
const ordinary = new Set(['invalid_model_output', 'invalid_response', 'invalid_answer_response', 'provider_failure', 'provider_failed', 'response_too_large', 'response_body_bounds']);

/** Two fixed policies, serialized ledger owners and literal first artifacts. */
export async function runCanonicalReceiptGroupComparison(options) {
  const owner = consumeCanonicalComparisonPreparation(options), observation = owner.observation;
  const report = { version: comparisonVersion, denominator: 24, status: 'running', failure: null, manifest: null,
    cases: comparisonIds.map((id, index) => ({ id, ordinal: index + 1, selectionOrder: index % 2 ? ['B', 'A'] : ['A', 'B'],
      answerOrder: [['B', 'A'], ['A', 'B'], ['A', 'B'], ['B', 'A']][index % 4],
      selections: { A: { status: 'not-run', failure: null }, B: { status: 'not-run', failure: null } },
      answers: { A: { status: 'not-run', failure: null }, B: { status: 'not-run', failure: null } } })),
    resources: { physicalCalls: 0, reservedIntents: 0, generations: 0, unknownIntents: 0, reservedMicroUsd: 0 }, attempts: [], checkpoints: [] };
  const runDeadline = now.call(clock) + limits.runMs;
  let opts, configuration, initial, expected, inspect, current, prepared, slot, phase, arm, transport, guard, core, pendingPort,
    controller, listener, runTimer, caseTimer, caseDeadline, fatalCode = null, phaseStart = 0, slotFinalized = true;
  const evidence = new Map(), persisted = [], mark = value => { fatalCode ??= value; };
  function integrity() {
    clockCheck(); promiseCheck(); verifyCanonicalComparisonPreparation(owner, prepared);
    for (const binding of persisted) verifyComparisonArtifact(binding);
    if (opts) { aborted(opts.signal); if (controller) aborted(controller.signal); }
  }
  function auditDeadline(includeCase = !slotFinalized) {
    clockCheck();
    const active = now.call(clock) < Math.min(runDeadline, includeCase ? caseDeadline ?? runDeadline : runDeadline);
    if (!active) mark('comparison_absolute_deadline');
    if (slot && !slotFinalized && slot.terminalChecks) slot.terminalChecks.absoluteDeadlineActive &&= active;
    return active;
  }
  function terminalAudit() {
    try { integrity(); } catch (error) { mark(code(error)); }
    // Cancellation/model errors must not short-circuit elapsed-time validation.
    try { auditDeadline(); } catch (error) { mark(code(error)); }
  }
  function ensure() {
    try { integrity(); } catch (error) { mark(code(error)); throw error; }
    if (fatalCode) fail(fatalCode);
    if (opts && aborted(opts.signal) || controller && aborted(controller.signal)) fail('cancelled');
    if (now.call(clock) >= Math.min(runDeadline, caseDeadline ?? runDeadline)) fail('comparison_absolute_deadline');
  }
  const retain = (name, value) => { const bound = jsonArtifact(observation, name, value); persisted.push(bound); return bound; };
  function callback(fn, value) {
    try {
      if (types.isProxy(fn)) fail('record_persistence_failed');
      const returned = fn(freeze(data(value, 'record_persistence_failed')));
      if (returned !== undefined) {
        if (returned && typeof returned === 'object' && !types.isProxy(returned) && types.isPromise(returned)
          && Object.getPrototypeOf(returned) === NativePromise.prototype
          && Reflect.ownKeys(Object.getOwnPropertyDescriptors(returned)).every(key => typeof key === 'symbol'
            && Object.hasOwn(Object.getOwnPropertyDescriptor(returned, key), 'value'))) {
          promiseCheck(); nativeThen.call(returned, () => {}, () => {});
        }
        fail('record_persistence_failed');
      }
    }
    catch { mark('record_persistence_failed'); fail('record_persistence_failed'); }
  }
  function record(raw) {
    const row = data(raw, 'record_persistence_failed'), canonical = arm === 'B' && phase === 'selection';
    const isPre = canonical ? row.phase === 'pre' : !Object.hasOwn(row, 'latencyMs');
    const kind = canonical ? row.kind : phase === 'answer' ? 'answer' : row.endpoint.endsWith('input_tokens') ? 'count' : 'generation';
    let attempt = report.attempts.find(a => a.attemptId === row.attemptId);
    if (isPre) {
      ensure(); const expectedBody = phase === 'answer' ? slot.requestBody : prepared.wires[arm][kind];
      if (attempt || report.attempts.length >= 144 || row.requestBody !== expectedBody || row.reservedMicroUsd !== 5000) { mark('comparison_wire_mismatch'); fail('comparison_wire_mismatch'); }
      const requestArtifact = artifact(observation, `${row.attemptId}-request.txt`, row.requestBody, 262144); persisted.push(requestArtifact);
      attempt = { attemptId: row.attemptId, id: current.id, arm, phase, kind, dispatched: false, requestArtifact, pre: row, post: null };
      report.attempts.push(attempt); report.resources.reservedIntents++; report.resources.reservedMicroUsd += 5000;
    } else if (!attempt || attempt.post) { mark('comparison_accounting_failed'); fail('comparison_accounting_failed'); }
    if (!isPre) {
      attempt.post = row;
      // Never persist credential-bearing raw strings or a fabricated raw body.
      const withheld = row.failureCode === 'credential_echo' || row.failure === 'algorithm_credential_echo' || row.responseBody === '[REDACTED]';
      if (!withheld && typeof row.responseBody === 'string') {
        attempt.responseArtifact = artifact(observation, `${row.attemptId}-response.txt`, row.responseBody, 786432); persisted.push(attempt.responseArtifact);
      } else attempt.responseAbsenceReason = withheld ? 'withheld-credential-echo' : 'unavailable';
    }
    const publicRow = { ...row, id: current.id, arm, phase, stage: isPre ? 'pre' : 'post', kind, requestArtifact: attempt.requestArtifact,
      ...(attempt.responseArtifact ? { responseArtifact: attempt.responseArtifact } : {}) };
    const safe = { ...publicRow }; delete safe.requestBody; delete safe.responseBody;
    retain(`record-${String(report.attempts.indexOf(attempt) * 2 + (isPre ? 1 : 2)).padStart(3, '0')}.json`, safe);
    callback(opts.onRecord, publicRow);
  }
  function reconcile() {
    const actual = inspect(configuration), delta = actual.attempts.slice(expected.attempts.length), known = report.attempts.slice(phaseStart);
    if (actual.schemaVersion !== 2 || actual.state !== 'open' || actual.runId !== configuration.runId || actual.limitMicroUsd !== 400000000
      || actual.requestCap !== configuration.requestCap || !isDeepStrictEqual(actual.attempts.slice(0, expected.attempts.length), expected.attempts)
      || actual.requestCount !== expected.requestCount + delta.length || actual.attempts.length !== actual.requestCount
      || actual.reservedMicroUsd !== expected.reservedMicroUsd + delta.length * 5000
      || !isDeepStrictEqual(delta.map(a => a.attemptId), known.map(a => a.attemptId)) || delta.some(a => a.outcome === null)
      || delta.some((a, index) => a.channel !== (known[index]?.kind === 'count' ? 'cairn-count' : known[index]?.kind === 'answer' ? 'host-completion' : 'cairn-generation'))
      || known.some((a, index) => !a.post || a.post.outcome !== delta[index].outcome || a.post.actualMicroUsd !== delta[index].actualMicroUsd)) fail('comparison_accounting_failed');
    const transition = { sequence: report.checkpoints.length + 1, id: current.id, arm, phase, before: binding(expected), after: binding(actual), deltas: delta };
    expected = actual; report.checkpoints.push(transition); retain(`checkpoint-${String(transition.sequence).padStart(3, '0')}.json`, transition);
    callback(opts.onCheckpoint, transition);
    if (delta.some(a => a.outcome === 'unknown')) mark('usage_unknown');
  }
  async function finish() {
    if (pendingPort) { try { await pendingPort; } catch { /* original port failure is retained by caller */ } pendingPort = null; }
    if (transport) {
      if (arm === 'B' && phase === 'selection') {
        slot.transportHealth = transport.health(); if (slot.transportHealth.fatalCode) mark(slot.transportHealth.fatalCode);
        if (slot.transportHealth.state !== 'consumed') mark('comparison_accounting_failed');
      } else {
        try { transport.assertHealthy(); slot.transportHealth = { state: 'consumed', fatalCode: null }; }
        catch (error) { const fatal = code(error); mark(fatal); slot.transportHealth = { state: 'consumed', fatalCode: fatal }; }
      }
      try { reconcile(); } catch (error) { mark(code(error)); }
      try { transport.close(); } catch (error) { mark(code(error)); }
      transport = null;
    }
    guard?.close(); guard = null;
    try { core?.close(); } catch { mark('comparison_store_close_failed'); } core = null;
    if (slot && !slotFinalized) {
      let callerActive = false; try { callerActive = !aborted(opts.signal) && !aborted(controller.signal); } catch (error) { mark(code(error)); }
      let deadlineActive = false; try { deadlineActive = auditDeadline(); } catch (error) { mark(code(error)); }
      slot.terminalChecks = { pendingPortSettled: pendingPort === null, callerActive,
        absoluteDeadlineActive: slot.terminalChecks?.absoluteDeadlineActive !== false && deadlineActive,
        ledgerReconciled: !!expected && expected.attempts.every(a => a.outcome !== null),
        nonfatalHealth: slot.transportHealth?.fatalCode === null, persistenceIntegrity: !fatalCode };
    }
  }
  // Reject direct fake thenables/proxies/accessors before any Promise machinery.
  function trustedFetch(url, init) {
    ensure(); const value = opts.fetchImpl(url, init);
    const response = item => {
      if (!item || types.isProxy(item) || Object.getPrototypeOf(item) !== Response.prototype
        || Reflect.ownKeys(Object.getOwnPropertyDescriptors(item)).some(key => typeof key !== 'symbol'
          || !Object.hasOwn(Object.getOwnPropertyDescriptor(item, key), 'value'))) { mark('comparison_invalid_port'); fail('comparison_invalid_port'); }
      ensure(); return item;
    };
    if (value && typeof value === 'object' && !types.isProxy(value) && types.isPromise(value)) {
      // node:test/AsyncLocalStorage may add native data-symbol properties. A
      // branded Promise with unchanged species/constructor is observed before
      // adoption, so synchronous cancellation cannot leak a rejection. Reject
      // caller-controlled string properties before invoking SpeciesConstructor.
      if (Object.getPrototypeOf(value) !== NativePromise.prototype
        || Reflect.ownKeys(Object.getOwnPropertyDescriptors(value)).some(key =>
          typeof key !== 'symbol' || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) {
        mark('comparison_invalid_port'); fail('comparison_invalid_port');
      }
      promiseCheck(); nativeThen.call(value, () => {}, () => {});
      return nativeThen.call(value, response);
    }
    return response(value);
  }
  async function openPhase(createGeneric, createCanonical, createGuard) {
    phaseStart = report.attempts.length;
    guard = createGuard({ fetchImpl: trustedFetch, signal: controller.signal, deadline: Math.min(runDeadline, caseDeadline),
      onFatal(value) { mark(value); controller.abort(); }, onDispatch() {
        ensure(); const attempt = report.attempts.at(-1);
        if (!attempt || attempt.dispatched) fail('comparison_accounting_failed'); attempt.dispatched = true; report.resources.physicalCalls++;
        if (attempt.kind !== 'count') report.resources.generations++;
      } });
    const common = { configuration, checkpoint: checkpoint(expected), historySha256: expected.historySha256, apiKey: opts.apiKey, fetchImpl: guard.fetch, onRecord: record };
    if (arm === 'B' && phase === 'selection') transport = await createCanonical({ ...common,
      manifest: { version: 'receipt-group-canonical-plan-rank-v1', slotId: `${current.id}-B-selection`, preparedRequestSha256: prepared.canonicalRequestSha256, runDeadline, caseDeadline } });
    else { transport = createGeneric(common); transport.beginCase({ id: current.id, ordinal: 1 }); transport.beginArm(arm === 'A' ? 'baseline' : 'full'); }
    ensure();
  }
  try {
    opts = fields(options, ['preparation', 'manifest', 'configuration', 'checkpoint', 'historySha256', 'apiKey', 'fetchImpl', 'signal', 'onRecord', 'onCheckpoint'], 'invalid_comparison_configuration');
    if (!isDeepStrictEqual(data(opts.manifest), createCanonicalReceiptGroupComparisonManifest(observation))) fail('invalid_comparison_manifest');
    report.manifest = data(opts.manifest); configuration = data(opts.configuration, 'invalid_comparison_configuration');
    if (configuration.limitMicroUsd !== 400000000 || typeof opts.apiKey !== 'string' || opts.apiKey.length < 8
      || [opts.fetchImpl, opts.onRecord, opts.onCheckpoint].some(fn => typeof fn !== 'function' || types.isProxy(fn))) fail('invalid_comparison_configuration');
    aborted(opts.signal); ensure();
    const budget = await import('../experiment-budget/index.mjs'); inspect = budget.inspectEmbeddingExperimentBudgetSnapshot;
    initial = inspect(configuration); expected = initial;
    if (initial.schemaVersion !== 2 || initial.state !== 'open' || !isDeepStrictEqual(checkpoint(initial), data(opts.checkpoint))
      || initial.historySha256 !== opts.historySha256 || initial.attempts.length !== initial.requestCount || initial.attempts.some(a => a.outcome === null)) fail('ledger_failed');
    if (configuration.requestCap - initial.requestCount < 2111 || 400000000 - initial.reservedMicroUsd < 30000000 + 10715000) fail('budget_blocked');
    report.originalHistory = artifact(observation, 'original-ledger-history.json', JSON.stringify(initial), 64 * 1024 * 1024); persisted.push(report.originalHistory);
    retain('run-start.json', { ...report, ledger: binding(initial) });
    controller = new AbortController(); listener = () => { mark('cancelled'); controller.abort(); }; nativeOn.call(opts.signal, 'abort', listener, { once: true });
    if (aborted(opts.signal)) listener();
    runTimer = schedule(() => { mark('comparison_absolute_deadline'); controller.abort(); }, Math.max(0, runDeadline - now.call(clock)));
    const { createSourceBundleGuard } = await import('./source-bundle-runner.mjs');
    const { createAlgorithmDevelopmentTransport } = await import('./transport.mjs');
    const { createCanonicalReceiptGroupPlanRankTransport } = await import('../architecture/source-bundle-plan-rank-transport.mjs');
    const { createCanonicalReceiptGroupInvocation, assembleCanonicalReceiptGroupPlan, packCanonicalReceiptGroupAnswer } = await import('../architecture/receipt-group-canonical-plan.mjs');
    const { compileOrdinaryCardSelection } = await import('../architecture/card-plan-projection.mjs');
    const { assembleCardPlanEvidence, packCardPlanAnswer } = await import('../architecture/card-plan-evidence.mjs');
    for (const [index, row] of report.cases.entries()) {
      current = row; prepared = observation.cases[index]; ensure(); caseDeadline = now.call(clock) + limits.caseMs;
      caseTimer = schedule(() => { mark('comparison_absolute_deadline'); controller.abort(); }, limits.caseMs);
      for (const selectedArm of row.selectionOrder) {
        arm = selectedArm; phase = 'selection'; slot = row.selections[arm]; slotFinalized = false; let caught, portError, compiled, rankRequest, returned;
        try {
          ensure(); await openPhase(createAlgorithmDevelopmentTransport, createCanonicalReceiptGroupPlanRankTransport, createSourceBundleGuard);
          const base = { contextWindow: 8192, countTokens: owner.counter, select() { fail('comparison_select_forbidden'); }, rank(request) {
            rankRequest = data({ system: request.system, input: request.input, maxOutputTokens: request.maxOutputTokens });
            if (!isDeepStrictEqual(rankRequest, prepared.rankRequest)) fail('comparison_wire_mismatch');
            slot.coreRankRequest = rankRequest;
            pendingPort = transport.model.rank(request).then(value => { returned = value; return value; }, error => {
              portError = code(error, report.attempts.at(-1)?.post?.failure ?? 'provider_failure'); throw error;
            }); return pendingPort;
          } };
          const invocation = arm === 'B' ? createCanonicalReceiptGroupInvocation(base, { planRank(request) {
            const actual = data({ system: request.system, input: request.input, outputSchema: request.outputSchema, maxOutputTokens: request.maxOutputTokens });
            if (!isDeepStrictEqual(actual, prepared.canonicalRequest)) fail('comparison_wire_mismatch');
            pendingPort = transport.planRank(request).catch(error => { portError = code(error); throw error; }); return pendingPort;
          } }) : null;
          const model = invocation ? Object.freeze({ ...invocation.model, rank(request) {
            const actual = data({ system: request.system, input: request.input, maxOutputTokens: request.maxOutputTokens });
            if (!isDeepStrictEqual(actual, prepared.rankRequest)) fail('comparison_wire_mismatch');
            slot.coreRankRequest = actual; return invocation.model.rank(request);
          } }) : base;
          core = owner.openMemoryCore({ path: prepared.path, sourceCandidatePolicy: 'bounded-keyset-v1', model });
          const recalled = await core.recall({ readSet: [prepared.namespace], query: prepared.query, limit: 6, contextMode: 'source-evidence', selectionMode: 'bounded-source-scan' });
          if (pendingPort) { try { await pendingPort; } catch (error) { portError ??= code(error); } pendingPort = null; }
          if (!recalled.ok) fail(portError ?? recalled.error.code);
          if (recalled.value.coverage !== 'complete' || recalled.value.recallTruncated || recalled.value.selection.strategy !== 'complete-map') fail('invalid_recall_provenance');
          let assembled, packed;
          if (arm === 'A') {
            const projected = compileOrdinaryCardSelection({ ...rankRequest, signal: controller.signal }, returned, owner.counter); compiled = projected.compiled;
            assembled = assembleCardPlanEvidence({ compiled, recall: recalled, core, plan: prepared.sourcePlan, namespace: prepared.namespace, question: prepared.question });
            packed = packCardPlanAnswer({ evidence: assembled, countTokens: owner.counter });
            Object.assign(slot, { origin: projected.origin, ordinaryResult: returned, ordinaryRefsSha256: projected.ordinaryRefsSha256,
              derivedAssemblyRequestSha256: projected.syntheticAssemblyRequestSha256, derivedAssemblyProposal: compiled.proposal });
          } else {
            compiled = invocation.takePlan(); const canonical = assembleCanonicalReceiptGroupPlan({ compiled, recall: recalled, core, plan: prepared.sourcePlan, namespace: prepared.namespace, question: prepared.question });
            assembled = canonical.assemblyEvidence; packed = packCanonicalReceiptGroupAnswer({ evidence: canonical, countTokens: owner.counter });
            Object.assign(slot, { origin: compiled.origin, proposal: compiled.proposal, proposalSha256: compiled.proposalSha256,
              canonicalProposal: compiled.canonicalProposal, canonicalProposalSha256: compiled.canonicalProposalSha256, canonicalization: compiled.canonicalization,
              derivedReceiptGroupRequestSha256: compiled.derivedReceiptGroupRequestSha256, derivedReceiptGroupProposalSha256: compiled.derivedReceiptGroupProposalSha256,
              derivedAssemblyRequestSha256: compiled.derivedAssemblyRequestSha256, derivedAssemblyProposal: compiled.diagnostics.derivedAssemblyProposal });
          }
          slot.refs = compiled.refs; slot.recall = recalled; slot.units = assembled.units; slot.packed = packed;
          slot.tokenLengths = { rawProposal: owner.counter(JSON.stringify(arm === 'A' ? returned : compiled.proposal)), refs: owner.counter(JSON.stringify({ refs: compiled.refs })),
            derivedAssemblyProposal: owner.counter(JSON.stringify(slot.derivedAssemblyProposal)), ...(arm === 'B' ? { canonicalProposal: owner.counter(JSON.stringify(compiled.canonicalProposal)) } : {}) };
          evidence.set(`${row.id}-${arm}`, { units: assembled.units, packed });
        } catch (error) { caught = error; slot.failure = { code: portError ?? code(error) }; if (genericFatal.includes(slot.failure.code)) mark(slot.failure.code); }
        finally { await finish(); }
        // Terminal audit is independent of cancellation and model-error code.
        terminalAudit();
        slot.status = caught ? 'failed' : 'completed'; slot.artifact = retain(`${row.id}-${arm}-selection.json`, slot);
        try { auditDeadline(); } catch (error) { mark(code(error)); }
        if (caught && !ordinary.has(slot.failure.code)) mark(slot.failure.code);
        if (caught) row.answers[arm] = { status: 'unanswered', failure: { code: 'selection_failed' }, accepted: false };
        slotFinalized = true;
        if (fatalCode) fail(fatalCode);
      }
      for (const answerArm of row.answerOrder) {
        arm = answerArm; phase = 'answer'; slot = row.answers[arm]; if (slot.status === 'unanswered') continue;
        slotFinalized = false;
        let caught;
        try {
          ensure(); const chosen = evidence.get(`${row.id}-${arm}`); if (!chosen) fail('invalid_recall_provenance');
          slot.requestBody = JSON.stringify(chosen.packed.request); slot.requestSha256 = sha(slot.requestBody);
          await openPhase(createAlgorithmDevelopmentTransport, createCanonicalReceiptGroupPlanRankTransport, createSourceBundleGuard);
          pendingPort = transport.answer({ question: prepared.question, units: chosen.units });
          const answered = await pendingPort; pendingPort = null;
          if (!isDeepStrictEqual(answered.packed, chosen.packed)) fail('comparison_answer_mismatch');
          slot.answer = answered.answer; slot.accepted = true;
        } catch (error) { caught = error; slot.failure = { code: code(error) }; slot.accepted = false; }
        finally { await finish(); }
        terminalAudit();
        slot.status = caught ? 'failed' : 'completed'; slot.artifact = retain(`${row.id}-${arm}-answer.json`, slot);
        try { auditDeadline(); } catch (error) { mark(code(error)); }
        if (caught && !ordinary.has(slot.failure.code)) mark(slot.failure.code);
        slotFinalized = true;
        if (fatalCode) fail(fatalCode);
      }
      unschedule(caseTimer); caseTimer = null; caseDeadline = null; current = null; prepared = null;
    }
    report.status = 'completed';
  } catch (error) { mark(code(error)); report.status = 'failed'; report.failure = { code: fatalCode }; }
  finally {
    try { await finish(); } catch (error) { mark(code(error)); }
    unschedule(runTimer); unschedule(caseTimer);
    if (opts?.signal && listener) try { nativeOff.call(opts.signal, 'abort', listener); } catch { mark('request_mutated'); }
  }
  if (fatalCode) { report.status = 'failed'; report.failure = { code: fatalCode }; }
  if (initial && inspect) try {
    const final = inspect(configuration), delta = final.attempts.slice(initial.attempts.length);
    if (!isDeepStrictEqual(final.attempts.slice(0, initial.attempts.length), initial.attempts) || delta.some(a => a.outcome === null)
      || delta.length !== report.resources.reservedIntents) fail('comparison_accounting_failed');
    report.resources.unknownIntents = delta.filter(a => a.outcome === 'unknown').length;
    report.ledgerReconciliation = { prefixUnchanged: true, pendingIntents: 0, final: binding(final), accepted: report.resources.unknownIntents === 0 && !fatalCode };
  } catch (error) { mark(code(error)); report.status = 'failed'; report.failure ??= { code: fatalCode }; }
  terminalAudit();
  if (fatalCode) {
    report.status = 'failed'; report.failure ??= { code: fatalCode };
    if (report.ledgerReconciliation) report.ledgerReconciliation.accepted = false;
  }
  const final = freeze(data(report));
  try { jsonArtifact(observation, 'returned-report.json', final); } catch { mark('record_persistence_failed'); }
  try { auditDeadline(false); } catch (error) { mark(code(error)); }
  // The first literal is write-once. A failed post-write gate returns a
  // conservative failure; a closed audit must reject any literal mismatch.
  if (fatalCode) return freeze({ ...final, status: 'failed', failure: final.failure ?? { code: fatalCode },
    ...(final.ledgerReconciliation ? { ledgerReconciliation: { ...final.ledgerReconciliation, accepted: false } } : {}) });
  return final;
}

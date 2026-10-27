import './p2e-offline.mjs';
import test from 'node:test';
import { registerHooks } from 'node:module';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import * as fixtures from '../../evaluation/context-read-p2e/fixtures.mjs';
import * as stats from '../../evaluation/context-read-p2e/statistics.mjs';
import * as registration from '../../evaluation/context-read-p2e/registration.mjs';
import { transmissionGuard } from '../../evaluation/context-read-p2e/cost.mjs';
import { checkSafety } from '../../evaluation/context-read-p2e/safety.mjs';
import * as safetyRunner from './p2e-safety.mjs';
import * as runner from '../../evaluation/context-read-p2e/runner.mjs';

// Expose private functions on the old revision without changing their bodies,
// so baseline failures exercise the defect rather than a newly exported seam.
async function privateExport(url, name) {
  const target = url.href + '?fix1-private';
  const hook = registerHooks({ load(specifier, context, next) {
    const result = next(specifier, context);
    if (specifier !== target) return result;
    const source = String(result.source);
    return { ...result, source: source + (new RegExp(`export (?:async )?function ${name}\\b`).test(source) ? '' : `\nexport { ${name} };`) };
  } });
  try { return (await import(target))[name]; } finally { hook.deregister(); }
}

const surfaces = ['candidates','assembly','evidence','private-metadata'];
const safe = () => ({ ok: true, value: { items: [], diagnostics: { omitted: { unavailable: 0 } } } });
const authorization = { id: 'synthetic-allowance', fromUtcMs: 0, untilUtcMs: 1000 };
const table = { counts: { [fixtures.hash('a')]: 1 } };
const guardOptions = stateDirectory => ({ tokenTable: table, rate: '1', maxUsd: '1', maxRequests: 1, authorization, stateDirectory, now: () => 500 });
const ref = id => ({ type: 'memory', memoryId: id, revision: 1, namespace: fixtures.namespace(0) });
const identify = r => r.memoryId ? `${r.memoryId}@${r.revision}` : `${r.cardId}@${r.revision}:${r.bodyRevision}`;
const semantic = () => ({ ok: true, value: { items: [], trace: { effective: 'hybrid', semantic: { coverage: 'complete', queryEmbeddingAttempts: 1, degradedReason: null } } } });

test('fix1 gold: audit every query independently and reject the ambiguous legacy alias', () => {
  const { fixture, labels } = fixtures.loadFixtures();
  assert.equal(fixture.queries.find(q => q.id === 'en-paraphrase-620').text, 'Find the membrane percussion instrument beside the seaport.');
  const audit = fixtures.auditGold(fixture, labels);
  assert.deepEqual(audit, { nouns: 240, descriptions: 262, nounComparisons: 62880, checked: 43701, comparisons: 524412, ambiguousQueries: 0, failures: [] });
  const legacy = structuredClone(fixture);
  legacy.queries.find(q => q.id === 'en-paraphrase-620').text = 'Find the percussion instrument beside the seaport.';
  const failures = fixtures.auditGold(legacy, labels).failures;
  assert.equal(failures.length, 12);
  assert.ok(failures.every(f => f.expected.includes('memory-780')));
  // A second ambiguity is audited rather than patched by query ID.
  legacy.queries.find(q => q.id === 'en-paraphrase-0').text = 'Find the brewing vessel beside the seaport.';
  assert.equal(fixtures.auditGold(legacy, labels).failures.length, 24);
  legacy.queries.find(q => q.negative).text = fixture.queries[0].text;
  assert.equal(fixtures.auditGold(legacy, labels).failures.length, 36);
});

test('fix1 scope: every complete surface envelope, including assembly omitted counts, is compared', async () => {
  const id = 'scope/cross-owner';
  const o = { forbidden: ['foreign-owner@1'], canonicalSnapshot: 'scope', mutationAcknowledged: true, qualifiedHistoryControl: 'history-eligible@1',
    returns: surfaces.map(surface => ({ surface, identities: [], scopeCanaries: [], envelope: safe() })),
    withCanary: safe(), withoutCanary: safe(), scopeComparisons: surfaces.map(surface => ({ surface, withCanary: safe(), withoutCanary: safe() })) };
  assert.equal(checkSafety({ [id]: o })[id].status, 'passed');
  for (const surface of surfaces) {
    const leak = structuredClone(o);
    leak.scopeComparisons.find(c => c.surface === surface).withCanary.value.diagnostics.omitted.unavailable++;
    assert.equal(checkSafety({ [id]: leak })[id].status, 'failed', surface);
  }
  o.scopeComparisons.pop(); assert.equal(checkSafety({ [id]: o })[id].status, 'incomplete');
  let evidenceReads = 0;
  const setup = { input: { readSet: fixtures.readSet }, credential: {}, fixtureIdentity: identify,
    evidenceInput: { refs: [ref('history-eligible')], readSet: fixtures.readSet, intent: 'history' },
    withCanaryOptions: () => ({ canary: true }), withoutCanaryOptions: () => ({ canary: false }), close() {} };
  const observations = await safetyRunner.executeSafety({ prepareSafetyCell: async cell => cell === id ? setup : { close() {} } }, {
    withReader: async (options, credential, operation) => operation({
      getContextReadCapabilities: async () => ({ ok: true, value: { channels: { semantic: { configured: true } } } }),
      findCandidates: async () => safe(),
      contextRead: async () => { const envelope = safe(); envelope.value.diagnostics.omitted.unavailable = Number(options.canary); return envelope; },
      fetchCandidateEvidence: async () => { evidenceReads++; return safe(); },
    }, credential),
  });
  assert.equal(evidenceReads, 2);
  assert.deepEqual(observations[id].scopeComparisons.map(c => c.surface), surfaces);
  assert.equal(checkSafety(observations)[id].status, 'failed');

});

test('fix1 mutation: empty fallback receipts cannot pass; observed target, semantic path and history are mandatory', async () => {
  const id = 'forget/embedding/fresh/memory/current';
  assert.equal(checkSafety({ [id]: {} })[id].status, 'incomplete');
  const empty = { forbidden: ['safety-target@1'], canonicalSnapshot: 'after', mutationAcknowledged: true, qualifiedHistoryControl: 'history-eligible@1',
    returns: surfaces.map(surface => ({ surface, identities: [], scopeCanaries: [], envelope: { ...safe(), value: { trace: { effective: 'lexical', semantic: { coverage: 'unavailable' } } } } })) };
  assert.notEqual(checkSafety({ [id]: empty })[id].status, 'passed');
  const target = { type: 'memory', ref: ref('safety-target'), content: 'The synthetic cedar key opens the blue cabinet.' };
  const history = { type: 'memory', ref: ref('history-eligible'), content: 'A qualified historical amber key belonged to the archive.' };
  const evidence = item => ({ envelope: { ok: true, value: { items: [item] } }, identities: [identify(item.ref)] });
  const observed = { ...empty, canonicalSnapshot: surfaces.map(() => 'after'),
    initial: surfaces.map(surface => ({ surface, envelope: { ...semantic(), value: { ...semantic().value, items: [{ ref: target.ref }] } }, semanticCalls: 1, identities: ['safety-target@1'], evidence: evidence(target) })),
    returns: surfaces.map(surface => ({ surface, envelope: safe(), semanticCalls: 1, semanticExecution: semantic(), identities: [], scopeCanaries: [] })),
    historyControls: surfaces.map(surface => ({ surface, envelope: { ok: true, value: { items: [{ ref: history.ref }] } }, identities: ['history-eligible@1'], evidence: evidence(history) })) };
  observed.postMutationReads = observed.returns.flatMap(r => {
    const h = observed.historyControls.find(h => h.surface === r.surface);
    return [['boundary', r.envelope], ['history-candidates', h.envelope], ['history-evidence', h.evidence.envelope],
      ...(r.surface === 'evidence' ? [['semantic-execution', r.semanticExecution]] : [])].flatMap(([role, envelope]) => [
      { surface: r.surface, role, kind: 'result', envelope, identities: [], scopeCanaries: [] },
      { surface: r.surface, role, kind: 'capabilities', envelope: safe(), identities: [], scopeCanaries: [] },
    ]);
  });
  assert.equal(checkSafety({ [id]: observed })[id].status, 'passed');
  for (const damage of [o => o.initial[0].envelope.value.items = [], o => o.initial[0].identities = [], o => o.initial[0].semanticCalls = 0,
    o => o.initial[0].evidence.envelope.value.items[0].content = 'wrong bytes', o => o.returns[0].semanticCalls = 0,
    o => o.returns[0].semanticExecution.value.trace.effective = 'lexical', o => o.historyControls[0].evidence.envelope.value.items = []]) {
    const bad = structuredClone(observed); damage(bad); assert.equal(checkSafety({ [id]: bad })[id].status, 'incomplete');
  }
  let removed = false, calls = 0, staleEvidenceReads = 0;
  const setup = { credential: {}, input: { readSet: fixtures.readSet, intent: 'current' }, fixtureIdentity: identify,
    prepareSurface: async () => { removed = false; }, readerOptions: async () => ({}), historyReaderOptions: async () => ({}),
    atMutationBoundary: async (surface, operation) => { removed = true; await operation(); return { canonicalSnapshot: 'after', mutationAcknowledged: true, stoppedAndDrained: true }; }, close() {} };
  const observations = await safetyRunner.executeSafety({ prepareSafetyCell: async cell => cell === id ? setup : { close() {} } }, {
    semanticCallCount: () => calls,
    withReader: async (options, credential, operation) => operation({
      getContextReadCapabilities: async () => ({ ok: true, value: { channels: { semantic: { configured: true } } } }),
      findCandidates: async input => { calls++; const envelope = semantic(); envelope.value.items = input.intent === 'history' ? [{ ref: history.ref }] : removed ? [] : [{ ref: target.ref }]; return envelope; },
      contextRead: async () => { calls++; return { ok: true, value: { diagnostics: { candidates: { trace: semantic().value.trace } } } }; },
      fetchCandidateEvidence: async input => {
        assert.ok(input.refs.length > 0);
        if (input.refs[0].memoryId === 'history-eligible') return { ok: true, value: { items: [history] } };
        if (removed) { staleEvidenceReads++; return { ok: false, error: { code: 'revision_conflict' } }; }
        return { ok: true, value: { items: [target] } };
      },
    }, credential),
  });
  assert.equal(staleEvidenceReads, 1);
  assert.equal(observations[id].initial.length, 4);
  assert.equal(observations[id].historyControls.length, 4);
  assert.equal(checkSafety(observations)[id].status, 'passed');

});

test('fix1 power: expanded independent nouns retain 80 percent under declared dependence', () => {
  const fixture = fixtures.generate();
  const nouns = new Set(fixture.documents.filter(d => d.fact.startsWith('stored-')).map(d => Math.floor(Number(d.fact.slice(7)) / 20)));
  assert.equal(nouns.size, 240);
  assert.ok(stats.dependencePower({ n: 400, nounSize: 10, nounCorrelation: .2 }).power < .5);
  for (const rho of [0, .1, .2, .3]) for (const discordance of [.1, .2]) {
    assert.ok(stats.dependencePower({ n: 2400, nounSize: 10, nounCorrelation: rho, discordance }).power >= .8);
    assert.ok(stats.dependencePower({ n: 4800, nounSize: 20, viewSize: 4, nounCorrelation: rho, viewCorrelation: rho, discordance }).power >= .8);
  }
  assert.ok(stats.dependencePower({ n: 2400, nounSize: 10, nounCorrelation: .4, discordance: .2 }).power < .8);
});

test('fix1 cap: durable reservations survive restart, unknown sends and replay; concurrent processes share the allowance', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'p2e-persistent-'));
  try {
    const options = guardOptions(directory);
    const first = transmissionGuard(options), second = transmissionGuard(options);
    first(['a'], 'unknown-transmission');
    assert.throws(() => second(['a'], 'unknown-transmission'), /replay/);
    assert.throws(() => transmissionGuard(options)(['a'], 'after-restart'), /run_cap/);
    assert.throws(() => transmissionGuard({ ...options, maxRequests: 100 })(['a'], 'rebound'), /rebound/);
    const concurrent = { ...options, authorization: { ...authorization, id: 'concurrent' }, maxRequests: 3 };
    delete concurrent.now;
    const program = `import './tools/testing/p2e-offline.mjs'; import { transmissionGuard } from './evaluation/context-read-p2e/cost.mjs';
      const options=JSON.parse(process.argv[1]); try { transmissionGuard({...options,now:()=>500})(['a'],process.argv[2]); console.log('admitted'); }
      catch(e) { if(e.message!=='run_cap_exhausted') throw e; console.log('refused'); }`;
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module','-e', program, JSON.stringify(concurrent), `nonce-${i}`], { env: { ...process.env, OPENAI_API_KEY: '' } });
      let output = '', errors = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => errors += b);
      child.on('error', reject); child.on('close', code => { try { assert.equal(code, 0, errors); resolve(output.trim()); } catch(e) { reject(e); } });
    })));
    assert.equal(results.filter(r => r === 'admitted').length, 3);
    assert.equal(results.filter(r => r === 'refused').length, 5);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('fix1 window: missing, invalid, future and expired windows refuse, including expiry after construction', () => {
  const directory = mkdtempSync(join(tmpdir(), 'p2e-window-'));
  try {
    for (const a of [{ id: 'x' }, { id: 'x', fromUtcMs: 0 }, { id: 'x', untilUtcMs: 1000 },
      { id: 'x', fromUtcMs: NaN, untilUtcMs: 1000 }, { id: 'x', fromUtcMs: 600, untilUtcMs: 1000 }, { id: 'x', fromUtcMs: 500, untilUtcMs: 500 }]) {
      assert.throws(() => transmissionGuard({ ...guardOptions(directory), authorization: a }), /window/);
    }
    let now = 999;
    const grant = { ...authorization };
    const guard = transmissionGuard({ ...guardOptions(directory), authorization: grant, now: () => now });
    grant.untilUtcMs = 2000; // Caller mutation cannot extend the sealed grant.
    now = 1000; assert.throws(() => guard(['a'], 'expired'), /window/);
    now = -1; assert.throws(() => guard(['a'], 'early'), /window/);
    now = 0; assert.equal(guard(['a'], 'start').requests, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('fix1 seal: incomplete manifests and freshly hashed but truncated inventories refuse at seal and runtime', () => {
  const registered = JSON.parse(readFileSync(new URL('../../evaluation/context-read-p2e/registration.json', import.meta.url)));
  assert.throws(() => registration.sealRegistration({ protocol: registration.PROTOCOL, files: { 'evaluation/context-read-p2e/fixtures/corpus-queries.json': fixtures.hash('fixture') } }), /manifest/);
  for (const name of Object.keys(registered.files)) {
    const draft = structuredClone(registered); delete draft.files[name];
    assert.throws(() => registration.sealRegistration(draft), /manifest/);
    delete draft.seal; draft.seal = { algorithm: 'sha256-canonical-json-v1', digest: registration.digest(draft) };
    assert.throws(() => registration.verifyRegistration(draft), /manifest/);
  }
  const inventoryName = 'evaluation/context-read-p2e/fixtures/inventory.json';
  const inventory = JSON.parse(readFileSync(inventoryName)); inventory.strata = inventory.strata.filter(s => !s.id.startsWith('short-cjk'));
  const bytes = fixtures.json(inventory), draft = structuredClone(registered); draft.files[inventoryName] = fixtures.hash(bytes);
  const read = name => name === inventoryName ? bytes : readFileSync(name);
  assert.throws(() => registration.sealRegistration(draft, read), /inventory/);
  delete draft.seal; draft.seal = { algorithm: 'sha256-canonical-json-v1', digest: registration.digest(draft) };
  assert.throws(() => registration.verifyRegistration(draft, read), /inventory/);
});

test('fix1 inspector: typed refs are detected in diagnostics, arrays, memoryRef and nested ref properties', async () => {
  const inspect = await privateExport(new URL('./p2e-safety.mjs', import.meta.url), 'inspect');
  const forbidden = ['foreign-owner@1'];
  for (const envelope of [{ ok: true, diagnostics: ref('foreign-owner') }, { ok: true, refs: [ref('foreign-owner')] },
    { ok: true, memoryRef: ref('foreign-owner') }, { ok: true, nested: { ref: ref('foreign-owner') } }]) {
    const observation = inspect(envelope, { fixtureIdentity: identify }, forbidden);
    assert.ok(observation.identities.includes(forbidden[0]));
  }
  const unknown = inspect({ refs: [ref('unmapped')] }, { fixtureIdentity: () => null }, forbidden);
  assert.deepEqual(unknown.scopeCanaries, ['unknown-ref']);
});

test('fix1 capability: selected quality and safety readers receive the mandatory credential', async () => {
  const readArm = await privateExport(new URL('../../evaluation/context-read-p2e/runner.mjs', import.meta.url), 'readArm');
  const credential = { synthetic: true }, calls = [];
  const reader = { async getContextReadCapabilities(input, token) { assert.deepEqual(input, {}); assert.equal(token, credential); calls.push('capability'); return { ok: true, value: { channels: { semantic: { configured: true } } } }; },
    async findCandidates() { return { ok: true, value: { items: [] } }; } };
  const withReader = async (options, token, operation) => operation(reader, token);
  const runnerSource = readFileSync(new URL('../../evaluation/context-read-p2e/runner.mjs', import.meta.url), 'utf8');
  assert.match(runnerSource, /reader\.getContextReadCapabilities\(\{\}, credential\)/);
  await readArm({ readerOptions: () => ({}), credential, identities: [] }, fixtures.cells()[0], { text: 'synthetic' }, true, { documents: [] }, {}, withReader);
  await safetyRunner.publicRead({ input: {}, credential }, 'candidates', {}, true, withReader);
  assert.deepEqual(calls, ['capability','capability']);
});

test('fix1 raw-fd: evaluation and p2e tooling are audited and injected raw reads trip the guard', () => {
  const url = new URL('../../core/test/no-raw-db-fd.test.mjs', import.meta.url);
  const source = readFileSync(url, 'utf8');
  const prefix = source.slice(0, source.indexOf("test('runtime raw"));
  const start = source.indexOf("test('runtime raw");
  const bodyStart = source.indexOf('() => {', start) + '() => {'.length;
  const bodyEnd = source.indexOf('\n});', bodyStart);
  const program = (prefix + source.slice(bodyStart, bodyEnd)).replaceAll('import.meta.url', JSON.stringify(url.href)) + `
    const selected = paths.filter(p=>p.includes('/evaluation/context-read-p2e/') || p.includes('/tools/testing/p2e-'));
    assert.ok(selected.some(p=>p.endsWith('/evaluation/context-read-p2e/cost.mjs')));
    assert.ok(selected.some(p=>p.endsWith('/tools/testing/p2e-canonical.mjs')));
    for (const path of selected) {
      const name=relative(root,path), source=readFileSync(path,'utf8');
      assert.ok(violations(name,source+"\\nimport { openSync as unsafe } from 'node:fs'; unsafe(path);").length>0,name);
    }
    console.log(selected.length);`;
  const result = spawnSync(process.execPath, ['--input-type=module','-e',program], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.ok(Number(result.stdout.trim()) >= 15);
});

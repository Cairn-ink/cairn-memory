import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createProductReaderRuntime } from '../context-product-reader.mjs';
import { selectContextProductNamespaces } from '../index.mjs';
import { contextInput, contextReadSet } from '../context-read-input.mjs';
import { PRODUCT_PROFILE, coverage } from '../context-product-control.mjs';
import { accessDigest, projectionDigest, verifiedRecord } from '../context-product-validation.mjs';
import { productSidecar } from '../context-product-sidecar.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { fuseCandidates } from '../context-read-fusion.mjs';
import { tokenizeT1 } from '../context-read-tokenize.mjs';
import { fixture, ok } from '../testing/context-read-fixture.mjs';
import { four, personal, project, configured, prebuild, card, descriptor, canonicalSet, denied } from '../testing/context-product-owner-fixture.mjs';
import { openDatabase } from '../database.mjs';
import { migrateMethodPrerequisites } from '../method-package-migration.mjs';
import { installAssets } from '../asset-schema.mjs';
import { installRoleProfiles } from '../role-profile-schema.mjs';
import { installCardCurrentDependencies } from '../card-current-schema.mjs';

const query = (readSet, patch = {}) => ({ readSet, types: ['memory', 'card'], intent: 'current', query: 'cache', deadlineMs: 5000, limit: 24, ...patch });
const statusInput = (readSet, types = ['memory', 'card'], intent = 'current') => ({ readSet, types, intent, deadlineMs: 5000 });
const selected32 = [personal, ...Array.from({ length: 31 }, (_, i) => project('p' + String(i).padStart(2, '0')))];

test('P2-15 four-namespace access/projection digest known answers omit request and selection provenance', () => {
  const readSet = canonicalSet(four), namespaces = readSet.map(ns => ({ownerId:ns.ownerId,projectId:ns.projectId,scope:ns.scope}));
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('base64url');
  const expectedAccess = hash({ownerGeneration:null,ownerId:personal.ownerId,profile:PRODUCT_PROFILE,readSet:namespaces});
  const expectedProjection = hash({intent:'current',profile:PRODUCT_PROFILE,readSet:namespaces,types:['memory','card']});
  for(const selectionRevision of ['r1','r2'])for(const selected of [readSet,[...readSet].reverse()]){
    const binding={ownerId:personal.ownerId,namespaces:{readSet:selected,ownerCoverage:descriptor(selected,0,selectionRevision)},issuedAt:123,requestId:selectionRevision,handleId:selectionRevision};
    assert.equal(accessDigest(binding),expectedAccess);
    assert.equal(projectionDigest({...query(selected),types:['card','memory'],selectionRevision}),expectedProjection);
  }
  assert.notEqual(accessDigest({ownerId:personal.ownerId,namespaces:{readSet},ownerGeneration:1}),expectedAccess);
});

test('P2-06 recent-projects-v1 known answers: ACL-filtered inventory, equal/missing activity, bytes and revision', () => {
  const inventory = [{ namespace: personal }, ...Array.from({ length: 29 }, (_, i) => ({ namespace: project('busy-' + i), lastActiveAt: 10 })),
    { namespace: project('é') }, { namespace: project('z'), lastActiveAt: 0 }, { namespace: project('a') }];
  // Authorized personal + 32 projects: the two zero-activity winners are a,z.
  const result = selectContextProductNamespaces(inventory, 'snapshot-1');
  assert.deepEqual(result, { readSet: canonicalSet([personal, ...inventory.slice(1, 30).map(e => e.namespace), project('a'), project('z')]),
    ownerCoverage: { policy: 'recent-projects-v1', selectionRevision: 'snapshot-1', requestedNamespaces: 33, selectedNamespaces: 32, omittedNamespaces: 1 } });
  assert.deepEqual(selectContextProductNamespaces([...inventory].reverse(), 'snapshot-1'), result);
  const next = selectContextProductNamespaces(inventory, 'snapshot-2');
  assert.deepEqual(next.readSet, result.readSet); assert.equal(next.ownerCoverage.selectionRevision, 'snapshot-2');
  assert.ok(Object.isFrozen(result.readSet[0]));
  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, undefined, Infinity, '10']) {
    assert.throws(() => selectContextProductNamespaces([{ namespace: project('a'), lastActiveAt: value }], 'r'), { code: 'invalid_input' });
  }
  for (const revision of ['', 'x'.repeat(201), 1, '\ud800']) assert.throws(() => selectContextProductNamespaces(inventory, revision), { code: 'invalid_input' });
  assert.equal(selectContextProductNamespaces([{ namespace: project('a'), lastActiveAt: Number.MAX_SAFE_INTEGER }], 'x'.repeat(200)).ownerCoverage.omittedNamespaces, 0);
  assert.throws(() => selectContextProductNamespaces([{ namespace: personal }, { namespace: personal }], 'r'), { code: 'invalid_read_set' });
  assert.throws(() => selectContextProductNamespaces([{ namespace: personal }, { namespace: { ...project('a'), ownerId: 'other' } }], 'r'), { code: 'invalid_read_set' });
  assert.equal(selectContextProductNamespaces(inventory.filter(e => e.namespace.projectId !== 'busy-0'), 'acl-revision').ownerCoverage.omittedNamespaces, 0);
});

test('P2-06 selected grammar refuses before Worker/storage; facade and storage validators agree', async t => {
  const f = fixture(t), config = configured(t, f.path, four);
  let spawned = 0, getters = 0;
  const open = createProductReaderRuntime({ spawnWorker() { spawned++; throw Error('unexpected storage'); } });
  const accessor = { ...project('a') }; Object.defineProperty(accessor, 'projectId', { get() { getters++; return 'a'; } });
  const hidden = { ...project('a') }; Object.defineProperty(hidden, 'unknown', { value: 1 });
  const hiddenArray = [personal]; Object.defineProperty(hiddenArray, 'unknown', { value: 1 });
  const arrayAccessor = []; Object.defineProperty(arrayAccessor, 0, { enumerable: true, get() { getters++; return personal; } });
  const proxy = new Proxy(personal, { ownKeys() { getters++; throw Error(); } });
  const cases = [undefined, [], [...selected32, project('extra')], Array.from({ length: 32 }, (_, i) => project('p' + i)),
    [personal, personal], [project('a'), project('a')], [personal, { ...project('a'), ownerId: 'other' }],
    [accessor], [hidden], hiddenArray, arrayAccessor, [proxy], [personal, , project('a')], [null], [{ ...personal, extra: true }]];
  const facade = openContextProductFacade(f.path, {}), storage = productSidecar({ path: f.path, db: facade.port.db, identity: facade.port.identity, features: facade.port.features, writable: true });
  try {
    for (const readSet of cases) {
      await assert.rejects(open({ ...config.options, readSet }), { code: 'invalid_read_set' });
      assert.throws(() => contextInput('findCandidates', query(readSet), ['memory', 'card'], undefined, PRODUCT_PROFILE), { code: 'invalid_read_set' });
      assert.throws(() => storage.refresh({ ...query(readSet), ownerCoverage: descriptor(four) }, 'unused', { maxItems: 1, maxMs: 1 }), { code: 'invalid_read_set' });
    }
    const selectedAccessor = {...query(four), ownerCoverage:descriptor(four)};
    Object.defineProperty(selectedAccessor,'readSet',{get(){getters++;return four;}});
    assert.throws(()=>storage.observe(selectedAccessor,'unused'),{code:'invalid_read_set'});
    assert.throws(()=>storage.refresh(selectedAccessor,'unused',{maxItems:1,maxMs:1}),{code:'invalid_read_set'});
  } finally { storage.close(); facade.close(); }
  assert.equal(spawned, 0); assert.equal(getters, 0); assert.equal(existsSync(f.path + '.context-read-product-v1.1.sqlite'), false);
  for (const patch of [{ requestedNamespaces: 0 }, { requestedNamespaces: 5 }, { omittedNamespaces: -1 }, { selectedNamespaces: 3 },
    { requestedNamespaces: 5, omittedNamespaces: 1 }, { selectionRevision: '' }, { policy: 'other' }, { extra: 1 }]) {
    assert.throws(() => coverage({ ...descriptor(four), ...patch }, four), { code: 'invalid_input' });
  }
  assert.deepEqual(contextReadSet([four[1], personal]), canonicalSet([personal, four[1]]));
  assert.throws(() => contextReadSet(four), { code: 'invalid_read_set' });
});

for (const size of [1, 4, 32]) test(`P2-06/12/18 ${size} selected namespaces: maintained pooled lookup, immutable mapping and exact counts`, async t => {
  const readSet = size === 1 ? [personal] : size === 4 ? four : selected32;
  const f = fixture(t);
  for (const ns of readSet) f.admit('cache 東京' + (size===32 && ns===readSet.at(-1)?' tailnamespace':''), ns);
  const ownerCoverage = descriptor(readSet, size === 32 ? 1 : 0);
  if (size === 32) {
    const absent = configured(t, f.path, readSet, { ownerCoverage }), handle = await absent.open();
    const status = ok(await handle.getContextIndexStatus(statusInput(readSet, ['memory']), absent.token));
    assert.deepEqual(status, {profile:PRODUCT_PROFILE,lexical:{state:'absent',reason:'missing',progress:null},semantic:{state:'disabled',reason:'not_enabled'},
      coverage:{status:'unavailable',freshness:'unverified',byType:{memory:{eligible:null,indexed:null,embedded:null}},namespaces:ownerCoverage}});
    const failed = await handle.findCandidates(query(readSet, {types:['memory']}), absent.token);
    denied(failed,'index_unavailable');assert.deepEqual(failed.error.details.trace.namespaceSelection,ownerCoverage);
    const assembly = await handle.contextRead({ ...statusInput(readSet,['memory']),query:'cache' }, absent.token);
    denied(assembly,'index_unavailable');assert.deepEqual(assembly.error.details.candidates.trace.namespaceSelection,ownerCoverage);
    await handle.close();
  }
  const s = configured(t, f.path, readSet, { service: true, ownerCoverage });
  await prebuild(s, ['memory']); assert.equal(s.view[5], 0);
  const r = configured(t, f.path, [...readSet].reverse(), { ownerCoverage }), h = await r.open();
  assert.equal(ok(await h.getContextReadCapabilities()).readSetMaximum, 32);
  const result = ok(await h.findCandidates(query(readSet, { types: ['memory'], limit: 12, semantic: true }), r.token));
  assert.equal(result.coverage.status, size === 32 ? 'partial' : 'complete');
  assert.equal(result.coverage.byType.memory.eligible, size); assert.equal(result.channels.semantic.state, 'disabled');
  if (size === 32) assert.deepEqual(result.trace.namespaceSelection, ownerCoverage);
  else assert.equal(result.trace.namespaceSelection, undefined);
  const reversed = ok(await h.findCandidates(query([...readSet].reverse(), { types: ['memory'], limit: 12, semantic: true }), r.token));
  assert.deepEqual(reversed.items, result.items);
  if (size === 32) {
    // Neither omitted authorized scopes nor other owners enter the statistics
    // or readiness fences of this exact maintained selection.
    for (let i=0;i<8;i++) f.admit('cache foreign omitted '+i,project('omitted'));
    f.admit('cache another owner',{...personal,ownerId:'foreign-owner'});
    const unchanged=ok(await h.findCandidates(query(readSet,{types:['memory'],limit:12,semantic:true}),r.token));
    assert.deepEqual(unchanged.items,result.items);assert.equal(unchanged.coverage.byType.memory.eligible,32);
    const second = ok(await h.findCandidates(query(readSet, { types: ['memory'], cursor: result.nextCursor, limit: 12, semantic: true }), r.token));
    assert.equal(second.items[0].rank, 13); assert.equal(second.nextCursor, null); assert.equal(result.coverage.omitted.lexical, 8);
    const assembled = ok(await h.contextRead({ ...statusInput(readSet, ['memory']), query: 'cache', budget: { maxTokens: 4000, maxItems: 24 } }, r.token));
    assert.equal(assembled.diagnostics.candidates.coverage.status, 'partial'); assert.deepEqual(assembled.diagnostics.candidates.trace.namespaceSelection, ownerCoverage);
    const empty = ok(await h.findCandidates(query(readSet, { types: ['memory'], query: 'absentterm' }), r.token));
    assert.deepEqual(empty.items, []); assert.equal(empty.coverage.status, 'partial');
    const tail=ok(await h.contextRead({...statusInput(readSet,['memory']),query:'tailnamespace',budget:{maxTokens:4000,maxItems:24}},r.token));
    assert.equal(tail.metered.items.length,1);assert.equal(tail.metered.items[0].ref.ns,31);
    const refetched=ok(await h.fetchCandidateEvidence({readSet:[...readSet].reverse(),snapshot:tail.snapshot},r.token));
    assert.deepEqual(refetched.items[0].ref.namespace,readSet.at(-1));
  }
  const dto = ok(await h.getContextIndexStatus(statusInput(readSet, ['memory']), r.token));
  assert.deepEqual(dto, { profile: PRODUCT_PROFILE, lexical: { state: 'ready', reason: null,
    progress: { phase: size + 3, checkpoint: size + 4, sequence: 1, baseSequence: 0 } }, semantic: { state: 'disabled', reason: 'not_enabled' },
    coverage: { status: size === 32 ? 'partial' : 'complete', freshness: 'current', byType: { memory: { eligible: size, indexed: size, embedded: null } }, namespaces: ownerCoverage } });
  assert.equal(r.view[5], 0);
  denied(await h.findCandidates(query([project('changed')], { types: ['memory'] }), r.token), 'invalid_read_set');
});

// Frozen bilingual/Japanese corpus. Tokens are manually transcribed, never
// obtained from the tokenizer, sidecar, createBM25 or production score routine.
const corpus = [
  ['memory', '快取 cache 東京', ['快取', 'cache', '東京']],
  ['card', 'cache\n東京 快取', ['cache', '東京', '快取']],
  ['memory', 'cache cache 快取 東京', ['cache', 'cache', '快取', '東京']],
  ['card', '東京\nキャッシュ cache', ['東京', 'キャッシュ', 'cache']],
  ['memory', '東京 キャッシュ cache', ['東京', 'キャッシュ', 'cache']],
  ['card', '快取\ncache cache 東京', ['快取', 'cache', 'cache', '東京']],
  ['memory', 'database 快取 東京', ['database', '快取', '東京']],
  ['card', 'キャッシュ\n東京 cache', ['キャッシュ', '東京', 'cache']],
];
const tuple = ref => [ref.namespace.ownerId, ref.namespace.scope, ref.namespace.projectId ?? '', ref.type, ref.memoryId ?? ref.cardId];
function compare(a,b) {
  const left = tuple(a.ref), right = tuple(b.ref);
  for (let i = 0; i < left.length; i++) { const n = Buffer.compare(Buffer.from(left[i]), Buffer.from(right[i])); if (n) return n; }
  return 0;
}
function oracle(documents, terms) {
  const N = documents.length, totalLength = documents.reduce((n,d) => n + d.tokens.length, 0);
  const df = Object.fromEntries(terms.map(term => [term, documents.filter(d => d.tokens.includes(term)).length]));
  const rows = documents.map(d => {
    let score = 0;
    for (const term of terms) {
      const f = d.tokens.filter(t => t === term).length;
      if (f) score += Math.log(1 + (N - df[term] + .5) / (df[term] + .5)) * f * 2.2 /
        (f + 1.2 * (.25 + .75 * d.tokens.length / (totalLength / N)));
    }
    return { ref: d.ref, score };
  }).filter(d => d.score > 0).sort((a,b) => b.score - a.score || compare(a,b));
  return { N, totalLength, df, rows };
}

for (const version of [23, 33]) test(`P2-05/07/11/12 pooled oracle and mixed equal bodies across four namespaces on physical v${version}`, async t => {
  const f = fixture(t, { cards: true }), documents = [];
  for (const [i, [type, text, tokens]] of corpus.entries()) {
    const ns = four[Math.floor(i / 2)];
    let ref;
    if (type === 'memory') { const memory = f.admit(text, ns); ref = { type, namespace: ns, memoryId: memory.id, revision: memory.revision }; }
    else { const [title, body] = text.split('\n'), c = card(f, ns, title, body); ref = { type, namespace: ns, cardId: c.id, revision: c.revision, bodyRevision: c.bodyRevision }; }
    documents.push({ ref, text, tokens });
  }
  // Equal Memory bodies remain separate identities, plus a nonmatching eligible
  // document that must influence N/average even though it never matches.
  const extra = f.admit('orchard', personal); documents.push({ ref: { type: 'memory', namespace: personal, memoryId: extra.id, revision: extra.revision }, text: 'orchard', tokens: ['orchard'] });
  const equal = f.admit(corpus[0][1], four[3]); documents.push({ ref: { type: 'memory', namespace: four[3], memoryId: equal.id, revision: equal.revision }, text: corpus[0][1], tokens: corpus[0][2] });
  const historical = f.admit('cache history',four[2]);
  const writer = new (f.db.constructor)(f.path);
  try { writer.prepare("UPDATE memories SET currentness='historical' WHERE id=?").run(historical.id); } finally { writer.close(); }
  const historyDoc={ref:{type:'memory',namespace:four[2],memoryId:historical.id,revision:historical.revision},text:'cache history',tokens:['cache','history']};
  f.core.close();
  if (version === 33) { const db = openDatabase(f.path); try { migrateMethodPrerequisites(db); installAssets(db); installRoleProfiles(db); installCardCurrentDependencies(db); db.exec('PRAGMA user_version=33'); } finally { db.close(); } }
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, version);
  const s = configured(t, f.path, four, { service: true }); await prebuild(s);
  const side = new DatabaseSync(f.path + '.context-read-product-v1.1.sqlite', { readOnly: true });
  try {
    for (const intent of ['current', 'history']) {
      const p = { readSet: four, types: ['memory', 'card'], intent };
      const publication = side.prepare('SELECT record FROM validation_records JOIN publications ON validation_records.publication=publications.publication WHERE projection=?').get(projectionDigest(p));
      assert.ok(publication);
      const secret = f.db.prepare('SELECT cursor_secret FROM store_metadata WHERE singleton=1').get().cursor_secret;
      const record = verifiedRecord(secret, 'validation', publication.record);
      const eligible = intent==='history'?[...documents,historyDoc]:documents;
      assert.deepEqual(record.counts.byType, {card:{eligible:4,indexed:4},memory:{eligible:eligible.length-4,indexed:eligible.length-4}});
      assert.equal(record.counts.totalTokenLength, intent==='history'?32:30);
      const totals = side.prepare("SELECT n,total_length FROM statistics WHERE generation=? AND term='' ").get(record.generation.id);
      assert.deepEqual({...totals},{n:eligible.length,total_length:intent==='history'?32:30});
      for (const term of ['快取','cache','東京','キャッシュ']) {
        const expectedDf = eligible.filter(d => d.tokens.includes(term)).length;
        assert.equal(side.prepare('SELECT df FROM statistics WHERE generation=? AND term=?').get(record.generation.id,term).df, expectedDf);
      }
    }
  } finally { side.close(); }
  const r = configured(t, f.path, [...four].reverse()), h = await r.open();
  for (const intent of ['current', 'history']) for (const [text, terms] of [['快取 cache', ['快取', 'cache']], ['東京 キャッシュ', ['東京', 'キャッシュ']]]) {
    const expected = oracle(intent==='history'?[...documents,historyDoc]:documents, terms);
    assert.equal(expected.N, intent==='history'?11:10); assert.equal(expected.totalLength, intent==='history'?32:30);
    const actual = ok(await h.findCandidates(query(four, { intent, query: text }), r.token));
    assert.deepEqual(actual.items.map(item => ({ ref: item.ref, score: item.channels.lexical.rawScore })), expected.rows);
    assert.deepEqual(actual.items.map(item => item.channels.lexical.rank), expected.rows.map((_,i) => i + 1));
    assert.ok(actual.items.every(i => i.fusionScore === null));
    assert.equal(actual.coverage.byType.memory.eligible, intent==='history'?7:6); assert.equal(actual.coverage.byType.card.eligible, 4);
    const permuted = ok(await h.findCandidates(query([four[2],four[0],four[3],four[1]], { intent, query: text }), r.token));
    assert.deepEqual(permuted.items, actual.items);
    const disabled = ok(await h.findCandidates(query(four, { intent, query: text, semantic: true }), r.token)); assert.deepEqual(disabled.items, actual.items);
    // One fusion of global lists, independent arithmetic oracle for both frozen
    // families. This shared seam is dormant on the product until P2e enables it.
    const semantic = [...expected.rows].reverse().map((row,i) => ({ ...row, score: 1 - i / 100 }));
    for (const [preset,k,depth,weight] of [['rrf-k60-d12',60,12,.45],['rrf-k10',10,24,.5]]) {
      const scores = new Map();
      [expected.rows.slice(0,depth),semantic.slice(0,depth)].forEach(rows => rows.forEach((row,i) => {
        const key = JSON.stringify(tuple(row.ref)), item = scores.get(key) ?? { ref: row.ref, score: 0 };
        item.score += weight * (1 / (k+i+1)); scores.set(key,item);
      }));
      const fused = fuseCandidates(expected.rows,semantic,{preset,semanticState:'ready',coverageComplete:true});
      assert.deepEqual(fused.rows.map(r => ({ ref:r.ref,score:r.fusionScore })), [...scores.values()].sort((a,b)=>b.score-a.score||compare(a,b)));
      assert.deepEqual(fuseCandidates(expected.rows,semantic,{preset,semanticState:'partial_coverage'}).rows.map(r=>r.ref),expected.rows.map(r=>r.ref));
    }
  }
  for (const intent of ['current','history']) {
    const assembly = ok(await h.contextRead({ ...statusInput([...four].reverse(),['memory','card'],intent),query:'東京 cache',budget:{maxTokens:4000,maxItems:24} },r.token));
    const fetched = ok(await h.fetchCandidateEvidence({readSet:four,snapshot:assembly.snapshot},r.token));
    assert.deepEqual(fetched.items.map(i=>i.ref),assembly.diagnostics.items.map(i=>i.ref));
    assert.equal(new Set(fetched.items.map(i=>i.type)).size,2);
    assert.equal(new Set(fetched.items.map(i=>JSON.stringify(i.ref.namespace))).size,4);
    assert.deepEqual(assembly.metered.items.map(i=>i.ref.ns),fetched.items.map(i=>canonicalSet(four).findIndex(ns=>JSON.stringify(ns)===JSON.stringify(i.ref.namespace))));
  }
  assert.equal(r.view[5], 0); assert.equal(s.view[5], 0);
});

test('P2-07 frozen one-character Han known miss has no substring fallback', async t => {
  assert.deepEqual(tokenizeT1('中文'), ['中文']); assert.deepEqual(tokenizeT1('中'), ['中']);
  assert.deepEqual(oracle([{ ref: { type:'memory', namespace:personal, memoryId:'known-miss' }, tokens:['中文'] }], ['中']).rows, []);
  const f=fixture(t);f.admit('中文',personal);
  await prebuild(configured(t,f.path,[personal],{service:true}),['memory']);
  const r=configured(t,f.path,[personal]),h=await r.open();
  const miss=ok(await h.findCandidates(query([personal],{types:['memory'],query:'中'}),r.token));
  assert.deepEqual(miss.items,[]);assert.equal(miss.coverage.status,'complete');
  assert.equal(ok(await h.findCandidates(query([personal],{types:['memory'],query:'中文'}),r.token)).items.length,1);
});

test('P2-07 every match ranks globally before the 24 horizon, with no per-namespace quota/top-k',async t=>{
  const f=fixture(t),documents=[];
  for(let i=0;i<30;i++){
    const text='cache '+i,m=f.admit(text,personal);
    documents.push({ref:{type:'memory',namespace:personal,memoryId:m.id,revision:m.revision},tokens:['cache',String(i)]});
  }
  for(const namespace of four.slice(1)){
    const text='cache '+Array(12).fill('orchard').join(' '),m=f.admit(text,namespace);
    documents.push({ref:{type:'memory',namespace,memoryId:m.id,revision:m.revision},tokens:['cache',...Array(12).fill('orchard')]});
  }
  await prebuild(configured(t,f.path,four,{service:true}),['memory']);
  const r=configured(t,f.path,four),h=await r.open();
  const result=ok(await h.findCandidates(query(four,{types:['memory']}),r.token));
  assert.deepEqual(result.items.map(i=>({ref:i.ref,score:i.channels.lexical.rawScore})),oracle(documents,['cache']).rows.slice(0,24));
  assert.ok(result.items.every(i=>i.ref.namespace.scope==='personal'));assert.equal(result.items.length,24);
  assert.equal(result.coverage.omitted.lexical,9);
});

test('P2-09/15/18 changed selection needs matching prebuild; revision/issuance do not change statistics identity', async t => {
  const f = fixture(t); for (const ns of four) f.admit('cache 東京', ns);
  const s = configured(t, f.path, four, { service: true }); await prebuild(s, ['memory']);
  const original = configured(t, f.path, four), a = await original.open();
  const before = ok(await a.findCandidates(query(four, { types: ['memory'] }), original.token)); await a.close();
  const nextCoverage = descriptor(four, 0, 'inventory-2'), next = configured(t, f.path, [...four].reverse(), { ownerCoverage: nextCoverage });
  next.binding.issuedAt = 120;
  assert.equal(accessDigest(original.binding), accessDigest(next.binding));
  assert.equal(projectionDigest(query(four)), projectionDigest({ ...query([...four].reverse()), ownerCoverage: nextCoverage, issuedAt: 120 }));
  const b = await next.open(), later = ok(await b.findCandidates(query(four, { types: ['memory'] }), next.token));
  assert.deepEqual(later.items, before.items); assert.deepEqual(ok(await b.getContextIndexStatus(statusInput(four, ['memory']), next.token)).coverage.namespaces, nextCoverage);
  const changed = [personal, four[1], four[2], project('new')];
  denied(await b.findCandidates(query(changed, { types: ['memory'] }), next.token), 'invalid_read_set');
  const c = configured(t, f.path, changed), h = await c.open();
  const emptyStatus = ok(await h.getContextIndexStatus(statusInput(changed, ['memory']), c.token));
  assert.deepEqual(emptyStatus, { profile:PRODUCT_PROFILE,lexical:{state:'absent',reason:'missing',progress:null},semantic:{state:'disabled',reason:'not_enabled'},
    coverage:{status:'unavailable',freshness:'unverified',byType:{memory:{eligible:null,indexed:null,embedded:null}},namespaces:descriptor(changed)} });
  denied(await h.findCandidates(query(changed, { types: ['memory'] }), c.token), 'index_unavailable');
  await prebuild(configured(t, f.path, changed, { service: true }), ['memory']);
  assert.equal(ok(await h.findCandidates(query(changed, { types: ['memory'] }), c.token)).coverage.status, 'complete');
});


for(const size of [1,2,32])test(`P2c fix1 ${size}-namespace multi-term lookup uses bounded term-index pages`,t=>{
  const f=fixture(t),readSet=selected32.slice(0,size);
  for(let i=0;i<133;i++)f.admit('cache 東京 repeated '+i,personal);
  for(const ns of readSet.slice(1))f.admit('cache 東京 elsewhere',ns);
  const facade=openContextProductFacade(f.path,{}),storage=productSidecar({path:f.path,db:facade.port.db,
    identity:facade.port.identity,features:facade.port.features,writable:true});
  t.after(()=>{storage.close();facade.close();});
  const p={...query(readSet,{types:['memory']}),ownerCoverage:descriptor(readSet)},access=accessDigest({ownerId:personal.ownerId,namespaces:{readSet}});
  let publication;
  for(let i=0;i<100;i++){
    storage.refresh(p,access,{maxItems:1024,maxMs:5000});
    publication=storage.observe(p,access).publication;if(publication)break;
  }
  assert.ok(publication,'finish the explicit prebuild before inspecting lookup plans');
  const prepare=DatabaseSync.prototype.prepare,plans=[];
  t.mock.method(DatabaseSync.prototype,'prepare',function(sql){
    const stmt=prepare.call(this,sql);
    if(!/FROM postings p\b/.test(sql))return stmt;
    return new Proxy(stmt,{get:(target,key)=>key==='all'?((...args)=>{
      plans.push(prepare.call(this,'EXPLAIN QUERY PLAN '+sql).all(...args).map(r=>r.detail).join('\n'));
      assert.match(sql,/ORDER BY p.identity LIMIT 128$/);
      const rows=target.all(...args);assert.ok(rows.length<=128);return rows;
    }):Reflect.get(target,key,target)});
  });
  assert.deepEqual(storage.lexical(p,publication,'missingalpha missingbeta'),{rows:[],matched:0});
  assert.equal(plans.length,2,'one indexed probe per missing term');
  for(const plan of plans){
    assert.match(plan,/USING (?:COVERING )?INDEX product_term .*generation=\? AND term=\? AND identity>\?/);
    assert.doesNotMatch(plan,/SCAN|TEMP B-TREE/);
  }
  plans.length=0;
  const both=storage.lexical(p,publication,'cache 東京'),single=storage.lexical(p,publication,'cache');
  assert.equal(both.matched,133+size-1);assert.equal(single.matched,both.matched);
  assert.equal(both.rows.length,24);assert.equal(new Set(both.rows.map(r=>r.ref.memoryId)).size,24);
  for(const plan of plans)assert.match(plan,/INDEX product_term .*generation=\? AND term=\? AND identity>\?/);
});


test('prebuild fixture drains a timed-out maintainer before reopening, and never replaces uncertain cleanup',async()=>{
  const calls=[];let opens=0,drained=false;
  const config={options:{readSet:[personal]},token:{synthetic:true},async open(){
    const id=++opens;if(id>1)assert.equal(drained,true);
    return {async refreshContextIndex(input){calls.push([id,input.intent]);return id===1?{ok:false,error:{code:'read_timeout'}}:{ok:true,value:{status:'complete'}};},
      async close(){await Promise.resolve();drained=true;}};
  }};
  assert.equal((await prebuild(config,['memory'])).length,2);assert.equal(opens,2);
  assert.deepEqual(calls,[[1,'current'],[2,'current'],[2,'history']]);
  let uncertainOpens=0;
  const uncertain={...config,async open(){uncertainOpens++;return {async refreshContextIndex(){return {ok:false,error:{code:'read_timeout'}};},async close(){throw Object.assign(Error('reader_failed'),{code:'reader_failed'});}};}};
  await assert.rejects(prebuild(uncertain,['memory']),{code:'reader_failed'});assert.equal(uncertainOpens,1);
});

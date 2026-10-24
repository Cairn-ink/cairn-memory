import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore, openContextReader } from '../index.mjs';
import { cardOptions } from './card-current-fixture.mjs';
import { scopedFixture, deniedLookupSpy, ns, project, scopes, sources, ok } from './card-current-scope-fixture.mjs';
const denied = (result, code) => assert.deepEqual(result, { ok: false, error: { code, retryable: false } });
function reader(t, f, kind, enabled, contextRead = { ...f.h.context, sources }) {
  if (kind === 'read-only') {
    const core = openContextReader({ path: f.path, contextRead }); t.after(() => core.close()); return core;
  }
  const core = openMemoryCore({ path: f.path, privateCards: cardOptions(f.h.authority, enabled), methodPackages: f.h.methods,
    roleProfiles: f.h.options, contextRead, ...(kind === 'managed' ? { existingStore: {
      version: 'schema33-existing-v1', storeId: f.db.prepare('SELECT store_id FROM store_metadata').get().store_id } } : {}) });
  t.after(() => core.close()); return core;
}
async function warm(f) {
  const candidate = ok(await f.call('findCandidates', { ...f.request, limit: 1 })); assert.ok(candidate.nextCursor);
  const sourcePages = [];
  for (const source of sources) {
    const contributed = ok(await f.call('findCandidates', { ...f.request, sources: [source] })).items.find(item => item.ref.cardId === f.b.cardId);
    assert.ok(contributed); assert.equal(contributed.channels.lexical, null);
    if (source === 'relations-one-hop-v1') assert.ok(contributed.via); else assert.ok(contributed.channels.moc?.rank > 0);
    const page = ok(await f.call('findCandidates', { ...f.request, sources: [source], limit: 1 })); assert.ok(page.nextCursor); sourcePages.push({ source, page });
  }
  const current = ok(f.call('fetchCandidateEvidence', { readSet: scopes, refs: [f.a, f.b], intent: 'current' }));
  const history = ok(f.call('fetchCandidateEvidence', { readSet: scopes, refs: [f.a, f.b], intent: 'history' }));
  const assembly = ok(await f.call('contextRead', f.request)); assert.ok(assembly.metered.items.some(item => item.ref.id === f.b.cardId));
  const role = ok(await f.call('readRoleTaskContext', { mode: 'now', roleKey: 'finance', readSet: scopes, task: 'finance' })).metered;
  const personalRole = ok(await f.call('readRoleTaskContext', { mode: 'now', roleKey: 'personal-finance', readSet: scopes, task: 'finance' })).metered;
  assert.ok(role.profile.release.fields.related.some(ref => ref.cardId === f.b.cardId)); assert.ok(personalRole.evidence.some(item => item.ref.id === f.a.cardId)); assert.ok(personalRole.profile.release.fields);
  const organization = ok(f.call('mapEvidence', { namespace: project, type: 'card', limit: 1 })); assert.ok(organization.nextCursor);
  const mappings = ok(f.call('listEvidenceMappings', { namespace: project, type: 'card', mocId: f.topic.mocId, limit: 1 })); assert.ok(mappings.nextCursor);
  const exact = ok(f.call('fetchEvidence', { namespace: project, refs: [f.b], intent: 'current' }));
  const exactPersonal = ok(f.call('fetchEvidence', { namespace: ns, refs: [f.a], intent: 'history' }));
  ok(await f.call('findCandidates', { ...f.request, readSet: [ns] }));
  return { candidate, sourcePages, current, history, assembly, role, personalRole, organization, mappings, exact, exactPersonal };
}
for (const enabled of [true, false]) for (const kind of ['ordinary', 'managed', 'read-only'])
  test(`C21 selective project revocation fences every applicable retained read; ${kind}, authoring ${enabled}`, async t => {
    const f = scopedFixture(t), saved = await warm(f), core = reader(t, f, kind, enabled);
    const spy = deniedLookupSpy(f.h.state, f.deniedValues); t.after(() => spy.restore());
    f.h.revokeProject();
    const calls = [
      ['findCandidates', f.request],
      ['findCandidates', { ...f.request, limit: 1, cursor: saved.candidate.nextCursor }],
      ...saved.sourcePages.flatMap(({ source, page }) => [['findCandidates', { ...f.request, sources: [source] }], ['findCandidates', { ...f.request, sources: [source], limit: 1, cursor: page.nextCursor }], ['contextRead', { ...f.request, sources: [source] }]]),
      ['contextRead', f.request],
      ['fetchCandidateEvidence', { readSet: scopes, refs: [f.a, f.b], intent: 'current' }],
      ['fetchCandidateEvidence', { readSet: scopes, refs: [f.a, f.b], intent: 'history' }],
      ['fetchCandidateEvidence', { readSet: scopes, refs: [f.a], intent: 'current', fences: [saved.assembly.metered.items.find(item => item.ref.id === f.a.cardId).ref.f] }],
      ...[saved.current.snapshot, saved.history.snapshot, saved.assembly.snapshot].map(snapshot => ['fetchCandidateEvidence', { readSet: scopes, snapshot }]),
      ['getCard', { namespace: project, cardId: f.b.cardId }], ['listCards', { namespace: project, states: ['confirmed'] }],
      ['selectEvidence', { namespace: project, query: 'finance', types: ['card'], intent: 'current' }],
      ['fetchEvidence', { namespace: project, refs: [f.b], intent: 'current' }],
      ['revalidateEvidence', { namespace: project, snapshot: saved.exact.snapshot }],
      ['mapEvidence', { namespace: project, type: 'card' }],
      ['mapEvidence', { namespace: project, type: 'card', limit: 1, cursor: saved.organization.nextCursor }],
      ['listEvidenceMappings', { namespace: project, type: 'card', mocId: f.topic.mocId, limit: 1, cursor: saved.mappings.nextCursor }],
      ['readRoleTaskContext', { mode: 'now', roleKey: 'finance', readSet: scopes, task: 'finance' }],
      ['readRoleTaskContext', { mode: 'refresh', receipt: saved.role.receipt, readSet: scopes, task: 'finance' }],
      ['readRoleTaskContext', { mode: 'then', receipt: saved.personalRole.receipt, readSet: scopes }],
      ['readRoleTaskContext', { mode: 'file', receipt: saved.role.receipt, readSet: scopes, package: f.v1.package, path: 'guide.txt' }],
      ['readRoleTaskContext', { mode: 'compare', roleKey: 'finance', readSet: scopes, from: f.v1.version, to: f.v2.version }],
    ];
    for (const [method, input] of calls) if (typeof core[method] === 'function') denied(await core[method](input, {}), 'authority_required');
    // The personal scope remains authorized: cross-scope Cards are minimized,
    // current use is blocked, and personal-only historical bytes remain readable.
    const personal = { readSet: [ns], refs: [f.a], intent: 'history' };
    const historical = ok(core.fetchCandidateEvidence(personal, {})).items[0];
    assert.deepEqual(historical.support.currentDependency, { revision: 1, status: 'needs-review', reasons: ['access_revoked'] });
    denied(core.fetchCandidateEvidence({ ...personal, intent: 'current' }, {}), 'evidence_unavailable');
    assert.ok(ok(await core.findCandidates({ ...f.request, readSet: [ns] }, {})).items.some(item => item.ref.cardId === f.control.cardId));
    if (kind !== 'read-only') {
      assert.equal(ok(core.getCard({ namespace: ns, cardId: f.control.cardId }, {})).card.body, 'personal access remains available');
      assert.equal(ok(core.revalidateEvidence({ namespace: ns, snapshot: saved.exactPersonal.snapshot }, {})).items[0].body, historical.body);
      assert.equal(ok(await core.readRoleTaskContext({ mode: 'now', roleKey: 'personal-finance', readSet: [ns] }, {})).metered.profile.release.fields, null);
      assert.ok(ok(core.mapEvidence({ namespace: ns, type: 'card' }, {})).items.some(item => item.ref?.cardId === f.control.cardId));
    }
    assert.equal(spy.observed.denied, 0);
  });

for (const enabled of [true, false]) test(`C21 selective revocation after preparation, at awaits and final grants; authoring ${enabled}`, async t => {
  // Each case starts with live project authority and an observable contribution.
  const cases = ['assembly-counter', 'assembly-await', 'fetch-prepared', 'role-now', 'role-refresh', 'role-then', 'role-file', 'role-compare',
    'getCard', 'listCards', 'selectEvidence', 'fetchEvidence', 'revalidateEvidence', 'mapEvidence', 'organization-cursor', 'mapping-cursor'];
  for (const stage of cases) {
    const f = scopedFixture(t), saved = await warm(f), core = reader(t, f, 'ordinary', enabled);
    let prepared = false, checks = 0, queued = false;
    const spy = deniedLookupSpy(f.h.state, f.deniedValues, sql => { if (/SELECT \* FROM private_cards WHERE/.test(sql)) prepared = true; });
    try {
      if (stage === 'assembly-counter' || stage.startsWith('role-')) f.h.state.count = () => f.h.revokeProject();
      else if (stage === 'assembly-await') f.h.state.check = request => {
        if (request.method === 'contextRead' && !queued) { queued = true; queueMicrotask(() => f.h.revokeProject()); }
      };
      else if (stage === 'fetch-prepared') f.h.state.check = request => { if (request.method === 'fetchCandidateEvidence' && prepared) f.h.revokeProject(); };
      else f.h.state.check = request => { if (request.namespace.scope === 'project' && ++checks === 2) f.h.revokeProject(); };
      let method, input;
      if (stage.startsWith('assembly-')) { method = 'contextRead'; input = f.request; }
      else if (stage === 'fetch-prepared') { method = 'fetchCandidateEvidence'; input = { readSet: scopes, snapshot: saved.current.snapshot }; }
      else if (stage.startsWith('role-')) {
        method = 'readRoleTaskContext'; const mode = stage.slice(5);
        input = { mode, readSet: scopes, ...(mode === 'now' ? { roleKey: 'finance', task: 'finance' } :
          mode === 'compare' ? { roleKey: 'finance', from: f.v1.version, to: f.v2.version } :
          { receipt: saved.role.receipt, ...(mode === 'file' ? { package: f.v1.package, path: 'guide.txt' } : {}) }) };
      } else {
        const inputs = {
          getCard: { namespace: project, cardId: f.b.cardId }, listCards: { namespace: project, states: ['confirmed'] },
          selectEvidence: { namespace: project, query: 'finance', types: ['card'], intent: 'current' },
          fetchEvidence: { namespace: project, refs: [f.b], intent: 'current' }, revalidateEvidence: { namespace: project, snapshot: saved.exact.snapshot },
          mapEvidence: { namespace: project, type: 'card' },
          'organization-cursor': { namespace: project, type: 'card', limit: 1, cursor: saved.organization.nextCursor },
          'mapping-cursor': { namespace: project, type: 'card', mocId: f.topic.mocId, limit: 1, cursor: saved.mappings.nextCursor },
        };
        method = stage === 'organization-cursor' ? 'mapEvidence' : stage === 'mapping-cursor' ? 'listEvidenceMappings' : stage; input = inputs[stage];
      }
      denied(await core[method](input, {}), 'scope_changed');
      assert.equal(f.h.state.revoked, true, stage);
      assert.equal(spy.observed.denied, 0, stage);
      f.h.state.check = null; f.h.state.count = null;
      assert.equal(ok(core.getCard({ namespace: ns, cardId: f.control.cardId }, {})).card.body, 'personal access remains available');
      assert.equal(spy.observed.denied, 0, stage);
    } finally { spy.restore(); }
  }
});


for (const enabled of [true, false]) for (const kind of ['ordinary', 'managed', 'read-only']) for (const method of ['findCandidates', 'contextRead'])
 test(`C21 selective project revocation at query embedding await; ${method}, ${kind}, authoring ${enabled}`, async t => {
  const f=scopedFixture(t);let armed=false,queryCalls=0;
  const embedder={id:`synthetic-selective-${enabled}-${kind}-${method}`,revision:'1',dimensions:2,normalization:'l2',async embed(texts){
   await Promise.resolve();if(armed){queryCalls++;f.h.revokeProject();}return texts.map(()=>[1,0]);
  }};
  const contextRead={...f.h.context,sources,embedder,policy:{maxRequests:10,maxUsd:1,estimateUsd:()=>0}};
  const writable=reader(t,f,'ordinary',enabled,contextRead);
  const refreshed=ok(await writable.refreshContextIndex({readSet:scopes,types:['memory','card'],intent:'current',budget:{maxItems:1024,maxMs:5000}},{}));assert.equal(refreshed.channels.semantic.state,'ready');
  const core=kind==='ordinary'?writable:reader(t,f,kind,enabled,contextRead),spy=deniedLookupSpy(f.h.state,f.deniedValues);
  try{
   armed=true;denied(await core[method]({...f.request,semantic:true},{}),'scope_changed');assert.equal(queryCalls,1);assert.equal(spy.observed.denied,0);
   assert.equal(ok(core.fetchCandidateEvidence({readSet:[ns],refs:[f.control],intent:'current'},{})).items[0].body,'personal access remains available');assert.equal(spy.observed.denied,0);
  }finally{spy.restore();}
 });

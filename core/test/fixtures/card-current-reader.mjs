import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { openMemoryCore, openContextReader } from '../../index.mjs';
import { cardOptions } from '../card-current-fixture.mjs';
import { scopedHost, sources, scopes, ns, project, deniedLookupSpy } from '../card-current-scope-fixture.mjs';
const path = process.argv[2], jobFile = process.argv[3], job = JSON.parse(readFileSync(jobFile)), h = scopedHost();
const core = job.kind === 'read-only' ? openContextReader({ path, contextRead: { ...h.context, sources } }) : openMemoryCore({ path,
  privateCards: cardOptions(h.authority, job.enabled), methodPackages: h.methods, roleProfiles: h.options,
  contextRead: { ...h.context, sources }, ...(job.kind === 'managed' ? { existingStore: job.existingStore } : {}) });
const request = { readSet: scopes, query: 'finance', types: ['memory', 'card'], intent: 'current', deadlineMs: 5000, sources: [job.source] };
async function call(method, input) { return typeof core[method] === 'function' ? await core[method](input, {}) : null; }
let spy;
try {
  let saved = job.saved;
  if (!saved) {
    saved = { contribution: await call('findCandidates', request), candidate: await call('findCandidates', { ...request, limit: 1 }),
      current: await call('fetchCandidateEvidence', { readSet: scopes, refs: [job.a, job.b], intent: 'current' }),
      history: await call('fetchCandidateEvidence', { readSet: scopes, refs: [job.a, job.b], intent: 'history' }),
      role: await call('readRoleTaskContext', { mode: 'now', roleKey: 'finance', readSet: scopes, task: 'finance' }),
      organization: await call('mapEvidence', { namespace: project, type: 'card', limit: 1 }) };
  }
  const prepared = { pid: process.pid, saved };
  if (job.gated) {
    writeFileSync(jobFile + '.ready.tmp', JSON.stringify(prepared));
    renameSync(jobFile + '.ready.tmp', jobFile + '.ready');
    const deadline = Date.now() + 20000;
    while (!existsSync(jobFile + '.release')) {
      if (Date.now() > deadline) throw Error('reader rendezvous timeout');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }
  if (job.revokeProject) h.revokeProject();
  spy = deniedLookupSpy(h.state, new Set(job.deniedValues));
  const results = {
    oldPage: await call('findCandidates', { ...request, limit: 1, cursor: saved.candidate.value.nextCursor }),
    aCurrent: await call('fetchCandidateEvidence', { readSet: scopes, refs: [job.a], intent: 'current' }),
    bCurrent: await call('fetchCandidateEvidence', { readSet: scopes, refs: [job.b], intent: 'current' }),
    oldSnapshot: await call('fetchCandidateEvidence', { readSet: scopes, snapshot: saved.current.value.snapshot }),
    oldHistory: await call('fetchCandidateEvidence', { readSet: scopes, snapshot: saved.history.value.snapshot }),
    freshHistory: await call('fetchCandidateEvidence', { readSet: scopes, refs: [job.a, job.b], intent: 'history' }),
    fresh: await call('findCandidates', request),
    organization: await call('mapEvidence', { namespace: project, type: 'card' }),
    oldOrganization: saved.organization ? await call('mapEvidence', { namespace: project, type: 'card', limit: 1, cursor: saved.organization.value.nextCursor }) : null,
    role: await call('readRoleTaskContext', { mode: 'now', roleKey: 'finance', readSet: scopes }),
    then: saved.role ? await call('readRoleTaskContext', { mode: 'then', receipt: saved.role.value.metered.receipt, readSet: scopes }) : null,
    personal: await call('fetchCandidateEvidence', { readSet: [ns], refs: [job.control], intent: 'current' }),
  };
  process.stdout.write(JSON.stringify({ pid: process.pid, saved, results, deniedLookups: spy.observed.denied }));
} finally { spy?.restore(); core.close(); }

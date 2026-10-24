import { spawn, spawnSync } from 'node:child_process';
import { openSync, closeSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { coreFixture, ns, ok, receipt } from './context-read-core-fixture.mjs';

export { ns, ok, receipt };
export const bothSources = ['relations-one-hop-v1', 'moc-v1'];
export const sourceQuery = (patch = {}) => ({ readSet: [ns], query: 'needle', types: ['memory'], intent: 'current', deadlineMs: 5000, ...patch });
export const memoryRef = (memory, namespace = ns) => ({ type: 'memory', namespace, memoryId: memory.id, revision: memory.revision });
export function sourcesFixture(t, { sources = bothSources, counter = { id: 'synthetic-unit', countTokens: () => 1 }, model, ...rest } = {}) {
  let proposals = [];
  const localModel = model ?? { contextWindow: 32768, countTokens: () => 1, relate: () => ({ edges: proposals }) };
  const f = coreFixture(t, { ...rest, coreOptions: { ...rest.coreOptions, model: localModel } });
  const context = f.reopen({ sources, counter });
  return { ...f, context,
    find(patch = {}) { return f.trusted.call(context, 'findCandidates', sourceQuery(patch)); },
    assemble(patch = {}) { return f.trusted.call(context, 'contextRead', sourceQuery(patch)); },
    async relate(from, to, relation = 'supports-decision', namespace = ns) {
      proposals = [{ from: 0, to: 1, fromReceipt: 0, toReceipt: 0, relation }];
      return ok(await context.reviewRationale({ namespace, refs: [from, to].map(m => ({ memoryId: m.id, revision: m.revision })) }));
    },
    topic(memory, title, root, namespace = ns) {
      const indexRevision = ok(context.map({ namespace, purpose: 'classification' })).indexRevision;
      return ok(context.applyPlacement({ namespace, expectedIndexRevision: indexRevision,
        expectedMemoryRevisions: [{ memoryId: memory.id, revision: memory.revision }],
        proposal: { items: [{ memoryId: memory.id, parentIds: [], newL1: { title, parentL2Ids: [], ...(root ? { newL2Title: root } : {}) } }] } }));
    },
    card(body, { memories, title = 'Synthetic card', namespace = ns } = {}) {
      const id = randomUUID();
      const draft = ok(f.host.call(f.core, 'createCardDraft', { namespace, actionId: 'draft-' + id, drafting: 'authored',
        input: { title, body, ...(memories ? { sourcePolicy: 'retained-receipts-v1', memoryRefs: memories.map(m => ({ type: 'memory', namespace, memoryId: m.id, revision: m.revision })) } :
          { authoredInput: { text: 'Synthetic submitted source ' + id, occurredAt: null } }) } }));
      const saved = ok(f.host.call(f.core, 'confirmCardDraft', { namespace, actionId: 'confirm-' + id, cardId: draft.id, expectedRevision: 1, applicability: 'current' }));
      return { type: 'card', namespace, cardId: saved.id, revision: saved.revision, bodyRevision: saved.bodyRevision };
    },
    cardTopic(ref, title, root) {
      const namespace = ref.namespace;
      const indexRevision = ok(f.host.call(f.core, 'mapEvidence', { namespace, type: 'card' })).indexRevision;
      return ok(f.host.call(f.core, 'applyCardPlacement', { namespace, actionId: randomUUID(), refs: [ref], expectedIndexRevision: indexRevision,
        proposal: { items: [{ cardId: ref.cardId, parentIds: [], newL1: { title, parentL2Ids: [], ...(root ? { newL2Title: root } : {}) } }] } }));
    },
  };
}

// Regular files avoid the sandbox's anonymous-pipe restriction. Every real
// process has a finite deadline, checked error/signal/exit status and report.
export function sourceChild(f, job, { sync = false } = {}) {
  const id = randomUUID(), out = join(f.workspace.path, id + '.out'), err = join(f.workspace.path, id + '.err'), report = join(f.workspace.path, id + '.json');
  const stdout = openSync(out, 'wx', 0o600), stderr = openSync(err, 'wx', 0o600);
  const args = [new URL('./context-read-sources-worker.mjs', import.meta.url).pathname, f.path, JSON.stringify(job), report];
  const checked = result => {
    if (result.error || result.signal || (result.status ?? result.code) !== 0) throw Error(JSON.stringify({ ...result, stderr: readFileSync(err, 'utf8') }));
    return JSON.parse(readFileSync(report, 'utf8'));
  };
  if (sync) {
    try { return checked(spawnSync(process.execPath, args, { stdio: ['ignore', stdout, stderr], timeout: 30000 })); }
    finally { closeSync(stdout); closeSync(stderr); }
  }
  const child = spawn(process.execPath, args, { stdio: ['ignore', stdout, stderr] }); closeSync(stdout); closeSync(stderr);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => { clearTimeout(timer); try { resolve(checked({ code, signal })); } catch (error) { reject(error); } });
  });
}

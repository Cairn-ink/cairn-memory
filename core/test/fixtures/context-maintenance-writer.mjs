// A fresh ordinary writer process for each rendezvous. SQLite exclusively owns
// all canonical file descriptors, including during capture/review and close.
import { workerData, parentPort } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { openMemoryCore } from '../../contract.mjs';
import { rationaleModel } from '../../testing/rationale-model.mjs';
import { cardHost } from '../../testing/raw-source-fixtures.mjs';

const [path, encoded] = workerData ? [workerData.path, JSON.stringify(workerData.input)] : process.argv.slice(2), input = JSON.parse(encoded);
const rendezvous = workerData && new Int32Array(workerData.rendezvous);
const host = cardHost(), text = 'Synthetic maintenance probe ' + randomUUID();
const core = openMemoryCore({ path, decisionReview: 'required-v1', privateCards: host.options,
  model: { ...rationaleModel(), extract: () => ({ items: [{ content: text, kind: 'decision', confidence: .8, sourceIndices: [0] }] }) } });
const ok = r => { if (!r.ok) throw Error(JSON.stringify(r)); return r.value; };
try {
  if (rendezvous) {
    // The writer is open before the maintainer advertises readiness. Startup
    // never consumes the refresh quantum; the hook only releases this wait.
    parentPort.postMessage('ready');
    while (Atomics.load(rendezvous, 0) === 0) Atomics.wait(rendezvous, 0, 0);
  }
  const namespace = input.namespace;
  let row;
  if (input.type === 'card') {
    row = input.operation === 'capture'
      ? ok(host.call(core, 'createCardDraft', { namespace, actionId: randomUUID(), drafting: 'authored',
        input: { title: text, body: text, authoredInput: { text, occurredAt: null } } }))
      : ok(host.call(core, 'confirmCardDraft', { namespace, cardId: input.id, expectedRevision: input.revision,
        actionId: randomUUID(), applicability: 'current' }));
  } else if (input.operation === 'capture') {
    const result = ok(await core.capture({ namespace, client: 'synthetic-maintenance', sessionId: 'writer', eventId: randomUUID(),
      messages: [{ id: 'message', role: 'user', content: text }] }));
    row = ok(core.get({ namespace, memoryId: result.admission.memories[0].id, includeAwaiting: true })).memory;
  } else {
    ok(core.confirm({ namespace, memoryId: input.id, expectedRevision: input.revision, actionId: randomUUID(),
      receipt: { client: 'synthetic-maintenance', sessionId: 'review', eventId: randomUUID(), role: 'user', excerpt: 'Confirm synthetic decision.' } }));
    row = ok(core.get({ namespace, memoryId: input.id, includeAwaiting: true })).memory;
  }
  console.log(JSON.stringify({ id: row.id, revision: row.revision, type: input.type }));
  if (rendezvous) Atomics.store(rendezvous, 1, 1);
} catch (error) {
  if (rendezvous) Atomics.store(rendezvous, 1, -1);
  throw error;
} finally {
  core.close();
  if (rendezvous) Atomics.notify(rendezvous, 1);
}

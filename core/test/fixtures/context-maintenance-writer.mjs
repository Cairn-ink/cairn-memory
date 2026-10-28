// A fresh ordinary writer process for each rendezvous. SQLite exclusively owns
// all canonical file descriptors, including during capture/review and close.
import { randomUUID } from 'node:crypto';
import { openMemoryCore } from '../../contract.mjs';
import { rationaleModel } from '../../testing/rationale-model.mjs';
import { cardHost } from '../../testing/raw-source-fixtures.mjs';

const [path, encoded] = process.argv.slice(2), input = JSON.parse(encoded);
const host = cardHost(), text = 'Synthetic maintenance probe ' + randomUUID();
const core = openMemoryCore({ path, decisionReview: 'required-v1', privateCards: host.options,
  model: { ...rationaleModel(), extract: () => ({ items: [{ content: text, kind: 'decision', confidence: .8, sourceIndices: [0] }] }) } });
const ok = r => { if (!r.ok) throw Error(JSON.stringify(r)); return r.value; };
try {
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
} finally { core.close(); }

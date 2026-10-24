import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { openMemoryCore } from '../contract.mjs';
import { sourceFixture, savedSource, anchor, resolve, draft, ns, ok, denied } from '../testing/raw-source-fixtures.mjs';

const confirm = (f,card) => ok(f.call('confirmCardDraft',{ namespace: ns,cardId: card.id,
  expectedRevision: card.revision,actionId: 'confirm',applicability: 'current' }));

for (const client of ['claude-code','codex']) {
  test(`P3c-08/10 ${client}: Raw support loss stales evidence/MOC snapshots and option-off consumers fail closed`, async t => {
    const f = sourceFixture(t), source = await savedSource(f,undefined,{ client }), refs = await resolve(f,[anchor(source)]);
    const card = ok(draft(f,refs)), saved = confirm(f,card), ref = { type: 'card',namespace: ns,cardId: saved.id,
      revision: saved.revision,bodyRevision: saved.bodyRevision };
    const index = ok(f.call('mapEvidence',{ namespace: ns,type: 'card' })).indexRevision;
    const placement = ok(f.call('applyCardPlacement',{ namespace: ns,actionId: 'place',refs: [ref],expectedIndexRevision: index,
      proposal: { items: [{ cardId: card.id,parentIds: [],newL1: { title: 'Synthetic topic',parentL2Ids: [] } }] } }));
    const evidence = ok(f.call('fetchEvidence',{ namespace: ns,intent: 'current',refs: [ref] }));
    const old = openMemoryCore({ path: f.path,privateCards: f.host.options }); f.workspace.defer(() => old.close());
    const calls = [
      ['getCard',{ namespace: ns,cardId: card.id }],
      ['listCards',{ namespace: ns,states: ['confirmed'] }],
      ['selectEvidence',{ namespace: ns,query: 'Synthetic',types: ['card'],intent: 'current' }],
      ['fetchEvidence',{ namespace: ns,refs: [ref],intent: 'current' }],
      ['mapEvidence',{ namespace: ns,type: 'card' }],
    ];
    for (const [method,input] of calls) denied(f.host.call(old,method,input),'source_unavailable');
    ok(f.core.deleteConversation({ namespace: ns,conversationId: source.conversationId,
      expectedRevision: source.expectedConversationRevision,actionId: 'delete' }));
    denied(f.call('revalidateEvidence',{ namespace: ns,snapshot: evidence.snapshot }),'snapshot_stale');
    const current = ok(f.call('mapEvidence',{ namespace: ns,type: 'card' }));
    assert.ok(current.indexRevision > placement.indexRevision);
    assert.equal(current.items.some(item => item.type === 'topic' && item.topic.title !== null),false);
    assert.equal(current.items.some(item => item.type === 'unfiled'),false);
    const retained = ok(f.call('getCard',{ namespace: ns,cardId: card.id })).card;
    const history = ok(f.call('fetchEvidence',{ namespace: ns,intent: 'history',refs: [{ ...ref,revision: retained.revision }] }));
    assert.equal(history.items[0].body,retained.body); assert.equal(history.items[0].provenance.support,'unavailable');
  });

  test(`P3c-03/07 ${client}: core-issued source identity and authored Card reopen in a new process`, { timeout: 15000 }, async t => {
    const f = sourceFixture(t), source = await savedSource(f,undefined,{ client }), refs = await resolve(f,[anchor(source,0,9)]);
    const card = ok(draft(f,refs)); confirm(f,card);
    const child = spawn(process.execPath,[new URL('../testing/raw-source-child.mjs',import.meta.url).pathname,f.path],{
      env: {},stdio: ['ignore','ignore','pipe','ipc'] });
    let stderr = '',settled = false;
    child.stderr.on('data',bytes => { stderr += bytes; });
    const exited = new Promise((resolve,reject) => { child.once('error',reject); child.once('exit',(code,signal) => {
      settled = true; resolve({ code,signal });
    }); });
    f.workspace.defer(async () => { if (!settled) child.kill('SIGKILL'); await exited; });
    const output = new Promise((resolve,reject) => { child.once('message',resolve); child.once('error',reject);
      child.once('exit',() => reject(Error('Child exited before reply: '+stderr))); });
    child.send({ source: refs[0],cardId: card.id });
    const result = await output;
    assert.deepEqual(await exited,{ code: 0,signal: null },stderr);
    assert.equal(ok(result.read).parts[0].text,source.text.slice(0,9));
    assert.deepEqual(ok(result.card).card.bindings[0].source,refs[0]);
    assert.equal(ok(result.card).card.support.status,'eligible');
  });
}

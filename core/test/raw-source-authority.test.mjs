import assert from 'node:assert/strict';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { fixture } from '../testing/raw-capture-fixtures.mjs';
import { sourceFixture, savedSource, anchor, resolve, draft, cardHost, ns, ok, denied, localPlainPort, request, splitRaw } from '../testing/raw-source-fixtures.mjs';

const snapshot = db => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({ name }) => [name,db.prepare(`SELECT * FROM "${name}"`).all().map(row => JSON.stringify(row)).sort()]);
const confirm = (f,card,actionId) => ok(f.call('confirmCardDraft',{ namespace: ns,cardId: card.id,
  expectedRevision: card.revision,actionId,applicability: 'current' }));

for (const client of ['claude-code','codex']) {
  test(`P3c-08/09/10 ${client}: pre-upgrade option-off forget excludes overlapping Raw Cards once, not disjoint support`, async t => {
    const host = cardHost(), base = fixture(t,{ deletion: true,coreOptions: { privateCards: host.options },model: {
      extract: () => ({ items: [{ content: 'Synthetic locator interpretation.',kind: 'fact',confidence: .8,sourceIndices: [0] }] }) } });
    const old = openMemoryCore({ path: base.path }); base.workspace.defer(() => old.close());
    const core = openRawCaptureCore({ path: base.path,model: base.model,privateCards: host.options }, {
      mode: 'raw-v1',sources: true,port: localPlainPort(),readPolicy: () => ({ generation: 'synthetic',reason: null }) });
    base.workspace.defer(() => core.close());
    const f = { ...base,core,call: (method,input) => host.call(core,method,input) };
    const source = await savedSource(f,'A'.repeat(4000)+'Independent tail.',{ client });
    const refs = await resolve(f,[anchor(source,0,8),anchor(source,16,24)]), separate = await resolve(f,[anchor(source,4000,4011)]);
    const pending = ok(draft(f,refs)), artifact = ok(draft(f,refs,'artifact')), other = ok(draft(f,separate,'other'));
    const confirmed = confirm(f,artifact,'confirm-artifact'), independent = confirm(f,other,'confirm-other');
    const memory = f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0').get();
    ok(old.forget({ namespace: ns,memoryId: memory.id,expectedRevision: memory.revision }));
    assert.equal(ok(f.call('getCard',{ namespace: ns,cardId: pending.id })).card,null);
    const retained = ok(f.call('getCard',{ namespace: ns,cardId: artifact.id })).card;
    assert.equal(retained.revision,confirmed.revision+1); assert.equal(retained.support.status,'unavailable');
    const live = ok(f.call('getCard',{ namespace: ns,cardId: other.id })).card;
    assert.equal(live.revision,independent.revision); assert.equal(live.support.status,'eligible');
    assert.equal(f.db.prepare('SELECT count(*) n FROM card_effects WHERE entity_id=?').get(artifact.id).n,1);
    denied(await f.call('getSource',{ namespace: ns,source: refs[0] }),'source_excluded');
    assert.equal(ok(await f.call('getSource',{ namespace: ns,source: separate[0] })).parts[0].text,'Independent');
    assert.equal(f.db.prepare('SELECT count(*) n FROM raw_parts').get().n,2);
  });

  test(`P3c-08 ${client}: late Card invalidation abort rolls every source/Memory/Card table back`, async t => {
    const f = sourceFixture(t,{ model: { extract: () => ({ items: [{ content: 'Synthetic locator.',kind: 'fact',confidence: .8,sourceIndices: [0] }] }) } });
    const source = await savedSource(f,undefined,{ client }), refs = await resolve(f,[anchor(source)]);
    const card = ok(draft(f,refs)); confirm(f,card,'confirm');
    const memory = f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0').get();
    f.db.exec("CREATE TRIGGER fail_raw_card_effect BEFORE INSERT ON card_effects BEGIN SELECT RAISE(ABORT,'synthetic late effect'); END;");
    const before = snapshot(f.db);
    denied(f.core.forget({ namespace: ns,memoryId: memory.id,expectedRevision: memory.revision }),'storage_error');
    assert.deepEqual(snapshot(f.db),before);
    f.db.exec('DROP TRIGGER fail_raw_card_effect');
    ok(f.core.forget({ namespace: ns,memoryId: memory.id,expectedRevision: memory.revision }));
    assert.equal(ok(f.call('getCard',{ namespace: ns,cardId: card.id })).card.support.status,'unavailable');
  });

  for (const mutation of ['delete','forget','revoke','append']) test(`P3c-04 ${client}: ${mutation} during opening cannot publish stale source references`, { timeout: 15000 }, async t => {
    const port = localPlainPort(), open = port.openRaw; let entered,release,armed = false;
    const arrived = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
    port.openRaw = async value => { if (armed) { entered(); await gate; } return open(value); };
    const f = sourceFixture(t,{ port,model: { extract: () => ({ items: [{ content: 'Synthetic race locator.',kind: 'fact',confidence: .8,sourceIndices: [0] }] }) } });
    f.workspace.defer(() => release());
    const source = await savedSource(f,undefined,{ client }); armed = true;
    const input = { namespace: ns,anchors: [anchor(source)] }, pending = f.call('resolveSourceReferences',input);
    await arrived;
    if (mutation === 'delete') ok(f.core.deleteConversation({ namespace: ns,conversationId: source.conversationId,
      expectedRevision: source.expectedConversationRevision,actionId: 'delete' }));
    if (mutation === 'forget') {
      const memory = f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0').get();
      ok(f.core.forget({ namespace: ns,memoryId: memory.id,expectedRevision: memory.revision }));
    }
    if (mutation === 'revoke') f.host.revoke();
    if (mutation === 'append') ok(await f.core.captureRaw(request(splitRaw('Synthetic unrelated appended source.',
      { id: 'appended',ordinal: 2 })[0],{ client,eventId: 'append' })));
    release();
    denied(await pending,mutation === 'delete' ? 'source_unavailable' : mutation === 'revoke' ? 'scope_changed' : 'revision_conflict');
    if (mutation === 'forget') {
      const revision = f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(source.conversationId).revision;
      denied(await f.call('resolveSourceReferences',{ namespace: ns,anchors: [anchor({ ...source,expectedConversationRevision: revision })] }),'source_excluded');
    }
  });
}

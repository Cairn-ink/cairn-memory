import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { openMemoryCore } from '../contract.mjs';
import { sourceFixture, savedSource, anchor, resolve, draft, ns, ok, denied, localPlainPort, request, splitRaw } from '../testing/raw-source-fixtures.mjs';

test('P3c-01 selector remains internal, own boolean and default facade byte-compatible', t => {
  const f = sourceFixture(t);
  for (const value of [null,1,'true']) assert.throws(() => openRawCaptureCore({ path: f.path },{
    mode: 'off',sources: value,readPolicy: () => ({ generation: 'test',reason: null }) }),{ code: 'invalid_input' });
  let reads = 0;
  assert.throws(() => openRawCaptureCore({ path: f.path },{ mode: 'off',get sources() { reads++; return true; } }),{ code: 'invalid_input' });
  assert.equal(reads,0);
  assert.throws(() => openRawCaptureCore({ path: f.path },{ mode: 'off',sources: true }),{ code: 'authority_required' });
  assert.throws(() => openMemoryCore({ path: f.path,sources: true }),{ code: 'invalid_input' });
  const old = openMemoryCore({ path: f.path,privateCards: f.host.options }); f.workspace.defer(() => old.close());
  assert.equal(old.resolveSourceReferences,undefined);
  const capability = ok(old.getPrivateCardCapabilities());
  assert.equal(capability.raw,false); assert.deepEqual(capability.sourceTypes,['submitted-note','receipt']);
  assert.equal(capability.methods.includes('resolveSourceReferences'),false);
  const files = JSON.parse(readFileSync(new URL('../../packaging/artifact-files.json',import.meta.url)));
  for (const file of ['raw-source-schema','raw-source-input','card-raw-sources']) assert.ok(files.includes('core/'+file+'.mjs'));
  for (const file of ['raw-source-reader','raw-capture','raw-journal']) assert.equal(files.includes('core/'+file+'.mjs'),false);
});

for (const client of ['claude-code','codex']) {
  test(`P3c-04/11 ${client}: malformed sealed size and metadata budget refuse before BLOB reads or opens`, async t => {
    const port = localPlainPort(), open = port.openRaw; let opens = 0,loads = 0;
    port.openRaw = async value => { opens++; return open(value); };
    const f = sourceFixture(t,{ port }), source = await savedSource(f,'A'.repeat(9000),{ client });
    const prepare = DatabaseSync.prototype.prepare;
    DatabaseSync.prototype.prepare = function(sql) {
      if (sql.startsWith('SELECT sealed FROM raw_parts')) loads++;
      return prepare.call(this,sql);
    };
    try {
      denied(await f.call('resolveSourceReferences',{ namespace: ns,anchors: [anchor(source)],
        budgets: { scanRowLimit: 2 } }),'source_budget_exceeded');
      assert.equal(loads,0); assert.equal(opens,0);
      f.db.prepare('UPDATE raw_parts SET sealed=zeroblob(byte_count+1) WHERE conversation_id=? AND part_index=1').run(source.conversationId);
      denied(await f.call('resolveSourceReferences',{ namespace: ns,anchors: [anchor(source)] }),'raw_crypto_unavailable');
      assert.equal(loads,0); assert.equal(opens,0);
    } finally { DatabaseSync.prototype.prepare = prepare; }
  });

  test(`P3c-02/04 ${client}: caller mutation during an unlocked open cannot alter the prepared span`, async t => {
    const port = localPlainPort(), open = port.openRaw; let input,f;
    port.openRaw = async value => {
      f.db.exec('BEGIN IMMEDIATE'); f.db.exec('ROLLBACK');
      input.anchors[0].rawAnchor.start = 4; input.anchors[0].rawAnchor.end = 6;
      return open(value);
    };
    f = sourceFixture(t,{ port });
    const source = await savedSource(f,'ABCDEF',{ client }); input = { namespace: ns,anchors: [anchor(source,0,3)] };
    const ref = ok(await f.call('resolveSourceReferences',input)).sources[0];
    assert.deepEqual(ref.span,{ start: 0,end: 3,precision: 'exact' });
  });

  test(`P3c-11 ${client}: overlapping anchors reuse scanned rows and opened parts under one budget`, async t => {
    const port = localPlainPort(), open = port.openRaw; let opens = 0;
    port.openRaw = async value => { opens++; return open(value); };
    const f = sourceFixture(t,{ port }), source = await savedSource(f,'A'.repeat(9000),{ client });
    for (const entries of [
      [anchor(source,0,4500),anchor(source,3500,8500)],
      [anchor(source,3500,8500),anchor(source,0,4500)],
      [anchor(source,0,1),anchor(source,8500,9000),anchor(source,0,9000)],
    ]) {
      opens = 0;
      const refs = await resolve(f,entries,{ sourceByteLimit: 9000,scanRowLimit: 3 });
      assert.equal(refs.length,entries.length); assert.equal(opens,3);
    }
  });

  test(`P3c-05 ${client}: paused/raw-off retained reads work; missing opener cannot mint but synchronous Card validation works`, async t => {
    const f = sourceFixture(t), source = await savedSource(f,undefined,{ client }), [ref] = await resolve(f,[anchor(source)]);
    ok(f.core.setRawCaptureControl({ ownerId: ns.ownerId,client,enabled: false,expectedRevision: 0 }));
    ok(f.core.setCapturePaused({ namespace: ns,paused: true,expectedGeneration: 'initial' }));
    const reader = openRawCaptureCore({ path: f.path,privateCards: f.host.options },{
      mode: 'off',sources: true,port: localPlainPort(),readPolicy: () => { throw Error('Capture policy is not read authority'); } });
    f.workspace.defer(() => reader.close());
    assert.equal(ok(await f.host.call(reader,'getSource',{ namespace: ns,source: ref })).parts[0].text,source.text);
    const noPort = openRawCaptureCore({ path: f.path,privateCards: f.host.options },{
      mode: 'off',sources: true,readPolicy: () => ({ generation: 'test',reason: null }) });
    f.workspace.defer(() => noPort.close());
    denied(await f.host.call(noPort,'resolveSourceReferences',{ namespace: ns,anchors: [anchor(source)] }),'raw_crypto_unavailable');
    const saved = ok(f.host.call(noPort,'createCardDraft',{ namespace: ns,actionId: 'metadata-only',drafting: 'authored',input: {
      sources: [ref],title: 'Synthetic title',body: 'Synthetic authored body.' } }));
    assert.equal(ok(f.host.call(noPort,'getCard',{ namespace: ns,cardId: saved.id })).card.support.status,'eligible');
  });

  test(`P3c-02 ${client}: whole-message precision needs the saved entire message, not a prefix or skipped source`, async t => {
    const f = sourceFixture(t), parts = splitRaw('A'.repeat(4500));
    const first = ok(await f.core.captureRaw(request(parts[0],{ client,eventId: 'first' })));
    const source = { conversationId: first.raw.conversationId,messageId: parts[0].id,text: 'A'.repeat(4500),expectedConversationRevision: first.raw.revision };
    denied(await f.call('resolveSourceReferences',{ namespace: ns,anchors: [anchor(source,0,4000,'whole-message')] }),'source_unavailable');
    denied(await f.call('resolveSourceReferences',{ namespace: ns,anchors: [anchor(source,0,4500,'whole-message')] }),'source_unavailable');
    const last = ok(await f.core.captureRaw(request(parts[1],{ client,eventId: 'last' })));
    source.expectedConversationRevision = last.raw.revision;
    assert.equal((await resolve(f,[anchor(source,0,4500,'whole-message')]))[0].span.precision,'whole-message');
    const skipped = sourceFixture(t,{ capBytes: 1 }), unavailable = await savedSource(skipped,'Not saved.',{ client });
    denied(await skipped.call('resolveSourceReferences',{ namespace: ns,anchors: [anchor(unavailable)] }),'source_unavailable');
  });

  test(`P3c-11 ${client}: live fanout is per conversation across distinct spans and cancellation frees capacity`, async t => {
    const f = sourceFixture(t), source = await savedSource(f,'A'.repeat(256),{ client }), refs = await resolve(f,[anchor(source,0,1),anchor(source,2,3)]);
    const cards = [];
    for (let index=0; index<128; index++) cards.push(ok(draft(f,[refs[index%2]],'draft-'+index)));
    const before = f.db.prepare('SELECT count(*) n FROM card_operations').get().n;
    denied(draft(f,[refs[1]],'overflow'),'dependency_limit_reached');
    assert.equal(f.db.prepare('SELECT count(*) n FROM card_operations').get().n,before);
    ok(f.call('cancelCardDraft',{ namespace: ns,cardId: cards[0].id,expectedRevision: cards[0].revision,actionId: 'cancel' }));
    ok(draft(f,[refs[1]],'replacement'));
    assert.equal(f.db.prepare('SELECT count(DISTINCT card_id) n FROM card_raw_bindings').get().n,128);
    denied(draft(f,[refs[0],refs[0]],'duplicate'),'invalid_input');
  });

  test(`P3c-11 ${client}: separately prepared references cannot multiply the aggregate64k Card source allowance`, async t => {
    const f = sourceFixture(t), a = await savedSource(f,'A'.repeat(36000),{ client,sessionId: 'A' }),
      b = await savedSource(f,'B'.repeat(36000),{ client,sessionId: 'B' });
    const refs = [...await resolve(f,[anchor(a)],{ sourceByteLimit: 64000 }),...await resolve(f,[anchor(b)],{ sourceByteLimit: 64000 })];
    denied(draft(f,refs),'invalid_input');
    assert.equal(f.db.prepare('SELECT count(*) n FROM private_cards').get().n,0);
    assert.equal(f.db.prepare('SELECT count(*) n FROM card_operations').get().n,0);
  });
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { classifyRawAcknowledgement } from '../../../integrations/client/raw/protocol.mjs';
import { fixture, ok } from './fixtures/workspace.mjs';
import { captureLocal } from '../capture.mjs';
import { configuration } from '../configuration.mjs';
import { openMemoryCore } from '../../../core/index.mjs';
import { localPlainPort, ns } from '../../../core/testing/raw-capture-fixtures.mjs';
import { searchFixture } from '../../../core/testing/raw-search-fixtures.mjs';
import { installRawSearchTestClock } from '../../../core/testing/raw-search-clock.mjs';
import { LOCAL_RAW_HIDE_WINDOW_MS, LOCAL_RAW_LEGACY_EVENT_LIMIT } from '../../../core/local-authority-storage.mjs';

for (const client of ['claude-code', 'codex']) test(`B3 ${client}: exact source, replay and multipart continuation survive fresh processes`, async t => {
  const f = fixture(t, { client }), text = 'synthetic_source_secret\n Ａ🙂 e\u0301 '.repeat(130);
  const firstEnd = /[\uD800-\uDBFF]/.test(text[2999]) ? 2999 : 3000, input = f.request('long', text.slice(0, firstEnd));
  input.messages[0].part.totalUnits = text.length; input.messages[0].part.totalBytes = Buffer.byteLength(text);
  const first = f.reply(await f.run(input)); assert.equal(first.status, 200);
  assert.equal(classifyRawAcknowledgement(first.status, first.body, input).disposition, 'complete');
  const replay = f.reply(await f.run(input, { key: false })); assert.equal(replay.body.duplicate, true);
  let index = 1, start = firstEnd;
  while (start < text.length) {
    let end = Math.min(start + 3000, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    const suffix = { ...input, event_id: 'suffix-' + index, messages: [{ ...input.messages[0], content: text.slice(start, end), part: { ...input.messages[0].part, index, start } }] };
    assert.equal(f.reply(await f.run(suffix, { key: false })).status, 200); start = end; index++;
  }
  const db = new DatabaseSync(f.databasePath, { readOnly: true });
  try {
    const parts = db.prepare('SELECT sealed FROM raw_parts WHERE conversation_id=? ORDER BY part_index').all(first.body.raw.conversationId);
    assert.ok(parts.length > 1); assert.equal(Buffer.concat(parts.map(part => Buffer.from(part.sealed))).toString('utf8'), text);
  } finally { db.close(); }
});

test('B3 whitespace-only projection and pure continuation never need a credential or ledger', async t => {
  const f = fixture(t), result = f.reply(await f.run(f.request('spaces', ' \t\n'), { key: false }));
  assert.equal(result.status, 200); assert.equal(result.body.memoryCount, 0);
  assert.equal(f.calls().length, 0); assert.equal(f.ledger(), null);
});

for (const mode of ['provider-error', 'qualification-error']) test(`B3 ${mode}: retained Raw does not become a successful or retryable interpretation`, async t => {
  const f = fixture(t), request = f.request(), first = f.reply(await f.run(request, { mode }));
  assert.equal(first.body.error, 'interpretation_incomplete'); assert.ok(first.status >= 400);
  const calls = f.calls().length, usage = f.ledger().used;
  const replay = f.reply(await f.run(request, { key: false })); assert.equal(replay.body.error, 'interpretation_incomplete');
  assert.equal(f.calls().length, calls); assert.equal(f.ledger().used, usage); assert.deepEqual(f.ledger().reservations, []);
  assert.equal(ok(f.core.list({ namespace: f.namespace })).memories.length, 0);
});

test('B3 optional filing failure retains completed qualified admission and counts ports once', async t => {
  const f = fixture(t), response = f.reply(await f.run(f.request(), { mode: 'filing-error' }));
  assert.equal(response.status, 200); assert.equal(response.body.memoryCount, 1);
  assert.equal(f.calls().length, 5); assert.equal(f.ledger().used, 3); assert.deepEqual(f.ledger().reservations, []);
  assert.equal(ok(f.core.list({ namespace: f.namespace })).memories.length, 1);
});

for (const mode of ['revoke', 'notice', 'raw-off']) test(`B3 ${mode}: per-HTTP checks distinguish consent from Raw retention`, async t => {
  const f = fixture(t), response = f.reply(await f.run(f.request(), { mode }));
  assert.equal(response.status, mode === 'revoke' ? 503 : 200);
  assert.equal(f.calls().length, mode === 'revoke' ? 1 : 6);
  assert.equal(ok(f.core.list({ namespace: f.namespace })).memories.length, mode === 'revoke' ? 0 : 1);
});

test('B3 daily port cap preserves incomplete evidence without a hidden retry', async t => {
  const f = fixture(t); f.config.usage.dailyCap = 1; f.save();
  const request = f.request(), response = f.reply(await f.run(request, { mode: 'memory' }));
  assert.equal(response.status, 503); assert.equal(response.body.error, 'interpretation_incomplete');
  assert.equal(f.calls().length, 2); assert.equal(f.ledger().used, 1);
  assert.equal(f.reply(await f.run(request, { key: false })).status, 503); assert.equal(f.calls().length, 2);
});

test('B3 malformed routing, bytes, CLI and unsafe config refuse without capture or usage mutation', async t => {
  const f = fixture(t), before = ok(f.core.getRawUsage({ ownerId: f.namespace.ownerId }));
  for (const options of [{ bytes: Buffer.from([0xc0, 0xaf]) }, { bytes: '{} {}' }, { bytes: Buffer.alloc(65537, 32) }, { args: ['--api-key', 'synthetic_key_secret'] }]) {
    const result = await f.run(f.request(), options); assert.equal(result.code, 1); assert.equal(result.stdout, '');
    assert.doesNotMatch(result.stderr, /synthetic_source_secret|synthetic_key_secret/);
  }
  assert.equal((await f.run({ ...f.request(), project_id: 'foreign-project-0000' })).code, 1);
  chmodSync(f.configPath, 0o644); assert.equal((await f.run(f.request())).code, 1);
  assert.equal(f.calls().length, 0); assert.equal(f.ledger(), null);
  assert.deepEqual(ok(f.core.getRawUsage({ ownerId: f.namespace.ownerId })), before);
});

test('B3 process deadline kills unconfirmed provider work without refund, then dead-owner recovery frees its slot', async t => {
  const f = fixture(t), ready = join(f.workspace.path, 'ready'), release = join(f.workspace.path, 'release');
  f.config.timeouts = { captureMs: 5000, processMs: 7000 }; f.save();
  const pending = f.launch(f.request(), { mode: 'hold', environment: { SYNTHETIC_READY: ready, SYNTHETIC_RELEASE: release } });
  const end = Date.now() + 4000;
  while (!existsSync(ready) && pending.child.exitCode === null && pending.child.signalCode === null && Date.now() < end) await delay(10);
  assert.equal(existsSync(ready), true, 'provider dispatch must precede the process-deadline assertion');
  assert.equal(pending.child.exitCode, null); assert.equal(pending.child.signalCode, null);
  assert.deepEqual(f.calls(), [{ method: 'cairn_extract', count: true }, { method: 'cairn_extract', count: false }]);
  assert.equal(f.ledger().used, 1); assert.equal(f.ledger().reservations.length, 1);
  const result = await pending.done;
  assert.equal(result.timedOut, false);
  assert.equal(result.code, 124); assert.equal(result.signal, null); assert.equal(result.stdout, '');
  assert.equal(existsSync(release), false);
  assert.equal(f.ledger().used, 1); assert.equal(f.ledger().reservations.length, 1);
  f.config.timeouts = { captureMs: 5000, processMs: 9000 }; f.save();
  const next = f.reply(await f.run(f.request('fresh', 'fresh', 2))); assert.equal(next.status, 200);
  assert.equal(f.ledger().used, 2); assert.deepEqual(f.ledger().reservations, []);
});

test('B3 pre-dispatch capture timeout completes cooperatively without refund and releases its slot', async t => {
  const f = fixture(t), ready = join(f.workspace.path, 'planning-ready');
  f.config.timeouts = { captureMs: 2000, processMs: 7000 }; f.save();
  const pending = f.launch(f.request(), { mode: 'planning-delay', environment: { SYNTHETIC_READY: ready } });
  const end = Date.now() + 4000;
  while (!existsSync(ready) && pending.child.exitCode === null && pending.child.signalCode === null && Date.now() < end) await delay(10);
  assert.equal(existsSync(ready), true, 'planning must precede the cooperative-timeout assertion');
  const result = await pending.done, response = f.reply(result);
  assert.equal(response.status, 503); assert.equal(response.body.error, 'interpretation_incomplete');
  assert.deepEqual(f.calls(), [{ method: 'cairn_extract', count: true }]);
  assert.equal(f.ledger().used, 1); assert.deepEqual(f.ledger().reservations, []);
});

test('B3 two actual processes share a target concurrency cap and release only after provider settlement', async t => {
  const f = fixture(t), ready = join(f.workspace.path, 'ready'), release = join(f.workspace.path, 'release');
  const first = f.launch(f.request(), { mode: 'hold', environment: { SYNTHETIC_READY: ready, SYNTHETIC_RELEASE: release } });
  const end = Date.now() + 5000;
  while (!existsSync(ready) && Date.now() < end) await delay(10);
  assert.equal(existsSync(ready), true);
  const second = f.reply(await f.run({ ...f.request('parallel'), session_id: 'other-session' }));
  assert.equal(second.status, 503); assert.equal(f.calls().length, 2); assert.equal(f.ledger().used, 1);
  writeFileSync(release, 'release', { flag: 'wx', mode: 0o600 });
  assert.equal(f.reply(await first.done).status, 200); assert.deepEqual(f.ledger().reservations, []);
});

function localPrivacyFixture(t) {
  const f = fixture(t,{client:'claude-code',namespace:ns});
  f.config.interpretation = 'raw-only'; f.save();
  const core = openMemoryCore({path:f.databasePath,raw:true,rawSearch:false}); f.workspace.defer(() => core.close());
  const db = new DatabaseSync(f.databasePath); db.exec('PRAGMA foreign_keys=ON'); f.workspace.defer(() => db.close());
  const at = Date.now(), iso = delta => new Date(at + delta).toISOString();
  const wire = (session,id,delta=0,ordinal=1,text='copper '+id) => {
    const input = f.request(id,text,ordinal); input.session_id = session; input.messages[0].occurred_at = delta === null ? null : iso(delta); return input;
  };
  let fetches = 0;
  const capture = input => captureLocal(configuration(f.config),input,{signal:new AbortController().signal,
    env:{SYNTHETIC_LOCAL_KEY:'synthetic_key_secret'},fetchImpl:() => { fetches++; assert.fail('Raw-only provider dispatch'); }});
  const remember = (sessionId='explicit-tool') => ok(core.admit({namespace:ns,memory:{content:'Synthetic retained fact',kind:'fact'},
    receipts:[{client:'claude-code',sessionId,eventId:'explicit-memory-event',role:'user',excerpt:'Synthetic retained fact'}]})).memory;
  const mutate = (action,memory) => core[action]({namespace:ns,memoryId:memory.id,expectedRevision:memory.revision,
    ...(action === 'correct' ? {content:'Synthetic corrected fact',kind:'fact',receipt:{client:'claude-code',sessionId:'explicit-tool',eventId:'correct-event',role:'user',excerpt:'Synthetic corrected fact'}} : {})});
  const sealedCount = () => db.prepare('SELECT count(*) n FROM raw_parts WHERE sealed IS NOT NULL').get().n;
  return {...f,path:f.databasePath,port:localPlainPort(),db,privacyCore:core,wire,capture,remember,mutate,sealedCount,iso,fetches:() => fetches};
}

test('Raw-only ignores keys and model-cost daily cap, acknowledges replay and stores no Memory',async t => {
  const f = localPrivacyFixture(t); f.config.usage.dailyCap = 1;
  for (let i=1;i<=4;i++) {
    const request = f.wire('raw-session','raw-'+i,0,i);
    const response = await f.capture(request); assert.equal(response.status,200,JSON.stringify(response));
    assert.equal(response.body.memoryCount,0); assert.equal((await f.capture(request)).status,200);
  }
  assert.equal(f.sealedCount(),4); assert.equal(f.fetches(),0); assert.equal(f.ledger(),null);
  assert.equal(f.db.prepare('SELECT count(*) n FROM memories').get().n,0);
});

test('Raw-only CLI never constructs the guarded model or any provider, even with a key',async t => {
  const f = fixture(t); f.config.interpretation = 'raw-only'; f.save();
  const preload = join(f.workspace.path,'forbid-provider.mjs');
  const loader = `export async function load(url,context,next){
    if(url.endsWith('/adapters/local/guarded-model.mjs'))return {format:'module',shortCircuit:true,source:
      "export function guardedModel(){throw Error('synthetic_guarded_constructor_forbidden')}"};
    if(url.endsWith('/adapters/openai/index.mjs'))return {format:'module',shortCircuit:true,source:
      "export function createOpenAIModel(){throw Error('synthetic_provider_constructor_forbidden')}"};
    return next(url,context);
  }`;
  const loaderUrl = 'data:text/javascript,'+encodeURIComponent(loader);
  writeFileSync(preload,`import {register} from 'node:module';register(${JSON.stringify(loaderUrl)});`,{mode:0o600});
  assert.equal(f.reply(await f.run(f.request(),{preloads:[preload],key:true})).status,200);
  assert.equal(f.calls().length,0); assert.equal(f.ledger(),null);
});

for (const control of ['pause','disabled','consent-generation','namespace-generation','source-exclusion','deleted','fenced','raw-cap','raw-toggle'])
test(`Raw-only ${control} refuses payload storage`,async t => {
  const f = localPrivacyFixture(t), input = f.wire('policy-session','policy');
  if (control === 'pause') ok(f.core.setCapturePaused({namespace:ns,expectedGeneration:'initial',paused:true}));
  if (control === 'disabled') {
    const c = ok(f.core.getLocalCaptureControl({namespace:ns,client:f.client}));
    ok(f.core.setLocalCaptureControl({namespace:ns,client:f.client,targetId:c.targetId,expectedStoreId:c.storeId,
      expectedRevision:c.revision,automaticCaptureEnabled:false,rawNoticeVersion:c.rawNoticeVersion}));
  }
  if (control === 'consent-generation') f.config.authority.expectedConsentGeneration = 'synthetic-stale';
  if (control === 'namespace-generation') f.config.authority.expectedNamespaceGeneration = 'synthetic-stale';
  if (control === 'fenced') ok(f.core.fenceSession({namespace:ns,client:f.client,sessionId:input.session_id}));
  if (control === 'raw-cap') f.config.raw.capBytes = 1;
  if (control === 'raw-toggle') ok(f.core.setRawCaptureControl({ownerId:ns.ownerId,client:f.client,enabled:false,expectedRevision:0}));
  if (['source-exclusion','deleted'].includes(control)) {
    const saved = await f.capture(input); assert.equal(saved.status,200);
    const id = saved.body.raw.conversationId;
    if (control === 'source-exclusion') f.db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,?)').run(id,input.messages[0].id,0,input.messages[0].content.length,1);
    else ok(f.core.deleteConversation({namespace:ns,conversationId:id,expectedRevision:saved.body.raw.revision,actionId:'synthetic-delete'}));
  }
  const before = f.sealedCount(), response = await f.capture(input);
  assert.equal(f.sealedCount(),before); assert.equal(f.fetches(),0);
  if (control === 'raw-cap') {
    assert.equal(response.status,200); assert.equal(response.body.raw.parts[0].reason,'quota_reached');
    const row = f.db.prepare('SELECT saved,reason,sealed FROM raw_parts').get();
    assert.equal(row.saved,0); assert.equal(row.reason,'quota_reached'); assert.equal(row.sealed,null);
  } else assert.ok(response.status>=400,JSON.stringify(response));
});

for (const firstMode of ['engine','raw-only']) test(`session mode remains ${firstMode} across replay, continuation and fresh configuration`,async t => {
  const f = localPrivacyFixture(t); f.config.interpretation = firstMode;
  // Whitespace exercises engine capture without a provider, but still binds mode.
  const input = f.wire('mode-session','mode-event',0,1,' ');
  assert.equal((await f.capture(input)).status,200);
  f.config.interpretation = firstMode === 'engine' ? 'raw-only' : 'engine';
  for (const request of [input,f.wire('mode-session','new-event',0,2,' ')]) {
    const result = await f.capture(request); assert.equal(result.status,409); assert.equal(result.body.error,'raw_session_mode_conflict');
  }
  // A new installation authority snapshot on the same store cannot reinterpret
  // an existing session, even with a fresh event and unchanged namespace.
  const c = ok(f.core.getLocalCaptureControl({namespace:ns,client:f.client}));
  const disabled = ok(f.core.setLocalCaptureControl({namespace:ns,client:f.client,targetId:c.targetId,expectedStoreId:c.storeId,
    expectedRevision:c.revision,automaticCaptureEnabled:false,rawNoticeVersion:c.rawNoticeVersion}));
  const granted = ok(f.core.setLocalCaptureControl({namespace:ns,client:f.client,targetId:c.targetId,expectedStoreId:c.storeId,
    expectedRevision:disabled.revision,automaticCaptureEnabled:true,rawNoticeVersion:c.rawNoticeVersion}));
  const fresh = structuredClone(f.config);
  Object.assign(fresh.authority,{expectedControlRevision:granted.revision,expectedConsentGeneration:granted.consentGeneration});
  const result = await captureLocal(configuration(fresh),f.wire('mode-session','fresh-install-event',0,2,' '),{signal:new AbortController().signal,env:{}});
  assert.equal(result.body.error,'raw_session_mode_conflict'); assert.equal(f.sealedCount(),1);
  Object.assign(f.config.authority,fresh.authority);
  assert.equal((await f.capture(f.wire('new-mode-session','new-session',0,1,' '))).status,200);
});

for (const firstMode of ['engine','raw-only']) test(`legacy ${firstMode} sessions keep their authenticated mode on a fresh local installation`,async t => {
  const f = localPrivacyFixture(t); f.config.interpretation = firstMode;
  const first = f.wire('legacy-mode-session','first-legacy',0,1,' ');
  assert.equal((await f.capture(first)).status,200);
  // Synthetic pre-feature store: captured bindings survive, mode rows do not.
  f.db.prepare('DELETE FROM local_raw_session_modes').run();
  const other = firstMode === 'engine' ? 'raw-only' : 'engine'; f.config.interpretation = other;
  assert.equal((await f.capture(f.wire('legacy-mode-session','new-legacy',0,2,' '))).body.error,'raw_session_mode_conflict');
  f.config.interpretation = firstMode;
  assert.equal((await f.capture(first)).status,200); assert.equal(f.sealedCount(),1);
});

for (const action of ['forget','correct']) test(`local ${action} hides whole overlapping sessions in both search intents`,async t => {
  installRawSearchTestClock(t);
  const f = localPrivacyFixture(t);
  const a = await f.capture(f.wire('S','A',-60000)), b = await f.capture(f.wire('S','B',7200000,2));
  const concurrent = await f.capture(f.wire('concurrent','concurrent-A',60000));
  const control = await f.capture(f.wire('T','control',-7200000));
  for (const value of [a,b,concurrent,control]) assert.equal(value.status,200,JSON.stringify(value));
  // Capture/receipt arrival time is irrelevant to matching the Raw event range.
  f.db.prepare("UPDATE raw_conversations SET first_received_at='2000-01-01T00:00:00.000Z',last_received_at='2000-01-01T00:00:00.000Z'").run();
  const s = await searchFixture(f); await s.maintain();
  for (const intent of ['current','history']) {
    const before = (await s.search({query:'copper',intent})).candidates;
    for (const id of ['message-A','message-B','message-concurrent-A','message-control'])
      assert.ok(before.some(row=>row.messageId===id), `${intent}: ${id} searchable before ${action}`);
  }
  ok(f.mutate(action,f.remember()));
  for (const intent of ['current','history']) {
    const hits = (await s.search({query:'copper',intent})).candidates;
    assert.ok(hits.some(row=>row.messageId==='message-control'));
    for (const id of ['message-A','message-B','message-concurrent-A'])
      assert.ok(!hits.some(row=>row.messageId===id), `${intent}: ${id} hidden after ${action}`);
    assert.ok(hits.every(row=>row.conversationId===control.body.raw.conversationId));
  }
  const before = f.sealedCount(); const refused = await f.capture(f.wire('S','after',14400000,3));
  assert.equal(refused.body.error,'conversation_deleted'); assert.equal(f.sealedCount(),before);
  assert.deepEqual(f.db.prepare('PRAGMA table_info(local_raw_hide_windows)').all().map(row=>row.name),['owner_id','scope','project_id','start_ms','end_ms']);
  assert.equal(f.db.prepare('SELECT count(*) n FROM local_raw_hide_windows').get().n,1);
  const window = f.db.prepare('SELECT * FROM local_raw_hide_windows').get(); assert.equal(window.end_ms-window.start_ms,2*LOCAL_RAW_HIDE_WINDOW_MS);
});

for (const action of ['forget','correct']) test(`${action} before capture durably fences arrivals, unknown times and explicit receipt sessions`,async t => {
  const f = localPrivacyFixture(t);
  assert.equal((await f.capture(f.wire('named-session','old-named',-86400000))).status,200);
  const m = f.remember('named-session'); ok(f.mutate(action,m)); const before = f.sealedCount();
  // Reopen the capture core on every call: windows cannot be process-local.
  for (const [session,delta] of [['later',0],['unknown',null],['named-session',-86400000]]) {
    const result = await f.capture(f.wire(session,session,delta)); assert.equal(result.body.error,'conversation_deleted',JSON.stringify(result));
    assert.equal(f.sealedCount(),before);
  }
  // Terminal fences also refuse later messages outside the window.
  assert.equal((await f.capture(f.wire('later','outside',86400000))).body.error,'conversation_deleted');
  assert.equal((await f.capture(f.wire('control','outside-control',86400000))).status,200);
});

test('local selection alone installs additive privacy storage; other constructors perform no privacy DDL',t => {
  const f = fixture(t), db = new DatabaseSync(f.databasePath); f.workspace.defer(()=>db.close());
  const count = () => db.prepare("SELECT count(*) n FROM sqlite_master WHERE name IN ('local_raw_hide_windows','local_raw_session_modes','local_raw_session_ranges')").get().n;
  assert.equal(count(),0);
  const plain = openMemoryCore({path:f.databasePath}); plain.close(); assert.equal(count(),0);
  const version = db.prepare('PRAGMA user_version').get().user_version;
  const local = openMemoryCore({path:f.databasePath,raw:true,rawSearch:false}); local.close(); assert.equal(count(),3);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,version);
});

for (const action of ['forget','correct']) for (const failure of ['window','fence'])
test(`${action} ${failure} failure rolls back memory, receipts, windows, fences and Raw`,async t => {
  const f = localPrivacyFixture(t); assert.equal((await f.capture(f.wire('S','before'))).status,200);
  const memory = f.remember();
  const tables = ['memories','receipts','raw_parts','raw_messages','raw_owner_usage','raw_session_fences','local_raw_hide_windows'];
  const snapshot = () => JSON.stringify(tables.map(table=>f.db.prepare('SELECT * FROM '+table).all()));
  const before = snapshot(), table = failure === 'window' ? 'local_raw_hide_windows' : 'raw_session_fences';
  f.db.exec(`CREATE TRIGGER synthetic_fail BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic injected failure'); END`);
  const result = f.mutate(action,memory); assert.equal(result.ok,false); assert.equal(result.error.code,'local_raw_privacy_write_failed');
  assert.equal(result.error.retryable,true); assert.equal(snapshot(),before);
  f.db.exec('DROP TRIGGER synthetic_fail'); ok(f.mutate(action,memory));
});

for (const action of ['forget','correct']) for (const anchor of ['memory','missing'])
test(`${action} without receipts uses memory times or fails loudly (${anchor})`,t => {
  const f = localPrivacyFixture(t), memory = f.remember(); f.db.prepare('DELETE FROM receipts WHERE memory_id=?').run(memory.id);
  if (anchor === 'missing') f.db.prepare("UPDATE memories SET created_at='',updated_at='' WHERE id=?").run(memory.id);
  else f.db.prepare('UPDATE memories SET created_at=?,updated_at=? WHERE id=?').run(f.iso(-86400000),f.iso(0),memory.id);
  const result = f.mutate(action,memory);
  if (anchor === 'memory') { ok(result); assert.deepEqual(f.db.prepare('SELECT start_ms,end_ms FROM local_raw_hide_windows ORDER BY start_ms').all().map(row=>[row.start_ms,row.end_ms]),[-86400000,0].map(delta=>[Date.parse(f.iso(delta))-LOCAL_RAW_HIDE_WINDOW_MS,Date.parse(f.iso(delta))+LOCAL_RAW_HIDE_WINDOW_MS])); }
  else {
    assert.equal(result.error.code,'local_raw_hide_anchor_missing');
    assert.equal(f.db.prepare('SELECT content FROM memories WHERE id=?').get(memory.id).content,'Synthetic retained fact');
    assert.equal(f.db.prepare('SELECT count(*) n FROM local_raw_hide_windows').get().n,0);
  }
});

for (const selection of ['none','explicit-raw']) for (const action of ['forget','correct'])
test(`${selection} ${action} leaves local windows and fences untouched`,t => {
  const f = localPrivacyFixture(t), memory = f.remember();
  const core = selection === 'explicit-raw' ? f.core : openMemoryCore({path:f.databasePath});
  if (selection === 'none') f.workspace.defer(()=>core.close());
  const statements = [];
  const result = traceSql(statements, () => core[action]({namespace:ns,memoryId:memory.id,expectedRevision:memory.revision,
    ...(action === 'correct' ? {content:'Synthetic other correction',kind:'fact',receipt:{client:'synthetic',sessionId:'other',eventId:'correct',role:'user',excerpt:'Synthetic other correction'}} : {})}));
  ok(result);
  assert.ok(statements.length > 0, 'trace must observe the mutation');
  assert.equal(statements.filter(sql=>/local_raw_|SELECT client,session_id,created_at FROM receipts|SELECT occurred_at FROM raw_messages WHERE conversation_id=/.test(sql)).length,0,
    'non-local forget/correct executes zero additional privacy SQL');
  assert.equal(f.db.prepare('SELECT count(*) n FROM local_raw_hide_windows').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_session_fences').get().n,0);
});

test('managed-window-race: localAuthority preserves the terminal arrival fence',async t => {
  const f = localPrivacyFixture(t), memory = f.remember(); let seals = 0;
  const core = openMemoryCore({path:f.path,rawSearch:false,rawConversations:{mode:'raw-v1',capBytes:1000000,configureCap:false,
    interpretation:'host',localAuthority:f.config.authority,readPolicy:()=>({generation:'synthetic',reason:null}),port:{...f.port,
      async sealRaw({text}) { seals++; ok(f.mutate('forget',memory)); return {format:'local-plain-v1',keyVersion:null,sealed:Buffer.from(text)}; }}}});
  f.workspace.defer(()=>core.close());
  const wire = f.wire('racing-session','racing-message');
  const result = await core.captureRaw({namespace:ns,client:f.client,sessionId:wire.session_id,eventId:wire.event_id,
    messages:wire.messages.map(m=>({id:m.id,role:m.role,occurredAt:m.occurred_at,messageOrdinal:m.message_ordinal,content:m.content,part:m.part}))});
  assert.equal(seals,1); assert.equal(result.error.code,'conversation_deleted'); assert.equal(f.sealedCount(),0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_session_fences').get().n,1);
  assert.equal((await f.capture(f.wire('racing-session','outside-race',86400000))).body.error,'conversation_deleted');
});

test('session event-time range includes gaps, while window lookup stays namespace scoped and indexed',async t => {
  const f = localPrivacyFixture(t);
  const other = {...ns,ownerId:'synthetic-other-owner'};
  ok(await f.privacyCore.captureRaw({namespace:other,client:f.client,sessionId:'other-owner-session',eventId:'other-owner-event',
    messages:[{id:'other-owner-message',role:'user',occurredAt:f.iso(0),messageOrdinal:1,content:' ',part:{index:0,start:0,totalUnits:1,totalBytes:1}}]}));
  assert.equal((await f.capture(f.wire('gap-session','gap-first',-7200000))).status,200);
  assert.equal((await f.capture(f.wire('gap-session','gap-last',7200000,2))).status,200);
  assert.equal((await f.capture(f.wire('unknown-session','unknown-first',null))).status,200);
  const version = f.db.prepare('PRAGMA user_version').get().user_version;
  ok(f.mutate('forget',f.remember()));
  for (const session of ['gap-session','unknown-session']) assert.equal((await f.capture(f.wire(session,'after-'+session,86400000,3))).body.error,'conversation_deleted');
  const plan = f.db.prepare(`EXPLAIN QUERY PLAN SELECT end_ms FROM local_raw_hide_windows WHERE owner_id=? AND scope=? AND project_id=? AND start_ms<=? ORDER BY start_ms DESC LIMIT 1`)
    .all(ns.ownerId,ns.scope,'',Date.now());
  assert.ok(plan.some(row=>/SEARCH.*INDEX/.test(row.detail))); assert.ok(plan.every(row=>!/SCAN|TEMP B-TREE/.test(row.detail)));
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,version);
  assert.equal(f.db.prepare('SELECT count(*) n FROM local_raw_hide_windows WHERE owner_id=?').get(other.ownerId).n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_session_fences WHERE owner_id=?').get(other.ownerId).n,0);
});

// Trace actual native calls synchronously; all fault hooks are restored before
// async search or other fixture work. Tests in this file run serially.
function traceSql(statements, work) {
  const prepare = DatabaseSync.prototype.prepare, exec = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.prepare = function(sql) { statements.push(sql); return Reflect.apply(prepare,this,[sql]); };
  DatabaseSync.prototype.exec = function(sql) { statements.push(sql); return Reflect.apply(exec,this,[sql]); };
  const restore=()=>{DatabaseSync.prototype.prepare=prepare; DatabaseSync.prototype.exec=exec;};
  try { const result=work(); if(result?.then)return result.finally(restore); restore(); return result; }
  catch(error){restore();throw error;}
}
function coreRequest(f, wire) {
  return {namespace:ns,client:f.client,sessionId:wire.session_id,eventId:wire.event_id,
    messages:wire.messages.map(m=>({id:m.id,role:m.role,occurredAt:m.occurred_at,messageOrdinal:m.message_ordinal,content:m.content,part:{...m.part}}))};
}
function managedCore(f, port=f.port, interpretation='host', extra={}) {
  const core = openMemoryCore({path:f.path,rawSearch:false,...extra,rawConversations:{mode:'raw-v1',capBytes:1000000,configureCap:false,
    interpretation,localAuthority:f.config.authority,readPolicy:()=>({generation:'synthetic',reason:null}),port}});
  f.workspace.defer(()=>{ try {core.close();} catch { /* Connection-loss injection. */ } });
  return core;
}
let syntheticWindowSequence=0;
function windowAt(f,delta=0) {
  const content='Synthetic window anchor '+(++syntheticWindowSequence);
  const memory = ok(f.privacyCore.admit({namespace:ns,memory:{content,kind:'fact'},receipts:[{client:f.client,sessionId:'explicit-tool',eventId:'anchor-'+syntheticWindowSequence,role:'user',excerpt:content}]})).memory;
  f.db.prepare('UPDATE receipts SET created_at=? WHERE memory_id=?').run(f.iso(delta),memory.id);
  ok(f.mutate('forget',memory));
}

for (const failure of ['seal','after-seal']) test(`managed-window-race exception ${failure} uses detached original arrival identity`,async t => {
  const f=localPrivacyFixture(t), memory=f.remember();
  const wire=f.wire('exception-session','exception-message'); let request;
  const core=managedCore(f,{...f.port,async sealRaw(value) {
    ok(f.mutate('forget',memory));
    // Mutation of the caller object after preparation must not change its fence.
    wire.session_id='caller-mutated-session';
    request.sessionId='mutated-direct-request'; request.messages[0].occurredAt=f.iso(86400000);
    if(failure==='seal')throw Error('synthetic seal failure');
    const current=ok(f.core.getLocalCaptureControl({namespace:ns,client:f.client}));
    ok(f.core.setLocalCaptureControl({namespace:ns,client:f.client,targetId:current.targetId,expectedStoreId:current.storeId,
      expectedRevision:current.revision,automaticCaptureEnabled:false,rawNoticeVersion:current.rawNoticeVersion}));
    return f.port.sealRaw(value);
  }});
  request=coreRequest(f,wire); const original=request.sessionId;
  const result=await core.captureRaw(request);
  assert.equal(result.error.code,'conversation_deleted'); assert.equal(f.sealedCount(),0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_session_fences').get().n,1);
  assert.equal(original,'exception-session');
});

for (const path of ['raw-only','ordinary','episode']) test(`managed-window-race ${path} commit writes only the terminal decision`,async t=>{
  const f=localPrivacyFixture(t), memory=f.remember(); let seals=0;
  const core=managedCore(f,{...f.port,async sealRaw(value) { seals++; ok(f.mutate('forget',memory)); return f.port.sealRaw(value); }},
    path==='raw-only'?'host':'engine',{model:{contextWindow:8192,countTokens:()=>1,extract:async()=>({items:[]})},
      ...(path==='episode'?{captureQualification:'source-bound-v2',captureEvidence:'staged-v1',sessionEpisodes:{mode:'episode-v1',draftEveryBatches:3}}:{})});
  const wire=f.wire('atomic-session','atomic-message');
  const request=coreRequest(f,wire);
  if(path==='episode')request.episodeContext={clientLabel:'Synthetic',generation:'initial',origin:'ordinary'};
  const result=await core.captureRaw(request);
  assert.equal(seals,1); assert.equal(result.error.code,'conversation_deleted');
  for(const table of ['raw_parts','raw_messages','raw_conversations','raw_events','raw_capture_events','admission_claims','local_raw_session_modes','local_raw_session_ranges'])
    assert.equal(f.db.prepare('SELECT count(*) n FROM '+table).get().n,0,table);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_session_fences').get().n,1);
});

for(const cutAt of ['decision-commit','rollback'])test(`rollback-crash-cut: connection loss after ${cutAt} preserves the terminal decision`,async t=>{
  const f=localPrivacyFixture(t), memory=f.remember(); let cut=false,lost=false,rollbacks=0;
  const core=managedCore(f,{...f.port,async sealRaw(value){ok(f.mutate('forget',memory));cut=true;return f.port.sealRaw(value);}});
  const native=DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec=function(sql){
    const result=Reflect.apply(native,this,[sql]);
    if(cut && sql==='ROLLBACK') {rollbacks++;this.close();lost=true;cut=false;}
    // With the fix there is no capture rollback. Lose the connection at the
    // first completed decision instead, before any response/fallback SQL.
    else if(cut && sql==='COMMIT'){
      if(cutAt==='rollback') {
        // Exercise a real rollback/connection-loss cut after the decision. An
        // old overlap rollback hits the branch above BEFORE any fence commits.
        this.exec('BEGIN IMMEDIATE'); this.exec('ROLLBACK');
      } else {this.close();lost=true;cut=false;}
    }
    return result;
  };
  try {await core.captureRaw(coreRequest(f,f.wire('lost-race','lost-batch')));}
  catch { /* Loss may prevent the response too. */ }
  finally {DatabaseSync.prototype.exec=native;}
  assert.equal(lost,true); assert.equal(rollbacks,cutAt==='rollback'?1:0,'overlap commits before any rollback/loss cut');
  assert.equal(f.sealedCount(),0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_session_fences').get().n,1);
  const result=await f.capture(f.wire('lost-race','outside-after-reopen',7200000,2));
  assert.equal(result.body.error,'conversation_deleted'); assert.equal(f.sealedCount(),0);
});

test('late-session-range: a late batch straddling a window is refused in full',async t=>{
  const f=localPrivacyFixture(t); windowAt(f);
  const wire=f.wire('late-gap','before',-7200000);
  wire.messages.push(...f.wire('late-gap','after',7200000,2).messages);
  const result=await f.capture(wire);
  assert.equal(result.body.error,'conversation_deleted'); assert.equal(f.sealedCount(),0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM local_raw_session_ranges').get().n,0);
  assert.equal((await f.capture(f.wire('late-gap','later',86400000,3))).body.error,'conversation_deleted');
});

test('ongoing-session-range: persisted endpoint plus continuation crosses a later window',async t=>{
  installRawSearchTestClock(t);
  const f=localPrivacyFixture(t); assert.equal((await f.capture(f.wire('ongoing-gap','before',-7200000))).status,200);
  const search=await searchFixture(f); await search.maintain();
  for(const intent of ['current','history'])assert.ok((await search.search({query:'copper',intent})).candidates.some(row=>row.messageId==='message-before'));
  windowAt(f);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_session_fences').get().n,0);
  const result=await f.capture(f.wire('ongoing-gap','after',7200000,2));
  assert.equal(result.body.error,'conversation_deleted'); assert.equal(f.sealedCount(),1);
  for(const intent of ['current','history'])assert.ok(!(await search.search({query:'copper',intent})).candidates.some(row=>row.messageId==='message-before'));
  const range=f.db.prepare('SELECT * FROM local_raw_session_ranges').get();
  assert.equal(range.min_ms,Date.parse(f.iso(-7200000))); assert.equal(range.max_ms,range.min_ms,'refused batch never extends persisted metadata');
});

test('known limit: uncorrelated-receipt-clock leaves an older conversation searchable until direct deletion',async t=>{
  installRawSearchTestClock(t);
  const f=localPrivacyFixture(t), capture=await f.capture(f.wire('older-source','old-source',-7200000)); assert.equal(capture.status,200);
  const search=await searchFixture(f); await search.maintain();
  for(const intent of ['current','history'])assert.ok((await search.search({query:'copper',intent})).candidates.some(row=>row.messageId==='message-old-source'));
  windowAt(f);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_session_fences').get().n,0);
  for(const intent of ['current','history'])assert.ok((await search.search({query:'copper',intent})).candidates.some(row=>row.messageId==='message-old-source'));
  ok(f.core.deleteConversation({namespace:ns,conversationId:capture.body.raw.conversationId,expectedRevision:capture.body.raw.revision,actionId:'synthetic-direct-delete'}));
  for(const intent of ['current','history'])assert.ok(!(await search.search({query:'copper',intent})).candidates.some(row=>row.messageId==='message-old-source'));
});

test('correct uses only old receipt clocks, separately from the replacement receipt clock',async t=>{
  installRawSearchTestClock(t);
  const f=localPrivacyFixture(t);
  assert.equal((await f.capture(f.wire('old-clock','old-clock',-86400000))).status,200);
  assert.equal((await f.capture(f.wire('new-clock','new-clock',0))).status,200);
  const memory=f.remember(); f.db.prepare('UPDATE receipts SET created_at=? WHERE memory_id=?').run(f.iso(-86400000),memory.id);
  const search=await searchFixture(f); await search.maintain();
  for(const intent of ['current','history'])for(const id of ['message-old-clock','message-new-clock'])
    assert.ok((await search.search({query:'copper',intent})).candidates.some(row=>row.messageId===id));
  ok(f.mutate('correct',memory));
  const windows=f.db.prepare('SELECT start_ms,end_ms FROM local_raw_hide_windows').all();
  assert.deepEqual(windows.map(row=>[row.start_ms,row.end_ms]),[[Date.parse(f.iso(-86400000))-LOCAL_RAW_HIDE_WINDOW_MS,Date.parse(f.iso(-86400000))+LOCAL_RAW_HIDE_WINDOW_MS]]);
  assert.ok(Date.parse(f.db.prepare('SELECT created_at FROM receipts WHERE memory_id=?').get(memory.id).created_at)>windows[0].end_ms);
  for(const intent of ['current','history']){
    const hits=(await search.search({query:'copper',intent})).candidates;
    assert.ok(!hits.some(row=>row.messageId==='message-old-clock')); assert.ok(hits.some(row=>row.messageId==='message-new-clock'));
  }
});

for(const action of ['forget','correct'])for(const receipts of ['invalid','mixed','no-anchor'])
test(`${action} tolerates invalid receipt clocks unless no anchor exists (${receipts})`,t=>{
  const f=localPrivacyFixture(t), memory=f.remember();
  f.db.prepare("UPDATE receipts SET created_at='invalid' WHERE memory_id=?").run(memory.id);
  const before=f.db.prepare('SELECT * FROM memories WHERE id=?').get(memory.id);
  if(receipts==='mixed') {
    const attached=ok(f.privacyCore.admit({namespace:ns,memory:{content:before.content,kind:'fact'},receipts:[{
      client:f.client,sessionId:'explicit-tool',eventId:'valid-clock',role:'user',excerpt:before.content}]})).memory;
    assert.equal(attached.id,memory.id);
    f.db.prepare("UPDATE receipts SET created_at=? WHERE memory_id=? AND event_id='valid-clock'").run(f.iso(0),memory.id);
  }
  f.db.prepare('UPDATE memories SET created_at=?,updated_at=? WHERE id=?').run(f.iso(-172800000),f.iso(-86400000),memory.id);
  if(receipts==='no-anchor')f.db.prepare("UPDATE memories SET created_at='',updated_at='' WHERE id=?").run(memory.id);
  const snapshot=f.db.prepare('SELECT * FROM memories WHERE id=?').get(memory.id);
  const result=f.mutate(action,snapshot);
  if(receipts==='no-anchor') {
    assert.equal(result.error.code,'local_raw_hide_anchor_missing');
    assert.deepEqual(f.db.prepare('SELECT * FROM memories WHERE id=?').get(memory.id),snapshot);
    assert.equal(f.db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(memory.id).n,1);
    assert.equal(f.db.prepare('SELECT count(*) n FROM local_raw_hide_windows').get().n,0);
  } else {
    ok(result);
    const anchors=[-172800000,-86400000,...(receipts==='mixed'?[0]:[])];
    assert.deepEqual(f.db.prepare('SELECT start_ms,end_ms FROM local_raw_hide_windows ORDER BY start_ms').all().map(r=>[r.start_ms,r.end_ms]),
      anchors.map(delta=>[Date.parse(f.iso(delta))-LOCAL_RAW_HIDE_WINDOW_MS,Date.parse(f.iso(delta))+LOCAL_RAW_HIDE_WINDOW_MS]));
  }
});

test('historical memory forget still hides; already-forgotten memory refuses without new windows',async t=>{
  const f=localPrivacyFixture(t); assert.equal((await f.capture(f.wire('history-session','history'))).status,200);
  const memory=f.remember(); f.db.prepare("UPDATE memories SET currentness='historical' WHERE id=?").run(memory.id);
  ok(f.mutate('forget',memory)); const windows=f.db.prepare('SELECT * FROM local_raw_hide_windows').all();
  assert.equal(windows.length,1); assert.equal(f.db.prepare('SELECT count(*) n FROM raw_session_fences').get().n,1);
  assert.equal(f.mutate('forget',memory).error.code,'memory_not_found');
  assert.deepEqual(f.db.prepare('SELECT * FROM local_raw_hide_windows').all(),windows);
});

for(const action of ['forget','correct'])test(`${action} leaves a second namespace under the same owner searchable and capturable`,async t=>{
  installRawSearchTestClock(t);
  const f=localPrivacyFixture(t), other={...ns,scope:'project',projectId:'synthetic-other-project'};
  const otherCore=managedNamespaceCore(f,other);
  const first=coreRequest(f,f.wire('other-session','other-namespace')); first.namespace=other;
  ok(await otherCore.captureRaw(first));
  const search=await searchFixture(f,{readSet:[other]}); await search.maintain();
  for(const intent of ['current','history'])assert.ok((await search.search({query:'copper',intent})).candidates.some(row=>row.messageId==='message-other-namespace'));
  ok(f.mutate(action,f.remember()));
  for(const intent of ['current','history'])assert.ok((await search.search({query:'copper',intent})).candidates.some(row=>row.messageId==='message-other-namespace'));
  const next=coreRequest(f,f.wire('other-session','other-next',0,2)); next.namespace=other;
  ok(await otherCore.captureRaw(next));
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_session_fences WHERE owner_id=? AND scope=? AND project_id=?').get(ns.ownerId,other.scope,other.projectId).n,0);
});

for(const when of ['forget','arrival'])test(`new ${when} fence releases pending reservations`,async t=>{
  const f=localPrivacyFixture(t), wire=f.wire('pending-session','pending',-7200000);
  wire.messages[0].part.totalUnits+=20; wire.messages[0].part.totalBytes+=20;
  assert.equal((await f.capture(wire)).status,200);
  assert.equal(f.db.prepare('SELECT reserved_bytes FROM raw_owner_usage').get().reserved_bytes,20);
  if(when==='forget')windowAt(f,-7200000);
  else {
    windowAt(f);
    // The pending first part has a consistent old time; a new message extends
    // the session range. Range refusal takes priority over unfinished-tail checks.
    assert.equal((await f.capture(f.wire('pending-session','next',7200000,2))).body.error,'conversation_deleted');
  }
  assert.equal(f.db.prepare('SELECT reserved_bytes FROM raw_owner_usage').get().reserved_bytes,0);
  const pending=f.db.prepare('SELECT assembly_state,reason,reserved_bytes FROM raw_messages').get();
  assert.deepEqual({...pending},{assembly_state:'closed',reason:'capture_barrier',reserved_bytes:0});
});

test('revocation between seal and commit stores no payload or batch metadata',async t=>{
  const f=localPrivacyFixture(t); let seals=0;
  const core=managedCore(f,{...f.port,async sealRaw(value){
    seals++; const current=ok(f.core.getLocalCaptureControl({namespace:ns,client:f.client}));
    ok(f.core.setLocalCaptureControl({namespace:ns,client:f.client,targetId:current.targetId,expectedStoreId:current.storeId,
      expectedRevision:current.revision,automaticCaptureEnabled:false,rawNoticeVersion:current.rawNoticeVersion}));
    return f.port.sealRaw(value);
  }});
  const result=await core.captureRaw(coreRequest(f,f.wire('revoked','revoked')));
  assert.equal(seals,1); assert.equal(result.error.code,'capture_disabled'); assert.equal(f.sealedCount(),0);
  for(const table of ['raw_parts','raw_capture_events','admission_claims','local_raw_session_ranges'])assert.equal(f.db.prepare('SELECT count(*) n FROM '+table).get().n,0);
});

for(const delta of [-LOCAL_RAW_HIDE_WINDOW_MS,LOCAL_RAW_HIDE_WINDOW_MS])test(`exact window endpoint ${delta} is inclusive on arrival and forget`,async t=>{
  const f=localPrivacyFixture(t);
  assert.equal((await f.capture(f.wire('existing-endpoint','existing-endpoint',delta))).status,200);
  windowAt(f);
  assert.equal((await f.capture(f.wire('late-endpoint','late-endpoint',delta))).body.error,'conversation_deleted');
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_session_fences').get().n,2);
});

test('overlapping, touching and disjoint windows coalesce without filling gaps',t=>{
  const f=localPrivacyFixture(t), w=LOCAL_RAW_HIDE_WINDOW_MS;
  windowAt(f,0); windowAt(f,w); windowAt(f,3*w); windowAt(f,7*w);
  assert.deepEqual(f.db.prepare('SELECT start_ms,end_ms FROM local_raw_hide_windows ORDER BY start_ms').all().map(row=>[row.start_ms,row.end_ms]),
    [[Date.parse(f.iso(-w)),Date.parse(f.iso(4*w))],[Date.parse(f.iso(6*w)),Date.parse(f.iso(8*w))]]);
});

for(const via of ['arrival','forget'])test(`legacy range fallback scans only sessions without metadata (${via})`,async t=>{
  const f=localPrivacyFixture(t);
  assert.equal((await f.capture(f.wire('legacy-range','old-range',-7200000))).status,200);
  f.db.prepare('DELETE FROM local_raw_session_ranges').run();
  if(via==='arrival')assert.equal((await f.capture(f.wire('legacy-range','new-range',7200000,2))).status,200);
  else windowAt(f);
  const range=f.db.prepare('SELECT min_ms,max_ms,unknown_time FROM local_raw_session_ranges').get();
  assert.equal(range.min_ms,Date.parse(f.iso(-7200000))); assert.equal(range.unknown_time,1);
  if(via==='arrival') { assert.equal(range.max_ms,Date.parse(f.iso(7200000))); windowAt(f); }
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_session_fences').get().n,1);
  const trace=[]; traceSql(trace,()=>windowAt(f,86400000));
  assert.equal(trace.filter(sql=>sql==='SELECT occurred_at FROM raw_messages WHERE conversation_id=?').length,0,'known ranges never rescan message histories');
});

test('ordinary missing event time keeps its Raw fallback and separately persists unknown range state',async t=>{
  const f=localPrivacyFixture(t);
  const before=new Date().toISOString();
  await f.privacyCore.capture({namespace:ns,client:f.client,sessionId:'ordinary-time',eventId:'ordinary-time',messages:[{id:'ordinary-time',role:'user',content:'Synthetic ordinary time'}]});
  const after=new Date().toISOString(), row=f.db.prepare('SELECT occurred_at FROM raw_messages').get();
  assert.ok(row.occurred_at>=before && row.occurred_at<=after);
  assert.equal(f.db.prepare('SELECT unknown_time FROM local_raw_session_ranges').get().unknown_time,1);
  windowAt(f,86400000);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_session_fences').get().n,1);
});

function seedLegacyHistory(f, count, mixed=false) {
  const event=f.db.prepare('SELECT * FROM raw_capture_events LIMIT 1').get();
  const raw=f.db.prepare('SELECT * FROM raw_events LIMIT 1').get();
  const copyRaw=f.db.prepare(`INSERT INTO raw_events(owner_id,scope,project_id,client,event_id,digest,conversation_id,policy,result) VALUES(?,?,?,?,?,?,?,?,?)`);
  const copyCapture=f.db.prepare(`INSERT INTO raw_capture_events(owner_id,scope,project_id,client,event_id,conversation_id,session_key,
    first_message_ids,eligible_message_ids,projection_digest,binding_digest,capture_generation) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  f.db.exec('BEGIN IMMEDIATE');
  try {
    for(let i=1;i<count;i++){
      const id='synthetic-legacy-'+String(i).padStart(5,'0');
      const projection=createHash('sha256').update(JSON.stringify(['raw-capture-host-empty-v1',event.session_key,id,
        JSON.parse(event.first_message_ids),event.binding_digest])).digest('hex');
      copyRaw.run(raw.owner_id,raw.scope,raw.project_id,raw.client,id,raw.digest,raw.conversation_id,raw.policy,raw.result);
      copyCapture.run(event.owner_id,event.scope,event.project_id,event.client,id,event.conversation_id,event.session_key,
        event.first_message_ids,event.eligible_message_ids,mixed && i===count-1?'synthetic-engine-projection':projection,event.binding_digest,event.capture_generation);
    }
    f.db.prepare('DELETE FROM local_raw_session_modes').run(); f.db.exec('COMMIT');
  } catch(error){f.db.exec('ROLLBACK');throw error;}
}

for(const history of ['many','overflow','mixed'])test(`indexed bounded legacy classification: ${history} history`,async t=>{
  const f=localPrivacyFixture(t);
  assert.equal((await f.capture(f.wire('legacy-long','seed',-7200000))).status,200);
  seedLegacyHistory(f,history==='mixed'?200:history==='overflow'?LOCAL_RAW_LEGACY_EVENT_LIMIT+1:LOCAL_RAW_LEGACY_EVENT_LIMIT,history==='mixed');
  const statements=[];
  const result=await traceSql(statements,()=>f.capture(f.wire('legacy-long','continuation',-3600000,2)));
  const selects=statements.filter(sql=>/FROM raw_capture_events WHERE.*session_key=\?/s.test(sql));
  assert.ok(selects.length>0); assert.ok(selects.every(sql=>/ORDER BY event_id LIMIT \?/.test(sql)));
  if(history==='many'){
    assert.equal(result.status,200); assert.equal(f.sealedCount(),2);
    const steady=[]; assert.equal((await traceSql(steady,()=>f.capture(f.wire('legacy-long','steady',0,3)))).status,200);
    assert.equal(steady.filter(sql=>/FROM raw_capture_events WHERE.*session_key=\?/s.test(sql)).length,0);
  } else {
    assert.equal(result.body.error,history==='overflow'?'raw_session_mode_history_limit':'raw_session_mode_conflict');
    assert.equal(f.sealedCount(),1); assert.equal(f.db.prepare('SELECT count(*) n FROM local_raw_session_modes').get().n,0);
    // Retry must remain bounded and explicit, never partially bind the mode.
    assert.equal((await f.capture(f.wire('legacy-long','retry',0,3))).body.error,result.body.error);
    if(history==='mixed'){
      f.config.interpretation='engine';
      assert.equal((await f.capture(f.wire('legacy-long','engine-retry',0,3,' '))).body.error,'raw_session_mode_conflict');
    }
  }
  const fresh=[]; f.config.interpretation='raw-only';
  assert.equal((await traceSql(fresh,()=>f.capture(f.wire('provably-new','fresh',0)))).status,200);
  assert.equal(fresh.filter(sql=>/FROM raw_capture_events WHERE.*session_key=\?/s.test(sql)).length,0,'fresh session never reads the namespace event history');
});

test('EXPLAIN QUERY PLAN: arrival, forget overlap/fallback and fresh/long/mixed classification',async t=>{
  const f=localPrivacyFixture(t);
  assert.equal((await f.capture(f.wire('plan-session','plan-event',-7200000))).status,200);
  seedLegacyHistory(f,200,true);
  const session=f.db.prepare('SELECT session_key FROM raw_conversations').get().session_key;
  const boundary=[ns.ownerId,ns.scope,''], identity=[...boundary,f.client,session], end=Date.parse(f.iso(0));
  const queries=[
    ['arrival range',`SELECT min_ms,max_ms,unknown_time FROM local_raw_session_ranges WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND session_key=?`,identity,/sqlite_autoindex_local_raw_session_ranges/],
    ['arrival predecessor',`SELECT end_ms FROM local_raw_hide_windows WHERE owner_id=? AND scope=? AND project_id=? AND start_ms<=? ORDER BY start_ms DESC LIMIT 1`,[...boundary,end],/sqlite_autoindex_local_raw_hide_windows/],
    ['arrival unknown',`SELECT 1 FROM local_raw_hide_windows WHERE owner_id=? AND scope=? AND project_id=? LIMIT 1`,boundary,/sqlite_autoindex_local_raw_hide_windows/],
    ['forget overlap',`SELECT client,session_key FROM local_raw_session_ranges WHERE owner_id=? AND scope=? AND project_id=? AND unknown_time=0 AND min_ms<=? AND max_ms>=?
      UNION ALL SELECT client,session_key FROM local_raw_session_ranges WHERE owner_id=? AND scope=? AND project_id=? AND unknown_time=1`,[...boundary,end+LOCAL_RAW_HIDE_WINDOW_MS,end-LOCAL_RAW_HIDE_WINDOW_MS,...boundary],/local_raw_range_overlap/],
    ['forget missing ranges',`SELECT c.client,c.session_key FROM raw_conversations c LEFT JOIN local_raw_session_ranges r
      ON r.owner_id=c.owner_id AND r.scope=c.scope AND r.project_id=c.project_id AND r.client=c.client AND r.session_key=c.session_key
      WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND r.session_key IS NULL`,boundary,/sqlite_autoindex_raw_conversations/],
    ['range fallback conversation / classification fresh',`SELECT id FROM raw_conversations WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND session_key=?`,[...boundary,f.client,'synthetic-new-key'],/sqlite_autoindex_raw_conversations/],
    ['range fallback messages',`SELECT occurred_at FROM raw_messages WHERE conversation_id=?`,[f.db.prepare('SELECT id FROM raw_conversations').get().id],/sqlite_autoindex_raw_messages/],
    ['classification mode',`SELECT interpretation FROM local_raw_session_modes WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND session_key=?`,identity,/sqlite_autoindex_local_raw_session_modes/],
    ['classification long/mixed',`SELECT event_id,first_message_ids,eligible_message_ids,projection_digest,binding_digest FROM raw_capture_events
      WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND session_key=? ORDER BY event_id LIMIT ?`,[...identity,LOCAL_RAW_LEGACY_EVENT_LIMIT+1],/local_raw_capture_session_events/],
    ['window coalescing',`SELECT start_ms,end_ms FROM local_raw_hide_windows WHERE owner_id=? AND scope=? AND project_id=? AND start_ms<=? AND end_ms>=?`,[...boundary,end+LOCAL_RAW_HIDE_WINDOW_MS,end-LOCAL_RAW_HIDE_WINDOW_MS],/sqlite_autoindex_local_raw_hide_windows/],
  ];
  for(const [label,sql,args,index] of queries){
    const details=f.db.prepare('EXPLAIN QUERY PLAN '+sql).all(...args).map(row=>row.detail);
    t.diagnostic(label+': '+JSON.stringify(details));
    assert.ok(details.some(detail=>index.test(detail)),label+': '+details.join('; '));
    assert.ok(details.every(detail=>!/\bSCAN\b|TEMP B-TREE/.test(detail)),label+': '+details.join('; '));
    if(label==='forget overlap')assert.equal(details.filter(detail=>/local_raw_range_overlap/.test(detail)).length,2,'both time and unknown branches use the range index');
    if(label==='forget missing ranges')assert.ok(details.some(detail=>/sqlite_autoindex_local_raw_session_ranges/.test(detail)));
  }
});

function managedNamespaceCore(f,namespace) {
  const client=f.client, current=ok(f.core.getLocalCaptureControl({namespace,client}));
  const granted=ok(f.core.setLocalCaptureControl({namespace,client,targetId:'synthetic-other-target',expectedStoreId:current.storeId,
    expectedRevision:current.revision,automaticCaptureEnabled:true,rawNoticeVersion:'local-plain-v1'}));
  const authority={...f.config.authority,namespace,targetId:granted.targetId,expectedControlRevision:granted.revision,
    expectedConsentGeneration:granted.consentGeneration,expectedNamespaceGeneration:ok(f.core.getCaptureControl({namespace})).generation};
  const core=openMemoryCore({path:f.path,rawSearch:false,rawConversations:{mode:'raw-v1',capBytes:1000000,configureCap:false,
    interpretation:'host',localAuthority:authority,readPolicy:()=>({generation:'synthetic',reason:null}),port:f.port}});
  f.workspace.defer(()=>core.close()); return core;
}

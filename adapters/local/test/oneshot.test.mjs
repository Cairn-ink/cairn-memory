import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
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
import { LOCAL_RAW_HIDE_WINDOW_MS } from '../../../core/local-authority-storage.mjs';

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
  assert.ok((await s.search({query:'copper'})).candidates.some(row=>row.conversationId===a.body.raw.conversationId));
  ok(f.mutate(action,f.remember()));
  for (const intent of ['current','history']) {
    const hits = (await s.search({query:'copper',intent})).candidates;
    assert.ok(hits.length>0); assert.ok(hits.every(row=>row.conversationId===control.body.raw.conversationId));
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
  const count = () => db.prepare("SELECT count(*) n FROM sqlite_master WHERE name IN ('local_raw_hide_windows','local_raw_session_modes')").get().n;
  assert.equal(count(),0);
  const plain = openMemoryCore({path:f.databasePath}); plain.close(); assert.equal(count(),0);
  const version = db.prepare('PRAGMA user_version').get().user_version;
  const local = openMemoryCore({path:f.databasePath,raw:true,rawSearch:false}); local.close(); assert.equal(count(),2);
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
  const result = f.mutate(action,memory);
  if (anchor === 'memory') { ok(result); assert.ok(f.db.prepare('SELECT count(*) n FROM local_raw_hide_windows').get().n>=1); }
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
  ok(core[action]({namespace:ns,memoryId:memory.id,expectedRevision:memory.revision,
    ...(action === 'correct' ? {content:'Synthetic other correction',kind:'fact',receipt:{client:'synthetic',sessionId:'other',eventId:'correct',role:'user',excerpt:'Synthetic other correction'}} : {})}));
  assert.equal(f.db.prepare('SELECT count(*) n FROM local_raw_hide_windows').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_session_fences').get().n,0);
});

test('local window committed during sealing refuses the capture and preserves the terminal arrival fence',async t => {
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

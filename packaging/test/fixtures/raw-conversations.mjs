// Synthetic trusted host only. All engine imports resolve inside the installation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import promises from 'node:fs/promises';
import { register, syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

const [phase,installed,path,statePath,client,trace] = process.argv.slice(2);
assert.ok(['create','resume','delete','restart-deleted'].includes(phase));
assert.ok(['claude-code','codex'].includes(client));
let modelCalls = 0, networkCalls = 0, policyCalls = 0;
const forbidden = () => { networkCalls++; assert.fail('Synthetic installed lifecycle forbids network'); };
globalThis.fetch=forbidden;
http.request=http.get=https.request=https.get=net.connect=net.createConnection=net.Socket.prototype.connect=forbidden;
for (const key of ['OPENAI_API_KEY','ANTHROPIC_API_KEY','NODE_OPTIONS','npm_config_userconfig']) assert.equal(process.env[key],undefined);
fs.writeFileSync(trace,'',{ flag:'wx',mode:0o600 });
const append = row => fs.appendFileSync(trace,JSON.stringify(row)+'\n');
for (const api of [fs,promises]) for (const method of ['readFileSync','readFile']) {
  if (typeof api[method]!=='function') continue;
  const original = api[method];
  api[method]=function(value,...args) {
    const file = value instanceof URL ? fileURLToPath(value):String(value);
    if (file.startsWith(installed+'/')) append({ kind:'asset',path:file });
    return original.call(this,value,...args);
  };
}
syncBuiltinESMExports();
const loader = `import {appendFileSync} from 'node:fs';import {fileURLToPath} from 'node:url';
let data;export function initialize(value){data=value}
export async function resolve(specifier,context,next){const result=await next(specifier,context);
if(result.url.startsWith('file:')){const path=fileURLToPath(result.url);
if(!path.startsWith(data.allowed+'/'))throw Error('installed_fixture_source_fallback');
appendFileSync(data.trace,JSON.stringify({kind:'module',path})+'\\n');}return result}`;
register('data:text/javascript,'+encodeURIComponent(loader),{ parentURL:import.meta.url,data:{ allowed:dirname(installed),trace } });
const importedCore = join(installed,'core/index.mjs');
const { openMemoryCore } = await import(pathToFileURL(importedCore).href);
const namespace = { ownerId:'synthetic-installed-raw',scope:'personal',projectId:null };
const text = 'Synthetic Raw prefix:\n'+'  Ａ🙂\t\n'.repeat(5000), body = 'Synthetic independently authored Card body.';
function parts() {
  const values = []; let start = 0;
  while (start<text.length) {
    let end=Math.min(text.length,start+4000);
    if (end<text.length && /[\uD800-\uDBFF]/.test(text[end-1])) end--;
    values.push({ id:'synthetic-message',role:'user',occurredAt:null,messageOrdinal:1,content:text.slice(start,end),
      part:{ index:values.length,start,totalUnits:text.length,totalBytes:Buffer.byteLength(text) } }); start=end;
  }
  return values;
}
const request = part => ({ namespace,client,sessionId:'synthetic-session',eventId:'event-'+part.part.index,messages:[part] });
const port = { version:'raw-seal-v1',
  sealRaw:({ text }) => ({ format:'local-plain-v1',keyVersion:null,sealed:Buffer.from(text) }),
  openRaw:({ sealed }) => ({ text:new TextDecoder('utf8',{ fatal:true }).decode(sealed) }),
};
const tokens = new WeakMap(),grants = new WeakMap();
const authority = {
  authorize(request,token) {
    const expected=tokens.get(token); if (!expected || expected.method!==request.method || !isDeepStrictEqual(expected.input,request.input)) return null;
    const grant={}, { input,...binding }=request; grants.set(grant,binding); return grant;
  },
  isCurrent:grant => grants.has(grant) ? { ...grants.get(grant),accessGeneration:1 }:null,
};
const readPolicy=() => { policyCalls++; assert.notEqual(phase,'delete','off-mode reads/deletes cannot call capture policy'); return { generation:'synthetic-notice',reason:null }; };
const core = openMemoryCore({ path,model:{ contextWindow:8192,countTokens:() => 1,extract:() => { modelCalls++; return { items:[] }; } },
  privateCards:{ version:'private-cards-local-v1',source:'submitted-note-v1',storage:'local-plain-v1',disclosure:'explicit-submitted-note-v1',authority },
  rawConversations:{ mode:['delete','restart-deleted'].includes(phase) ? 'off':'raw-v1',port,readPolicy,
    ...(['delete','restart-deleted'].includes(phase) ? {}:{ capBytes:1000000 }) } });
const ok=value => { assert.equal(value.ok,true,JSON.stringify(value)); return value.value; };
const denied=(value,code) => { assert.equal(value.ok,false); assert.equal(value.error.code,code); };
function call(method,input) {
  input={ namespace,...input }; const token={}; tokens.set(token,{ method,input:structuredClone(input) }); return core[method](input,token);
}
const usage=() => ok(core.getRawUsage({ ownerId:namespace.ownerId }));
async function readAll(id) {
  let cursor,actual='',view;
  do {
    view=ok(await core.getConversation({ namespace,conversationId:id,limit:2,...(cursor ? { cursor }:{}) }));
    assert.ok(Buffer.byteLength(JSON.stringify(view))<=65536);
    actual+=view.messages.flatMap(message=>message.parts.map(part=>part.text)).join(''); cursor=view.nextCursor;
  } while(cursor);
  assert.equal(actual,text); return view;
}
let evidence;
try {
  assert.equal(ok(core.getPrivateCardCapabilities()).raw,true);
  const selected=parts();
  if (phase==='create') {
    const first=ok(await core.captureRaw(request(selected[0]))); ok(first.interpretation);
    assert.equal(first.raw.parts[0].saved,true); assert.equal(modelCalls,1);
    assert.equal(usage().savedBytes,Buffer.byteLength(selected[0].content)); assert.ok(usage().reservedBytes>0);
    fs.writeFileSync(statePath,JSON.stringify({ first,usage:usage() }),{ flag:'wx',mode:0o600 });
    evidence={ pending:true };
  } else if (phase==='resume') {
    const state=JSON.parse(fs.readFileSync(statePath,'utf8'));
    assert.deepEqual(ok(await core.captureRaw(request(selected[0]))).raw,state.first.raw);
    assert.deepEqual(usage(),state.usage);
    for (const [index,part] of selected.entries()) {
      const input=request(part), result=ok(await core.captureRaw(input)); ok(result.interpretation);
      assert.deepEqual(ok(await core.captureRaw(input)).raw,result.raw);
      const before=usage(); ok(ok(await core.captureRaw({ ...input,eventId:'overlap-'+index })).interpretation);
      assert.deepEqual(usage(),before); assert.equal(modelCalls,0);
    }
    const conversationId=state.first.raw.conversationId, view=await readAll(conversationId);
    assert.equal(usage().savedBytes,Buffer.byteLength(text)); assert.equal(usage().reservedBytes,0);
    const anchors=[{ rawAnchor:{ conversationId,messageId:'synthetic-message',start:0,end:9,precision:'exact' },expectedConversationRevision:view.conversation.revision }];
    denied(await core.resolveSourceReferences({ namespace,anchors },{}),'authority_required');
    const source=ok(await call('resolveSourceReferences',{ anchors })).sources[0];
    const draftInput={ drafting:'authored',input:{ sources:[source],title:'Synthetic installed Raw Card',body } };
    const draft=ok(call('createCardDraft',{ ...draftInput,actionId:'draft' }));
    const confirmed=ok(call('confirmCardDraft',{ cardId:draft.id,expectedRevision:draft.revision,actionId:'confirm' }));
    const pending=ok(call('createCardDraft',{ ...draftInput,actionId:'dependent' }));
    const db=new DatabaseSync(path,{ readOnly:true });
    try { assert.equal(db.prepare('SELECT count(*) n FROM memories').get().n,0); } finally { db.close(); }
    fs.writeFileSync(statePath,JSON.stringify({ ...state,source,confirmed,pending,usage:usage(),
      deletion:{ namespace,conversationId,expectedRevision:view.conversation.revision,actionId:'delete' } }));
    evidence={ reconstructedUnits:text.length,zeroContinuationCalls:true,bareRawCard:true };
  } else if (phase==='delete') {
    const state=JSON.parse(fs.readFileSync(statePath,'utf8'));
    assert.deepEqual(usage(),state.usage); await readAll(state.deletion.conversationId);
    assert.equal(ok(await call('getSource',{ source:state.source })).parts[0].text,'Synthetic');
    denied(core.deleteConversation({ ...state.deletion,expectedRevision:state.deletion.expectedRevision+1 }),'revision_conflict');
    const { actionId,...preview }=state.deletion;
    assert.equal(ok(core.previewDeleteConversation(preview)).forgottenMemories,0);
    const deleted=ok(core.deleteConversation(state.deletion));
    assert.equal(usage().savedBytes,0); assert.equal(usage().reservedBytes,0);
    assert.equal(ok(call('getCard',{ cardId:state.pending.id })).card,null);
    const retained=ok(call('getCard',{ cardId:state.confirmed.id })).card;
    assert.equal(retained.body,body); assert.equal(retained.support.status,'unavailable');
    denied(await call('getSource',{ source:state.source }),'source_unavailable');
    assert.equal(policyCalls,0);
    fs.writeFileSync(statePath,JSON.stringify({ ...state,deleted }));
    evidence={ authoredBodyRetained:true,draftPurged:true,usageReleased:true };
  } else {
    const state=JSON.parse(fs.readFileSync(statePath,'utf8'));
    assert.deepEqual(ok(core.deleteConversation(state.deletion)),state.deleted);
    assert.equal(ok(await core.getConversation({ namespace,conversationId:state.deletion.conversationId })).conversation,null);
    const retained=ok(call('getCard',{ cardId:state.confirmed.id })).card;
    assert.equal(retained.body,body); assert.equal(retained.support.status,'unavailable');
    denied(await call('getSource',{ source:state.source }),'source_unavailable');
    denied(await core.captureRaw({ ...request(selected[0]),eventId:'late-after-delete' }),'conversation_deleted');
    assert.equal(usage().savedBytes,0); assert.equal(usage().reservedBytes,0);
    evidence={ coldDeleteReplay:true,staleSourceBlocked:true,lateCaptureBlocked:true };
  }
} finally { core.close(); }
assert.equal(networkCalls,0); assert.equal(modelCalls,phase==='create' ? 1:0);
console.log(JSON.stringify({ phase,client,pid:process.pid,importedCore,modelCalls,networkCalls,...evidence }));

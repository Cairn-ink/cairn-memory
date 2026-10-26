import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { rationaleModel } from './rationale-model.mjs';
import { interpretation } from './episode-capture-helpers.mjs';
import { config } from './raw-capture-fixtures.mjs';

export const ns = { ownerId:'synthetic-local-owner',scope:'project',projectId:'synthetic-project' };
export const ok = result => { assert.equal(result.ok,true,JSON.stringify(result)); return result.value; };
export const denied = (result,code) => { assert.equal(result.ok,false,JSON.stringify(result)); if (code) assert.equal(result.error.code,code); };
export const readPolicy = () => ({ generation:'synthetic-policy',reason:null });
export const plain = observe => ({ version:'raw-seal-v1',
  async sealRaw({text}) { await observe?.(); return { format:'local-plain-v1',keyVersion:null,sealed:Buffer.from(text) }; },
  async openRaw({sealed}) { return { text:Buffer.from(sealed).toString() }; },
});
export const request = (patch = {}) => {
  const text = 'Synthetic authority evidence.';
  return { namespace:ns,client:'claude-code',sessionId:'synthetic-session',eventId:'event-1',messages:[{
    id:'source',role:'user',occurredAt:null,messageOrdinal:1,content:text,
    part:{ index:0,start:0,totalUnits:text.length,totalBytes:Buffer.byteLength(text) },
  }],...patch };
};
export function fixture(t,{ kind = 'ordinary',client = 'claude-code' } = {}) {
  const workspace = createTestWorkspace(t,{ prefix:'local-authority-' }), path = join(workspace.path,'synthetic.sqlite');
  const control = openMemoryCore({ path,rawConversations:{mode:'off',readPolicy} }); workspace.defer(() => control.close());
  const db = new DatabaseSync(path); workspace.defer(() => db.close());
  const get = (namespace = ns,selected = client) => ok(control.getLocalCaptureControl({namespace,client:selected}));
  const set = (patch = {},namespace = ns,selected = client) => {
    const before = get(namespace,selected);
    return control.setLocalCaptureControl({ namespace,client:selected,targetId:'synthetic-target',expectedStoreId:before.storeId,
      expectedRevision:before.revision,automaticCaptureEnabled:before.automaticCaptureEnabled,rawNoticeVersion:before.rawNoticeVersion,...patch });
  };
  const snapshot = () => {
    const current = get();
    return { version:'local-capture-authority-v1',targetId:current.targetId ?? 'synthetic-target',storeId:current.storeId,
      namespace:ns,client,expectedControlRevision:current.revision,expectedConsentGeneration:current.consentGeneration,
      expectedNamespaceGeneration:ok(control.getCaptureControl({namespace:ns})).generation,
      expectedRawRevision:ok(control.getRawCaptureControl({ownerId:ns.ownerId,client})).revision };
  };
  let calls = 0,policyCalls = 0,seals = 0;
  function worker({ authority = snapshot(),duringSeal,duringExtract,duringPolicy,model:overrides = {},unmanaged = false } = {}) {
    const base = { ...rationaleModel(),interpretEpisode:interpretation,...overrides }, model = { ...base,
      async extract(value) { calls++; await duringExtract?.(); return base.extract(value); } };
    const core = openMemoryCore({path,model,...config(kind),rawConversations:{mode:'raw-v1',capBytes:1000000,
      port:plain(async () => { seals++; await duringSeal?.(); }),readPolicy:() => { policyCalls++; duringPolicy?.(); return readPolicy(); },
      ...(unmanaged ? {}:{localAuthority:authority}) }});
    workspace.defer(() => core.close()); return core;
  }
  return {workspace,path,db,control,get,set,snapshot,worker,grant:() => ok(set({automaticCaptureEnabled:true,rawNoticeVersion:'local-plain-v1'})),
    get calls(){return calls;},get policyCalls(){return policyCalls;},get seals(){return seals;},
    request:patch => request({client,...(kind === 'episode' ? {episodeContext:{clientLabel:'Synthetic',generation:'initial',origin:'ordinary'}}:{}),...patch})};
}

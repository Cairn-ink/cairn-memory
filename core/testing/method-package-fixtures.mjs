import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, openSync, closeSync, readFileSync } from 'node:fs';
import { after } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../contract.mjs';
import { METHOD_METHODS } from '../method-package-input.mjs';
import { CARD_METHODS } from '../private-card-input.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

export const ns = { ownerId:'synthetic-method-owner',scope:'personal',projectId:null };
export const project = { ...ns,scope:'project',projectId:'synthetic-project' };
export const foreign = { ...ns,ownerId:'foreign-owner' };
export const ok = result => { assert.equal(result.ok,true,JSON.stringify(result)); return result.value; };
export const error = (result,code) => assert.deepEqual(result,{ ok:false,error:{ code,retryable:code === 'storage_busy' } });
export function host() {
  const tokens = new WeakMap(), grants = new WeakMap();
  const state = { generation:1,enabled:true,classes:null,checks:0,hook:null,wrongScope:false,denyReasonReads:false,requests:[] };
  const methods = new Set([...METHOD_METHODS,...CARD_METHODS]);
  const authority = {
    authorize(request,token) {
      state.requests.push({ method:request.method,actionClass:request.actionClass,namespace:request.namespace });
      const expected = tokens.get(token);
      if (!state.enabled || !expected || !methods.has(request.method) || expected.method !== request.method ||
          !isDeepStrictEqual(expected.input,request.input) || ![ns,project].some(scope => isDeepStrictEqual(scope,request.namespace)) ||
          state.classes && !state.classes.includes(request.actionClass) ||
          state.denyReasonReads && request.method === 'importMethodVersion' && request.actionClass === 'read') return null;
      const grant = {}, { input,...binding } = request;
      grants.set(grant,binding); return grant;
    },
    isCurrent(grant) {
      state.checks++; state.hook?.(state.checks);
      const binding = grants.get(grant);
      return state.enabled && binding ? { ...binding,accessGeneration:state.generation,
        ...(state.wrongScope ? { namespace:foreign } : {}) } : null;
    },
  };
  return { state,authority,
    options:{ version:'method-packages-local-v1',storage:'local-plain-v1',authority },
    cards:{ version:'private-cards-local-v1',source:'submitted-note-v1',storage:'local-plain-v1',disclosure:'explicit-submitted-note-v1',authority },
    token(method,input) { const token = {}; tokens.set(token,{ method,input:structuredClone(input) }); return token; },
    call(core,method,input) { return core[method](input,this.token(method,input)); },
  };
}
export function fixture(t,{ cards = false,model } = {}) {
  const workspace = createTestWorkspace(t,{ prefix:'method-packages-' }), path = join(workspace.path,'store.sqlite'), trusted = host();
  const config = { path,methodPackages:trusted.options,...(cards ? { privateCards:trusted.cards } : {}),...(model ? { model } : {}) };
  let core = openMemoryCore(config);
  workspace.defer(() => core.close());
  const db = new DatabaseSync(path); workspace.defer(() => db.close());
  return { workspace,path,db,trusted,get core(){return core;},
    call(method,input) { return trusted.call(core,method,input); },
    reopen(){ core.close(); core = openMemoryCore(config); return core; } };
}
export const file = (path = 'SKILL.md',text = 'Synthetic independently submitted method.\n',mediaType = 'text/markdown') => ({ path,text,mediaType });
export const input = (actionId = 'import-first',patch = {}) => ({ namespace:ns,actionId,title:'Synthetic method',submittedBy:'Synthetic author',files:[file()],...patch });
export const history = version => ({ version,intent:'history' });
export function collect(f,method,input,key) {
  const entries = []; let cursor;
  do {
    const response = f.call(method,{ ...input,...(cursor ? { cursor } : {}) });
    assert.ok(Buffer.byteLength(JSON.stringify(response)) <= 65536);
    const page = ok(response); entries.push(...page[key]); cursor = page.nextCursor;
  } while (cursor);
  return entries;
}
export const repo = fileURLToPath(new URL('../../',import.meta.url));
export function child(code,args = [],options = {}) {
  // Regular-file stdio also works in restricted POSIX runners that deny the
  // socket-backed pipes used by spawnSync. The owned workspace cleans these.
  const workspace = createTestWorkspace(null,{prefix:'method-child-'});
  after(() => workspace.cleanup());
  const scratch = workspace.path;
  const stdout = join(scratch,'stdout'), stderr = join(scratch,'stderr');
  const out = openSync(stdout,'wx',0o600), err = openSync(stderr,'wx',0o600);
  let outcome;
  try { outcome = spawnSync(process.execPath,['--input-type=module','-e',code,...args],{
    cwd:repo,timeout:30000,...options,stdio:['ignore',out,err],
  }); } finally { closeSync(out);closeSync(err); }
  const output = readFileSync(stdout,'utf8'), errors = readFileSync(stderr,'utf8');
  assert.equal(outcome.error,undefined,String(outcome.error));
  assert.equal(outcome.signal,null,errors);
  assert.equal(outcome.status,0,errors+output);
  return output;
}
export const moduleURL = name => pathToFileURL(join(repo,name)).href;
export function materialize(root,revision) {
  const target = join(root,'code-'+revision); mkdirSync(target,{ mode:0o700 });
  const archive = join(root,'code-'+revision+'.tar'), out = openSync(archive,'wx',0o600);
  try { execFileSync('git',['archive',revision,'core','plugins/cairn-memory/lib/redact.mjs'],{ cwd:repo,stdio:['ignore',out,'inherit'] }); }
  finally { closeSync(out); }
  execFileSync('tar',['-xf',archive,'-C',target],{ stdio:['ignore','ignore','inherit'] });
  return target;
}
export const childHost = `
const token={}, grants=new WeakMap();
const authority={authorize(request,supplied){if(supplied!==token)return null;const grant={}, {input,...binding}=request;grants.set(grant,binding);return grant;},
isCurrent(grant){return grants.has(grant)?{...grants.get(grant),accessGeneration:1}:null;}};
const methods={version:'method-packages-local-v1',storage:'local-plain-v1',authority};
const cards={version:'private-cards-local-v1',source:'submitted-note-v1',storage:'local-plain-v1',disclosure:'explicit-submitted-note-v1',authority};
const ok=r=>{if(!r.ok)throw Error(JSON.stringify(r));return r.value;};
`;

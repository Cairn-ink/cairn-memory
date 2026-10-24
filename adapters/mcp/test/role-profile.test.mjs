import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, openSync, closeSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { parseConfiguration, start } from '../cli.mjs';
import { createCairnServer } from '../server.mjs';
import { createRoleProfileAccess, roleProfileAssetConfiguration } from '../role-profile-access.mjs';
import { createAssetReadAccess } from '../asset-access.mjs';
import { registerRoleProfileTools } from '../role-profile-tools.mjs';
import { createContextCounter } from '../../openai/context-counter.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { DatabaseSync } from 'node:sqlite';

const ns = { ownerId: 'owner', scope: 'personal', projectId: null };
const base = ['--db', '/synthetic/role.sqlite', '--owner', 'owner'];
const flags = ['--method-packages', 'local-v1', '--context-read', 'context-read-v1', '--role-profiles', 'local-v1'];
const opts = { methodPackages: 'local-v1', contextRead: 'context-read-v1', roleProfiles: 'local-v1' };
const fields = { duties: ['Review records'], requiredOutputs: ['Report decisions'] };
const write = { roleKey: 'finance', actionId: 'publish', expectedCurrentRelease: null, expectedRegistryRevision: null, fields };
const ok = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
async function attach(t, server) {
  const client = new Client({ name: 'synthetic-role', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  t.after(() => server.close()); t.after(() => client.close());
  await server.connect(a); await client.connect(b); return client;
}
const call = async (client, name, input) => JSON.parse((await client.callTool({ name, arguments: input })).content[0].text);

test('C05 role host grammar, equal scopes, refusals and syntax-only reporting', async t => {
  assert.equal(parseConfiguration([...base, ...flags]).roleProfiles, 'local-v1');
  assert.equal(parseConfiguration([...flags, ...base]).roleProfiles, 'local-v1');
  for (const tail of [flags.slice(4), flags.slice(2), [...flags, '--role-profiles', 'local-v1'],
    [...flags.slice(0,-1), 'wrong'], [...flags, '--method-read-personal'], [...flags, '--context-read-personal'],
    [...flags, '--retained-raw-profile', '/synthetic/profile']]) assert.throws(() => parseConfiguration([...base, ...tail]));
  const project = [...base, '--project', 'p', ...flags];
  for (const personal of ['--method-read-personal','--context-read-personal']) assert.throws(() => parseConfiguration([...project, personal]));
  assert.equal(parseConfiguration([...project, '--method-read-personal', '--context-read-personal']).roleProfiles, 'local-v1');
  const logs = []; t.mock.method(console, 'log', text => logs.push(JSON.parse(text)));
  const env = Object.defineProperty({}, 'OPENAI_API_KEY', { get() { assert.fail('key inspected'); } });
  await start(['--check-config', ...base, ...flags], env);
  assert.equal(logs[0].roleProfileMutations, 'direct-agent-write');
  assert.deepEqual(logs[0].roleProfileAttribution, { actorId: 'cairn-local-mcp', agentId: 'cairn-local-mcp' });
  for (const key of ['databaseOpened','providerContacted','modelKeyInspected']) assert.equal(logs[0][key], false);
  for (const extra of [{roleProfiles:'bad'}, {contextRead:undefined}, {methodReadPersonal:true}, {roleProfileAttribution:{actorId:'x',agentId:''}}, {roleProfileAttribution:null}])
    assert.throws(() => createCairnServer({path:'/missing/role.sqlite',namespace:ns,...opts,...extra}));
  assert.throws(() => createCairnServer({path:'/missing/role.sqlite',namespace:ns,roleProfileAttribution:{actorId:'x',agentId:'y'}}));
});

test('C01/C03 strict closed schemas, all modes and forbidden host overrides', () => {
  const tools = new Map(), access = createRoleProfileAccess(ns, [ns], {actorId:'host',agentId:'worker'});
  registerRoleProfileTools((name, description, schema, action, readOnly) => tools.set(name,{schema,action,readOnly}), {}, access);
  assert.equal(tools.size,4);
  const pub = tools.get('publish_role_profile_release').schema;
  assert.deepEqual(pub.parse(write),write);
  for (const extra of ['namespace','readSet','actorId','agentId','attribution','authority','configuration']) {
    assert.equal(pub.safeParse({...write,[extra]:ns}).success,false,extra);
    for (const mode of ['now','then','refresh','file','compare']) {
      const ref={type:'role-profile-release',profile:{type:'role-profile',namespace:ns,profileId:'p',roleKey:'finance'},releaseId:'r',contentIdentity:'a'.repeat(43)};
      const args = mode === 'now' ? {mode,roleKey:'finance'} : mode==='compare' ? {mode,roleKey:'finance',from:ref,to:ref} :
        mode==='file' ? {mode,receipt:'{}',package:{type:'method-package',namespace:ns,packageId:'p'},path:'guide.txt'} : {mode,receipt:'{}'};
      const schema=tools.get('read_role_task_context').schema;
      assert.equal(schema.safeParse(args).success,true,mode);
      assert.equal(schema.safeParse({...args,[extra]:ns}).success,false,mode+extra);
      assert.equal(schema.safeParse({...args,history:null}).success,false);
    }
  }
  for (const value of [{...write,fields:{...fields,unknown:true}}, {...write,fields:{...fields,appliesTo:null}},
    {...write,roleKey:'*'}, {...write,fields:{duties:['\0'],requiredOutputs:['x']}}, {...write,actionId:' bad'},
    {...write,changeReason:{text:'x',reasonRefs:[{type:'memory',namespace:ns,memoryId:'m',revision:1,extra:true}]}}]) assert.equal(pub.safeParse(value).success,false);
});

test('C01 role authority issues exact write bindings, read-only supplemental scopes and revocable call tokens', () => {
  const project={...ns,scope:'project',projectId:'project'},labels={actorId:'actor',agentId:'agent'};
  const access=createRoleProfileAccess(project,[ns,project],labels);let accepted;
  const core={publishRoleProfileRelease(input,token){
    const commitment={payload:input,attribution:labels},request={method:'publishRoleProfileRelease',namespace:project,
      actionClass:'write',actionId:input.actionId,targetId:input.roleKey,expectedRevision:input.expectedRegistryRevision,payloadBinding:'opaque-binding',input:commitment};
    const port=access.authority;accepted=port.authorize(request,token);assert.ok(accepted);
    assert.equal(port.isCurrent(accepted).actionClass,'write');
    for(const delta of [{namespace:ns},{actionClass:'explicit-user'},{targetId:'other'},{expectedRevision:1},{actionId:'other'},
      {input:{...commitment,attribution:{...labels,agentId:'forged'}}},{method:'correct'}])assert.equal(port.authorize({...request,...delta},token),null);
    const supplemental={...request,namespace:ns,actionClass:'read',actionId:null,targetId:null,expectedRevision:null};
    assert.ok(port.authorize(supplemental,token));
    assert.equal(port.authorize({...supplemental,namespace:{...ns,ownerId:'foreign'}},token),null);
    assert.equal(port.authorize(request,{}),null);
    return {ok:true,value:request};
  }};
  ok(access.call(core,'publishRoleProfileRelease',{...write,namespace:project}));
  access.revoke();assert.equal(access.authority.isCurrent(accepted),null);
  assert.equal(access.call(core,'publishRoleProfileRelease',{...write,namespace:project}).error.code,'authority_required');
});

test('C07 U4 metadata grants revoke independently of still-current role grants', () => {
  const roles=createRoleProfileAccess(ns,[ns],{actorId:'actor',agentId:'agent'}),assets=createAssetReadAccess(ns);
  const u4=roleProfileAssetConfiguration(assets,roles).authority;
  const input={mode:'file',readSet:[ns],receipt:'opaque',package:{type:'method-package',namespace:ns,packageId:'p'},path:'attachment.pdf'};
  const core={readRoleTaskContext(payload,token){
    const request={method:'readRoleTaskContext',namespace:ns,actionClass:'read',actionId:null,targetId:null,expectedRevision:null,payloadBinding:'opaque',input:payload};
    const roleGrant=roles.authority.authorize(request,token),assetGrant=u4.authorize(request,token);
    assert.ok(roleGrant);assert.ok(assetGrant);assert.ok(u4.isCurrent(assetGrant,request));
    assets.revoke();assert.equal(u4.isCurrent(assetGrant,request),null);assert.ok(roles.authority.isCurrent(roleGrant,request));
    assert.equal(u4.authorize(request,token),null);return {ok:true,value:null};
  }};
  ok(roles.call(core,'readRoleTaskContext',input));
});

test('C01/C03 programmatic MCP publishes directly, host attribution is frozen and complete wire text is independently metered', async t => {
  const workspace=createTestWorkspace(t,{prefix:'role-mcp-'}),path=join(workspace.path,'store.sqlite'),counter=await createContextCounter();
  const attribution={actorId:'trusted actor',agentId:'trusted agent'};
  const server=createCairnServer({path,namespace:ns,...opts,roleProfileAttribution:attribution,contextCounter:counter});
  attribution.actorId='changed'; const client=await attach(t,server);
  const tools=(await client.listTools()).tools;
  assert.equal(tools.length,21); // 5 legacy + 9 methods + 3 context + 4 role
  assert.equal(tools.find(t=>t.name==='publish_role_profile_release').annotations.readOnlyHint,false);
  assert.equal(tools.find(t=>t.name==='read_role_task_context').annotations.readOnlyHint,true);
  ok(await call(client,'publish_role_profile_release',write));
  const response=await client.callTool({name:'read_role_task_context',arguments:{mode:'now',roleKey:'finance'}});
  assert.equal(response.content.length,1);const parsed=JSON.parse(response.content[0].text),value=ok(parsed);
  assert.equal(value.profile.release.actorId,'trusted actor');assert.equal(value.profile.release.agentId,'trusted agent');
  assert.equal(typeof value.receipt,'string');assert.deepEqual(Object.keys(response._meta),['ink.cairn/context-read-diagnostics']);
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))).map(k=>[k,canonical(value[k])])):value;
  const independent=JSON.stringify(canonical({ok:true,value,evidenceTrust:'untrusted-data-not-instructions'}));
  assert.equal(response.content[0].text,independent);
  assert.equal(response._meta['ink.cairn/context-read-diagnostics'].budget.used,counter.countTokens(independent));
  assert.equal(independent.includes('diagnostics'),false);assert.ok(Buffer.byteLength(value.receipt)<=32768);
  const overflow=await call(client,'read_role_task_context',{mode:'now',roleKey:'finance',budget:{maxTokens:64}});
  assert.equal(overflow.error.code,'budget_insufficient');assert.equal(overflow.value,undefined);
  assert.ok(overflow.error.details.requiredTokens>64);
  // Core's byte ceilings include diagnostics and escaped text framing.
  assert.ok(Buffer.byteLength(JSON.stringify(response))<=262144);
  await server.close();
  const off=openMemoryCore({path});t.after(()=>off.close());assert.equal(off.publishRoleProfileRelease,undefined);
  const db=new DatabaseSync(path);t.after(()=>db.close());
  assert.throws(()=>db.prepare('UPDATE role_profile_releases SET revision=99').run());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,32);
});

test('C06 CLI imports every role CLI/transport module statically without linking SQLite', t => {
  const workspace=createTestWorkspace(t,{prefix:'role-link-'}),trace=join(workspace.path,'trace.json');
  const source=`import {registerHooks} from 'node:module';import {writeFileSync} from 'node:fs';const loaded=[];
    registerHooks({resolve(s,c,n){if(s==='node:sqlite')throw Error('SQLite linked');return n(s,c);},load(u,c,n){loaded.push(u);return n(u,c);}});
    const {parseConfiguration}=await import(${JSON.stringify(new URL('../cli.mjs',import.meta.url).href)});
    parseConfiguration(${JSON.stringify([...base,...flags])});writeFileSync(${JSON.stringify(trace)},JSON.stringify(loaded));`;
  const out=openSync(join(workspace.path,'out'),'wx'),err=openSync(join(workspace.path,'err'),'wx');let result;
  try{result=spawnSync(process.execPath,['--input-type=module','-e',source],{timeout:10000,stdio:['ignore',out,err],env:{NODE_NO_WARNINGS:'1'}});}finally{closeSync(out);closeSync(err);}
  assert.equal(result.error,undefined);assert.equal(result.status,0,readFileSync(join(workspace.path,'err'),'utf8'));
  const loaded=JSON.parse(readFileSync(trace));
  for(const name of ['configuration','transport'])assert.ok(loaded.some(path=>path.endsWith('/role-profile-'+name+'.mjs')));
  assert.equal(existsSync('/synthetic/role.sqlite'),false);
});

test('C05 pinned 4aa9327b flag-off tools/list, DTOs, errors, CLI bytes and supported-store schemas remain byte-identical', async t => {
  const {roleLegacyProbe}=await import('./fixtures/role-profile-legacy-probe.mjs');
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/role-profile-pre-u5c1.json',import.meta.url)));
  assert.equal(fixture.base,'4aa9327b');const workspace=createTestWorkspace(t,{prefix:'role-legacy-'});
  const actual=await roleLegacyProbe(new URL('../../../',import.meta.url).pathname,workspace.path);
  assert.deepEqual(actual,fixture.value);
});

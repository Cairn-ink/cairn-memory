import { assertNoCardCurrentDependencies } from '../../../core/card-current-schema.mjs';
import { assertNoRoleProfiles } from '../../../core/role-profile-schema.mjs';
import { assertNoAssets } from '../../../core/asset-schema.mjs';
import { validateExistingStore } from '../../../core/existing-store.mjs';
import { mkdir, lstat, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ownData } from '../../../core/local-authority-input.mjs';
import { checkedPath, privateRead, privateWrite, privateDirectory, syncDirectory } from '../private-state.mjs';
import { stateLock } from '../state-lock.mjs';
import { createLocalRawHost } from './local-host.mjs';
import { hasQualifiedCreator } from '../../codex/qualification.mjs';
import { absolute, exact, setupRequest, consented, locations, runtime, runtimeRoot, sha, fail, result, failure, checkSignal } from './local-setup-input.mjs';
import { directory, nativeSnapshot, nativeWrite, mergeNative, events, hookCommand } from './local-setup-files.mjs';

const phases = ['preparing','prepared','activation_pending','active','disabling','disabled','reenabling','rearm_required'];
const bytes = value => JSON.stringify(value,null,2)+'\n';
const ok = outcome => { if (!outcome?.ok) fail('authority_changed'); return outcome.value; };
const host = root => createLocalRawHost({ profilePath:locations(root).profile });
async function publish(root,record,phase) {
  await privateWrite(locations(root).record,bytes({ ...record,phase })); return { ...record,phase };
}
export async function readLocalInstallation(root) {
  const paths = locations(root); await directory(root,true);
  let record;
  try {
    record = exact(JSON.parse(await privateRead(paths.record)),['version','phase','request','requestDigest','storeId','targetId','runtimeRoot','nodeExecutable','sourceIdentity']);
    const request = setupRequest(record.request);
    exact(record.sourceIdentity,['device','inode']);
    if (record.version !== 'local-raw-installation-v1' || !phases.includes(record.phase) || request.installationDirectory !== root ||
        record.requestDigest !== sha(bytes(request)) || record.runtimeRoot !== runtimeRoot || record.nodeExecutable !== process.execPath ||
        typeof record.storeId !== 'string' || !record.storeId || typeof record.targetId !== 'string' || !record.targetId ||
        !Object.values(record.sourceIdentity).every(value => typeof value === 'string' && /^\d+$/.test(value))) fail('recovery_required');
    return { ...record,request };
  } catch { fail('recovery_required'); }
}
async function absent(root) {
  try { await lstat(root); return false; } catch (error) { if (error.code === 'ENOENT') return true; fail('unsafe_path'); }
}
async function qualification(request) {
  if (request.client !== 'codex') { await directory(request.installation.pluginRoot); return; }
  const path = request.installation.qualificationConfigPath;
  await checkedPath(dirname(path),{ directory:true }); await privateRead(path);
  // Presence is only a prerequisite. Actual hook invocation independently binds
  // the running ancestor binary and its cached identity, header and exec mode.
  const cache = join(dirname(path),'qualification'); await checkedPath(cache,{ directory:true });
  const names = await readdir(cache); if (names.length > 64) fail('qualification_required');
  for (const name of names) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    try {
      const verdict = JSON.parse(await privateRead(join(cache,name)));
      if (await hasQualifiedCreator(path,verdict.version)) return;
    } catch { /* Corrupt evidence never qualifies a creator. */ }
  }
  fail('qualification_required');
}
async function store(request,expectedStoreId) {
  let db;
  try {
    await directory(dirname(request.databasePath),true); const before = await checkedPath(request.databasePath);
    const { DatabaseSync } = await import('node:sqlite'); db = new DatabaseSync(request.databasePath,{ readOnly:true });
    const after = await checkedPath(request.databasePath);
    if (before.dev !== after.dev || before.ino !== after.ino || db.prepare('PRAGMA application_id').get().application_id !== 0x43414952 ||
        ![29,30,31,32,33].includes(db.prepare('PRAGMA user_version').get().user_version)) fail('store_invalid');
    const storeId = db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get()?.store_id;
    if (db.prepare('PRAGMA user_version').get().user_version < 33) assertNoCardCurrentDependencies(db);
    if (db.prepare('PRAGMA user_version').get().user_version < 32) assertNoRoleProfiles(db);
    if (db.prepare('PRAGMA user_version').get().user_version < 31) assertNoAssets(db);
    if (db.prepare('PRAGMA user_version').get().user_version >= 30) validateExistingStore(db, { storeId });
    if (typeof storeId !== 'string' || expectedStoreId !== undefined && expectedStoreId !== storeId ||
        db.prepare('SELECT 1 FROM raw_owner_usage WHERE owner_id=? AND cap_bytes!=?').get(request.namespace.ownerId,request.rawCapBytes)) fail('store_invalid');
    return storeId;
  } catch { fail('store_invalid'); } finally { db?.close(); }
}
async function withCore(request,storeId,work) {
  await store(request,storeId);
  const { openMemoryCore } = await import('../../../core/index.mjs');
  const core = openMemoryCore({ path:request.databasePath,existingStore:{ version:'schema29-existing-v1',storeId },
    rawConversations:{ mode:'off',capBytes:request.rawCapBytes,configureCap:false,readPolicy:() => ({ generation:'local-setup-v1',reason:'tool_off' }) } });
  try { return await work(core); } finally { await core.close(); }
}
async function sharedBudget(request,storeId,core,{ create = false } = {}) {
  await directory(request.usageRoot,true);
  const path = join(request.usageRoot,'local-setup-budget.json');
  const text = await privateRead(path,{ missing:true });
  const controls = ['claude-code','codex'].map(client => ok(core.getLocalCaptureControl({ namespace:request.namespace,client })));
  let descriptor;
  if (text === undefined) {
    if (!create || controls.some(control => control.targetId !== null)) fail('authority_bound');
    descriptor = { version:'local-raw-setup-budget-v1',storeId,namespace:request.namespace,targetId:randomUUID(),dailyCap:request.dailyCap,rawCapBytes:request.rawCapBytes };
    await privateWrite(path,bytes(descriptor),{ exclusive:true });
    if (await privateRead(path) !== bytes(descriptor)) fail('recovery_required');
  } else {
    try { descriptor = exact(JSON.parse(text),['version','storeId','namespace','targetId','dailyCap','rawCapBytes']); }
    catch { fail('recovery_required'); }
  }
  if (descriptor.version !== 'local-raw-setup-budget-v1' || descriptor.storeId !== storeId ||
      JSON.stringify(descriptor.namespace) !== JSON.stringify(request.namespace) || !descriptor.targetId || typeof descriptor.targetId !== 'string' ||
      descriptor.dailyCap !== request.dailyCap || descriptor.rawCapBytes !== request.rawCapBytes ||
      controls.some(control => control.targetId !== null && control.targetId !== descriptor.targetId)) fail('authority_bound');
  return descriptor;
}
function grant(core,request,storeId,targetId,enabled) {
  const previous = ok(core.getLocalCaptureControl({ namespace:request.namespace,client:request.client }));
  if (previous.targetId !== null && previous.targetId !== targetId) fail('authority_bound');
  const control = ok(core.getCaptureControl({ namespace:request.namespace }));
  if (enabled && (control.paused || !control.enabled)) fail('authority_changed');
  const current = ok(core.setLocalCaptureControl({ namespace:request.namespace,client:request.client,targetId,
    expectedStoreId:storeId,expectedRevision:previous.revision,automaticCaptureEnabled:enabled,
    rawNoticeVersion:request.rawMode === 'local-plain-v1' ? 'local-plain-v1':null }));
  return { version:'local-capture-authority-v1',storeId,targetId,namespace:request.namespace,client:request.client,
    expectedControlRevision:current.revision,expectedConsentGeneration:current.consentGeneration,
    expectedNamespaceGeneration:control.generation,
    expectedRawRevision:ok(core.getRawCaptureControl({ ownerId:request.namespace.ownerId,client:request.client })).revision };
}
function registered(text,request) {
  // Re-merging is permitted only after validating the existing structure and
  // conflicts. An already active installation must actually own every hook.
  const value = JSON.parse(mergeNative(text,request,false));
  void value;
  const original = text ? JSON.parse(text):{};
  return events(request.client).every(event => {
    const found = (original.hooks?.[event] ?? []).flatMap(group => group.hooks
      .filter(hook => hook.command === hookCommand(request.installationDirectory,event)).map(hook => ({ group,hook })));
    if (found.length !== 1) return false;
    const { group,hook } = found[0];
    // An exact command is insufficient if a matcher or modifier changes when
    // it runs. Only our unconditional foreground shape is owned; unrelated
    // hooks may share its array and unrelated groups retain their own options.
    return Object.keys(group).length === 1 && Object.keys(hook).length === 3 && hook.type === 'command' && hook.timeout === 160;
  });
}
async function prepare(request,signal) {
  checkSignal(signal); const paths = locations(request.installationDirectory);
  if (!await absent(paths.root)) {
    return stateLock(paths.lock,async () => {
      const record = await readLocalInstallation(paths.root);
      if (record.requestDigest !== sha(bytes(request)) || !['prepared','active'].includes(record.phase)) fail('recovery_required');
      if ((await host(paths.root).status({ signal })).status !== 'ready') fail('recovery_required');
      if (record.phase === 'active') {
        // Repeated setup observes the same owned registration as status; a
        // stale active journal is not proof that its native hooks still exist.
        // Refuse drift without silently repairing settings, consent or identity.
        let present = false;
        try { present = registered((await nativeSnapshot(request.clientConfigPath)).text,request); }
        catch { fail('configuration_changed'); }
        if (!present) fail('configuration_changed');
      }
      return result(record.phase);
    });
  }
  await directory(dirname(paths.root),true);
  const sourceIdentity = await directory(request.sourceRoot);
  await directory(request.usageRoot,true); await qualification(request); const before = await nativeSnapshot(request.clientConfigPath);
  mergeNative(before.text,request,false,{ own:false });
  const storeId = await store(request);
  // Validate the complete core opener and all controls before acquiring a new
  // installation identity or changing consent. Never adopt an existing target.
  await withCore(request,storeId,async core => {
    if (ok(core.getLocalCaptureControl({ namespace:request.namespace,client:request.client })).targetId !== null) fail('authority_bound');
    // An absent descriptor is admissible only while both clients are unbound.
    const descriptor = await privateRead(join(request.usageRoot,'local-setup-budget.json'),{ missing:true });
    if (descriptor !== undefined) await sharedBudget(request,storeId,core);
    else if (ok(core.getLocalCaptureControl({ namespace:request.namespace,client:request.client === 'codex' ? 'claude-code':'codex' })).targetId !== null) fail('authority_bound');
    const control = ok(core.getCaptureControl({ namespace:request.namespace })); if (control.paused || !control.enabled) fail('authority_changed');
  });
  checkSignal(signal);
  try { await mkdir(paths.root,{ mode:0o700 }); await syncDirectory(dirname(paths.root)); } catch { fail('recovery_required'); }
  return stateLock(paths.lock,async () => {
    let record = { version:'local-raw-installation-v1',phase:'preparing',request,requestDigest:sha(bytes(request)),storeId,targetId:randomUUID(),
      runtimeRoot,nodeExecutable:process.execPath,sourceIdentity };
    await privateWrite(paths.record,bytes(record),{ exclusive:true });
    await privateDirectory(paths.home);
    checkSignal(signal);
    // Re-check conflicts immediately before the real consent mutation.
    mergeNative((await nativeSnapshot(request.clientConfigPath)).text,request,false,{ own:false });
    const authority = await stateLock(request.databasePath+'.local-setup.lock',() =>
      stateLock(join(request.usageRoot,'.local-setup.lock'),() => withCore(request,storeId,async core => {
        if (ok(core.getLocalCaptureControl({ namespace:request.namespace,client:request.client })).targetId !== null) fail('authority_bound');
        const descriptor = await sharedBudget(request,storeId,core,{ create:true });
        record = { ...record,targetId:descriptor.targetId }; await privateWrite(paths.record,bytes(record));
        return grant(core,request,storeId,record.targetId,true);
      })));
    const config = { version:'local-capture-config-v1',databasePath:request.databasePath,authority,
      raw:{ mode:request.rawMode,capBytes:request.rawCapBytes },provider:{ profile:'openai-baseline-v1',apiKeyEnv:request.providerApiKeyEnv },
      usage:{ root:request.usageRoot,dailyCap:request.dailyCap,concurrency:1 },timeouts:{ captureMs:120000,processMs:150000 } };
    const configText = bytes(config); await privateWrite(paths.config,configText,{ exclusive:true });
    await privateWrite(paths.profile,bytes({ version:'local-raw-host-profile-v1',configPath:paths.config,configDigest:sha(configText),stateRoot:paths.state,
      identityKeyPath:paths.key,home:paths.home,installation:{ client:request.client,...request.installation } }),{ exclusive:true });
    if ((await host(paths.root).prepare({ signal })).status !== 'ready') fail('recovery_required');
    record = await publish(paths.root,record,'prepared'); return result(record.phase);
  });
}
async function selected(root,signal,work) {
  if (!absolute(root)) fail('invalid_input');
  if (await absent(root)) return result('blocked','not_installed');
  await directory(root,true); return stateLock(locations(root).lock,async () => work(await readLocalInstallation(root)));
}
async function activate(root,signal) {
  return selected(root,signal,async record => {
    const { request } = record; checkSignal(signal);
    if (record.phase === 'disabled') {
      record = await publish(root,record,'reenabling');
      await stateLock(request.databasePath+'.local-setup.lock',() => stateLock(join(request.usageRoot,'.local-setup.lock'),() =>
        withCore(request,record.storeId,async core => {
          const descriptor = await sharedBudget(request,record.storeId,core);
          if (descriptor.targetId !== record.targetId) fail('authority_bound');
          grant(core,request,record.storeId,record.targetId,true);
        })));
      await publish(root,record,'rearm_required'); return result('blocked','rearm_required');
    }
    if (!['prepared','active','rearm_required'].includes(record.phase)) fail('recovery_required');
    const ready = await host(root).status({ signal });
    if (ready.status !== 'ready') fail(record.phase === 'rearm_required' ? 'rearm_required':'recovery_required');
    await qualification(request);
    return stateLock(request.clientConfigPath+'.cairn-local.lock',async () => {
      checkSignal(signal); const before = await nativeSnapshot(request.clientConfigPath);
      if (record.phase === 'active') { if (!registered(before.text,request)) fail('configuration_changed'); return result('active'); }
      const text = mergeNative(before.text,request,true);
      record = await publish(root,record,'activation_pending');
      await nativeWrite(request.clientConfigPath,text,before);
      if ((await host(root).status({ signal })).status !== 'ready') fail('authority_changed');
      await publish(root,record,'active'); return result('active');
    });
  });
}
async function disable(root,signal) {
  return selected(root,signal,async record => {
    checkSignal(signal); const { request } = record;
    // This is deliberately first: a journal or native settings failure cannot
    // leave a stale foreground hook authorized to read the transcript.
    await withCore(request,record.storeId,core => grant(core,request,record.storeId,record.targetId,false));
    record = await publish(root,record,'disabling');
    try {
      await stateLock(request.clientConfigPath+'.cairn-local.lock',async () => {
        const before = await nativeSnapshot(request.clientConfigPath),text = mergeNative(before.text,request,false);
        if (text !== before.text) await nativeWrite(request.clientConfigPath,text,before);
      });
    } catch (error) { await publish(root,record,'disabled'); throw error; }
    await publish(root,record,'disabled'); return result('disabled');
  });
}
export async function setupLocalRaw(value,options = {}) {
  try { const { signal } = exactOptions(options); runtime(); const request = setupRequest(value);
    if (!consented(request)) return result('declined','declined'); return await prepare(request,signal);
  } catch (error) { return failure(error); }
}
function exactOptions(options) {
  // Optional signal is the only trusted call option, not installation input.
  const value = ownData(options,['signal']); checkSignal(value.signal); return value;
}
export function createLocalRawSetup(value) {
  const { installationDirectory:root } = exact(value,['installationDirectory']); locations(root);
  async function call(action,options) {
    try { const { signal } = exactOptions(options); runtime();
      if (action === 'activate') return await activate(root,signal);
      if (action === 'disable') return await disable(root,signal);
      // Status is a read-only observation, not a lock/recovery operation. Atomic
      // records and host permission snapshots may race a concurrent transition;
      // they never repair it or create transient filesystem ownership files.
      if (await absent(root)) return result('blocked','not_installed');
      const record = await readLocalInstallation(root);
      if (record.phase === 'disabled') return result('disabled');
      if (record.phase === 'rearm_required') return result('blocked','rearm_required');
      if (!['prepared','active'].includes(record.phase)) fail('recovery_required');
      if ((await host(root).status({ signal })).status !== 'ready') fail('authority_changed');
      if (record.phase === 'active' && !registered((await nativeSnapshot(record.request.clientConfigPath)).text,record.request)) fail('configuration_changed');
      return result(record.phase);
    } catch (error) { return failure(error); }
  }
  return Object.freeze({ status:(options = {}) => call('status',options),activate:(options = {}) => call('activate',options),disable:(options = {}) => call('disable',options) });
}

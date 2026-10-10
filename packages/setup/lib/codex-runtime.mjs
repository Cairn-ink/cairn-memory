import { readFile, mkdir, lstat, open, unlink, rm, realpath, rename, chmod } from 'node:fs/promises';
import { readFileSync, constants, accessSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, delimiter, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { browserAuthorize, collectToken } from './auth.mjs';
import { DEFAULT_CODEX_DAILY_CAP, PRIVACY_URL } from './constants.mjs';
import { chooseIdentity, assertIdentityUnchanged, backupIdentity, restoreIdentity, reportBackups } from './identity-choice.mjs';
import { confirmStopped } from './clients.mjs';
import { selectEndpoint } from './options.mjs';
import { privateRead, privateWrite, privateDirectory, checkedPath } from '../runtime/integrations/client/private-state.mjs';
import { resolveClient, detectClients, initializePairing, completePairing } from '../runtime/integrations/client/pairing.mjs';
import { readControlState, setPaused } from '../runtime/integrations/client/control-state.mjs';
import { inspectAutomaticPolicy, automaticGuard, policyPath, rotateAutomaticBoundary } from '../runtime/integrations/client/automatic-policy.mjs';
import { hostedTargetId, resumeHostedQuota } from '../runtime/integrations/client/transport-hosted.mjs';
import { validateUsage } from '../runtime/integrations/client/runtime-usage.mjs';
import { conforms } from '../runtime/integrations/client/hosted-contract.mjs';
import { stateLock } from '../runtime/integrations/client/state-lock.mjs';
import { hostedPauseStatus } from '../runtime/integrations/client/hosted-pause.mjs';
import { readInstallation, validateInstallation, readCredential, writeCredential, clientOptions,
  promptRecallEnabled, writePromptRecall } from '../runtime/integrations/codex/installed-state.mjs';
import { observedHosts, qualifyBinary, refreshObservedHost, qualificationStatus, cachedQualification } from '../runtime/integrations/codex/qualification.mjs';

const version = JSON.parse(readFileSync(new URL('../package.json',import.meta.url))).version;
const events = ['SessionStart','UserPromptSubmit','Stop','PreCompact'];
const shellQuote = value => "'" + value.replace(/'/gu,"'\\''") + "'";
export const hookCommand = (config, path, event) => ['/usr/bin/env','-i',`HOME=${config.home}`,
  `PATH=${dirname(config.node)}:/usr/bin:/bin`,'LANG=C.UTF-8',
  config.node,join(config.runtime,'integrations/codex/entry.mjs'),path,event]
  .map(shellQuote).join(' ')+' 2>/dev/null || true';

async function readRuntime(path) {
  const before = await checkedPath(path,{missing:true});
  if (!before) return undefined;
  const file = await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (info.ino!==before.ino || info.dev!==before.dev || info.size>1048576 || info.nlink!==1) throw new Error('runtime_changed');
    return await file.readFile('utf8');
  } finally {await file.close();}
}
async function hostWrite(path, text, before, {snapshot,unchanged}) {
  const temporary = path+`.cairn-${process.pid}-${Date.now()}.tmp`;
  const file = await open(temporary,'wx',0o600);
  try {
    try {await file.writeFile(text);await file.sync();} finally {await file.close();}
    if (!unchanged(before,await snapshot(path))) throw new Error('concurrent_change');
    await rename(temporary,path);
  } finally {await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}

// Recognize the installer-owned command shape and this installation path, rather
// than the current node/runtime digest. Older or interrupted upgrades are removed
// too; commands for another installation and unrelated handlers are preserved.
function ownedHook(hook, path, event) {
  const command = hook?.command;
  return typeof command === 'string' && hook.type === 'command' &&
    command.startsWith("'/usr/bin/env' '-i' 'HOME=") &&
    command.includes(" 'LANG=C.UTF-8' ") &&
    command.endsWith("/integrations/codex/entry.mjs' "+shellQuote(path)+' '+shellQuote(event)+' 2>/dev/null || true');
}
// Remove all our handlers, even when they share a group with others.
// Rebuild only the changed JSON document; every unrelated value is retained.
export function mergeHooks(text, path, config, previous, enabled) {
  const value = text ? JSON.parse(text) : {};
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (value.hooks !== undefined && (!value.hooks || typeof value.hooks !== 'object' || Array.isArray(value.hooks)))) {
    throw new Error('invalid_hooks');
  }
  value.hooks ??= {};
  for (const event of events) {
    const groups = value.hooks[event] ?? [];
    if (!Array.isArray(groups) || groups.some(group => !Array.isArray(group?.hooks))) throw new Error('invalid_hooks');
    const commands = new Set([previous,config].filter(Boolean).map(entry => hookCommand(entry,path,event)));
    value.hooks[event] = groups.map(group => ({ ...group,
      hooks: group.hooks.filter(hook => !commands.has(hook.command) && !ownedHook(hook,path,event)) })).filter(group => group.hooks.length);
    if (enabled) value.hooks[event].push({ hooks: [{ type: 'command', command: hookCommand(config,path,event),
      timeout: ['Stop','PreCompact'].includes(event) ? 1 : 3,
      statusMessage: 'Cairn automatic memory', ...(['SessionStart','UserPromptSubmit'].includes(event) ? {additionalContextLimit:0} : {}) }] });
    if (!value.hooks[event].length) delete value.hooks[event];
  }
  return JSON.stringify(value,null,2) + '\n';
}

export async function copyRuntime(directory) {
  const source = new URL('../runtime/',import.meta.url);
  const bytes = await readFile(new URL('manifest.json',source));
  const manifest = JSON.parse(bytes);
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0,12);
  const runtime = join(directory,'runtime',version+'-'+digest);
  await privateDirectory(directory); await privateDirectory(join(directory,'runtime')); await privateDirectory(runtime);
  for (const [path, hash] of Object.entries(manifest.files)) {
    if (!/^integrations\/(?:codex|client)\/[a-z][a-z-]*\.mjs$/u.test(path)) throw new Error('invalid_runtime_manifest');
    const sourceBytes = await readFile(new URL(path,source));
    if (createHash('sha256').update(sourceBytes).digest('hex') !== hash) throw new Error('invalid_runtime_manifest');
    // Each ancestor in the private copy is verified before descending.
    await privateDirectory(join(runtime,'integrations'));
    await privateDirectory(join(runtime,dirname(path)));
    const destination = join(runtime,path);
    const existing = await readRuntime(destination);
    if (existing === undefined) await privateWrite(destination,sourceBytes);
    else if (createHash('sha256').update(existing).digest('hex') !== hash) throw new Error('runtime_modified');
  }
  const previous = await privateRead(join(runtime,'manifest.json'),{missing:true});
  if (previous !== undefined && previous !== bytes.toString()) throw new Error('runtime_modified');
  if (previous === undefined) await privateWrite(join(runtime,'manifest.json'),bytes);
  return runtime;
}

function binary(name) {
  for (const folder of (process.env.PATH ?? '').split(delimiter)) {
    const path = resolve(folder || '.',name);
    try { accessSync(path,constants.X_OK); return path; } catch { /* continue */ }
  }
  throw new Error('missing_binary');
}
async function localClaude(args, input, { cwd }) {
  return new Promise(resolveResult => {
    const child = spawn(binary('claude'),args,{cwd,stdio:['pipe','pipe','pipe']});
    let stdout = '', failed = false;
    const timer = setTimeout(() => {failed=true;child.kill('SIGKILL');},15000);
    child.on('error', () => { failed = true; });
    child.stdout.on('data', chunk => {stdout+=chunk;if(stdout.length>65536){failed=true;child.kill('SIGKILL');}});
    // Native configuration may include credentials. Always drain and discard it.
    child.stderr.resume(); child.stdin.on('error', () => { failed=true; });
    child.stdin.end(input);
    child.on('close', code => {clearTimeout(timer);resolveResult({code:failed?1:code,stdout});});
  });
}

// 0.1.2 introduced the explicit pairing_record/project-key contract (ba33fb1).
// Capability discovery is still required. Prereleases/unknown versions refuse.
export const CLAUDE_PAIRING_MINIMUM = '0.1.2';
export function supportsClaudePairing(version) {
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.exec(version ?? '');
  if (!match) return false;
  const current = match.slice(1).map(Number), minimum = CLAUDE_PAIRING_MINIMUM.split('.').map(Number);
  return current.every(Number.isSafeInteger) && current[0] === minimum[0] &&
    (current[1] > minimum[1] || (current[1] === minimum[1] && current[2] >= minimum[2]));
}
async function compatibleClaude(neutral) {
  try {
    const inspected = await localClaude(['plugin','list','--json'],undefined,{cwd:neutral});
    const entries = JSON.parse(inspected.stdout).filter(entry=>entry.id==='cairn-memory@cairn-memory');
    if (inspected.code!==0 || !entries.length || entries.some(entry=>!entry.enabled || entry.errors?.length ||
      !['user','project','local'].includes(entry.scope) ||
      !supportsClaudePairing(entry.version))) return false;
    const config = await localClaude(['plugin','configure','cairn-memory@cairn-memory','--json'],undefined,{cwd:neutral});
    const metadata = JSON.parse(config.stdout);
    return config.code===0 && [...metadata.configured,...metadata.unconfigured].includes('pairing_record');
  } catch { return false; }
}

async function prepareIdentity({ previous, prompt, write, t, neutral, codexHome, pairingConsent, identityPlan, hostsStopped, progress=()=>{} }) {
  const addingClaude = pairingConsent === 'shared' && previous && !previous.usesClaude;
  if (previous && !addingClaude) {
    const resolved = await resolveClient(clientOptions(previous));
    if (!resolved.enabled) {
      if (!previous.usesClaude || resolved.status!=='pairing_needed') throw new Error('identity_unavailable');
      // Resume an interrupted explicit pairing, never fall back to a new target.
    } else {
      if (resolved.root !== previous.root) throw new Error('identity_unavailable');
      // Never silently switch an established memory identity when a plugin is
      // removed/downgraded. Codex can retain its already delivered binding.
      if (previous.usesClaude && !await compatibleClaude(neutral)) write(t('codex_existing_pair_kept'));
      if (!previous.usesClaude && await compatibleClaude(neutral)) write(t('codex_standalone_kept'));
      return async () => ({ root:previous.root,usesClaude:previous.usesClaude,pairingRecord:previous.pairingRecord });
    }
  }
  const home = await realpath(homedir());
  const detected = await detectClients({ home,setup:true,standardClaudeOrigin:true,
    ...(addingClaude ? {root:previous.root} : {}) });
  const compatible = pairingConsent !== 'standalone' && await compatibleClaude(neutral);
  if (previous && !addingClaude && (!compatible || detected.locations.pairing!==previous.pairingRecord || detected.record?.root!==previous.root))
    throw new Error('identity_unavailable');
  if (!compatible) {
    if (pairingConsent === 'shared') throw new Error('claude_pairing_unavailable');
    write(t('codex_standalone'));
    // Standalone always has its own root, including when Claude has no key yet.
    // Installing Codex must not claim Claude's future default identity directory.
    const options = {client:'codex',home,usesClaude:false,initialize:true,env:{HOME:home},
      root:join(codexHome,'cairn-standalone'),isolatedCodex:true};
    return async () => {
      const resolved = await resolveClient(options);
      if (!resolved.enabled) throw new Error('identity_unavailable');
      return {root:resolved.root,usesClaude:false,pairingRecord:null};
    };
  }
  if (!hostsStopped) await confirmStopped({write,prompt,t});
  if (detected.keys.length > 1 && !detected.record && !identityPlan) throw new Error('identity_conflict');
  const profileRoot = detected.install.clients.claude?.profileRoot ??
    process.env.CLAUDE_PLUGIN_DATA ?? detected.locations.knownClaudeRoot;
  const root = identityPlan?.root ?? detected.record?.root ?? (addingClaude ? previous.root : detected.keys[0]) ?? detected.locations.defaultRoot;
  return async () => {
    // The host may have created its data directory as 0755. Explicit stopped
    // adoption makes only the owned identity root private, without changing keys.
    try {
      const info = await lstat(root);
      if (!info.isDirectory() || info.isSymbolicLink() || info.uid!==process.getuid()) throw new Error('unsafe_identity_root');
      await chmod(root,0o700);
    } catch (error) {if(error.code!=='ENOENT')throw error;}
    const options = { home, root,claudeProfileRoot:profileRoot, standardClaudeOrigin:true,
      // Only the combined, explicitly consented setup may bootstrap keyless
      // Claude. Explicit Codex retains the established Claude-key requirement.
      ...(pairingConsent === 'shared' ? {} : {usesClaude:true}),
      hostsStopped:true,consent:{claude:true,codex:true},adopt:detected.keys.length>0 };
    if (identityPlan) await assertIdentityUnchanged(identityPlan);
    if (identityPlan) options.checkpoint=async point=>{if(point==='binding-written')await backupIdentity(identityPlan);};
    progress('identity_initialize');
    const pending = await initializePairing(options);
    if (!pending.pairingRecord) throw new Error('identity_unavailable');
    // Native Claude delivery happens only after the disabled Codex binding is
    // durable. A hook/credential failure cannot strand Claude behind H5 or a cap.
    return {root:pending.root,usesClaude:true,pairingRecord:pending.pairingRecord,complete:options};
  };
}

async function deliverClaudeIdentity(identity,neutral) {
  const saved = await localClaude(['plugin','configure','cairn-memory@cairn-memory','--values-stdin'],
    JSON.stringify({pairing_record:identity.pairingRecord}),{cwd:neutral});
  const inspected = await localClaude(['plugin','configure','cairn-memory@cairn-memory','--json'],undefined,{cwd:neutral});
  let verified = false;
  try {verified = inspected.code===0 && JSON.parse(inspected.stdout).configured.includes('pairing_record');} catch { /* private output */ }
  if (saved.code!==0 || !verified) throw new Error('claude_pairing_unavailable');
}

async function rotateBoundary(root) {
  await rotateAutomaticBoundary(root);
}

export async function installedStatus({home,hostVersion,write,t,snapshot,cliHost,hostVerdict,verbose=false}) {
  const path = join(home,'cairn','installation.json');
  const installed=await readInstallation(path).then(()=>true,()=>false);
  const verdicts=[{host:cliHost,verdict:hostVerdict??{status:'pending'},version:hostVersion}];
  for(let host of await observedHosts(path)) {
    if(host.identity===cliHost?.identity && host.kind===cliHost?.kind)continue;
    let verdict={status:'pending'};
    try {
      host=await refreshObservedHost(host);
      verdict=installed?await qualifyBinary(path,host):await cachedQualification(path,host);
    } catch {/* unavailable host is reported as pending, never on */}
    if(host.identity!==cliHost?.identity || host.kind!==cliHost?.kind)verdicts.push({host,verdict,version:verdict.version,observed:true});
  }
  write(`Codex ${hostVersion}`);
  for(const item of verdicts) {
    const values={version:item.version??t('unknown')};
    if (item.verdict.status!=='qualified') write(t(`codex_format_${item.verdict.status==='changed'?'changed':item.verdict.status==='unavailable'?'unavailable':'pending'}`,values));
    if(verbose && item.verdict.status==='qualified')write(t('host_format_status',{kind:item.host.kind,observed:item.observed?t('last_observed_prefix'):'',...values}));
  }
  const formatQualified=verdicts.every(item=>item.verdict.status==='qualified');
  const anyQualified=verdicts.some(item=>item.verdict.status==='qualified');
  try {
    const config = await readInstallation(path);
    const hooks = JSON.parse((await snapshot(join(home,'hooks.json'))).text || '{}');
    const registered = events.every(event => hooks.hooks?.[event]?.some(group =>
      group.hooks?.some(hook => hook.command === hookCommand(config,path,event))));
    const credential = await readCredential(path,config.endpoint).then(() => true,() => false);
    const inspectedPolicy = await inspectAutomaticPolicy(config.root,config.endpoint);
    const policy = inspectedPolicy.policy;
    const state=!anyQualified?'unsupported_host':!config.enabled?'disabled':
      !registered?'registration_incomplete':!credential?'credential_missing':
      inspectedPolicy.state==='invalid'?'policy_invalid_or_unreadable':
      !policy || policy.dailyCap!==config.dailyCap?'policy_missing_or_conflicting':'registered';
    write(t('codex_hooks_status',{state:t(state,{host:new URL(config.endpoint).host})}));
    if(credential)write(t('signin_saved'));
    if(verbose)write(t('codex_runtime_version',{version,host:hostVersion}));
    const control = await readControlState(config.root);
    const target = hostedTargetId(config);
    const quotaBytes = await privateRead(join(config.root,'hosted-quota',target+'.json'),{missing:true});
    const quotaValue = quotaBytes ? JSON.parse(quotaBytes) : null;
    const quota = quotaValue === null ? 'open' : quotaValue.version===2 &&
      ['recall','capture'].every(operation => quotaValue.operations?.[operation]?.mode==='open') ? 'open' : 'limited_or_invalid';
    const usageBytes = await privateRead(join(config.root,'usage',target+'.json'),{missing:true});
    const usage = usageBytes===undefined ? null : validateUsage(JSON.parse(usageBytes));
    const today=new Date().toISOString().slice(0,10);
    const used = !usage || usage.day!==today ? 0 : usage.used;
    const matured=usage?.pendingPolicy && usage.day<today && usage.pendingPolicy.day<=today;
    const effectiveCap=usage ? matured?usage.pendingPolicy.cap:usage.cap : config.dailyCap;
    write(t('codex_hooks_policy',{pause:t(control.paused?'paused':'active'),cap:effectiveCap,
      used,shared:config.usesClaude?t('shared_status'):''}));
    write(t(effectiveCap!==config.dailyCap?(used>=effectiveCap?'cap_pending_reached':'cap_pending'):used>=effectiveCap?'cap_reached':'cap_status_hint',{cap:config.dailyCap}));
    if(quota!=='open')write(t('quota_limited'));
    write(t('codex_prompt_recall_status',{state:t(await promptRecallEnabled(path)&&anyQualified?(formatQualified?'on':'recall_per_host'):'off')}));
    if(config.captureExec===true)write(t('codex_exec_enabled'));
    write(t('codex_hooks_trust'));
    const hostedBytes = await privateRead(join(config.root,'hosted-pause',target+'.json'),{missing:true});
    const hosted = hostedBytes===undefined ? null : JSON.parse(hostedBytes);
    if (verbose || (conforms('pause-state',hosted) && hosted.enforced && hosted.paused))
      write(t('codex_hosted_pause_status',{state:conforms('pause-state',hosted)&&hosted.enforced?t(hosted.paused?'paused':'active'):t('unknown')}));
    if(verbose){
      const availability = await hostedPauseStatus(config);
      write(t('codex_shared_pause_availability',{state:t('pause_availability_'+availability.state.replaceAll(' ','_'))}));
      write(t('codex_startup_gate'));
    }
    const detected = await detectClients({home:config.home,setup:true,standardClaudeOrigin:true});
    if(config.usesClaude && detected.keys.some(root=>root!==config.root))write(t('identity_reappeared'));
  } catch(error) { write(t(error.code==='ENOENT'?'not_installed':'status_unsafe')); }

}

// Remove only Codex's binding. Keep the Claude root, key, pause and immutable
// binding history so old project memories remain addressable and a lost key can
// never silently mint a replacement. The shared setup lock serializes pairing.
async function restoreClaude(config, neutral) {
  if (config && !config.usesClaude) return;
  const home = config?.home ?? await realpath(homedir());
  const options = {home,setup:true,standardClaudeOrigin:true,env:{HOME:home}};
  const initial = await detectClients(options);
  if (!initial.install.clients.codex && !initial.install.shared && !initial.record) {
    if (config?.usesClaude) {
      const profile = initial.install.clients.claude?.profileRoot;
      const restored = await resolveClient({client:'claude',home,env:{HOME:home,...(profile?{CLAUDE_PLUGIN_DATA:profile}:{})}});
      if (!restored.enabled || restored.root !== config.root) throw new Error('claude_restore_failed');
    }
    return;
  }
  if (!initial.install.shared || !initial.record || !initial.install.clients.claude?.profileRoot ||
      (config && (initial.record.root !== config.root || initial.locations.pairing !== config.pairingRecord)))
    throw new Error('claude_restore_failed');
  await stateLock(join(initial.locations.coordination,'setup.lock'),async () => {
    const current = await detectClients(options);
    const {install,record,locations} = current;
    if (!record || record.id !== initial.record.id || record.root !== initial.record.root ||
        install.resetPending || install.shared?.id !== record.id) throw new Error('claude_restore_failed');
    const binding = install.clients.claude;
    const claude = {client:'claude',home,env:{HOME:home,CLAUDE_PLUGIN_DATA:binding.profileRoot}};
    const installBytes = await privateRead(locations.install), recordBytes = await privateRead(locations.pairing);
    // Native configure is authoritative for the option write. Never echo native
    // output, which may contain unrelated credentials. Do not update any scope.
    const saved = await localClaude(['plugin','configure','cairn-memory@cairn-memory','--values-stdin'],
      JSON.stringify({pairing_record:''}),{cwd:neutral});
    if (saved.code !== 0) throw new Error('claude_restore_failed');
    try {
      const solo = {...install,clients:{claude:{...binding,state:'established'}}};
      delete solo.shared;
      await privateWrite(locations.install,JSON.stringify(solo));
      await unlink(locations.pairing);
      const restored = await resolveClient(claude);
      if (!restored.enabled || restored.root !== record.root) throw new Error('claude_restore_failed');
    } catch (error) {
      await privateWrite(locations.install,installBytes);
      await privateWrite(locations.pairing,recordBytes);
      await localClaude(['plugin','configure','cairn-memory@cairn-memory','--values-stdin'],
        JSON.stringify({pairing_record:locations.pairing}),{cwd:neutral});
      throw error;
    }
  },{timeoutMs:2000});
}

const unpairReceipt = (userHome, installation) => join(userHome,'.cairn-memory-clients',
  'codex-uninstall-'+createHash('sha256').update(installation).digest('hex')+'.json');

export async function controlCodex({action,home,write,t,snapshot,unchanged,neutral,SetupError,dailyCap,captureExec,progress={}}) {
  const directory = join(home,'cairn');
  const path = join(directory,'installation.json');
  let config;
  try {config = await readInstallation(path);} catch(error) {
    if (error.code==='ENOENT' && ['disable','uninstall'].includes(action)) {
      if (action==='uninstall') {
        try {
          const userHome = await realpath(homedir());
          const receiptPath = unpairReceipt(userHome,path);
          const bytes = await privateRead(receiptPath,{missing:true});
          if (bytes !== undefined) {
            const previous = validateInstallation(JSON.parse(bytes));
            if (previous.home !== userHome || !previous.usesClaude) throw new Error('claude_restore_failed');
            await restoreClaude(previous,neutral);
            await unlink(receiptPath);
          } else {
            // No ownership receipt: never unpair a different CODEX_HOME install.
            // Also never mask a pending shared Claude binding as successful cleanup.
            const detected = await detectClients({home:userHome,setup:true,standardClaudeOrigin:true,env:{HOME:userHome}});
            const profile = detected.install.clients.claude?.profileRoot;
            if (profile) {
              const existing = await resolveClient({client:'claude',home:userHome,
                pairingRecord:detected.record ? detected.locations.pairing : undefined,
                env:{HOME:userHome,CLAUDE_PLUGIN_DATA:profile}});
              if (!existing.enabled) throw new Error('claude_restore_failed');
            } else if (detected.install.shared) throw new Error('claude_restore_failed');
          }
        }
        catch {write(t('codex_unpair_failed'));return 1;}
      }
      write(t('not_installed'));return 0;
    }
    throw error;
  }
  if (action==='pause') {await setPaused(config.root,true);write(t('pause_done'));if(config.usesClaude)write(t('pause_shared'));write(t('pause_no_backfill'));return 0;}
  if (action==='prompt-recall-off' || action==='prompt-recall-on') {
    const enabled = action==='prompt-recall-on';
    await writePromptRecall(path,enabled);
    if (await promptRecallEnabled(path)!==enabled) throw new Error('prompt_recall_unverified');
    write(t('codex_prompt_recall_status',{state:t(enabled?'on':'off')}));return 0;
  }
  if (action==='resume') {
    const {policy} = await inspectAutomaticPolicy(config.root,config.endpoint);
    if (policy) await automaticGuard(config.root,config.endpoint,policy).resume();
    const quota = await resumeHostedQuota({root:config.root,targetId:hostedTargetId(config)});
    if (quota.status==='unavailable') throw new Error('quota_unavailable');
    await setPaused(config.root,false);write(t('resume_done',{clients:config.usesClaude?'Claude Code '+(t.locale==='zh-TW'?'和':'and')+' Codex':'Codex'}));
    if(['quota_reached','busy','repaired'].includes(quota.status))write(t('resume_'+quota.status));return 0;
  }
  const lockPath = join(home,'.cairn-setup.lock');
  let lock;
  try {lock = await open(lockPath,'wx',0o600);}
  catch(error){if(error.code==='EEXIST')throw new SetupError('codex_lock',2);throw error;}
  try {
    if(action==='config') {
      if(dailyCap===undefined && captureExec===undefined)throw new SetupError('config_option_required',2);
      const nextCap=dailyCap ?? config.dailyCap;
      if(captureExec!==undefined) {
        // Older frozen launchers reject the new field and cannot implement the
        // default. Updating native hook commands belongs to stopped-host setup.
        const expected=await readFile(new URL('../runtime/manifest.json',import.meta.url),'utf8');
        if(await privateRead(join(config.runtime,'manifest.json'),{missing:true})!==expected)
          throw new SetupError('exec_runtime_update_required',2,{setting:captureExec?'on':'off'});
      }
      const current=await readInstallation(path);
      if(JSON.stringify(current)!==JSON.stringify(config))throw new SetupError('codex_concurrent',2);
      // Deny captures during policy/config publication; usage and pause stay intact.
      await privateWrite(path,JSON.stringify({...config,enabled:false}));progress.install=true;
      await rotateBoundary(config.root);
      await privateWrite(policyPath(config.root,config.endpoint),JSON.stringify({version:1,dailyCap:nextCap,concurrency:2}));
      if(nextCap!==config.dailyCap && !(await automaticGuard(config.root,config.endpoint,{dailyCap:nextCap,concurrency:2}).status()).ok)
        throw new SetupError('cap_policy_conflict',2);
      await privateWrite(path,JSON.stringify({...config,dailyCap:nextCap,...(captureExec===undefined?{}:{captureExec})}));
      if(dailyCap!==undefined)write(t('cap_configured',{cap:dailyCap}));
      if(captureExec!==undefined)write(t(captureExec?'codex_exec_enabled':'codex_exec_skipped'));return 0;
    }
    // Revoke launch and every frozen generation before detaching handlers.
    await privateWrite(path,JSON.stringify({...config,enabled:false}));
    await rotateBoundary(config.root);
    const hookPath = join(home,'hooks.json');
    const before = await snapshot(hookPath);
    const text = mergeHooks(before.text,path,config,config,false);
    if (!unchanged(before,await snapshot(hookPath))) throw new Error('hooks_changed');
    if (text!==before.text) {
      // hooks.json may have unrelated handlers and host-default modes.
      await hostWrite(hookPath,text,before,{snapshot,unchanged});
    }
    if (action==='uninstall') {
      // Cairn owns this entire private directory. Memory, identity, pause/quota
      // and MCP authorization are intentionally retained for the other client.
      let restored = true;
      try {
        const receipt = unpairReceipt(config.home,path);
        // Secret-free recovery ownership survives removal of installation.json.
        if (config.usesClaude) await privateWrite(receipt,JSON.stringify(config));
        await restoreClaude(config,neutral);
        if (config.usesClaude) await unlink(receipt);
      }
      catch {restored=false;}
      const policyFile = policyPath(config.root,config.endpoint);
      try {
        if (await checkedPath(dirname(policyFile),{directory:true,missing:true})) {
          await unlink(policyFile).catch(error=>{if(error.code!=='ENOENT')throw error;});
        }
      } catch {write(t('codex_policy_cleanup_unsafe'));}
      // An unsafe optional policy leaf cannot retain the plaintext credential.
      await checkedPath(directory,{directory:true});
      await rm(directory,{recursive:true});
      if (!restored) {write(t('codex_unpair_failed'));return 1;}
    }
    write(t(action==='uninstall'?'uninstalled_control':'disabled_control',{url:new URL('/settings/tokens',config.endpoint).href.replace(/^https?:\/\//u,'')}));return 0;
  } finally {await lock.close();await unlink(lockPath);}
}

export async function setupInstalledCodex(context) {
  const {action,flags,home,hostVersion,write,t,snapshot,unchanged,before,configPath,existing,usable,
    interactive,prompt,endpointOverride,neutral,get,SetupError,signal,authOptions,browse,progress={}} = context;
  if (action==='status' || flags.includes('--dry-run')) {
    await installedStatus(context);
    if (flags.includes('--dry-run')) write(t('codex_hooks_dry'));
    return 0;
  }
  if (context.hostVerdict?.status!=='qualified') throw new SetupError('codex_host_unqualified');
  if (!interactive) throw new SetupError('tty_required',2);
  if (existing && (!usable || !existing.enabled)) throw new SetupError('codex_repair');
  // All consent/identity questions precede runtime copies and authorization.
  if(!context.coordinated)write(t('privacy_codex',{privacy:PRIVACY_URL}));
  let identityPlan=context.identityPlan;
  if(!context.hostsStopped && context.pairingConsent!=='standalone' && await compatibleClaude(neutral)){
    await confirmStopped({write,prompt,t});context.hostsStopped=true;
    identityPlan=await chooseIdentity({write,prompt,t,interactive});
    if(identityPlan?.declined)return 0;
  }
  await mkdir(home,{recursive:true,mode:0o700});
  const info = await lstat(home);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid!==process.getuid() || (info.mode&0o022)) throw new Error('unsafe_home');
  const directory = join(home,'cairn');
  const path = join(directory,'installation.json');
  let previous;
  try {previous=await readInstallation(path);} catch (error) {if(error.code!=='ENOENT')throw error;}
  const currentCredential = previous ? await readCredential(path,previous.endpoint).catch(error=>{
    if (error.code !== 'ENOENT' && !flags.includes('--reauthorize')) throw new SetupError('authorization_credential_unavailable',2);
  }) : undefined;
  if (currentCredential && endpointOverride && !flags.includes('--reauthorize')) throw new SetupError('endpoint_reauthorize',2);
  const endpoint = await selectEndpoint({endpointOverride,existingEndpoint:authOptions.authorization?.endpoint??previous?.endpoint??
    (existing?existing.transport.url.slice(0,-8):undefined),prompt,write,t});
  progress.endpoint=endpoint;
  if (previous && previous.endpoint!==endpoint && !flags.includes('--reauthorize')) throw new SetupError('codex_endpoint_conflict',2);
  const lockPath = join(home,'.cairn-setup.lock');
  let lock;
  try {lock = await open(lockPath,'wx',0o600);}
  catch(error){if(error.code==='EEXIST')throw new SetupError('codex_lock',2);throw error;}
  let phase = 'hooks_validation';
  let pairingPending = false;
  try {
    // Validate hooks BEFORE pairing or requesting credentials.
    const hooksPath = join(home,'hooks.json');
    const hooksBefore = await snapshot(hooksPath);
    mergeHooks(hooksBefore.text,path,previous,previous,false);
    phase = 'runtime_copy';
    if(context.expectedCodex && !unchanged(context.expectedCodex,await snapshot(configPath)))throw new SetupError('codex_concurrent',2);
    const runtime = await copyRuntime(directory);progress.runtime=true;
    phase = 'identity';
    const applyIdentity = await prepareIdentity({previous,prompt,write,t,neutral,codexHome:home,pairingConsent:context.pairingConsent,identityPlan,hostsStopped:context.hostsStopped,progress:value=>{phase=value;}});
    const dailyCap = context.dailyCap ?? previous?.dailyCap ?? DEFAULT_CODEX_DAILY_CAP;
    phase = 'authorization';
    if (!currentCredential || flags.includes('--reauthorize')) {
      const save = async values => {
        let token = values.api_token;values.api_token=undefined;
        try {
          await writeCredential(path,endpoint,token);progress.credential=true;
          if (await readCredential(path,endpoint)!==token) throw new Error('credential_save_failed');
        } finally {token=undefined;}
      };
      const result = await browserAuthorize(endpoint,{...authOptions,write,t,prompt,browse,save,signal,
        noBrowser:flags.includes('--no-browser'),noClipboard:flags.includes('--no-clipboard')});
      if (result.unsupported) throw new SetupError('codex_browser_required',1,{url:endpoint+'/api/mcp'});
      if(!result.reported)write(t(flags.includes('--reauthorize')?'login_replaced':'connected_expiry',{date:new Date(result.expiresAt).toLocaleDateString(t.locale)}));
      if(flags.includes('--reauthorize')&&!result.reported)write(t('credential_replaced',{url:new URL('/settings/tokens',endpoint).href.replace(/^https?:\/\//u,'')}));
      write(t('codex_hook_plaintext'));
    } else if(!context.coordinated)write(t('credential_kept'));
    let mcpText = before.text;
    phase = 'mcp_validation';
    let mcpToken;
    if (!existing) {
      mcpText += (mcpText?(mcpText.endsWith('\n')?'\n':'\n\n'):'')+
        `[mcp_servers.cairn]\nurl = ${JSON.stringify(endpoint+'/api/mcp')}\n`;
    }
    const hasMCPAuth = Object.keys(existing?.transport.http_headers??{}).length || existing?.transport.http_headers?.Authorization || existing?.transport.bearer_token_env_var ||
      existing?.transport.http_headers_helper || Object.keys(existing?.transport.env_http_headers??{}).length;
    if(existing && existing.transport.url!==endpoint+'/api/mcp') {
      if(!context.endpointChoice || hasMCPAuth || hostVersion!=='0.160.1' ||
          /(?:bearer_token_env_var|http_headers|env_http_headers|oauth|headers_helper)\s*(?:=|\])/u.test(before.text))throw new SetupError('codex_endpoint_conflict',2);
      // Only an unambiguous plain native table is rewritten; native CLI validates it.
      const pattern=/^(\[mcp_servers\.cairn\]\r?\n)([\s\S]*?)(?=^\[|$(?![\s\S]))/mu;
      let matched=false;
      mcpText=mcpText.replace(pattern,(_all,heading,body)=>{
        const urls=body.match(/^url\s*=.*$/gmu);
        if(urls?.length!==1)throw new SetupError('codex_endpoint_conflict',2);
        matched=true;return heading+body.replace(/^url\s*=.*$/mu,'url = '+JSON.stringify(endpoint+'/api/mcp'));
      });
      if(!matched)throw new SetupError('codex_endpoint_conflict',2);
    }
    if (!hasMCPAuth) {
      if (flags.includes('--manual-token')) {
        write(t('codex_plaintext'));
        mcpToken=await collectToken({prompt,write,t});
        mcpText+=`\n[mcp_servers.cairn.http_headers]\nAuthorization = ${JSON.stringify('Bearer '+mcpToken)}\n`;
      }
    }
    const validation = join(neutral,'cx5-candidate');await mkdir(validation,{mode:0o700});
    await privateWrite(join(validation,'config.toml'),mcpText);
    const checked = await get({env:{CODEX_HOME:validation}});
    if (!checked.enabled || checked.transport.url!==endpoint+'/api/mcp' ||
        (mcpToken && checked.transport.http_headers?.Authorization!=='Bearer '+mcpToken)) throw new Error('invalid_candidate');
    mcpToken=undefined;
    phase = 'identity_initialize';
    const identity = await applyIdentity();
    pairingPending = Boolean(identity.complete);
    const config = {version:1,enabled:false,hostVersion,codex:binary('codex'),node:process.execPath,
      home:await realpath(homedir()),root:identity.root,usesClaude:identity.usesClaude,
      pairingRecord:identity.pairingRecord,endpoint,runtime,dailyCap,
      captureExec:context.captureExec ?? previous?.captureExec ?? false};
    const hooksText = mergeHooks(hooksBefore.text,path,config,previous,true);
    phase = 'registration';
    if (!unchanged(before,await snapshot(configPath)) || !unchanged(hooksBefore,await snapshot(hooksPath))) throw new Error('concurrent_change');
    if (mcpText!==before.text) {await hostWrite(configPath,mcpText,before,{snapshot,unchanged});progress.config=true;}
    // Authorization and candidate validation succeeded. Keep the last successful
    // installation until here. Persist disabled binding before external Claude
    // delivery; finish identity readiness before fallible policy/hook publication.
    if (previous) await rotateBoundary(previous.root);
    await privateWrite(path,JSON.stringify(config));progress.install=true;
    if (identity.complete) {
      const delivered = await readInstallation(path);
      if (delivered.root!==identity.root || delivered.pairingRecord!==identity.pairingRecord) throw new Error('codex_pairing_unavailable');
      phase = 'identity_deliver';
      await deliverClaudeIdentity(identity,neutral);
      await completePairing({...identity.complete,configured:{claude:true,codex:true}});
      pairingPending = false;
    }
    phase = 'registration';
    // Local daily cap/concurrency policy is consumed only by Codex.
    await privateWrite(policyPath(config.root,endpoint),JSON.stringify({version:1,dailyCap,concurrency:2}));
    if(previous && dailyCap!==previous.dailyCap && !(await automaticGuard(config.root,endpoint,{dailyCap,concurrency:2}).status()).ok)
      throw new SetupError('cap_policy_conflict',2);
    if (hooksText!==hooksBefore.text) {await hostWrite(hooksPath,hooksText,hooksBefore,{snapshot,unchanged});progress.hooks=true;}
    phase = 'activation';
    if (!unchanged({text:hooksText,stat:(await snapshot(hooksPath)).stat},await snapshot(hooksPath))) throw new Error('hooks_changed');
    await privateWrite(path,JSON.stringify({...config,enabled:true}));
    write(t(previous?'codex_hooks_updated':'codex_hooks_ready'));
    write(t(config.captureExec?'codex_exec_enabled':'codex_exec_skipped'));reportBackups(identityPlan,write,t);
    if(!context.coordinated){write(t('next_codex'));write(t('optional_mcp'));}
    if(context.verbose)write(t('codex_startup_gate'));return 0;
  } catch(error) {
    if(identityPlan?.backups.length){
      try{await restoreIdentity(identityPlan);write(t('identity_restored'));}
      catch{write(t('identity_restore_failed'));}
    }
    if (pairingPending) write(t('codex_pairing_pending'));
    if(error instanceof SetupError)throw error;
    if(['identity_conflict','claude_pairing_unavailable','sharing_required'].includes(error.message))throw new SetupError(error.message,2);
    const code = ['ENOENT','EACCES','EEXIST','EPERM','ERR_INVALID_ARG_TYPE'].includes(error.code)?error.code:'internal';
    throw new SetupError('codex_phase_failed',1,{phase,code});
  } finally {await lock.close();await unlink(lockPath);}
}

import { readFile, mkdir, lstat, open, unlink, rm, realpath, rename, chmod } from 'node:fs/promises';
import { readFileSync, constants, accessSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, delimiter, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { browserAuthorize, validToken } from './auth.mjs';
import { selectEndpoint } from './options.mjs';
import { privateRead, privateWrite, privateDirectory, checkedPath } from '../runtime/integrations/client/private-state.mjs';
import { resolveClient, detectClients, initializePairing, completePairing } from '../runtime/integrations/client/pairing.mjs';
import { readControlState, setPaused } from '../runtime/integrations/client/control-state.mjs';
import { automaticPolicy, automaticGuard, policyPath, rotateAutomaticBoundary } from '../runtime/integrations/client/automatic-policy.mjs';
import { hostedTargetId, resumeHostedQuota } from '../runtime/integrations/client/transport-hosted.mjs';
import { validateUsage } from '../runtime/integrations/client/runtime-usage.mjs';
import { conforms } from '../runtime/integrations/client/hosted-contract.mjs';
import { readInstallation, readCredential, writeCredential, clientOptions } from '../runtime/integrations/codex/installed-state.mjs';
import { qualifiedHost } from '../runtime/integrations/codex/parser.mjs';

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

// Remove exactly our prior handlers, even when they share a group with others.
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
      hooks: group.hooks.filter(hook => !commands.has(hook.command)) })).filter(group => group.hooks.length);
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

async function claudePolicyCapability(neutral) {
  const inspected=await localClaude(['plugin','configure','cairn-memory@cairn-memory','--json'],undefined,{cwd:neutral});
  try {
    const metadata=JSON.parse(inspected.stdout);
    return inspected.code===0 && [...metadata.configured,...metadata.unconfigured].includes('automatic_memory_policy');
  } catch {return false;}
}
async function ensureClaudePolicy(neutral,write,t) {
  if(await claudePolicyCapability(neutral))return true;
  const inspected=await localClaude(['plugin','list','--json'],undefined,{cwd:neutral});
  let entries;
  try {entries=JSON.parse(inspected.stdout).filter(entry=>entry.id==='cairn-memory@cairn-memory');}catch{return false;}
  if(inspected.code!==0 || !entries.length || entries.some(entry=>!entry.enabled || entry.errors?.length ||
    !['user','project','local'].includes(entry.scope)))return false;
  write(t('codex_claude_policy_update'));
  // Same supported native update commands as the Claude installer. Touch only
  // this marketplace/plugin at its existing scopes; never enable disabled ones.
  const refresh=await localClaude(['plugin','marketplace','update','cairn-memory'],undefined,{cwd:neutral});
  if(refresh.code!==0)return false;
  for(const scope of [...new Set(entries.map(entry=>entry.scope))]) {
    const updated=await localClaude(['plugin','update','cairn-memory@cairn-memory','--scope',scope],undefined,{cwd:neutral});
    if(updated.code!==0)return false;
  }
  return claudePolicyCapability(neutral);
}

async function prepareIdentity({ previous, prompt, write, t, neutral, progress=()=>{} }) {
  if (previous) {
    const resolved = await resolveClient(clientOptions(previous));
    if (resolved.enabled && resolved.root === previous.root &&
        (!previous.usesClaude || await claudePolicyCapability(neutral)))
      return { root:previous.root,usesClaude:previous.usesClaude,pairingRecord:previous.pairingRecord };
    if (!previous.usesClaude) throw new Error('identity_unavailable');
  }
  const home = await realpath(homedir());
  const detected = await detectClients({ home,setup:true,standardClaudeOrigin:true });
  const usesClaude = Boolean(detected.install.clients.claude) ||
    detected.keys.includes(detected.locations.knownClaudeRoot) ||
    (() => {try{binary('claude');return true;}catch{return false;}})();
  if (!usesClaude) {
    const options = {client:'codex',home,usesClaude:false,initialize:true,env:{HOME:home}};
    const resolved = await resolveClient(options);
    if (!resolved.enabled) throw new Error('identity_unavailable');
    return {root:resolved.root,usesClaude:false,pairingRecord:null};
  }
  write(t('codex_sharing'));
  if (!/^(?:y|yes)$/iu.test((await prompt(t('codex_stopped_prompt'))).trim())) throw new Error('sharing_required');
  const compatible = await ensureClaudePolicy(neutral,write,t);
  if (!compatible) { write(t('codex_claude_policy_required')); throw new Error('claude_policy_unavailable'); }
  if (detected.keys.length > 1 && !detected.record) throw new Error('identity_conflict');
  const profileRoot = detected.install.clients.claude?.profileRoot ??
    process.env.CLAUDE_PLUGIN_DATA ?? detected.locations.knownClaudeRoot;
  const root = detected.record?.root ?? detected.keys[0] ?? detected.locations.defaultRoot;
  // The host may have created its data directory as 0755. Explicit stopped
  // adoption makes only the owned identity root private, without changing keys.
  try {
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid!==process.getuid()) throw new Error('unsafe_identity_root');
    await chmod(root,0o700);
  } catch (error) {if(error.code!=='ENOENT')throw error;}
  const options = { home, root,claudeProfileRoot:profileRoot, standardClaudeOrigin:true,usesClaude:true,
    hostsStopped:true,consent:{claude:true,codex:true},adopt:detected.keys.length>0 };
  progress('identity_initialize');
  const pending = await initializePairing(options);
  if (!pending.pairingRecord) throw new Error('identity_unavailable');
  // Deliver only identity/policy through the supported API. Claude's hidden
  // credential/endpoint remain bound together; do not retarget its unseen token.
  progress('identity_deliver');
  const saved = await localClaude(['plugin','configure','cairn-memory@cairn-memory','--values-stdin'],
    JSON.stringify({pairing_record:pending.pairingRecord,automatic_memory_policy:true}),{cwd:neutral});
  const inspected = await localClaude(['plugin','configure','cairn-memory@cairn-memory','--json'],undefined,{cwd:neutral});
  let verified = false;
  try {verified = inspected.code===0 && ['pairing_record','automatic_memory_policy'].every(key=>JSON.parse(inspected.stdout).configured.includes(key));} catch { /* private output */ }
  if (saved.code!==0 || !verified) throw new Error('claude_pairing_unavailable');
  // Completion happens after Codex hooks have been written and verified below.
  return {root:pending.root,usesClaude:true,pairingRecord:pending.pairingRecord,complete:options};
}

async function rotateBoundary(root) {
  await rotateAutomaticBoundary(root);
}

export async function installedStatus({home,hostVersion,write,t,snapshot}) {
  const path = join(home,'cairn','installation.json');
  try {
    const config = await readInstallation(path);
    const hooks = JSON.parse((await snapshot(join(home,'hooks.json'))).text || '{}');
    const registered = events.every(event => hooks.hooks?.[event]?.some(group =>
      group.hooks?.some(hook => hook.command === hookCommand(config,path,event))));
    const credential = await readCredential(path,config.endpoint).then(() => true,() => false);
    const policy = await automaticPolicy(config.root,config.endpoint);
    write(t('codex_hooks_status',{state:!qualifiedHost(hostVersion)?'unsupported_host':!config.enabled?'disabled':
      !registered?'registration_incomplete':!credential?'credential_missing':
      !policy || policy.dailyCap!==config.dailyCap?'policy_missing_or_conflicting':'registered'}));
    write(t('codex_runtime_version',{version,host:hostVersion}));
    write(t('codex_hooks_trust'));
    const control = await readControlState(config.root);
    const target = hostedTargetId(config);
    const quotaBytes = await privateRead(join(config.root,'hosted-quota',target+'.json'),{missing:true});
    const quotaValue = quotaBytes ? JSON.parse(quotaBytes) : null;
    const quota = quotaValue === null ? 'open' : quotaValue.version===2 &&
      ['recall','capture'].every(operation => quotaValue.operations?.[operation]?.mode==='open') ? 'open' : 'limited_or_invalid';
    const usageBytes = await privateRead(join(config.root,'usage',target+'.json'),{missing:true});
    const usage = usageBytes===undefined ? null : validateUsage(JSON.parse(usageBytes));
    const used = !usage || usage.day!==new Date().toISOString().slice(0,10) ? 0 : usage.used;
    write(t('codex_hooks_policy',{pause:control.paused?'paused':'active',cap:config.dailyCap,
      used,quota}));
    const hostedBytes = await privateRead(join(config.root,'hosted-pause',target+'.json'),{missing:true});
    const hosted = hostedBytes===undefined ? null : JSON.parse(hostedBytes);
    write(t('codex_hosted_pause_status',{state:conforms('pause-state',hosted) && hosted.enforced ?
      `${hosted.paused?'paused':'active'}; generation ${hosted.generation}` : 'unknown'}));
    write(t('codex_startup_gate'));
  } catch { write(t('codex_hooks_status',{state:'not_installed_or_unsafe'})); }
}

export async function controlCodex({action,home,write,t,snapshot,unchanged}) {
  const directory = join(home,'cairn');
  const path = join(directory,'installation.json');
  let config;
  try {config = await readInstallation(path);} catch(error) {
    if (error.code==='ENOENT' && ['disable','uninstall'].includes(action)) {
      write(t('codex_control_done',{state:'not_installed'}));return 0;
    }
    throw error;
  }
  const policy = await automaticPolicy(config.root,config.endpoint);
  if (action==='pause') {await setPaused(config.root,true);write(t('codex_control_done',{state:'paused'}));return 0;}
  if (action==='resume') {
    if (policy) await automaticGuard(config.root,config.endpoint,policy).resume();
    const quota = await resumeHostedQuota({root:config.root,targetId:hostedTargetId(config)});
    if (quota.status==='unavailable') throw new Error('quota_unavailable');
    await setPaused(config.root,false);write(t('codex_control_done',{state:quota.status}));return 0;
  }
  const lockPath = join(home,'.cairn-setup.lock');
  const lock = await open(lockPath,'wx',0o600);
  try {
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
      await checkedPath(directory,{directory:true});
      await rm(directory,{recursive:true});
    }
    write(t('codex_control_done',{state:action==='uninstall'?'uninstalled':'disabled'}));return 0;
  } finally {await lock.close();await unlink(lockPath);}
}

export async function setupInstalledCodex(context) {
  const {action,flags,home,hostVersion,write,t,snapshot,unchanged,before,configPath,existing,usable,
    interactive,prompt,endpointOverride,neutral,get,SetupError,signal,authOptions,browse} = context;
  if (action==='status' || flags.includes('--dry-run')) {
    await installedStatus(context);
    if (flags.includes('--dry-run')) write(t('codex_hooks_dry'));
    return 0;
  }
  if (!qualifiedHost(hostVersion)) throw new SetupError('codex_host_unqualified');
  if (!interactive) throw new SetupError('tty_required',2);
  if (existing && (!usable || !existing.enabled)) throw new SetupError('codex_repair');
  await mkdir(home,{recursive:true,mode:0o700});
  const info = await lstat(home);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid!==process.getuid() || (info.mode&0o022)) throw new Error('unsafe_home');
  const directory = join(home,'cairn');
  const path = join(directory,'installation.json');
  let previous;
  try {previous=await readInstallation(path);} catch (error) {if(error.code!=='ENOENT')throw error;}
  const endpoint = await selectEndpoint({endpointOverride,existingEndpoint:previous?.endpoint??
    (existing?existing.transport.url.slice(0,-8):undefined),prompt,write,t});
  if (previous && previous.endpoint!==endpoint) throw new SetupError('codex_endpoint_conflict',2);
  const lockPath = join(home,'.cairn-setup.lock');
  const lock = await open(lockPath,'wx',0o600);
  let phase = 'hooks_validation';
  try {
    // Validate hooks BEFORE pairing or requesting credentials.
    const hooksPath = join(home,'hooks.json');
    const hooksBefore = await snapshot(hooksPath);
    mergeHooks(hooksBefore.text,path,previous,previous,false);
    phase = 'runtime_copy';
    const runtime = await copyRuntime(directory);
    phase = 'identity';
    const identity = await prepareIdentity({previous,prompt,write,t,neutral,progress:value=>{phase=value;}});
    let dailyCap = previous?.dailyCap;
    if (dailyCap===undefined) {
      const policy = await automaticPolicy(identity.root,endpoint);
      const answer = policy ? String(policy.dailyCap) : (await prompt(t('codex_cap_prompt'))).trim();
      dailyCap = Number(answer);
      if (!/^\d+$/u.test(answer) || !Number.isSafeInteger(dailyCap) || dailyCap<1 || dailyCap>100000) throw new Error('invalid_cap');
    }
    const config = {version:1,enabled:false,hostVersion,codex:binary('codex'),node:process.execPath,
      home:await realpath(homedir()),root:identity.root,usesClaude:identity.usesClaude,
      pairingRecord:identity.pairingRecord,endpoint,runtime,dailyCap};
    const currentCredential = await readCredential(path,endpoint).then(value=>value,()=>undefined);
    phase = 'authorization';
    if (!currentCredential || flags.includes('--reauthorize')) {
      if (previous) await rotateBoundary(previous.root);
      await privateWrite(path,JSON.stringify(config));
      const save = async values => {
        let token = values.api_token;values.api_token=undefined;
        try {
          await writeCredential(path,endpoint,token);
          if (await readCredential(path,endpoint)!==token) throw new Error('credential_save_failed');
        } finally {token=undefined;}
      };
      write(t('codex_hook_plaintext'));
      const result = await browserAuthorize(endpoint,{...authOptions,write,t,prompt,browse,save,signal,
        noBrowser:flags.includes('--no-browser'),noClipboard:flags.includes('--no-clipboard')});
      if (result.unsupported) throw new SetupError('codex_browser_required');
      write(t('connected_expiry',{date:new Date(result.expiresAt).toLocaleDateString(t.locale)}));
    }
    let mcpText = before.text;
    phase = 'mcp_validation';
    let mcpToken;
    if (!existing) {
      mcpText += (mcpText?(mcpText.endsWith('\n')?'\n':'\n\n'):'')+
        `[mcp_servers.cairn]\nurl = ${JSON.stringify(endpoint+'/api/mcp')}\n`;
    }
    const hasMCPAuth = existing?.transport.http_headers?.Authorization || existing?.transport.bearer_token_env_var ||
      existing?.transport.http_headers_helper || Object.keys(existing?.transport.env_http_headers??{}).length;
    if (!hasMCPAuth) {
      write(t('codex_oauth'));write(t('codex_login_command'));
      if (flags.includes('--manual-token') || (await prompt(t('codex_oauth_prompt'))).trim().toLowerCase()==='pat') {
        write(t('codex_plaintext'));
        mcpToken=await prompt(t('token_prompt'),{secret:true});
        if(!validToken(mcpToken))throw new Error('invalid_token');
        mcpText+=`\n[mcp_servers.cairn.http_headers]\nAuthorization = ${JSON.stringify('Bearer '+mcpToken)}\n`;
      }
    }
    const validation = join(neutral,'cx5-candidate');await mkdir(validation,{mode:0o700});
    await privateWrite(join(validation,'config.toml'),mcpText);
    const checked = await get({env:{CODEX_HOME:validation}});
    if (!checked.enabled || checked.transport.url!==endpoint+'/api/mcp' ||
        (mcpToken && checked.transport.http_headers?.Authorization!=='Bearer '+mcpToken)) throw new Error('invalid_candidate');
    mcpToken=undefined;
    const hooksText = mergeHooks(hooksBefore.text,path,config,previous,true);
    phase = 'registration';
    if (!unchanged(before,await snapshot(configPath)) || !unchanged(hooksBefore,await snapshot(hooksPath))) throw new Error('concurrent_change');
    if (mcpText!==before.text) await hostWrite(configPath,mcpText,before,{snapshot,unchanged});
    // Secret-free shared policy is consumed by the upgraded Claude plugin too.
    await privateWrite(policyPath(config.root,endpoint),JSON.stringify({version:1,dailyCap,concurrency:2}));
    if (hooksText!==hooksBefore.text) await hostWrite(hooksPath,hooksText,hooksBefore,{snapshot,unchanged});
    if (identity.complete) await completePairing({...identity.complete,configured:{claude:true,codex:true}});
    phase = 'activation';
    if (!unchanged({text:hooksText,stat:(await snapshot(hooksPath)).stat},await snapshot(hooksPath))) throw new Error('hooks_changed');
    await privateWrite(path,JSON.stringify({...config,enabled:true}));
    write(t('codex_hooks_ready'));write(t('codex_hooks_trust'));write(t('codex_startup_gate'));return 0;
  } catch(error) {
    if(error instanceof SetupError)throw error;
    const code = ['ENOENT','EACCES','EEXIST','EPERM','ERR_INVALID_ARG_TYPE'].includes(error.code)?error.code:'internal';
    throw new SetupError('codex_phase_failed',1,{phase,code});
  } finally {await lock.close();await unlink(lockPath);}
}

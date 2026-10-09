import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveClient, clientProjectId } from '../client/pairing.mjs';
import { automaticPolicy, automaticGuard } from '../client/automatic-policy.mjs';
import { readControlState } from '../client/control-state.mjs';
import { hostedTargetId } from '../client/transport-hosted.mjs';
import { handleHook, readHookInput, validateHook, workerFromHandoff } from './hook.mjs';
import { establishPauseBoundary } from './worker.mjs';
import { detectRunningHost, cachedQualification, observeHost, qualifyBinary, validHost, boundBinary,
  scheduleQualification, finishQualification, hasQualifiedCreator } from './qualification.mjs';
import { readInstallation, readCredential, clientOptions, childEnvironment, promptRecallEnabled } from './installed-state.mjs';
import { observeHostedPause, installedTransport, recallContext } from './hosted-lifecycle.mjs';

// No --version/schema subprocess on the hook path. Ancestor detection and
// identity-keyed cache reads are the only host work before capture/recall.
export async function currentHost(configPath,{detect=detectRunningHost,launch=launchQualification}={}) {
  const host=await detect();
  if(!host)return {status:'pending'};
  await observeHost(configPath,host);
  const verdict=await cachedQualification(configPath,host);
  if(verdict.status==='pending')await scheduleQualification(configPath,host,launch);
  return {...verdict,host};
}
function launchQualification(configPath,host) {
  const child=spawn(process.execPath,[fileURLToPath(new URL('./entry.mjs',import.meta.url)),configPath,'qualify'],{
    detached:true,env:{HOME:'/tmp',PATH:'/usr/bin:/bin',LANG:'C.UTF-8',
      ...(process.env.TMPDIR?{TMPDIR:process.env.TMPDIR}:{})},stdio:['pipe','ignore','ignore']});
  return new Promise((resolve,reject)=>{
    child.once('error',reject);child.stdin.once('error',reject);
    child.once('spawn',()=>child.stdin.end(JSON.stringify(host),()=>{child.unref();resolve();}));
  });
}

function launchWorker(configPath, config, content) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(config.runtime,'integrations/codex/entry.mjs'),
      configPath, 'worker'], { detached: true, cwd: config.home,
      env: childEnvironment(config.home), stdio: ['pipe','ignore','ignore'] });
    child.once('error', reject);
    child.stdin.once('error', reject);
    child.once('spawn', () => {
      child.stdin.end(content, () => {
        child.unref(); resolve();
      });
    });
  });
}

export async function runInstalled(configPath, event, stream, { signal, launch = launchWorker,
  detectHost = detectRunningHost } = {}) {
  const config = await readInstallation(configPath);
  if (!config.enabled || signal.aborted) return '';
  if(event==='qualify') {
    const host=await readHookInput(stream,{deadlineMs:750});
    if(!validHost(host))return '';
    try {await qualifyBinary(configPath,host);} finally {await finishQualification(configPath,host);}
    return '';
  }
  // Detached workers re-check the host supplied by the trusted launcher. Hook
  // payloads cannot supply or override it; a changed binary invalidates the key.
  let input, qualification;
  if(event==='worker') {
    input=await readHookInput(stream,{deadlineMs:750});
    const host=input?.host;
    if(!await boundBinary(host))return '';
    qualification={...await cachedQualification(configPath,host),host};
    delete input.host;
  } else qualification=await currentHost(configPath,{detect:detectHost});
  if(qualification.status!=='qualified' || signal.aborted)return '';
  if(event==='UserPromptSubmit' && !await promptRecallEnabled(configPath))return '';
  input??=await readHookInput(stream,{deadlineMs:300});
  const qualifyCreator = version => hasQualifiedCreator(configPath,version,{signal});
  const options = clientOptions(config);
  const resolved = await resolveClient(options);
  if (!resolved.enabled || resolved.root !== config.root || signal.aborted) return '';
  const policy = await automaticPolicy(config.root, config.endpoint);
  if (!policy || policy.dailyCap !== config.dailyCap) return '';
  const targetId = hostedTargetId(config);
  if (event === 'worker') {
    const token = await readCredential(configPath, config.endpoint);
    const remote = await observeHostedPause(config, token, signal);
    if (remote.paused || signal.aborted) return '';
    const handoff = input;
    const guard = automaticGuard(config.root, config.endpoint, policy);
    const transport = installedTransport(config, token, remote.generation);
    await workerFromHandoff(handoff, { clientOptions: options, targetId, transport, guard,
      mode: 'hosted', overallMs: 60000, qualifiedCreatorVersion: qualification.version, qualifyCreator });
    return '';
  }
  const hook = validateHook(input);
  if (hook.event !== event || input.agent_id != null || input.agent_type != null) return '';
  const projectId = await clientProjectId(options, hook.cwd, resolved);
  if (signal.aborted) return '';
  if (event === 'UserPromptSubmit') {
    const token = await readCredential(configPath, config.endpoint);
    return recallContext(input, config, token, projectId, signal, async () => await promptRecallEnabled(configPath) && Boolean(await boundBinary(qualification.host)));
  }
  if (event === 'SessionStart') {
    const token = await readCredential(configPath, config.endpoint);
    const remote = await observeHostedPause(config, token, signal);
    if (remote.paused || signal.aborted) return '';
    if (hook.path) await establishPauseBoundary({ root: config.root,targetId,projectId,
      sessionId: hook.sessionId,path: hook.path });
    // Protocol 0.3.0 startup context requires a qualified local o200k counter
    // and separate authority acceptance. Keep that optional port disabled.
    return '';
  }
  const control = await readControlState(config.root);
  if (control.paused || signal.aborted) return '';
  const result = await handleHook(input, { clientOptions: options, targetId,
    qualifiedCreatorVersion: qualification.version, qualifyCreator,
    launch: async content => {
      if (signal.aborted) return;
      await launch(configPath, config, JSON.stringify({...JSON.parse(content),host:qualification.host}));
    } });
  return result.output;
}

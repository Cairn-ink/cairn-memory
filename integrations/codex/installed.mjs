import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { resolveClient, clientProjectId } from '../client/pairing.mjs';
import { automaticPolicy, automaticGuard } from '../client/automatic-policy.mjs';
import { readControlState } from '../client/control-state.mjs';
import { hostedTargetId } from '../client/transport-hosted.mjs';
import { handleHook, readHookInput, validateHook, workerFromHandoff } from './hook.mjs';
import { establishPauseBoundary } from './worker.mjs';
import { qualifiedHost,qualifiedContextHost } from './parser.mjs';
import { readInstallation, readCredential, clientOptions, childEnvironment, promptRecallEnabled } from './installed-state.mjs';
import { observeHostedPause, installedTransport, recallContext } from './hosted-lifecycle.mjs';

export function currentHost(config, timeoutMs = 300) {
  return new Promise(resolve => {
    const child = spawn(config.codex, ['--version'], { cwd: config.home,
      env: childEnvironment(config.home), stdio: ['ignore','pipe','ignore'] });
    let output = '', settled = false;
    const finish = result => {
      if (settled) return; settled = true;
      clearTimeout(timer); resolve(result);
    };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(false); }, timeoutMs);
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.length > 1024) { child.kill('SIGKILL'); finish(false); }
    });
    child.on('error', () => finish(false));
    child.on('close', code => finish(code === 0 && qualifiedHost(output.trim().replace(/^codex-cli /u,''))));
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
  contextQualification = qualifiedContextHost } = {}) {
  const config = await readInstallation(configPath);
  if (!config.enabled || !await currentHost(config) || signal.aborted) return '';
  if (event==='UserPromptSubmit' && (!contextQualification(config.hostVersion) ||
    !await promptRecallEnabled(configPath))) return '';
  const input = await readHookInput(stream, { deadlineMs: event === 'worker' ? 750 : 300 });
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
      mode: 'hosted', overallMs: 60000 });
    return '';
  }
  const hook = validateHook(input);
  if (hook.event !== event || input.agent_id != null || input.agent_type != null) return '';
  const projectId = await clientProjectId(options, hook.cwd, resolved);
  if (signal.aborted) return '';
  if (event === 'UserPromptSubmit') {
    const token = await readCredential(configPath, config.endpoint);
    return recallContext(input, config, token, projectId, signal, () => promptRecallEnabled(configPath));
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
    launch: async content => {
      if (signal.aborted) return;
      await launch(configPath, config, content);
    } });
  return result.output;
}

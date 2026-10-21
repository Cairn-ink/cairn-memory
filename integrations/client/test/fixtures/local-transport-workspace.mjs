import { mkdirSync, writeFileSync, copyFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../../tools/testing/workspace.mjs';
export function transportFixture(t, { client = 'codex', project = false } = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'local-transport-' }), runtimeRoot = join(workspace.path, 'runtime'), home = join(workspace.path, 'home');
  const directory = join(runtimeRoot, 'adapters/local'); mkdirSync(directory, { recursive: true }); mkdirSync(home, { mode: 0o700 });
  copyFileSync(new URL('./local-transport-child.mjs', import.meta.url), join(directory, 'cli.mjs'));
  const authority = { version: 'local-capture-authority-v1', targetId: 'synthetic-target', storeId: 'synthetic-store',
    namespace: { ownerId: 'synthetic-owner', scope: project ? 'project' : 'personal', projectId: project ? 'synthetic-project-identity' : null }, client,
    expectedControlRevision: 1, expectedConsentGeneration: 'synthetic-consent', expectedNamespaceGeneration: 'initial', expectedRawRevision: 0 };
  const config = { version: 'local-capture-config-v1', databasePath: join(workspace.path, 'unused.sqlite'), authority,
    raw: { mode: 'off', capBytes: 1000000 }, provider: { profile: 'openai-baseline-v1', apiKeyEnv: 'CAIRN_SYNTHETIC_API_KEY' },
    usage: { root: workspace.path, dailyCap: 20, concurrency: 1 }, timeouts: { captureMs: 120000, processMs: 150000 } };
  const configPath = join(workspace.path, 'config.json');
  const save = () => writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 }); save();
  const set = (mode = 'complete', patch = {}) => writeFileSync(join(directory, 'scenario.json'), JSON.stringify({ mode, ...patch }), { mode: 0o600 }); set();
  const text = 'synthetic-source-sentinel', request = { version: 2, client, event_id: 'synthetic-event', session_id: 'synthetic-session',
    ...(project ? { project_id: authority.namespace.projectId } : {}), messages: [{ id: 'synthetic-message', role: 'user', occurred_at: null,
      message_ordinal: 1, content: text, part: { index: 0, start: 0, totalUnits: text.length, totalBytes: Buffer.byteLength(text) } }] };
  const observedPath = join(directory, 'observed.json'), observed = () => existsSync(observedPath) ? JSON.parse(readFileSync(observedPath, 'utf8')) : null;
  const probePath = join(workspace.path, 'probe.json'), probeObserved = () => existsSync(probePath) ? JSON.parse(readFileSync(probePath, 'utf8')) : null;
  function executable({ version = process.version + '\n', status = 0, hang = false, changeConfig = false, probeFlood = false, removeSelf = false } = {}) {
    const path = join(workspace.path, 'synthetic-node-' + Math.random().toString(36).slice(2));
    const source = `#!${process.execPath}\nimport {spawn} from 'node:child_process';import {appendFileSync,unlinkSync,writeFileSync} from 'node:fs';
      if(process.argv[2]==='--version'){
        writeFileSync(${JSON.stringify(probePath)},JSON.stringify({pid:process.pid,environmentKeys:Object.keys(process.env).sort()}),{mode:0o600});
        ${removeSelf ? `unlinkSync(${JSON.stringify(path)});` : ''}
        ${changeConfig ? `appendFileSync(${JSON.stringify(typeof changeConfig === 'string' ? changeConfig : configPath)},' ');` : ''}
        if(${hang})setInterval(()=>{},1000);else{process.stdout.write(${JSON.stringify(probeFlood ? 'x'.repeat(129) : version)});process.exitCode=${status};}
      }else{const child=spawn(${JSON.stringify(process.execPath)},process.argv.slice(2),{stdio:'inherit',env:process.env});
        for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));child.on('close',(code,signal)=>{process.exitCode=code??1;});}`;
    writeFileSync(path, source, { mode: 0o700 }); chmodSync(path, 0o700); return path;
  }
  return { workspace, runtimeRoot, home, authority, config, configPath, request, save, set, observed, probeObserved, executable,
    options: { nodeExecutable: process.execPath, runtimeRoot, configPath, expectedAuthority: authority, home, deadlineMs: 4000, env: {} } };
}

import assert from 'node:assert/strict';
import { chmod, copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../../../tools/testing/workspace.mjs';
import { binaryIdentity, canonical, KNOWN_FORMATS } from '../../qualification.mjs';
import { resolveClient } from '../../../client/pairing.mjs';
import { policyPath } from '../../../client/automatic-policy.mjs';
import { hostedTargetId } from '../../../client/transport-hosted.mjs';
import { hostedPauseStatus } from '../../../client/hosted-pause.mjs';
import { copyRuntime } from '../../../../packages/setup/lib/codex-runtime.mjs';

const preload = fileURLToPath(new URL('./prefetch-preload.mjs', import.meta.url));
export async function installedPrompt(t, { host = 'codex', warm = true, syncDelay = 0, unanswered = false, seedIdentity = true, pauseUnavailable = false, memories = [], deliveryEvidence = false } = {}) {
  const ws = createTestWorkspace(t, { prefix: 'prefetch-' });
  try {
    const home = join(ws.path, 'home'), root = join(home, 'data'), directory = join(home, 'codex', 'cairn');
    await mkdir(root, { recursive: true, mode: 0o700 });
    let measuring = !warm, startedAt, recallHeaders = 0, pauseRequests = 0, snapshot;
    const phases = [], timers = new Set();
    const server = createServer((request, response) => {
      request.resume();
      if (measuring) phases.push({ route: request.url.split('/').at(-1), atMs: performance.now() - startedAt });
      if (request.url.endsWith('/recall')) {
        if (measuring) recallHeaders++;
        if (measuring && unanswered) return;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ memories })); return;
      }
      assert.ok(request.url.endsWith('/pause-state'));
      const wait = measuring && unanswered && pauseRequests++ === 0 ?
        Math.max(0, Math.ceil(1100 - (performance.now() - startedAt))) : 0;
      const reply = () => {
        if (measuring && pauseUnavailable) { response.writeHead(503); response.end(); return; }
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ paused: false, generation: 0, enforced: true }));
      };
      if (wait) { const timer = setTimeout(() => { timers.delete(timer); reply(); }, wait); timers.add(timer); }
      else reply();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    ws.defer(async () => { for (const timer of timers) clearTimeout(timer);
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const put = (path, value) => writeFile(path, JSON.stringify(value), { mode: 0o600 });
    let executable = process.execPath, entry, args, input;
    const env = { HOME: home, CODEX_HOME: join(home, 'codex'), PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' };
    if (host === 'codex') {
      executable = join(ws.path, 'codex');
      await copyFile(process.execPath, executable); await chmod(executable, 0o700);
      await mkdir(join(directory, 'qualification'), { recursive: true, mode: 0o700 });
      const runtime = await copyRuntime(directory), identity = await binaryIdentity(executable);
      const installation = join(directory, 'installation.json');
      await put(installation, { version: 1, enabled: true, hostVersion: '0.160.1', codex: executable,
        node: process.execPath, home, root, pairingRecord: null, usesClaude: false,
        endpoint, runtime, dailyCap: 100, captureExec: true });
      await put(join(directory, 'credential.json'), { version: 1, endpoint, token: 'synthetic-token' });
      await put(join(directory, 'qualification', identity + '.json'), { identity,
        policy: createHash('sha256').update(canonical(KNOWN_FORMATS)).digest('hex'),
        version: '0.160.1', status: 'qualified', fingerprint: KNOWN_FORMATS[0] });
      const resolved = await resolveClient({ client: 'codex', home, root, usesClaude: false,
        isolatedCodex: true, initialize: true, env: { HOME: home } });
      assert.equal(resolved.enabled, true);
      await mkdir(join(root, 'automatic-policy'), { mode: 0o700 });
      await put(policyPath(root, endpoint), { version: 1, concurrency: 2, dailyCap: 100 });
      const transcript = join(ws.path, 'rollout.jsonl');
      const text = await readFile(new URL('../fixtures/primary-0.160.1.jsonl', import.meta.url), 'utf8');
      await writeFile(transcript, text.replace('"source":"exec"', '"source":"cli"')
        .replace('"originator":"codex_exec"', '"originator":"codex_cli"'), { mode: 0o600 });
      entry = join(runtime, 'integrations/codex/entry.mjs'); args = [installation, 'UserPromptSubmit'];
      input = { hook_event_name: 'UserPromptSubmit', session_id: '11111111-1111-4111-8111-111111111111',
        cwd: ws.path, transcript_path: transcript, prompt: 'Synthetic preferences?' };
    } else {
      const plugin = join(ws.path, 'plugin');
      await cp(new URL('../../../../plugins/cairn-memory/lib/', import.meta.url), join(plugin, 'lib'), { recursive: true });
      await cp(new URL('../../../../plugins/cairn-memory/scripts/', import.meta.url), join(plugin, 'scripts'), { recursive: true });
      // Isolate the distributed plugin. Seed project identity as setup does;
      // fresh/warm here refers to hook-owned observation and boundary state.
      if (seedIdentity) await writeFile(join(root, 'project-key'), '12345678-1234-4234-8234-123456789abc\n', { mode: 0o600 });
      Object.assign(env, { CLAUDE_PLUGIN_DATA: root, CLAUDE_PLUGIN_OPTION_API_ENDPOINT: endpoint,
        CLAUDE_PLUGIN_OPTION_API_TOKEN: 'synthetic-token', CLAUDE_PLUGIN_OPTION_TELEMETRY: 'false' });
      entry = join(plugin, 'scripts/hook.mjs'); args = ['recall'];
      input = { hook_event_name: 'UserPromptSubmit', session_id: 'synthetic-session', cwd: ws.path, prompt: 'Synthetic preferences?' };
    }
    const parent = join(ws.path, 'parent.mjs');
    await writeFile(parent, `import { spawn } from 'node:child_process';
      async function run(measured) {
        const start = performance.now();
        const child = spawn(${JSON.stringify(process.execPath)}, [
          ...(measured ? ['--import', ${JSON.stringify(preload)}] : []),
          ...(measured && ${deliveryEvidence} ? ['--import', ${JSON.stringify(fileURLToPath(new URL('./pause-delivery-preload.mjs', import.meta.url)))}] : []),
          ${JSON.stringify(entry)}, ...${JSON.stringify(args)}], {
          env: {...process.env, CAIRN_TEST_SYNC_DELAY: measured ? '${syncDelay}' : '0'},
          stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
        child.on('message', message => process.send(message));
        child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
        child.stdin.end(${JSON.stringify(JSON.stringify(input))});
        return new Promise((resolve, reject) => {
          child.on('error', reject); child.on('close', (code, signal) => resolve({code, signal,
            elapsedMs: performance.now() - start}));
        });
      }
      ${warm ? "const prime = await run(false); if (prime.code !== 0) process.exit(2);" : ''}
      await new Promise(resolve => process.send({kind:'measuring'}, resolve));
      const outcome = await run(true);
      process.send({kind:'outcome', ...outcome}, () => process.exit(outcome.code ?? 1));`);
    startedAt = performance.now();
    const child = spawn(executable, [parent], { cwd: ws.path, detached: true, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    let stdout = '', stderr = '', outcome, delivery;
    child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
    child.on('message', message => {
      if (message.kind === 'measuring') { measuring = true; startedAt = performance.now(); }
      else if (message.kind === 'prefetch') snapshot = message;
      else if (message.kind === 'outcome') outcome = message;
      else if (message.kind === 'delivery') delivery = message;
    });
    const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    ws.defer(async () => {
      if (child.exitCode === null && child.signalCode === null) process.kill(-child.pid, 'SIGKILL');
      await done;
    });
    const watchdog = setTimeout(() => process.kill(-child.pid, 'SIGKILL'), 10000);
    let code;
    try { code = await done; } finally { clearTimeout(watchdog); }
    const exists = path => readFile(path).then(() => true, error => { if(error.code==='ENOENT')return false; throw error; });
    const deliveryLocks = deliveryEvidence ? {control:await exists(join(root,'control.lock')),
      gate:await exists(join(root, 'hosted-pause.gate'))} : undefined;
    return { code, signal: child.signalCode, stdout, stderr, outcome, recallHeaders, snapshot, phases, deliveryLocks,
      delivery, status: await hostedPauseStatus({ root, endpoint }) };
  } finally { await ws.cleanup(); }
}

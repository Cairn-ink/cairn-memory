import assert from 'node:assert/strict';
import test from 'node:test';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { binaryIdentity, canonical, KNOWN_FORMATS } from '../qualification.mjs';
import { resolveClient } from '../../client/pairing.mjs';
import { policyPath } from '../../client/automatic-policy.mjs';
import { copyRuntime } from '../../../packages/setup/lib/codex-runtime.mjs';

test('installed prompt entry exits silently within its process-clock budget, five times',
  { skip: process.platform !== 'linux', timeout: 35000 }, async t => {
    for (let run = 0; run < 5; run++) await t.test(`run ${run + 1}`, async t => {
      const ws = createTestWorkspace(t, { prefix: 'codex-prompt-budget-' });
      const home = join(ws.path, 'home'), codexHome = join(home, 'codex');
      const root = join(codexHome, 'cairn-standalone'), directory = join(codexHome, 'cairn');
      for (const path of [root, join(directory, 'qualification')])
        await mkdir(path, { recursive: true, mode: 0o700 });
      let recallHeaders = 0;
      const pending = new Set();
      const server = createServer((request, response) => {
        request.resume();
        if (request.url.endsWith('/recall')) { recallHeaders++; return; }
        assert.ok(request.url.endsWith('/pause-state'));
        // Local pre-fetch work must consume enough time for the process cap to
        // win over the unchanged 2,500 ms fetch timer. Recall itself never answers.
        const timer = setTimeout(() => {
          pending.delete(timer);
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify({ paused: false, generation: 0, enforced: true }));
        }, 650);
        pending.add(timer);
      });
      ws.defer(async () => {
        for (const timer of pending) clearTimeout(timer);
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const endpoint = `http://127.0.0.1:${server.address().port}`;
      const runtime = await copyRuntime(directory);
      const codex = join(ws.path, 'codex');
      // A private native-shaped ancestor exercises production /proc detection
      // and the identity-keyed qualification cache without using a real host.
      await copyFile(process.execPath, codex);
      const identity = await binaryIdentity(codex);
      const put = (path, value) => writeFile(path, JSON.stringify(value), { mode: 0o600 });
      const installation = join(directory, 'installation.json');
      await put(installation, { version: 1, enabled: true, hostVersion: '0.160.1', codex,
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
      const text = await readFile(new URL('./fixtures/primary-0.160.1.jsonl', import.meta.url), 'utf8');
      await writeFile(transcript, text.replace('"source":"exec"', '"source":"cli"')
        .replace('"originator":"codex_exec"', '"originator":"codex_cli"'), { mode: 0o600 });
      const input = { hook_event_name: 'UserPromptSubmit',
        session_id: '11111111-1111-4111-8111-111111111111', cwd: ws.path,
        transcript_path: transcript, prompt: 'Synthetic preferences?' };
      const parent = join(ws.path, 'parent.mjs');
      await writeFile(parent, `import { spawn } from 'node:child_process';
        const start = performance.now();
        const child = spawn('env', ['-u', 'CAIRN_MCP_TOKEN', ${JSON.stringify(process.execPath)},
          ${JSON.stringify(join(runtime, 'integrations/codex/entry.mjs'))},
          ${JSON.stringify(installation)}, 'UserPromptSubmit'], { stdio: ['pipe', 'pipe', 'pipe'] });
        child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
        child.stdin.end(${JSON.stringify(JSON.stringify(input))});
        child.on('close', (code, signal) => process.send({ code, signal,
          elapsedMs: performance.now() - start }, () => process.exit(code ?? 1)));`);
      const child = spawn(codex, [parent], { cwd: ws.path, detached: true,
        env: { HOME: home, CODEX_HOME: codexHome, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      let stdout = '', stderr = '', outcome;
      child.stdout.on('data', data => stdout += data);
      child.stderr.on('data', data => stderr += data);
      child.on('message', message => outcome = message);
      const watchdog = setTimeout(() => process.kill(-child.pid, 'SIGKILL'), 7000);
      let code;
      try { code = await new Promise((resolve, reject) => {
        child.once('error', reject); child.once('close', resolve);
      }); } finally { clearTimeout(watchdog); }
      assert.equal(code, 0); assert.equal(child.signalCode, null);
      assert.equal(outcome.code, 0); assert.equal(outcome.signal, null);
      assert.equal(stdout, '', 'no_late_context'); assert.equal(stderr, '', 'silent_failure');
      assert.equal(recallHeaders, 1, 'real_loopback_recall_reached');
      t.diagnostic(JSON.stringify({ run: run + 1, ...outcome, recallHeaders }));
      // The launcher reserves 50 ms; another 50 ms tolerates clock/scheduling noise.
      assert.ok(outcome.elapsedMs >= 2900, 'process_cap_not_shortened');
      assert.ok(outcome.elapsedMs < 4000, 'host_margin');
    });
  });

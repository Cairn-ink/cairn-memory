import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, open } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
const now = () => Number(process.hrtime.bigint()) / 1e6;
const hook = fileURLToPath(new URL('../scripts/hook.mjs', import.meta.url));
const preload = fileURLToPath(new URL('./fixtures/recall-drain-preload.mjs', import.meta.url));

for (const sink of ['slow-pipe', 'blocked-pipe', 'file']) test(`admitted recall output drains within the host window (${sink})`, { timeout: 15000 }, async t => {
  const workspace = createTestWorkspace(t), home = join(workspace.path, 'home'), root = join(home, 'data');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeFile(join(root, 'project-key'), '12345678-1234-4234-8234-123456789abc\n', { mode: 0o600 });
  const outputPath = join(workspace.path, 'stdout'), exitPath = join(workspace.path, 'exit.json');
  const file = sink === 'file' ? await open(outputPath, 'wx', 0o600) : undefined;
  const started = now(), events = [], chunks = [];
  const child = spawn(process.execPath, ['--import', preload, hook, 'recall'], {
    cwd: home, env: { PATH: '/usr/bin:/bin', HOME: home, TMPDIR: workspace.path,
      CLAUDE_PLUGIN_DATA: root, CLAUDE_PLUGIN_OPTION_API_ENDPOINT: 'http://127.0.0.1:1',
      CLAUDE_PLUGIN_OPTION_API_TOKEN: 'synthetic-token', CLAUDE_PLUGIN_OPTION_TELEMETRY: 'false',
      CAIRN_TEST_EXIT_RECORD: exitPath }, stdio: ['pipe', file?.fd ?? 'pipe', 'pipe', 'ipc'],
  });
  await file?.close();
  let stderr = '', hostKilled = false, drainTimer;
  child.stderr.on('data', bytes => { stderr += bytes; });
  child.on('message', event => events.push({ ...event, ms: event.at - started }));
  const done = new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const collect = () => { child.stdout.on('data', bytes => chunks.push(bytes)); child.stdout.resume(); };
  // A never-draining reader begins collecting only AFTER process termination,
  // so the parent's stdio close event cannot itself be blocked by unread bytes.
  if (sink === 'blocked-pipe') child.once('exit', collect);
  if (sink === 'slow-pipe') drainTimer = setTimeout(collect, Math.max(0, 3525 - (now() - started)));
  const hostTimer = setTimeout(() => { hostKilled = true; child.kill('SIGKILL'); child.stdout?.resume(); }, 4000);
  t.after(async () => {
    clearTimeout(hostTimer); clearTimeout(drainTimer);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    child.stdout?.resume(); await done;
  });
  child.stdin.end(JSON.stringify({ session_id: 'synthetic-drain', cwd: home, prompt: 'Synthetic question' }));
  const outcome = await done;
  clearTimeout(hostTimer); clearTimeout(drainTimer);
  const exited = JSON.parse(await readFile(exitPath, 'utf8')), spawnExitMs = exited.at - started;
  const output = sink === 'file' ? await readFile(outputPath) : Buffer.concat(chunks);
  const entry = events.find(event => event.kind === 'write-start'), queued = events.find(event => event.kind === 'write-queued');
  t.diagnostic(JSON.stringify({ node: process.versions.node, sink, ...outcome, hostKilled,
    spawnOriginMs: events.find(event => event.kind === 'origin')?.ms, spawnExitMs,
    deliveredBytes: output.length, events: events.map(({ at, ...event }) => event) }));
  assert.deepEqual(outcome, { code: 0, signal: null }); assert.equal(stderr, ''); assert.equal(hostKilled, false);
  assert.ok(entry, 'valid_nonempty_response_reaches_write');
  assert.equal(entry.admissionMs, 3449, 'admitted_just_before_deadline');
  assert.ok(entry.bytes > 1024 * 1024, 'larger_than_pipe_capacity');
  assert.equal(events.filter(event => event.kind === 'fetch').length, 1, 'fetch_does_not_wait_for_output');
  assert.ok(spawnExitMs < 4000, 'hard_limit_precedes_host_timeout');
  if (sink !== 'file') {
    assert.ok(queued.queued > 0 && queued.needDrain, 'real_pipe_backpressure');
    assert.equal(events.filter(event => event.kind === 'abort-cap').length, 1, 'abort_retained_at_cap');
  }
  if (sink === 'blocked-pipe') {
    assert.equal(events.filter(event => event.kind === 'write-complete').length, 0);
    assert.ok(spawnExitMs >= 3700, 'admitted_write_waits_for_backstop');
    assert.ok(output.length < entry.bytes, 'blocked_reader_abandoned_at_hard_limit');
  } else {
    assert.equal(events.filter(event => event.kind === 'write-complete').length, 1, 'admitted_write_completed');
    assert.equal(output.length, entry.bytes, 'complete_json_byte_count');
    let envelope; try { envelope = JSON.parse(output.toString()); } catch { assert.fail('complete_json_required'); }
    assert.equal(envelope.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.ok(envelope.hookSpecificOutput.additionalContext.endsWith(' synthetic-tail'), 'json_suffix_delivered');
  }
});

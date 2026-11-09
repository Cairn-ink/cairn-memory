import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createHostedTransport } from '../../../integrations/client/transport-hosted.mjs';
import { handleHook } from '../../../integrations/codex/hook.mjs';
import { mergeHooks } from '../../../packages/setup/lib/codex-runtime.mjs';
import { invocation, assertProcessOutcome } from './fixtures/recall-deadline-harness.mjs';

const source = path => readFile(new URL(path, import.meta.url), 'utf8');
const at = (result, kind) => {
  const event = result.events.find(event => event.kind === kind);
  assert.ok(event, `missing_${kind}`); return event.ms;
};
const silent = result => {
  assertProcessOutcome(result);
  assert.equal(result.stdout, '', 'no_late_context');
  assert.equal(result.events.filter(event => event.kind === 'telemetry-fetch').length, 0);
};
const capTime = result => result.elapsedMs - at(result, 'process-origin');

test('cap and kill boundary: ten unanswered loopback requests consume the process-clock cap', async t => {
  const exits = [];
  for (let run = 0; run < 10; run++) await t.test(`run ${run + 1}`, async () => {
    // Contention makes the application cap precede the fetch deadline.
    const result = await invocation(t, { lockMs: 1500, neverAnswer: true });
    exits.push(result.elapsedMs);
    t.diagnostic(JSON.stringify({ run: run + 1, code: result.code, spawnExitMs: result.elapsedMs,
      processExitMs: capTime(result), fetchMs: at(result, 'recall-fetch') }));
    silent(result);
    assert.equal(result.serverHeaders, 1);
    assert.ok(capTime(result) >= 3400, 'cap_not_shortened');
    assert.ok(result.elapsedMs < 4000, 'host_margin');
    assert.equal(result.events.find(event => event.kind === 'recall-aborted')?.source, 'application');
  });
  t.diagnostic(JSON.stringify({ runs: exits.length, maxSpawnExitMs: Math.max(...exits) }));
});

test('startup and imports count against the cap', async t => {
  const result = await invocation(t, { startupMs: 650, stalledInput: true });
  silent(result);
  assert.ok(at(result, 'application-entry') - at(result, 'process-origin') >= 650);
  assert.ok(capTime(result) >= 3400, 'cap_not_shortened');
  assert.ok(capTime(result) < 3900, 'imports_count_against_cap');
  assert.equal(result.events.filter(event => event.kind === 'recall-fetch').length, 0);
});

test('fetch timer starts at fetch and allows 2500 ms; contention lets the cap win', async t => {
  const short = await invocation(t, { neverAnswer: true });
  silent(short); assert.equal(short.serverHeaders, 1);
  const elapsed = at(short, 'recall-aborted') - at(short, 'recall-fetch');
  assert.deepEqual(short.events.filter(event => event.kind === 'http-timeout').map(event => event.delayMs), [2500],
    'configured_fetch_deadline_2500');
  assert.ok(elapsed >= 2400, 'fetch_deadline_not_shortened');
  // silent() checks the sole exit upper bound: the 4000 ms host boundary.
  assert.equal(short.events.find(event => event.kind === 'recall-aborted').source, 'http');
  const contended = await invocation(t, { lockMs: 1500, neverAnswer: true });
  silent(contended); assert.equal(contended.serverHeaders, 1);
  assert.ok(capTime(contended) >= 3400, 'process_cap_3500');
  assert.ok(at(contended, 'recall-aborted') - at(contended, 'recall-fetch') < 2400, 'cap_wins');
  assert.equal(contended.events.find(event => event.kind === 'recall-aborted').source, 'application');
});

test('configured host timeouts reserve at least 500 ms after each recall cap', async () => {
  const hook = await source('../scripts/hook.mjs');
  const expression = hook.match(/const recallEnd = recallController \? (.+) : undefined;/)?.[1];
  assert.ok(expression, 'application_cap_expression');
  // Evaluate at a nonzero startup time so a fresh post-import allowance fails.
  const cap = Function('performance', `return ${expression}`)({ now: () => 725 });
  assert.equal(cap, 3500, 'process_clock_cap');
  const config = JSON.parse(await source('../hooks/hooks.json'));
  const timeout = config.hooks.UserPromptSubmit[0].hooks[0].timeout;
  assert.equal(timeout, 4); assert.ok(timeout * 1000 - cap >= 500, 'plugin_margin');
});

test('host handler retains the prompt, startup and capture budgets', async () => {
  const timers = [], original = globalThis.setTimeout;
  globalThis.setTimeout = (callback, ms, ...args) => {
    timers.push(ms); return original(callback, ms, ...args);
  };
  try {
    for (const event of ['UserPromptSubmit', 'SessionStart', 'Stop', 'PreCompact'])
      await handleHook({ hook_event_name: event });
  } finally { globalThis.setTimeout = original; }
  assert.deepEqual(timers, [3000, 2500, 750, 750], 'event_budgets');
});

test('installed prompt launcher and configuration retain the required margin', async () => {
  const merged = JSON.parse(mergeHooks('', 'synthetic-installation', {
    home: 'synthetic-home', node: process.execPath, runtime: 'synthetic-runtime',
  }, undefined, true));
  const timeouts = Object.fromEntries(Object.entries(merged.hooks).map(([event, groups]) =>
    [event, groups[0].hooks[0].timeout]));
  assert.deepEqual(timeouts, { SessionStart: 3, UserPromptSubmit: 4, Stop: 1, PreCompact: 1 });
  const entry = await source('../../../integrations/codex/entry.mjs');
  const budget = entry.match(/const budget = (.+);/)?.[1];
  assert.ok(budget, 'launcher_budget_expression');
  const launcherBudget = Function('event', 'capture', `return ${budget}`);
  const cap = launcherBudget('UserPromptSubmit', false);
  assert.equal(cap, 3000, 'installed_process_cap');
  assert.equal(timeouts.UserPromptSubmit * 1000 - cap, 1000, 'installed_margin');
  assert.ok(timeouts.UserPromptSubmit * 1000 - cap >= 500);
  const remaining = entry.match(/Math.max\(1,(budget - process.uptime\(\)\*1000 - 50)\)/)?.[1];
  assert.ok(remaining, 'launcher_process_clock_expression');
  assert.equal(Function('budget', 'process', `return ${remaining}`)(3000, { uptime: () => 0.725 }), 2225);
  assert.equal(launcherBudget('SessionStart', false), 2000, 'startup_unchanged');
  assert.equal(launcherBudget('Stop', true), 750, 'capture_unchanged');
  const lifecycle = await source('../../../integrations/codex/hosted-lifecycle.mjs');
  assert.match(lifecycle, /hash\('wire-session-v1','codex',input.session_id\) }, 2500, undefined, signal, dispatch\)/);
});

test('hosted client aborts 2500 ms after fetch', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'recall-fetch-budget-' });
  let started, aborted;
  const timers = [], originalTimeout = AbortSignal.timeout;
  t.mock.method(AbortSignal, 'timeout', function (milliseconds) {
    timers.push(milliseconds);
    return originalTimeout.call(this, milliseconds);
  });
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => {
    started = performance.now();
    await new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = performance.now(); reject(signal.reason); }, { once: true });
    });
  });
  // AbortSignal.timeout is unref'ed; keep this isolated timer observation alive.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const transport = createHostedTransport({ root: workspace.path,
      endpoint: 'https://synthetic.invalid', token: 'synthetic-token' });
    assert.equal((await transport.recall('Synthetic question')).status, 'unavailable');
    assert.deepEqual(timers, [2500], 'configured_client_fetch_deadline_2500');
    assert.ok(aborted - started >= 2400, 'client_fetch_deadline_not_shortened');
  } finally { clearInterval(keepAlive); }
});

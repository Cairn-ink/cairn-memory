import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, cp, rm, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fixture } from './clients.test.mjs';

// Extract the immutable 0.5.3 git object, never current source, with the same
// fakes and private homes. No credentials or machine paths are recorded.
let historicalPromise, historicalScratch;
after(async () => { if (historicalScratch) await rm(historicalScratch, { recursive: true, force: true }); });
function native(executable, args, { input, ...options } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = []; child.stdout.on('data', value => chunks.push(value)); child.stderr.resume();
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error('baseline_unavailable')); });
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}
function historicalInstaller() {
  return historicalPromise ??= (async () => {
    historicalScratch = await mkdtemp(join(tmpdir(), 'cairn-053-baseline-'));
    try {
      const env = { PATH: process.env.PATH, HOME: historicalScratch };
      const archive = await native('git', ['archive', 'b2513501', 'packages/setup'], {
        cwd: fileURLToPath(new URL('../../../', import.meta.url)), env });
      await native('tar', ['-xf', '-', '-C', historicalScratch], { input: archive, env });
      return { module: pathToFileURL(join(historicalScratch, 'packages/setup/lib/setup.mjs')).href };
    } catch { return { skip: 'Historical 0.5.3 comparison requires git object b2513501 and working git/tar child pipes.' }; }
  })();
}
const scenarios = ['both configured', 'Claude only', 'Codex qualified', 'Codex fallback',
  'Claude unconfigured', 'Claude disabled', 'legacy cairn', 'Claude no endpoint', 'Claude inspection failure'];
const actions = [['setup'], ['setup', '--client', 'codex'], ['status'], ['setup', '--dry-run'],
  ['uninstall', '--client', 'codex'], ['pause']];
const callsThatMutate = call => call.args[0] === 'plugin' ? !call.args.includes('--json') && !call.args.includes('--help') :
  call.args[0] === 'mcp' && ['remove', 'add'].includes(call.args[1]) && !call.args.includes('--help');
function assertProbeDelta(baseline, current, client, home) {
  const args = call => {
    if (!call) return undefined;
    // The old hosted schema probe creates a fresh private scratch directory on
    // every invocation. Its generated output pathname is not a client mutation.
    return call.args.length === 4 && call.args.slice(0, 3).join(' ') === 'app-server generate-json-schema --out' ?
      [...call.args.slice(0, 3), '<schema-output>'] : call.args;
  };
  let index = 0;
  for (const call of current) {
    if (JSON.stringify(args(call)) === JSON.stringify(args(baseline[index]))) { index++; continue; }
    const expected = client === 'claude' ? 'plugin list --json' : 'mcp list --json';
    assert.equal(call.args.join(' '), expected, 'Only the new read-only detection probes may be added');
    if (client === 'codex') assert.notEqual(call.home, home, 'The extra probe must use an inspection copy');
  }
  assert.equal(index, baseline.length, 'Existing native calls must remain in order');
}
async function inventory(root) {
  const result = {};
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const path = join(root, entry.name);
      if (entry.isDirectory()) Object.assign(result, Object.fromEntries(Object.entries(await inventory(path)).map(([name, value]) => [entry.name + '/' + name, value])));
      else result[entry.name] = createHash('sha256').update(await readFile(path)).digest('hex');
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return result;
}
const normalized = text => text.replace(/(Cairn\.ink Memory(?: setup| status| 安裝程式)? )\d+\.\d+\.\d+/gu, '$1<version>')
  .replace(/\/runtime\/\d+\.\d+\.\d+-[a-f0-9]{12}/gu, '/runtime/<version>-<digest>');
for (const lang of ['zh', 'en']) test(`L02 fresh cloud choice preserves hosted flow (${lang})`, async t => {
  const baselineFixture = await fixture(t), routedFixture = await fixture(t);
  const args = ['setup', '--lang', lang];
  const baseline = await baselineFixture.run({ args, disableLocalMode: true });
  const routed = await routedFixture.run({ args, choices: { mode: '2' }, disableLocalMode: false });
  assert.equal(baseline.code, 0, baseline.stdout); assert.equal(routed.code, 0, routed.stdout);
  const start = lang === 'zh' ? '在這台電腦找到' : 'Found Claude Code';
  assert.equal(routed.stdout.slice(routed.stdout.indexOf(start)), baseline.stdout.slice(baseline.stdout.indexOf(start)));
  assert.equal(routed.prompts.filter(p => /Where should memory live|記憶要存在哪裡/u.test(p.prompt)).length, 1);
  await assert.rejects(readdir(join(routedFixture.home, 'local-memory')), { code: 'ENOENT' });
});
for (const scenario of scenarios) for (const args of actions) test(`L06 hosted baseline: ${scenario}; ${args.join(' ')}`, async t => {
  const f = await fixture(t, { claude: scenario !== 'Codex qualified' && scenario !== 'Codex fallback',
    codex: scenario !== 'Claude only', qualified: scenario !== 'Codex fallback' });
  // Seed known identities/credentials once so both comparison runs begin from
  // byte-identical state. Each cell restores that state before its second run.
  if (!['Claude unconfigured', 'legacy cairn', 'Claude inspection failure'].includes(scenario)) {
    const initial = await f.run(); assert.equal(initial.code, 0, initial.stdout);
  }
  if (scenario === 'Claude unconfigured') await f.setClaudeState({ installed: true, marketplace: true });
  if (scenario === 'Claude disabled') await f.setClaudeState({ ...await f.claudeState(), disabled: true });
  if (scenario === 'Claude no endpoint') await f.setClaudeState({ ...await f.claudeState(), omitEndpoint: true });
  if (scenario === 'legacy cairn') {
    await f.setClaudeState({ mcp: true });
    await writeFile(join(f.home, '.claude.json'), JSON.stringify({ mcpServers: { cairn: { type: 'stdio', command: 'legacy', args: [] } } }));
  }
  if (scenario === 'Claude inspection failure') await f.setClaudeState({ fail: 'plugin list --json', failCode: 7 });
  const saved = join(f.scratch, 'baseline-home'); await cp(f.home, saved, { recursive: true });
  const nativeState = await readFile(join(f.scratch, 'claude.json'));
  const codexState = await readFile(join(f.scratch, 'codex.json'));
  const choices = { claude: 'no', codex: 'no' }, fixedNow = Date.now();
  if (args.length === 1 && args[0] === 'setup') {
    const before = await inventory(f.home), calls = (await f.orderedCalls()).length;
    const conflict = await f.run({ args: ['setup', '--local'], disableLocalMode: false });
    assert.equal(conflict.code, 2, conflict.stdout);
    assert.match(conflict.stdout, scenario === 'Claude inspection failure' ? /Cannot inspect/ : /Cloud memory is configured/);
    assert.deepEqual(await inventory(f.home), before);
    assert.deepEqual((await f.orderedCalls()).slice(calls).filter(callsThatMutate), []);
  }
  const beforeCalls = await f.calls(), beforeOrdered = (await f.orderedCalls()).length;
  const historical = await historicalInstaller();
  const baseline = await f.run({ args, choices, fixedNow, disableLocalMode: true, module: historical.module });
  const baselineFiles = await inventory(f.home), baselineCalls = await f.calls();
  const mutating = (all, start) => Object.fromEntries(['claude', 'codex'].map(client => [client,
    all[client].slice(start[client].length).filter(callsThatMutate).map(call => ({ args: call.args, keys: call.keys, endpoint: call.endpoint, pairingRecord: call.pairingRecord }))]));
  const mutations = mutating(baselineCalls, beforeCalls);
  const orderedMutations = (await f.orderedCalls()).slice(beforeOrdered).filter(callsThatMutate);
  const restore = async () => {
    await rm(f.home, { recursive: true }); await cp(saved, f.home, { recursive: true });
    await writeFile(join(f.scratch, 'claude.json'), nativeState); await writeFile(join(f.scratch, 'codex.json'), codexState);
  };
  await t.test('immutable 0.5.3 versus current hosted-only path', { skip: historical.skip }, async () => {
    await restore(); const start = await f.calls(), orderedStart = (await f.orderedCalls()).length;
    const disabled = await f.run({ args, choices, fixedNow, disableLocalMode: true });
    assert.equal(disabled.code, baseline.code, disabled.stdout);
    assert.equal(normalized(disabled.stdout), normalized(baseline.stdout));
    assert.deepEqual(disabled.prompts, baseline.prompts);
    const disabledCalls = await f.calls();
    assert.deepEqual(mutating(disabledCalls, start), mutations);
    for (const client of ['claude', 'codex']) assertProbeDelta(baselineCalls[client].slice(beforeCalls[client].length), disabledCalls[client].slice(start[client].length), client, f.codexHome);
    assert.deepEqual((await f.orderedCalls()).slice(orderedStart).filter(callsThatMutate), orderedMutations);
    assert.deepEqual(await inventory(f.home), baselineFiles);
    await assert.rejects(readdir(join(f.home, 'local-memory')), { code: 'ENOENT' });
  });
  await restore();
  const beforeRouted = await f.calls(), routedOrdered = (await f.orderedCalls()).length;
  const routed = await f.run({ args, choices, fixedNow, disableLocalMode: false });
  assert.equal(routed.code, baseline.code, routed.stdout);
  assert.equal(normalized(routed.stdout), normalized(baseline.stdout));
  assert.deepEqual(routed.prompts, baseline.prompts);
  assert.deepEqual(mutating(await f.calls(), beforeRouted), mutations);
  assert.deepEqual((await f.orderedCalls()).slice(routedOrdered).filter(callsThatMutate), orderedMutations);
  assert.deepEqual(await inventory(f.home), baselineFiles);
  await assert.rejects(readdir(join(f.home, 'local-memory')), { code: 'ENOENT' });
  const routedCalls = await f.calls();
  for (const client of ['claude', 'codex']) assertProbeDelta(baselineCalls[client].slice(beforeCalls[client].length),
    routedCalls[client].slice(beforeRouted[client].length), client, f.codexHome);
  t.diagnostic('Compared native mutations, prompts, output and every HOME file against the hosted-only seam.');
});

for (const lang of ['zh', 'en']) for (const flags of [['--codex-capture-exec', 'on'], ['--codex-daily-cap', '100']])
test('L06 pre-header Claude option error: ' + lang + ' ' + flags[0], async t => {
  const f = await fixture(t), historical = await historicalInstaller();
  const args = ['setup', '--lang', lang, '--client', 'claude', ...flags];
  const before = await inventory(f.home), calls = (await f.orderedCalls()).length;
  const baseline = await f.run({ args, module: historical.module });
  const disabled = await f.run({ args, disableLocalMode: true });
  const routed = await f.run({ args, disableLocalMode: false });
  assert.equal(baseline.code, 2); assert.equal(disabled.code, 2); assert.equal(routed.code, 2);
  assert.equal(routed.stdout, disabled.stdout);
  await t.test('immutable 0.5.3 error output', { skip: historical.skip }, () => assert.equal(routed.stdout, baseline.stdout));
  assert.doesNotMatch(routed.stdout, /Memory setup|記憶設定/u);
  assert.deepEqual(await inventory(f.home), before);
  assert.deepEqual((await f.orderedCalls()).slice(calls).filter(callsThatMutate), []);
  await assert.rejects(readdir(join(f.home, 'local-memory')), { code: 'ENOENT' });
});

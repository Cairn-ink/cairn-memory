import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, cp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './clients.test.mjs';

// The same fixtures run against the unchanged hosted coordinator with local
// routing disabled, then with routing enabled. Baselines stay in memory/private
// scratch, avoiding recorded credentials, absolute paths and stale release data.
const scenarios = ['both configured', 'Claude only', 'Codex qualified', 'Codex fallback',
  'Claude unconfigured', 'Claude disabled', 'legacy cairn', 'Claude no endpoint', 'Claude inspection failure'];
const actions = [['setup'], ['setup', '--client', 'codex'], ['status'], ['setup', '--dry-run'],
  ['uninstall', '--client', 'codex'], ['pause']];
const callsThatMutate = call => call.args[0] === 'plugin' ? !call.args.includes('--json') && !call.args.includes('--help') :
  call.args[0] === 'mcp' && ['remove', 'add'].includes(call.args[1]) && !call.args.includes('--help');
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
const normalized = text => text.replace(/(Memory (?:setup|status) )\d+\.\d+\.\d+/gu, '$1<version>')
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
  const baseline = await f.run({ args, choices, fixedNow, disableLocalMode: true });
  const baselineFiles = await inventory(f.home), baselineCalls = await f.calls();
  const mutating = (all, start) => Object.fromEntries(['claude', 'codex'].map(client => [client,
    all[client].slice(start[client].length).filter(callsThatMutate).map(call => ({ args: call.args, keys: call.keys, endpoint: call.endpoint, pairingRecord: call.pairingRecord }))]));
  const mutations = mutating(baselineCalls, beforeCalls);
  const orderedMutations = (await f.orderedCalls()).slice(beforeOrdered).filter(callsThatMutate);
  await rm(f.home, { recursive: true }); await cp(saved, f.home, { recursive: true });
  await writeFile(join(f.scratch, 'claude.json'), nativeState); await writeFile(join(f.scratch, 'codex.json'), codexState);
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
  // The only additional native call is list against the disposable copy, plus
  // Claude's plugin-list detection. Neither may write the real host config.
  for (const client of ['claude', 'codex']) {
    const extra = routedCalls[client].slice(beforeRouted[client].length).filter(call =>
      client === 'claude' ? call.args.join(' ') === 'plugin list --json' : call.args.join(' ') === 'mcp list --json');
    const extraCount = routedCalls[client].length - beforeRouted[client].length -
      (baselineCalls[client].length - beforeCalls[client].length);
    assert.equal(extraCount, extra.length - baselineCalls[client].slice(beforeCalls[client].length).filter(call =>
      client === 'claude' ? call.args.join(' ') === 'plugin list --json' : call.args.join(' ') === 'mcp list --json').length);
    if (client === 'codex') assert.ok(extra.every(call => call.home !== f.codexHome));
  }
  t.diagnostic('Compared native mutations, prompts, output and every HOME file against the hosted-only seam.');
});

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, cp, rm, mkdtemp, mkdir } from 'node:fs/promises';
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
function acceptBaseline(t, historical, required = process.env.CAIRN_SETUP_REQUIRE_BASELINE === '1') {
  if (historical.module) return historical;
  const reason = historical.skip ?? 'Historical 0.5.3 installer is unavailable.';
  assert.ok(!required, 'CAIRN_SETUP_REQUIRE_BASELINE=1: ' + reason);
  t.skip(reason);
  return null;
}
const baselineForTest = async t => acceptBaseline(t, await historicalInstaller());
test('L06 unavailable baseline fails when required and never falls back to current code', () => {
  let skipped = false;
  const context = { skip: () => { skipped = true; } };
  assert.equal(acceptBaseline(context, { skip: 'baseline unavailable' }, false), null);
  assert.equal(skipped, true);
  skipped = false;
  assert.throws(() => acceptBaseline(context, { skip: 'baseline unavailable' }, true), /CAIRN_SETUP_REQUIRE_BASELINE=1/u);
  assert.equal(skipped, false);
});
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
      [...call.args.slice(0, 3), '<schema-output>'] : call.args.map(arg => normalizeRuntime(arg, home));
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
// Normalize only this fixture's managed hosted runtime, never another /runtime.
const runtimeId = String.raw`\d+\.\d+\.\d+(?:-[\w.]+)?-[a-f0-9]{12}`;
const escapePattern = text => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const normalizeRuntime = (text, home) => text.replace(new RegExp(
  '(^|[\\s\'"=])(' + escapePattern(home + '/cairn/runtime/') + ')' + runtimeId + '(?=/|[\\s\'"\\\\]|$)', 'gu'),
'$1$2<version>-<digest>');
const generationPath = new RegExp('^\\.codex/cairn/runtime/(' + runtimeId + ')(/.*)?$', 'u');
// PR #454 intentionally changes hosted cancellation and protocol R16 permit
// restoration. Only these runtime sources may differ from immutable 0.5.3.
const hostedRuntimeExceptions = [
  'integrations/client/control-state.mjs',
  'integrations/client/file-lock.mjs',
  'integrations/client/pairing.mjs',
  'integrations/client/transport-hosted.mjs',
];
const packagedHostedRuntime = new Map(await Promise.all(hostedRuntimeExceptions.map(async path =>
  [path, await readFile(new URL('../runtime/' + path, import.meta.url))])));
const packagedHostedManifest = await readFile(new URL('../runtime/manifest.json', import.meta.url));

// Walk JSON token positions so only exact field paths change, retaining every
// whitespace byte and string escape elsewhere. Hosted installation.json has no
// installerVersion field; its schema version and every nested field stay raw.
function normalizeFile(name, bytes, home) {
  const installation = name === '.codex/cairn/installation.json';
  const runtimeManifest = generationPath.exec(name)?.[2] === '/manifest.json';
  if (!installation && !runtimeManifest && name !== '.codex/hooks.json') return bytes;
  const text = bytes.toString();
  JSON.parse(text);
  const tokens = [...text.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/gu)];
  let at = 0;
  const edits = [];
  function value(path) {
    const token = tokens[at++], raw = token[0];
    if (raw === '{') {
      if (tokens[at][0] === '}') { at++; return; }
      for (;;) {
        const key = JSON.parse(tokens[at++][0]); at++; // colon
        value([...path, key]);
        if (tokens[at++][0] === '}') return;
      }
    } else if (raw === '[') {
      if (tokens[at][0] === ']') { at++; return; }
      for (let index = 0; ; index++) {
        value([...path, index]);
        if (tokens[at++][0] === ']') return;
      }
    } else if (raw.startsWith('"')) {
      if (runtimeManifest) {
        // Preserve paths, order, formatting and every other manifest byte.
        if (path.length === 2 && path[0] === 'files' && hostedRuntimeExceptions.includes(path[1])) {
          assert.match(raw, /^"[a-f0-9]{64}"$/u);
          edits.push([token.index, raw.length, '"<PR-454-runtime-hash>"']);
        }
        return;
      }
      const managedField = installation ? path.length === 1 && path[0] === 'runtime' :
        path.length === 6 && path[0] === 'hooks' &&
        ['SessionStart', 'UserPromptSubmit', 'Stop', 'PreCompact'].includes(path[1]) &&
        Number.isInteger(path[2]) && path[3] === 'hooks' && Number.isInteger(path[4]) && path[5] === 'command';
      if (managedField) {
        const replacement = normalizeRuntime(raw, JSON.stringify(home).slice(1, -1));
        if (replacement !== raw) edits.push([token.index, raw.length, replacement]);
      }
    }
  }
  value([]);
  let result = text;
  for (const [index, length, replacement] of edits.reverse()) result = result.slice(0, index) + replacement + result.slice(index + length);
  return Buffer.from(result);
}
const normalizedCall = (call, home) => ({ ...call, args: call.args.map(arg => normalizeRuntime(arg, home)) });
function fileInventory(entries, normalize, home, { historical = false } = {}) {
  const result = {}, generations = new Map();
  for (let [name, bytes] of entries) {
    const generation = generationPath.exec(name);
    if (normalize && generation?.[2] === '/manifest.json' && !historical)
      assert.deepEqual(bytes, packagedHostedManifest, 'Installed runtime manifest must match packaged manifest: ' + name);
    const packaged = normalize && generation && packagedHostedRuntime.get(generation[2]?.slice(1));
    if (packaged) {
      if (!historical) assert.deepEqual(bytes, packaged, 'Installed runtime must match packaged source: ' + name);
      bytes = packaged;
    }
    const hash = bytes === null ? '<directory>' : createHash('sha256')
      .update(normalize ? normalizeFile(name, bytes, home) : bytes).digest('hex');
    if (normalize && generation) {
      if (!generations.has(generation[1])) generations.set(generation[1], {});
      generations.get(generation[1])[generation[2] ?? '/'] = hash;
    }
    const key = normalize && generation ? '.codex/cairn/runtime/<version>-<digest>' + (generation[2] ?? '') : name;
    if (Object.hasOwn(result, key)) assert.equal(result[key], hash, name);
    result[key] = hash;
  }
  // Compare whole generations before accepting collapsed paths. An older tree
  // cannot supply files that a new, incomplete generation is missing.
  const complete = [...generations.values()];
  for (const generation of complete.slice(1)) assert.deepEqual(generation, complete[0], 'Every hosted runtime generation must have the same complete inventory and bytes');
  return result;
}
async function inventory(root, normalize = false, options) {
  async function entries(directory, prefix = '') {
    const result = [];
    try {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name), name = prefix + entry.name;
        if (entry.isDirectory()) {
          if (generationPath.test(name)) result.push([name + '/', null]);
          result.push(...await entries(path, name + '/'));
        } else result.push([name, await readFile(path)]);
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return result;
  }
  return fileInventory(await entries(root), normalize, join(root, '.codex'), options);
}
const normalized = (text, home) => normalizeRuntime(text.replace(/(Cairn\.ink Memory(?: setup| status| 安裝程式)? )\d+\.\d+\.\d+(?:-[\w.]+)?/gu, '$1<version>'), home);
test('L06 version normalization preserves unrelated bytes and complete runtime generations', () => {
  const home = '/synthetic/.codex';
  const oldRuntime = home + '/cairn/runtime/0.5.3-0123456789ab';
  const newRuntime = home + '/cairn/runtime/0.6.0-abcdef012345';
  const before = Buffer.from(`{ "version": 1, "runtime": "${oldRuntime}", "dailyCap": 200 }\n`);
  const after = Buffer.from(`{ "version": 1, "runtime": "${newRuntime}", "dailyCap": 200 }\n`);
  const name = '.codex/cairn/installation.json';
  const equalFile = (path, first, second) => assert.deepEqual(normalizeFile(path, first, home), normalizeFile(path, second, home));
  equalFile(name, before, after);
  for (const changed of [after.toString().replace('200', '201'), after.toString().replace('{ ', '{  ')])
    assert.throws(() => equalFile(name, before, Buffer.from(changed)));
  const hooks = runtime => Buffer.from(JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: `node ${runtime}/hook.mjs` }] }] } }));
  equalFile('.codex/hooks.json', hooks(oldRuntime), hooks(newRuntime));
  const unrelated = version => hooks(`/unrelated/runtime/${version}`);
  assert.throws(() => equalFile('.codex/hooks.json', unrelated('0.5.3-0123456789ab'), unrelated('0.6.0-abcdef012345')));
  assert.throws(() => equalFile('.codex/hooks.json', hooks('/unrelated' + oldRuntime), hooks('/unrelated' + newRuntime)));
  for (const path of [name, '.codex/hooks.json']) {
    for (const field of ['runtime', 'command', 'installerVersion']) {
      const nested = runtime => Buffer.from(JSON.stringify({ nested: { [field]: runtime } }));
      assert.throws(() => equalFile(path, nested(oldRuntime), nested(newRuntime)));
    }
  }
  assert.throws(() => equalFile(name, Buffer.from('{"installerVersion":"0.5.3"}'), Buffer.from('{"installerVersion":"0.6.0"}')));
  assert.throws(() => equalFile('.codex/hooks.json', hooks(oldRuntime), Buffer.from(hooks(newRuntime).toString().replace('Stop', 'Start'))));
  for (const path of ['.codex/config.toml', '.codex/cairn/runtime/0.6.0-abcdef012345/entry.mjs']) {
    assert.deepEqual(normalizeFile(path, after, home), after);
    assert.throws(() => equalFile(path, before, after));
  }
  const payload = Buffer.from('runtime payload 0.5.3 stays literal');
  const oldName = '.codex/cairn/runtime/0.5.3-0123456789ab/entry.mjs';
  const newName = '.codex/cairn/runtime/0.6.0-abcdef012345/entry.mjs';
  const files = entries => fileInventory(entries, true, home);
  assert.deepEqual(files([[oldName, payload]]), files([[newName, payload]]));
  assert.throws(() => files([[oldName, payload], [newName, Buffer.from('changed source')]]));
  const secondFile = oldName.replace('entry.mjs', 'second.mjs');
  assert.throws(() => files([[oldName, payload], [secondFile, payload], [newName, payload]]));
  assert.throws(() => files([[oldName, payload], [newName.replace('/entry.mjs', '/'), null]]));
  assert.throws(() => assert.deepEqual(files([[oldName, payload]]), files([[newName, payload], [newName.replace('entry.mjs', 'extra.mjs'), payload]])));
  assert.equal(normalizeRuntime(oldRuntime + '/entry.mjs', home), normalizeRuntime(newRuntime + '/entry.mjs', home));
  assert.notEqual(normalizeRuntime(oldRuntime, '/other/.codex'), normalizeRuntime(newRuntime, '/other/.codex'));
  assert.deepEqual(normalizedCall({ args: ['configure', oldRuntime + '/entry.mjs'], keys: ['0.5.3'] }, home),
    { args: ['configure', normalizeRuntime(newRuntime + '/entry.mjs', home)], keys: ['0.5.3'] });
  assert.notEqual(normalized('Cairn.ink Memory setup 0.6.0\nunrelated 0.6.0', home),
    normalized('Cairn.ink Memory setup 0.5.3\nunrelated 0.5.3', home));
});
test('L06 hosted runtime exceptions require packaged bytes and preserve all other comparisons', async () => {
  const home = '/synthetic/.codex';
  const oldRuntime = '.codex/cairn/runtime/0.5.3-0123456789ab/';
  const newRuntime = '.codex/cairn/runtime/0.6.0-abcdef012345/';
  const files = (entries, historical = false) => fileInventory(entries, true, home, { historical });
  const payload = Buffer.from('unchanged runtime bytes');
  const manifest = JSON.parse(packagedHostedManifest);
  for (const path of Object.keys(manifest.files).filter(path => !hostedRuntimeExceptions.includes(path))) {
    assert.deepEqual(files([[newRuntime + path, payload]]), files([[oldRuntime + path, payload]], true));
    assert.throws(() => assert.deepEqual(files([[newRuntime + path, Buffer.from('changed runtime bytes')]]),
      files([[oldRuntime + path, payload]], true)), { code: 'ERR_ASSERTION' }, path);
  }
  for (const [path, packaged] of packagedHostedRuntime) {
    const baseline = files([[oldRuntime + path, payload]], true);
    assert.deepEqual(files([[newRuntime + path, packaged]]), baseline);
    const damaged = Buffer.from(packaged); damaged[0] ^= 1;
    assert.throws(() => files([[newRuntime + path, damaged]]), { code: 'ERR_ASSERTION' }, path);
    assert.throws(() => files([[oldRuntime + path, packaged], [newRuntime + path, damaged]]), { code: 'ERR_ASSERTION' }, path);
    assert.throws(() => assert.deepEqual(files([]), baseline), { code: 'ERR_ASSERTION' }, path);
    assert.throws(() => files([[oldRuntime + path, packaged], [newRuntime, null]]), { code: 'ERR_ASSERTION' }, path);
  }
  const manifestName = newRuntime + 'manifest.json';
  const oldManifest = Buffer.from(packagedHostedManifest.toString().replace(/"([^"\n]+)": "[a-f0-9]{64}"/gu,
    (raw, path) => hostedRuntimeExceptions.includes(path) ? JSON.stringify(path) + ': "' + '0'.repeat(64) + '"' : raw));
  const baselineManifest = files([[oldRuntime + 'manifest.json', oldManifest]], true);
  assert.deepEqual(files([[manifestName, packagedHostedManifest]]), baselineManifest);
  assert.deepEqual(files([[oldRuntime + 'manifest.json', oldManifest], [manifestName, packagedHostedManifest]], true), baselineManifest);
  const equalManifest = bytes => assert.deepEqual(normalizeFile(manifestName, bytes, home),
    normalizeFile(oldRuntime + 'manifest.json', oldManifest, home));
  for (const path of Object.keys(manifest.files).filter(path => !hostedRuntimeExceptions.includes(path))) {
    const changedHash = Buffer.from(packagedHostedManifest.toString().replace(manifest.files[path], '0'.repeat(64)));
    assert.throws(() => equalManifest(changedHash), { code: 'ERR_ASSERTION' }, path);
    assert.throws(() => files([[manifestName, changedHash]]), { code: 'ERR_ASSERTION' }, path);
  }
  for (const changed of [
    packagedHostedManifest.toString().replace('"version": 1', '"version": 2'),
    packagedHostedManifest.toString().replace('{\n', '{ \n'),
    packagedHostedManifest.toString().replace('integrations/client/control-state.mjs', 'integrations/client/control-stale.mjs'),
  ]) {
    assert.throws(() => equalManifest(Buffer.from(changed)), { code: 'ERR_ASSERTION' });
    assert.throws(() => files([[manifestName, Buffer.from(changed)]]), { code: 'ERR_ASSERTION' });
  }
  // Even an approved hash cannot hide a corrupt installed manifest copy.
  assert.throws(() => files([[manifestName, oldManifest]]), { code: 'ERR_ASSERTION' });
});
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
// The fixture runner supplies internal inspection paths by calling the library
// router, then delegates the unchanged hosted flow to main. Production main
// needs no new option or environment seam.
async function routingFixture(scratch, inspection) {
  const root = process.env.CAIRN_SETUP_TEST_PACKAGE || fileURLToPath(new URL('../', import.meta.url));
  const lib = name => pathToFileURL(join(root, 'lib', name + '.mjs')).href;
  const wrapper = join(scratch, 'routed-setup.mjs');
  for (const name of ['errors', 'transport']) await writeFile(join(scratch, name + '.mjs'),
    `export * from ${JSON.stringify(lib(name))};`);
  await writeFile(wrapper, `import{main as hosted}from${JSON.stringify(lib('setup'))};
    import{routeLocalMode,localStatus}from${JSON.stringify(lib('local-mode'))};
    import{parseOptions}from${JSON.stringify(lib('options'))};
    import{parseClient}from${JSON.stringify(lib('codex'))};
    import{SetupError}from${JSON.stringify(lib('errors'))};
    import{translator}from${JSON.stringify(lib('messages'))};
    import{spawn}from'node:child_process';import{writeSync}from'node:fs';
    export async function main(argv,options={}){
      const parsed=parseOptions(argv),selection=parseClient(parsed.argv,SetupError);
      const write=options.write??(line=>{if(line!==undefined)writeSync(1,line+'\\n');});write.literal??=write;
      const runClaude=args=>new Promise(resolve=>{const child=spawn('claude',args,{stdio:['ignore','pipe','pipe']});
        let stdout='',stderr='',error;child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);
        child.on('error',v=>error=v);child.on('close',status=>resolve({stdout,stderr,error,status}));});
      const context={...options,env:process.env,inspection:${JSON.stringify(inspection)},write,t:translator(parsed.lang??'en'),
        runClaude,supportedNode:()=>true,nodeVersion:process.versions.node};
      const result=await routeLocalMode(parsed,selection,context);
      if(result.handled)return result.code;
      const code=await hosted(argv,{...options,disableLocalMode:true});
      if(result.detection)await localStatus(result.detection,context);
      return Math.max(code,result.statusCode??0);
    }`);
  return pathToFileURL(wrapper).href;
}
const cells = [
  ...scenarios.flatMap(scenario => actions.map(args => ({ scenario, args, label: 'L06' }))),
  ...scenarios.slice(0, 4).flatMap(scenario => [['setup'], ['setup', '--client', 'claude'], ['setup', '--cloud'],
    ['setup', '--dry-run'], ['status'], ['pause']].map(args => ({ scenario, args, label: 'L24' }))),
];
for (const { scenario, args, label } of cells) test(`${label} hosted baseline: ${scenario}; ${args.join(' ')}`, async t => {
  const historical = label === 'L24' ? acceptBaseline(t, await historicalInstaller(), true) : await baselineForTest(t);
  if (!historical) return;
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
  let inspectionTmpdir, routedModule;
  if (label === 'L24') {
    inspectionTmpdir = join(f.home, 'tmp'); await mkdir(inspectionTmpdir);
    await mkdir(f.codexHome, { recursive: true });
    await writeFile(join(f.codexHome, 'config.toml'), await readFile(join(f.codexHome, 'config.toml')).catch(error => {
      if (error.code !== 'ENOENT') throw error; return Buffer.from('model = "fixture"\n');
    }), { mode: 0o600 });
    const fallbackParent = join(f.scratch, 'fallback'); await mkdir(fallbackParent);
    routedModule = await routingFixture(f.scratch, { fallbackParent, managedPaths: [] });
  }
  const run = options => f.run({ ...options, tmpdir: inspectionTmpdir });
  const saved = join(f.scratch, 'baseline-home'); await cp(f.home, saved, { recursive: true });
  const nativeState = await readFile(join(f.scratch, 'claude.json'));
  const codexState = await readFile(join(f.scratch, 'codex.json'));
  const choices = { claude: 'no', codex: 'no' }, fixedNow = Date.now();
  if (args.length === 1 && args[0] === 'setup') {
    const before = await inventory(f.home), calls = (await f.orderedCalls()).length;
    const conflict = await run({ args: ['setup', '--local'], disableLocalMode: false, ...(routedModule ? { module: routedModule } : {}) });
    assert.equal(conflict.code, 2, conflict.stdout);
    assert.match(conflict.stdout, scenario === 'Claude inspection failure' ? /Cannot inspect/ : /Cloud memory is configured/);
    assert.deepEqual(await inventory(f.home), before);
    assert.deepEqual((await f.orderedCalls()).slice(calls).filter(callsThatMutate), []);
  }
  const beforeCalls = await f.calls(), beforeOrdered = (await f.orderedCalls()).length;
  // --cloud selects the pre-existing hosted setup; 0.5.3 had no mode flag.
  const baseline = await run({ args: args.filter(arg => arg !== '--cloud'), choices, fixedNow, disableLocalMode: true, module: historical.module });
  const baselineFiles = await inventory(f.home, true, { historical: true }), baselineCalls = await f.calls();
  const mutating = (all, start) => Object.fromEntries(['claude', 'codex'].map(client => [client,
    all[client].slice(start[client].length).filter(callsThatMutate).map(call => ({ args: call.args.map(arg => normalizeRuntime(arg, f.codexHome)), keys: call.keys, endpoint: call.endpoint, pairingRecord: call.pairingRecord }))]));
  const mutations = mutating(baselineCalls, beforeCalls);
  const orderedMutations = (await f.orderedCalls()).slice(beforeOrdered).filter(callsThatMutate).map(call => normalizedCall(call, f.codexHome));
  const restore = async () => {
    await rm(f.home, { recursive: true }); await cp(saved, f.home, { recursive: true });
    await writeFile(join(f.scratch, 'claude.json'), nativeState); await writeFile(join(f.scratch, 'codex.json'), codexState);
  };
  await t.test('immutable 0.5.3 versus current hosted-only path', async () => {
    await restore(); const start = await f.calls(), orderedStart = (await f.orderedCalls()).length;
    const disabled = await run({ args, choices, fixedNow, disableLocalMode: true });
    assert.equal(disabled.code, baseline.code, disabled.stdout);
    assert.equal(normalized(disabled.stdout, f.codexHome), normalized(baseline.stdout, f.codexHome));
    assert.deepEqual(disabled.prompts, baseline.prompts);
    const disabledCalls = await f.calls();
    assert.deepEqual(mutating(disabledCalls, start), mutations);
    for (const client of ['claude', 'codex']) assertProbeDelta(baselineCalls[client].slice(beforeCalls[client].length), disabledCalls[client].slice(start[client].length), client, f.codexHome);
    assert.deepEqual((await f.orderedCalls()).slice(orderedStart).filter(callsThatMutate).map(call => normalizedCall(call, f.codexHome)), orderedMutations);
    assert.deepEqual(await inventory(f.home, true), baselineFiles);
    await assert.rejects(readdir(join(f.home, 'local-memory')), { code: 'ENOENT' });
  });
  await restore();
  const beforeRouted = await f.calls(), routedOrdered = (await f.orderedCalls()).length;
  const routed = await run({ args, choices, fixedNow, disableLocalMode: false, ...(routedModule ? { module: routedModule } : {}) });
  assert.equal(routed.code, baseline.code, routed.stdout);
  assert.equal(normalized(routed.stdout, f.codexHome), normalized(baseline.stdout, f.codexHome));
  assert.deepEqual(routed.prompts, baseline.prompts);
  assert.deepEqual(mutating(await f.calls(), beforeRouted), mutations);
  assert.deepEqual((await f.orderedCalls()).slice(routedOrdered).filter(callsThatMutate).map(call => normalizedCall(call, f.codexHome)), orderedMutations);
  assert.deepEqual(await inventory(f.home, true), baselineFiles);
  await assert.rejects(readdir(join(f.home, 'local-memory')), { code: 'ENOENT' });
  const routedCalls = await f.calls();
  for (const client of ['claude', 'codex']) assertProbeDelta(baselineCalls[client].slice(beforeCalls[client].length),
    routedCalls[client].slice(beforeRouted[client].length), client, f.codexHome);
  t.diagnostic('Compared native mutations, prompts, output and every HOME file against the hosted-only seam.');
});

for (const lang of ['zh', 'en']) for (const flags of [['--codex-capture-exec', 'on'], ['--codex-daily-cap', '100']])
test('L06 pre-header Claude option error: ' + lang + ' ' + flags[0], async t => {
  const historical = await baselineForTest(t);
  if (!historical) return;
  const f = await fixture(t);
  const args = ['setup', '--lang', lang, '--client', 'claude', ...flags];
  const before = await inventory(f.home), calls = (await f.orderedCalls()).length;
  const baseline = await f.run({ args, module: historical.module });
  const disabled = await f.run({ args, disableLocalMode: true });
  const routed = await f.run({ args, disableLocalMode: false });
  const cloud = await f.run({ args: [...args, '--cloud'], disableLocalMode: false });
  assert.equal(baseline.code, 2); assert.equal(disabled.code, 2); assert.equal(routed.code, 2);
  assert.equal(cloud.code, 2); assert.equal(cloud.stdout, baseline.stdout);
  assert.equal(routed.stdout, disabled.stdout);
  await t.test('immutable 0.5.3 error output', () => assert.equal(routed.stdout, baseline.stdout));
  assert.doesNotMatch(routed.stdout, /Memory setup|記憶設定/u);
  assert.deepEqual(await inventory(f.home), before);
  assert.deepEqual((await f.orderedCalls()).slice(calls).filter(callsThatMutate), []);
  await assert.rejects(readdir(join(f.home, 'local-memory')), { code: 'ENOENT' });
});

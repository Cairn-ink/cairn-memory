import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, cp, rm, mkdtemp, mkdir, realpath, symlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fixture } from './clients.test.mjs';
import { messages } from '../lib/messages.mjs';
import { KNOWN_FORMATS } from '../runtime/integrations/codex/qualification.mjs';

// Extract immutable historical git objects, never current source, with the same
// fakes and private homes. No credentials or machine paths are recorded.
const historicalPromises = new Map(), historicalScratch = new Set();
after(async () => {
  await Promise.all([...historicalScratch].map(path => rm(path, { recursive: true, force: true })));
});
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
function historicalInstaller(revision = 'b2513501', version = '0.5.3') {
  if (!historicalPromises.has(revision)) historicalPromises.set(revision, (async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'cairn-' + version.replaceAll('.', '') + '-baseline-'));
    historicalScratch.add(scratch);
    try {
      const env = { PATH: process.env.PATH, HOME: scratch };
      const archive = await native('git', ['archive', revision, 'packages/setup'], {
        cwd: fileURLToPath(new URL('../../../', import.meta.url)), env });
      await native('tar', ['-xf', '-', '-C', scratch], { input: archive, env });
      return { module: pathToFileURL(join(scratch, 'packages/setup/lib/setup.mjs')).href };
    } catch { return { skip: `Historical ${version} comparison requires git object ${revision} and working git/tar child pipes.` }; }
  })());
  return historicalPromises.get(revision);
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
    assert.equal(call.args.join(' '), expected, 'Only the new read-only detection probes may be added; next historical call: ' + JSON.stringify(args(baseline[index])));
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
// Contract section 18 (0.6.3) adds the three Codex format qualification modules.
// Recall deadlines admit exactly these line substitutions, checked against the
// immutable installer below. Every other source byte remains significant.
const recallRuntimeChanges = new Map([
  ['integrations/codex/hook.mjs', [
    "  const budget=['SessionStart','UserPromptSubmit'].includes(input?.hook_event_name)?2500:750;",
    "  const budget=input?.hook_event_name==='UserPromptSubmit'?3000:input?.hook_event_name==='SessionStart'?2500:750;",
  ]],
]);
// Atomic output delivery changes entry beyond its recall-budget line.
// Pause durability changes whole functions; pin both immutable historical and
// current bytes instead of reconstructing the earlier file from current source.
// Root replay and the frozen capture generation revise current pins; preserve
// every historical digest and the historical behavior comparisons below.
const durabilityRuntimeChanges = new Map([
  // Output gate admission now accepts the remaining-budget abort signal.
  ['integrations/client/state-lock.mjs', {
    historical: 'ee4bc6161d97bac44a8dc34a2058ed48e3dbbfeb105e32f6e66590b883b29b58',
    before: 'ee4bc6161d97bac44a8dc34a2058ed48e3dbbfeb105e32f6e66590b883b29b58',
    previousHostContainer: '47899f7e6881b7e27726f5145fe151c0f8068537045b3e26556eb9e53d87e14a',
    // Host-managed root gates allow readable containers; eligibility stays read-only.
    current: 'b1c40477819aceb2bf374d598da25eb258c81f031a6f70646d28c154aefba152',
  }],
  // The merged worker retains capture windows/source times plus root replay
  // and frozen-generation dispatch; pin these combined bytes exactly once.
  ['integrations/codex/worker.mjs', {
    historical: '0fbb1295e596769035eca5e974efa4f355774a6c37d70f3442a3e78c4aa7264d',
    before: '0fbb1295e596769035eca5e974efa4f355774a6c37d70f3442a3e78c4aa7264d',
    previousPauseWorker: '6453ea0e6d3c0f3a4eb70bfc4eb7c45e85251c48dcc4c3da89e177be834ff03e',
    previousCombined: 'a22f205506062e00debe4971a825dfd3990240a005c7c2d7d180f34e4affa3fd',
    previousInstaller: '2fd5987edcf0c047d0ad78145b7f2887e20643ce6eca723871b41598ca2e13e4',
    // Acknowledged-capture diagnostics plus capture windows, root replay and frozen-generation dispatch.
    current: 'b26a5823e39aaabb21e9224794801be7d80ede84a9c29122bc60e33745b825c6',
  }],
  ['integrations/codex/entry.mjs', {
    historical: '558a2f9f5cbed3c4e08146626708ba5ab4374e6938fa9c2e1cdc935d50580952',
    before: '0182cc90faddafeea34b8ba11a4c96805f74140117c1ee4b4ad118ca47b0d331',
    current: '4bc207d972508f7e0ba7eea2ed69021188673d47cccfe6a375de1b8d88973ea4',
  }],
  // Final admission needs synchronous owner-checked reads of pause metadata.
  ['integrations/client/private-state.mjs', {
    historical: 'ca789169d55a76c327ca1ee603ff21b71d1bdde9a8f0d837cfbeb167700afd64',
    before: 'ca789169d55a76c327ca1ee603ff21b71d1bdde9a8f0d837cfbeb167700afd64',
    previousCurrent: '7dc46417a129414937b0180482acf6bdf7f58c1816f93468e8df1d952057485b',
    previousHostContainer: '7fd62ae5b862cfe77b393e06ef787508f89f7071879a84859357420893aff0c4',
    // Host containers may be readable or aliased; state files remain private.
    current: 'df7adad56c4a0e40d072a69f4f67ccd62ec3e9b7970327443fb114f5a4715dff',
  }],
  // Merge portable exact-GET first-prompt authority with gate-only pause commits
  // and durable pending-marker replay; retain both parent current digests below.
  ['integrations/client/hosted-pause.mjs', {
    historical: 'f4782d2c3e1f4103778990af93805be918eab67768708e70f28f12610a114d30',
    before: 'f4782d2c3e1f4103778990af93805be918eab67768708e70f28f12610a114d30',
    previousCurrent: '365314ab54f794b34e4972de22d456b2c529a0f6d608c62a01f8558fe4a32892',
    previousSynchronousAdmission: '24d0588a6316c89cc5c2d4c0cc2a8ee5a6bacd035c2187298e3480ac3c21a5b2',
    previousGatedPublication: 'c946fb5ab612b8a252bf21d4c18a12c69bd4abed9bda16ea5ad411c551f36993',
    previousPortableFirstPrompt: '76cc819ac94a85ed1fc8a2d2dabd92bf9b3581ad82422119df279c054727639c',
    previousPendingReplay: 'c2cb8a1dce38e1a9ae2055094c9ef8b1ec65ba40e6ce0cbfbcee8bfa1f9e8086',
    previousHostContainer: 'ab63b7ddb34a8f097255e4f702bd7cfaefd5155a63873d66b93f0d229a6995d2',
    // Retain the installer's superseded pause runtime alongside gate-only replay.
    previousInstallerPause: '8d15d24036533f5a235b5e54627cb4db3b94312f28874f9fdf24cd2897cb0635',
    // Root authority and rotation retain the gate in host-managed containers.
    current: 'ef2f022848664bb436d7f59f4cc446a2d230e3aacf637707f20d09b66ac563ba',
  }],
  ['integrations/codex/installed.mjs', {
    historical: '778cfefb7f6aed93f68258c2a2ffc32de5110d2b41cd62b7ac922ae6dddf20ea',
    before: '778cfefb7f6aed93f68258c2a2ffc32de5110d2b41cd62b7ac922ae6dddf20ea',
    previousCombined: '8079b851c499f57f2064c29380a3b8b9a137dd3bb9b4dd4b930b5b1b047f32d9',
    previousInstaller: '0377df55d80378aad167522116c58262e3b5e182b9c4b5da517e14670bb832e8',
    // Capture-stop notices plus pause-gated context delivery and deferred host publication.
    current: 'a054b5da392fc2b4dce7bc7b0e2c9e161ba1bc7beb5a3518247b1c8575f9997b',
  }],
  ['integrations/codex/hosted-lifecycle.mjs', {
    historical: '8b4a8e7ea1cef5473147bfe2ea6af9548894c52f08e44a656e545fcb9fc8c496',
    before: 'bd7bc299773cc389565a34bfd9a7131f68ad7bef934d3ce5a0ebeeea800bbe3a',
    previousInstallerDeadline: '5123350b18ee89a7557dbeec237e1e7790f1b7f21484dd393a97a6f66b009e94',
    previousPromptDeadline: '3771ad2a034c5cad4b9a2882d5a9306a7cefd704bcebc67893fc286b93937b24',
    // Recall retains its full deadline and cancellation after the final switch withholds output.
    current: '513a735b9f14899f824374b7fe27fcbf0c06ce81d025588cd6c84c0e415be44a',
  }],
]);
// Capture metadata changes the contract/schema and worker, and extracts a pure
// calendar helper. Pin the exact historical/current bytes; the new helper is
// required in current generations and synthesized only for the pinned old tree.
const captureRuntimeChanges = new Map([
  [
    "integrations/client/hosted-contract.mjs",
    {
      "historical": "39ce7dcb60b91ab7bf815bd0085f278e9cc5d0f9798b9b5d27e7b7655fd217d1",
      "current": "07bb439a728f1be053cfa40f425d7e52e0a2b958a22dd72cd889f3f942fb12fd"
    }
  ],
  [
    "integrations/client/hosted-schemas.mjs",
    {
      "historical": "fda2e6b4f6feda316300819e1a199dd25f7462b9f47e33bff950c3c4f95ba8ce",
      "current": "c9e2b4fc3e85e136594438ad58a24d15526296b12ab1d438ae930a91b8ec82d3"
    }
  ],
  // Reuse the durability object's historical/before/current pins: one worker,
  // one authority for its merged bytes, with both behavioral classifications.
  ['integrations/codex/worker.mjs', durabilityRuntimeChanges.get('integrations/codex/worker.mjs')],
  [
    "integrations/client/source-time.mjs",
    {
      "historical": null,
      "current": "002acf215bd6b79b3e4ace3e9d181a89dbf8efc48093a6e980c8417df64b9401"
    }
  ]
]);
const captureSourceModule = 'integrations/client/source-time.mjs';
const historicalCaptureManifestHash = "3f03f7e0f15e3f4b482b383e2a8b01c5c51ce2903c22f2983d5f3da42b41b1dd";
const hostedRuntimeExceptions = [...new Set([
  'integrations/client/control-state.mjs',
  'integrations/client/file-lock.mjs',
  'integrations/client/pairing.mjs',
  'integrations/client/transport-hosted.mjs',
  'integrations/codex/parser.mjs',
  'integrations/codex/qualification.mjs',
  'integrations/codex/schema-evidence.mjs',
  // Installer 0.6.5 (capture stop notice) adds these hook runtime files. Its
  // installed.mjs change is covered by the durability pin below, listed once.
  'integrations/codex/installed-state.mjs',
  'integrations/codex/worker.mjs',
  ...recallRuntimeChanges.keys(),
  ...durabilityRuntimeChanges.keys(),
  ...captureRuntimeChanges.keys(),
])];
const packagedHostedRuntime = new Map(await Promise.all(hostedRuntimeExceptions.map(async path =>
  [path, await readFile(new URL('../runtime/' + path, import.meta.url))])));
const packagedHostedManifest = await readFile(new URL('../runtime/manifest.json', import.meta.url));
const historicalRecallRuntime = new Map([...recallRuntimeChanges].map(([path, [before, after]]) => {
  const current = packagedHostedRuntime.get(path).toString();
  assert.equal(current.split(after).length, 2, 'Exactly one approved recall line: ' + path);
  return [path, Buffer.from(current.replace(after, before))];
}));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function assertRecallRuntime(path, bytes) {
  const pins = durabilityRuntimeChanges.get(path) ?? captureRuntimeChanges.get(path);
  assert.ok(pins ? Object.values(pins).includes(sha256(bytes)) :
    bytes.equals(packagedHostedRuntime.get(path)) || bytes.equals(historicalRecallRuntime.get(path)),
    'Only approved runtime bytes may differ: ' + path);
}

// Contract section 18, Rule 8 (v0.21): an independent historical-verdict oracle.
// Do not import production canonical/fingerprint or derive expected values from
// a current verdict. These frozen historical inputs also guard registry drift.
const historicalFormats = Object.freeze([
  'a64741d8899f84513232c3145595ed279325abfdf190b7705b94dcb81b14ab1a',
  '66fc10979c1594fdb2ba648983d36f10f2c4c1b33c01afe853ba92925b707b87',
]);
const historicalPolicy = 'a4e32a525989152d59714e6125e3704ea9ee131e1d1b1439c2b5ee638df6cef3';
const markerProfile = ['internally tagged enum AgentMessageContent',
  'struct variant AgentMessageContent::Text with 1 element',
  'internally tagged enum RolloutItemWire', 'hook_started', 'hook_completed'].sort();
function oracleCanonical(value) {
  if (Array.isArray(value)) return '[' + value.map(oracleCanonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + oracleCanonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const oracleHash = value => createHash('sha256').update(oracleCanonical(value)).digest('hex');
assert.equal(oracleHash(historicalFormats), historicalPolicy);
const mappedFingerprints = new Map(), derivedFormats = new Set();
for (const version of ['0.160.1', '0.161.0', '0.162.0', '0.163.0', '0.164.0', '0.165.0', '0.166.0']) {
  const original = JSON.parse(await readFile(new URL(`../../../integrations/codex/test/fixtures/binary-${version}/format.json`, import.meta.url)));
  const refreshed = oracleHash({ ...original, serdeMarkers: markerProfile });
  derivedFormats.add(refreshed);
  if (['0.160.1', '0.161.0', '0.162.0'].includes(version)) {
    const previous = oracleHash(original);
    assert.ok(historicalFormats.includes(previous));
    if (mappedFingerprints.has(previous)) assert.equal(mappedFingerprints.get(previous), refreshed);
    mappedFingerprints.set(previous, refreshed);
  }
}
assert.deepEqual([...mappedFingerprints.keys()], historicalFormats);
assert.deepEqual(KNOWN_FORMATS, [...derivedFormats]);
const expectedPolicy = oracleHash([...derivedFormats]);
const qualificationVerdictPath = /^\.codex\/cairn\/qualification\/[a-f0-9]{64}\.json$/u;

// Walk JSON token positions so only exact field paths change, retaining every
// whitespace byte and string escape elsewhere. Hosted installation.json has no
// installerVersion field; its schema version and every nested field stay raw.
function normalizeFile(name, bytes, home, { historical = false } = {}) {
  const installation = name === '.codex/cairn/installation.json';
  const runtimeManifest = generationPath.exec(name)?.[2] === '/manifest.json';
  const verdict = historical && qualificationVerdictPath.test(name);
  if (!installation && !runtimeManifest && name !== '.codex/hooks.json' && !verdict) return bytes;
  let text = verdict ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) : bytes.toString();
  if (runtimeManifest && historical && !Object.hasOwn(JSON.parse(text).files, captureSourceModule)) {
    assert.equal(sha256(bytes), historicalCaptureManifestHash, 'Only the pinned historical manifest lacks the calendar helper');
    const next = '    "integrations/client/state-lock.mjs":';
    assert.equal(text.split(next).length, 2);
    text = text.replace(next, '    ' + JSON.stringify(captureSourceModule) + ': ' +
      JSON.stringify(captureRuntimeChanges.get(captureSourceModule).current) + ',\n' + next);
  }
  const parsed = JSON.parse(text), translatedValues = new Map();
  if (verdict) {
    assert.ok(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'Malformed qualification verdict');
    const oldPolicy = parsed.policy === historicalPolicy;
    assert.ok(oldPolicy || parsed.policy === expectedPolicy, 'Unsupported qualification policy');
    translatedValues.set('policy', expectedPolicy);
    if (Object.hasOwn(parsed, 'fingerprint')) {
      const current = derivedFormats.has(parsed.fingerprint);
      assert.ok(current || (oldPolicy && mappedFingerprints.has(parsed.fingerprint)), 'Unsupported qualification fingerprint');
      translatedValues.set('fingerprint', current ? parsed.fingerprint : mappedFingerprints.get(parsed.fingerprint));
    }
  }
  const tokens = [...text.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/gu)];
  let at = 0;
  const edits = [], seenVerdictValues = new Set();
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
    } else if (historical && name === '.codex/hooks.json' && raw === '3' &&
        path.length === 6 && path[0] === 'hooks' && path[1] === 'UserPromptSubmit' &&
        Number.isInteger(path[2]) && path[3] === 'hooks' && Number.isInteger(path[4]) && path[5] === 'timeout') {
      const hook = parsed.hooks.UserPromptSubmit[path[2]].hooks[path[4]];
      const command = hook.command;
      if (hook.type === 'command' && typeof command === 'string' &&
          command.startsWith("'/usr/bin/env' '-i' 'HOME=") &&
          normalizeRuntime(command, home).includes(" '" + home + "/cairn/runtime/<version>-<digest>/integrations/codex/entry.mjs' ") &&
          command.endsWith(" '" + home + "/cairn/installation.json' 'UserPromptSubmit' 2>/dev/null || true"))
        edits.push([token.index, raw.length, '4']);
    } else if (raw.startsWith('"')) {
      if (verdict) {
        if (path.length === 1 && translatedValues.has(path[0])) {
          assert.ok(!seenVerdictValues.has(path[0]), 'Duplicate qualification value');
          seenVerdictValues.add(path[0]);
          const expected = translatedValues.get(path[0]);
          if (JSON.parse(raw) !== expected) edits.push([token.index, raw.length, JSON.stringify(expected)]);
        }
        return;
      }
      if (runtimeManifest) {
        // Preserve paths, order, formatting and every other manifest byte.
        if (path.length === 2 && path[0] === 'files' && hostedRuntimeExceptions.includes(path[1])) {
          assert.match(raw, /^"[a-f0-9]{64}"$/u);
          const pins = durabilityRuntimeChanges.get(path[1]) ?? captureRuntimeChanges.get(path[1]);
          if (pins) assert.ok(Object.values(pins).includes(JSON.parse(raw)), 'Only approved diagnostic hashes: ' + path[1]);
          else if (recallRuntimeChanges.has(path[1])) assert.ok([
            sha256(historicalRecallRuntime.get(path[1])), sha256(packagedHostedRuntime.get(path[1])),
          ].includes(JSON.parse(raw)), 'Only the approved recall hashes: ' + path[1]);
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
  entries = [...entries];
  if (normalize && historical) for (const [name, bytes] of [...entries]) {
    const generation = generationPath.exec(name);
    if (generation?.[2] !== '/manifest.json' || Object.hasOwn(JSON.parse(bytes).files, captureSourceModule)) continue;
    assert.equal(sha256(bytes), historicalCaptureManifestHash, 'Only the pinned historical inventory lacks the calendar helper');
    const leaf = name.slice(0, -'manifest.json'.length) + captureSourceModule;
    assert.ok(!entries.some(([path]) => path === leaf), 'Historical helper must be absent before its explicit classification');
    entries.push([leaf, packagedHostedRuntime.get(captureSourceModule)]);
  }
  for (let [name, bytes] of entries) {
    const generation = generationPath.exec(name);
    if (normalize && generation?.[2] === '/manifest.json' && !historical)
      assert.deepEqual(bytes, packagedHostedManifest, 'Installed runtime manifest must match packaged manifest: ' + name);
    const packaged = normalize && generation && packagedHostedRuntime.get(generation[2]?.slice(1));
    if (packaged) {
      if (historical && (recallRuntimeChanges.has(generation[2]?.slice(1)) || durabilityRuntimeChanges.has(generation[2]?.slice(1)) || captureRuntimeChanges.has(generation[2]?.slice(1)))) assertRecallRuntime(generation[2].slice(1), bytes);
      if (!historical) assert.deepEqual(bytes, packaged, 'Installed runtime must match packaged source: ' + name);
      bytes = packaged;
    }
    const hash = bytes === null ? '<directory>' : createHash('sha256')
      .update(normalize ? normalizeFile(name, bytes, home, { historical }) : bytes).digest('hex');
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
// The immutable comparator keeps historical stdout byte-for-byte. Only current
// status blocks (also printed by --dry-run) get the approved 0.6.5 B/C delta.
const captureTimestamp = String.raw`\d{4,6}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]) (?:[01]\d|2[0-3]):[0-5]\d`;
const captureStatusLine = new RegExp('^(?:' + ['en','zh'].flatMap(language => [
  escapePattern(messages.codex_last_capture_none[language]),
  escapePattern(messages.codex_last_capture[language]).replace(escapePattern('{date}'), captureTimestamp),
]).join('|') + ')(?:\n|$)', 'mu');
const indentedExecLine = new RegExp('^  (' + ['en','zh'].map(language =>
  escapePattern(messages.codex_exec_enabled[language])).join('|') + ')(?=\n|$)', 'mu');
const currentHostedOutput = text => text.replace(captureStatusLine, '').replace(indentedExecLine, '$1');
for (const language of ['en','zh']) test(`L06/L33/L24 current-only B/C output exception rejects unrelated line edits (${language})`, () => {
  const exec = messages.codex_exec_enabled[language];
  const before = `header\n  existing sibling\n${exec}\n  existing tail\n`;
  for (const date of [null,'1970-01-01 00:00','2026-11-04 17:42','275760-09-13 08:00']) {
    const line = date === null ? messages.codex_last_capture_none[language] :
      messages.codex_last_capture[language].replace('{date}',date);
    const after = before.replace(exec+'\n','  '+exec+'\n'+line+'\n');
    const equal = text => assert.equal(currentHostedOutput(text),before);
    equal(after);
    for (const damaged of [
      after+'unrelated added line\n',
      after.replace('  existing sibling\n',''),
      after.replace('existing tail','changed tail'),
      after.replace(exec+'\n','changed exec\n'),
      after.replace('  '+exec+'\n','   '+exec+'\n'),
      after.replace(line+'\n',line+' changed\n'),
      after.replace(line+'\n',' '+line+'\n'),
      after.replace(line+'\n',line+'\n'+line+'\n'),
      after.replace('header\n','header\n\n'),
    ]) assert.throws(()=>equal(damaged), {code:'ERR_ASSERTION'});
    if(date !== null) for(const invalid of ['not a timestamp','2026-13-04 17:42','2026-11-04 24:00','2026-11-04 17:99'])
      assert.throws(()=>equal(after.replace(date,invalid)), {code:'ERR_ASSERTION'});
    // Historical stdout is passed straight to the old normalizer; B and C
    // bytes in historical data must remain visible to the comparison.
    assert.notEqual(normalized(after,'/synthetic/.codex'),normalized(before,'/synthetic/.codex'));
  }
});

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
  // Eight unpinned modules + recall (1) + durability (7) + capture (4),
  // less the shared worker (1): nineteen unique runtime exceptions. Merging
  // synchronous metadata reads and pending replay changes pins, not membership.
  assert.equal(hostedRuntimeExceptions.length, 19);
  // Atomic output moved entry to whole-file pins; root replay and cancellable
  // admission add worker/state-lock. Immutable historical/before pins remain.
  assert.equal(recallRuntimeChanges.size, 1);
  assert.equal(durabilityRuntimeChanges.size, 7);
  // The worker belongs to both behaviors but shares one exact pin object.
  assert.equal(captureRuntimeChanges.size, 4);
  // Capture-stop diagnostics add installed-state; worker is already pinned.
  assert.equal(new Set(hostedRuntimeExceptions).size, hostedRuntimeExceptions.length);
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
    const baseline = files([[oldRuntime + path, historicalRecallRuntime.get(path) ?? ((durabilityRuntimeChanges.has(path) || captureRuntimeChanges.has(path)) ? packaged : payload)]], true);
    assert.deepEqual(files([[newRuntime + path, packaged]]), baseline);
    const damaged = Buffer.from(packaged); damaged[0] ^= 1;
    assert.throws(() => files([[newRuntime + path, damaged]]), { code: 'ERR_ASSERTION' }, path);
    assert.throws(() => files([[oldRuntime + path, packaged], [newRuntime + path, damaged]]), { code: 'ERR_ASSERTION' }, path);
    assert.throws(() => assert.deepEqual(files([]), baseline), { code: 'ERR_ASSERTION' }, path);
    assert.throws(() => files([[oldRuntime + path, packaged], [newRuntime, null]]), { code: 'ERR_ASSERTION' }, path);
  }
  const manifestName = newRuntime + 'manifest.json';
  const oldManifest = Buffer.from(packagedHostedManifest.toString().replace(/"([^"\n]+)": "[a-f0-9]{64}"/gu,
    (raw, path) => hostedRuntimeExceptions.includes(path) ? JSON.stringify(path) + ': "' +
      (historicalRecallRuntime.has(path) ? sha256(historicalRecallRuntime.get(path)) : durabilityRuntimeChanges.get(path)?.historical ?? captureRuntimeChanges.get(path)?.historical ?? captureRuntimeChanges.get(path)?.current ?? '0'.repeat(64)) + '"' : raw));
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

test('L06 capture allowances pin exact source bytes and require the new calendar helper', async t => {
  const historical = await baselineForTest(t);
  if (!historical) return;
  const oldBytes = await readFile(new URL('../runtime/manifest.json', historical.module));
  const oldManifest = JSON.parse(oldBytes), currentManifest = JSON.parse(packagedHostedManifest);
  assert.equal(sha256(oldBytes), historicalCaptureManifestHash);
  const oldBase = '.codex/cairn/runtime/0.5.3-0123456789ab/';
  const newBase = '.codex/cairn/runtime/0.6.0-abcdef012345/';
  const previous = [[oldBase + 'manifest.json', oldBytes]];
  for (const path of Object.keys(oldManifest.files))
    previous.push([oldBase + path, await readFile(new URL('../runtime/' + path, historical.module))]);
  const current = [[newBase + 'manifest.json', packagedHostedManifest]];
  for (const path of Object.keys(currentManifest.files))
    current.push([newBase + path, await readFile(new URL('../runtime/' + path, import.meta.url))]);
  const compare = entries => assert.deepEqual(fileInventory(entries, true, '/synthetic/.codex'),
    fileInventory(previous, true, '/synthetic/.codex', { historical: true }));
  compare(current);
  for (const [path, pins] of captureRuntimeChanges) {
    assert.equal(currentManifest.files[path], pins.current);
    assert.equal(oldManifest.files[path] ?? null, pins.historical);
    const missing = current.filter(([name]) => name !== newBase + path);
    assert.throws(() => compare(missing), { code: 'ERR_ASSERTION' }, path);
    const damaged = current.map(([name, bytes]) => [name,
      name === newBase + path ? Buffer.concat([bytes, Buffer.from('damaged')]) : bytes]);
    assert.throws(() => compare(damaged), { code: 'ERR_ASSERTION' }, path);
  }
});

test('L06 recall allowances prove the exact historical source and hash changes', async t => {
  const historical = await baselineForTest(t);
  if (!historical) return;
  const manifest = JSON.parse(await readFile(new URL('../runtime/manifest.json', historical.module)));
  for (const [path, expected] of historicalRecallRuntime) {
    const original = await readFile(new URL('../runtime/' + path, historical.module));
    assert.deepEqual(original, expected, 'Only the approved recall line changed: ' + path);
    assert.equal(manifest.files[path], sha256(original));
    assert.equal(JSON.parse(packagedHostedManifest).files[path], sha256(packagedHostedRuntime.get(path)));
    const damaged = Buffer.from(original); damaged[0] ^= 1;
    assert.throws(() => assertRecallRuntime(path, damaged), { code: 'ERR_ASSERTION' });
    const name = '.codex/cairn/runtime/0.5.3-0123456789ab/' + path;
    assert.throws(() => fileInventory([[name, damaged]], true, '/synthetic/.codex', { historical: true }),
      { code: 'ERR_ASSERTION' });
    const badManifest = Buffer.from(packagedHostedManifest.toString().replace(
      sha256(packagedHostedRuntime.get(path)), '0'.repeat(64)));
    assert.throws(() => normalizeFile(name.replace(path, 'manifest.json'), badManifest, '/synthetic/.codex'),
      { code: 'ERR_ASSERTION' });
  }
});

test('L06 recall hook allowance changes only the managed historical prompt timeout', () => {
  const home = '/synthetic/.codex', name = '.codex/hooks.json';
  const command = event => "'/usr/bin/env' '-i' 'HOME=/synthetic' 'PATH=/bin' 'LANG=C.UTF-8' '/bin/node' '" +
    home + "/cairn/runtime/0.5.3-0123456789ab/integrations/codex/entry.mjs' '" + home +
    "/cairn/installation.json' '" + event + "' 2>/dev/null || true";
  const hooks = Object.fromEntries(['SessionStart', 'UserPromptSubmit', 'Stop', 'PreCompact'].map(event =>
    [event, [{ hooks: [{ type: 'command', command: command(event), timeout: ['Stop', 'PreCompact'].includes(event) ? 1 : 3 }] }]]));
  const before = JSON.stringify({ hooks }, null, 2) + '\n';
  hooks.UserPromptSubmit[0].hooks[0].timeout = 4;
  const after = JSON.stringify({ hooks }, null, 2) + '\n';
  const normalizedHooks = (text, historical = false) => normalizeFile(name, Buffer.from(text), home, { historical });
  assert.deepEqual(normalizedHooks(before, true), normalizedHooks(after));
  assert.notDeepEqual(normalizedHooks(before), normalizedHooks(after));
  for (const event of ['SessionStart', 'Stop', 'PreCompact', 'UserPromptSubmit']) {
    const changed = JSON.parse(after); changed.hooks[event][0].hooks[0].timeout++;
    assert.notDeepEqual(normalizedHooks(before, true), normalizedHooks(JSON.stringify(changed, null, 2) + '\n'));
  }
  for (const mutate of [
    hook => { hook.command = 'unrelated'; },
    hook => { hook.command = hook.command.replace('installation.json', 'other.json'); },
    hook => { hook.type = 'other'; },
    hook => { hook.nested = { timeout: 3 }; },
  ]) {
    const old = JSON.parse(before), current = JSON.parse(after);
    mutate(old.hooks.UserPromptSubmit[0].hooks[0]); mutate(current.hooks.UserPromptSubmit[0].hooks[0]);
    // Nested timeout remains literal, even when the outer owned timeout qualifies.
    if (old.hooks.UserPromptSubmit[0].hooks[0].nested) current.hooks.UserPromptSubmit[0].hooks[0].nested.timeout = 4;
    assert.notDeepEqual(normalizedHooks(JSON.stringify(old), true), normalizedHooks(JSON.stringify(current)));
  }
  assert.notDeepEqual(normalizedHooks(before, true), normalizedHooks(after.replace('{\n', '{ \n')));
});

test('L06/L33/L24 verdict exception edits only historical value spans using the independent oracle', () => {
  const name = '.codex/cairn/qualification/' + 'a'.repeat(64) + '.json', home = '/synthetic/.codex';
  const previousFingerprint = historicalFormats[0], targetFingerprint = mappedFingerprints.get(previousFingerprint);
  // Deliberate whitespace, escapes and nested lookalikes must survive unchanged.
  const oldText = '  {\r\n "identity":"' + 'a'.repeat(64) + '", "policy" : "' + historicalPolicy + '",\r\n' +
    ' "version":"0.160.\\u0031", "status":"qualified", "fingerprint":"' + previousFingerprint + '",\r\n' +
    ' "binarySha256":"' + 'b'.repeat(64) + '", "nested":{"policy":"' + historicalPolicy + '"} }\r\n';
  const currentText = oldText.replace('"' + historicalPolicy + '"', '"' + expectedPolicy + '"')
    .replace('"' + previousFingerprint + '"', '"' + targetFingerprint + '"');
  const old = Buffer.from(oldText), current = Buffer.from(currentText);
  const historical = bytes => normalizeFile(name, bytes, home, { historical: true });
  assert.deepEqual(historical(old), current);
  assert.deepEqual(historical(current), current); // already-current values stay verbatim
  assert.strictEqual(normalizeFile(name, current, home), current); // current is never rewritten
  assert.strictEqual(normalizeFile(name, old, home), old);
  const mixed = Buffer.from(oldText.replace(previousFingerprint, targetFingerprint));
  assert.deepEqual(historical(mixed), current);
  const escapedFingerprint = '\\u00' + targetFingerprint.charCodeAt(0).toString(16) + targetFingerprint.slice(1);
  const escaped = Buffer.from(currentText.replace(targetFingerprint, escapedFingerprint));
  assert.deepEqual(historical(escaped), escaped); // not decoded/re-serialized
  const absent = Buffer.from(oldText.replace(', "fingerprint":"' + previousFingerprint + '"', ''));
  const absentExpected = Buffer.from(currentText.replace(', "fingerprint":"' + targetFingerprint + '"', ''));
  assert.deepEqual(historical(absent), absentExpected);
  assert.equal(Object.hasOwn(JSON.parse(historical(absent)), 'fingerprint'), false);

  const files = (entries, historical = false, normalize = true) => fileInventory(entries, normalize, home, { historical });
  assert.deepEqual(files([[name, old]], true), files([[name, current]]));
  assert.notDeepEqual(files([[name, old]]), files([[name, current]])); // current/current stays strict
  assert.notDeepEqual(files([[name, old]], true, false), files([[name, current]], false, false)); // no-write inventory stays strict
  for (const otherName of [name.replace('.json', '.pending'), name.replace('a'.repeat(64), 'observed-cli'),
    name.replace('a'.repeat(64), 'A'.repeat(64)), name.replace('/qualification/', '/qualification/nested/'),
    name.replace('/qualification/', '/other/')]) {
    assert.strictEqual(normalizeFile(otherName, old, home, { historical: true }), old);
    assert.notDeepEqual(files([[otherName, old]], true), files([[otherName, current]]));
  }
});

test('L06/L33/L24 verdict exception rejects every unrelated byte, value and inventory change', () => {
  const name = '.codex/cairn/qualification/' + 'a'.repeat(64) + '.json', home = '/synthetic/.codex';
  const oldFingerprint = historicalFormats[0], newFingerprint = mappedFingerprints.get(oldFingerprint);
  const before = '{"identity":"' + 'a'.repeat(64) + '","policy":"' + historicalPolicy + '","version":"0.160.1",' +
    '"status":"qualified","fingerprint":"' + oldFingerprint + '","binarySha256":"' + 'b'.repeat(64) + '"}\n';
  const after = before.replace(historicalPolicy, expectedPolicy).replace(oldFingerprint, newFingerprint);
  const files = (entries, historical = false) => fileInventory(entries, true, home, { historical });
  const baseline = files([[name, Buffer.from(before)]], true);
  const current = text => files([[name, Buffer.from(text)]]);
  for (const [label, changed] of [
    ['qualified to changed', after.replace('"qualified"', '"changed"')],
    ['different identity', after.replace('a'.repeat(64), 'c'.repeat(64))],
    ['version', after.replace('0.160.1', '0.160.2')],
    ['binary hash', after.replace('b'.repeat(64), 'c'.repeat(64))],
    ['reordered keys', after.replace('"status":"qualified","fingerprint":"' + newFingerprint + '"',
      '"fingerprint":"' + newFingerprint + '","status":"qualified"')],
    ['added key', after.replace('}\n', ',"extra":true}\n')],
    ['deleted key', after.replace('"status":"qualified",', '')],
    ['missing fingerprint', after.replace('"fingerprint":"' + newFingerprint + '",', '')],
    ['whitespace', '{ ' + after.slice(1)],
    ['key escape', after.replace('"status"', '"sta\\u0074us"')],
    ['unsupported current policy', after.replace(expectedPolicy, 'c'.repeat(64))],
    ['unsupported current fingerprint', after.replace(newFingerprint, 'c'.repeat(64))],
    ['old current policy', before],
    ['old fingerprint under current policy', after.replace(newFingerprint, oldFingerprint)],
    ['malformed current JSON', after.slice(0, -2)],
  ]) assert.throws(() => assert.deepEqual(current(changed), baseline), { code: 'ERR_ASSERTION' }, label);
  for (const bad of [before.replace(historicalPolicy, 'c'.repeat(64)), before.replace(oldFingerprint, 'c'.repeat(64)),
    before.replace(oldFingerprint, newFingerprint).replace(historicalPolicy, 'c'.repeat(64)),
    after.replace(newFingerprint, oldFingerprint), before.slice(0, -2), '\ufeff' + before,
    before.replace('"policy":"' + historicalPolicy + '"', '"policy":null'),
    before.replace('"fingerprint":"' + oldFingerprint + '"', '"fingerprint":null')])
    assert.throws(() => files([[name, Buffer.from(bad)]], true));
  assert.throws(() => files([[name, Buffer.from([0xff])]], true));
  assert.throws(() => assert.deepEqual(files([]), baseline), { code: 'ERR_ASSERTION' });
  assert.throws(() => assert.deepEqual(files([[name, Buffer.from(after)],
    [name.replace('a'.repeat(64), 'c'.repeat(64)), Buffer.from(after)]]), baseline), { code: 'ERR_ASSERTION' });
  const noFingerprintBefore = before.replace('"fingerprint":"' + oldFingerprint + '",', '').replace('"qualified"', '"changed"');
  const noFingerprintAfter = noFingerprintBefore.replace(historicalPolicy, expectedPolicy);
  assert.deepEqual(files([[name, Buffer.from(noFingerprintBefore)]], true), current(noFingerprintAfter));
  assert.throws(() => assert.deepEqual(files([[name, Buffer.from(noFingerprintBefore)]], true),
    current(noFingerprintAfter.replace('"status"', '"fingerprint":"' + newFingerprint + '","status"'))), { code: 'ERR_ASSERTION' });
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
const cells = [
  ...scenarios.flatMap(scenario => actions.map(args => ({ scenario, args, label: 'L06' }))),
  ...scenarios.slice(0, 4).flatMap(scenario => [['setup'], ['setup', '--client', 'claude'], ['setup', '--cloud'],
    ['setup', '--dry-run'], ['status'], ['pause']].map(args => ({ scenario, args, label: 'L33/L24' }))),
];
for (const { scenario, args, label } of cells) test(`${label} hosted baseline: ${scenario}; ${args.join(' ')}`, async t => {
  const historical = label === 'L33/L24' ? acceptBaseline(t, await historicalInstaller(), true) : await baselineForTest(t);
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
  // Fixture setup used the current policy. Start BOTH comparison runs without
  // that derived verdict, so the historical policy does not uniquely incur
  // schema probes while current gets a cache hit. Setup/status then write the
  // independently checked verdicts. Keep native call-order checks strict and
  // preserve observed-host descriptors and pending locks.
  const verdictDirectory = join(f.codexHome, 'cairn/qualification');
  const verdictNames = await readdir(verdictDirectory).catch(error => {
    if (error.code !== 'ENOENT') throw error; return [];
  });
  for (const name of verdictNames.filter(name => /^[a-f0-9]{64}\.json$/u.test(name))) await rm(join(verdictDirectory, name));
  let inspectionTmpdir;
  if (label === 'L33/L24') {
    inspectionTmpdir = join(f.home, 'tmp'); await mkdir(inspectionTmpdir);
    await mkdir(f.codexHome, { recursive: true });
    await writeFile(join(f.codexHome, 'config.toml'), await readFile(join(f.codexHome, 'config.toml')).catch(error => {
      if (error.code !== 'ENOENT') throw error; return Buffer.from('model = "fixture"\n');
    }), { mode: 0o600 });
  }
  const run = options => f.run({ ...options, tmpdir: inspectionTmpdir });
  const saved = join(f.scratch, 'baseline-home'); await cp(f.home, saved, { recursive: true });
  const nativeState = await readFile(join(f.scratch, 'claude.json'));
  const codexState = await readFile(join(f.scratch, 'codex.json'));
  const choices = { claude: 'no', codex: 'no' }, fixedNow = Date.now();
  if (args.length === 1 && args[0] === 'setup') {
    const before = await inventory(f.home), calls = (await f.orderedCalls()).length;
    const conflict = await run({ args: ['setup', '--local'], disableLocalMode: false });
    assert.equal(conflict.code, 2, conflict.stdout);
    assert.match(conflict.stdout, scenario === 'Claude inspection failure' ? /Cannot inspect/ : /Cloud memory is configured/);
    assert.deepEqual(await inventory(f.home), before);
    assert.deepEqual((await f.orderedCalls()).slice(calls).filter(callsThatMutate), []);
  }
  const beforeCalls = await f.calls(), beforeOrdered = (await f.orderedCalls()).length;
  // --cloud selects the pre-existing hosted setup; 0.5.3 had no mode flag.
  const baseline = await f.run({ tmpdir: f.neutralParent, args: args.filter(arg => arg !== '--cloud'), choices, fixedNow, disableLocalMode: true, module: historical.module });
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
    assert.equal(normalized(currentHostedOutput(disabled.stdout), f.codexHome), normalized(baseline.stdout, f.codexHome));
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
  const routed = await run({ args, choices, fixedNow, disableLocalMode: false });
  assert.equal(routed.code, baseline.code, routed.stdout);
  assert.equal(normalized(currentHostedOutput(routed.stdout), f.codexHome), normalized(baseline.stdout, f.codexHome));
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


// F2 uses the same immutable HOME and native state for each neutral/inside pair.
async function saveFixture(f) {
  const saved = join(f.scratch, 'f2-home');
  await cp(f.home, saved, { recursive: true });
  const states = await Promise.all(['claude', 'codex'].map(name => readFile(join(f.scratch, name + '.json'))));
  return async () => {
    await rm(f.home, { recursive: true }); await cp(saved, f.home, { recursive: true });
    for (const [index, name] of ['claude', 'codex'].entries()) await writeFile(join(f.scratch, name + '.json'), states[index]);
  };
}
async function assertNoAttempts(f, primary) {
  for (const parent of [primary, f.neutralParent, f.fallbackParent]) {
    assert.deepEqual((await readdir(parent)).filter(name => name.startsWith('cairn-codex-inspect-')), [], parent);
  }
}
const hostedCalls = calls => calls.filter(call => call.cwd.includes('/cairn-codex-inspect-') && call.args.join(' ') !== 'mcp list --json');
const hostedActions = [['setup', '--client', 'codex'], ['setup', '--cloud'], ['setup', '--dry-run'],
  ['setup', '--client', 'codex', '--dry-run'], ['setup', '--client', 'codex', '--reauthorize']];
for (const qualified of [false, true]) for (const present of [false, true]) for (const args of hostedActions)
test(`L34 hosted fallback equivalence: qualified=${qualified}; config=${present}; ${args.join(' ')}`, async t => {
  const f = await fixture(t, { claude: false, qualified });
  if (args.includes('--reauthorize')) assert.equal((await f.run()).code, 0);
  const primary = join(f.home, 'tmp'); await mkdir(primary);
  if (present && !args.includes('--reauthorize')) {
    await mkdir(f.codexHome, { recursive: true });
    await writeFile(join(f.codexHome, 'config.toml'), 'model = "fixture"\n', { mode: 0o600 });
  }
  // Reauthorization always starts with an existing cloud installation.
  const configured = present || args.includes('--reauthorize');
  const restore = await saveFixture(f), fixedNow = Date.now();
  const before = (await f.orderedCalls()).length;
  const control = await f.run({ args, fixedNow, disableLocalMode: false, tmpdir: f.neutralParent });
  const controlFiles = await inventory(f.home, true);
  const mutations = (await f.orderedCalls()).slice(before).filter(callsThatMutate).map(call => normalizedCall(call, f.codexHome));
  assert.equal(control.code, 0, control.stdout);
  await restore();
  const start = (await f.calls()).codex.length, orderedStart = (await f.orderedCalls()).length;
  const actual = await f.run({ args, fixedNow, disableLocalMode: false, tmpdir: primary });
  assert.equal(actual.code, control.code, actual.stdout);
  assert.equal(normalized(actual.stdout, f.codexHome), normalized(control.stdout, f.codexHome));
  assert.deepEqual(actual.prompts, control.prompts);
  assert.deepEqual((await f.orderedCalls()).slice(orderedStart).filter(callsThatMutate).map(call => normalizedCall(call, f.codexHome)), mutations);
  assert.deepEqual(await inventory(f.home, true), controlFiles);
  const calls = hostedCalls((await f.calls()).codex.slice(start));
  assert.ok(calls.length, 'hosted body reached');
  const readOnly = args.includes('--dry-run');
  const expected = await realpath(configured || !readOnly ? f.fallbackParent : primary);
  // Unscoped setup first performs a read-only inspectOnly probe. The final
  // hosted group owns the mutating reservation; qualification has its own cwd.
  const groups = [...new Set(calls.map(call => call.cwd))];
  assert.equal(dirname(groups.at(-1)), expected);
  if (!configured && args.includes('--cloud')) {
    assert.equal(groups.length, 2, 'inspectOnly and mutating setup select separate attempts');
    assert.equal(dirname(groups[0]), await realpath(primary), 'inspectOnly does not reserve the absent config');
  }
  for (const cwd of groups) assert.ok([expected, ...(!configured && !readOnly ? [await realpath(primary)] : [])].includes(dirname(cwd)), cwd);
  await assertNoAttempts(f, primary);
});
for (const relativeHome of ['settings', 'tmp/.codex', 'tmp/settings', 'alias/missing/.codex'])
for (const dryRun of [false, true]) test(`L34a planned config: ${relativeHome}; dry-run=${dryRun}`, async t => {
  const f = await fixture(t, { claude: false, qualified: false, codexHomeRelative: relativeHome });
  const primary = join(f.home, 'tmp'); await mkdir(primary);
  if (relativeHome.startsWith('alias/')) await symlink(primary, join(f.home, 'alias'));
  // For the symlink case the absent planned path is tmp/missing/.codex;
  // make TMPDIR that missing path's existing parent through an alias.
  let tmp = primary;
  if (relativeHome.startsWith('alias/')) { await mkdir(join(primary, 'missing')); tmp = join(f.home, 'alias/missing'); }
  const args = ['setup', '--client', 'codex', ...(dryRun ? ['--dry-run'] : [])];
  const result = await f.run({ args, tmpdir: tmp });
  assert.equal(result.code, 0, result.stdout);
  const calls = hostedCalls((await f.calls()).codex);
  assert.ok(calls.length);
  const reservedAncestor = relativeHome === 'tmp/.codex' || relativeHome.startsWith('alias/');
  const expected = await realpath(!dryRun && reservedAncestor ? f.fallbackParent : tmp);
  for (const call of calls) assert.equal(dirname(call.cwd), expected);
  if (dryRun) await assert.rejects(readdir(f.codexHome), { code: 'ENOENT' });
  else assert.match(await readFile(join(f.codexHome, 'config.toml'), 'utf8'), /Authorization = /u);
  await assertNoAttempts(f, primary);
  if (tmp !== primary) assert.deepEqual((await readdir(tmp)).filter(name => name.startsWith('cairn-codex-inspect-')), []);
});
for (const args of [['status'], ['status', '--client', 'codex']]) test(`L35 cloud status fallback: ${args.join(' ')}`, async t => {
  const f = await fixture(t, { claude: false }); assert.equal((await f.run()).code, 0);
  const primary = join(f.home, 'tmp'); await mkdir(primary);
  const before = await inventory(f.home);
  const neutral = await f.run({ args, tmpdir: f.neutralParent, disableLocalMode: false });
  const actual = await f.run({ args, tmpdir: primary, disableLocalMode: false });
  assert.equal(actual.code, 0, actual.stdout); assert.equal(actual.code, neutral.code);
  assert.equal(actual.stdout, neutral.stdout); assert.doesNotMatch(actual.stdout, /TMPDIR has ancestor/u);
  assert.deepEqual(await inventory(f.home), before); await assertNoAttempts(f, primary);
});
for (const cause of ['codex_tmpdir', 'codex_managed']) for (const args of [['setup', '--cloud'], ['setup', '--client', 'codex'], ['status']])
test(`L36 hosted refusal: ${cause}; ${args.join(' ')}`, async t => {
  const historical = acceptBaseline(t, await historicalInstaller('be2bc543', '0.6.1'), true);
  const f = await fixture(t, { claude: false });
  // Hosted-only preserves its historical refusal. Routed setup may refuse
  // earlier with mode_unknown, which remains covered by L27/L28.
  let primary = f.neutralParent, inspection = f.inspection;
  if (cause === 'codex_tmpdir') {
    primary = join(f.home, 'tmp'); await mkdir(primary); await mkdir(f.codexHome);
    await writeFile(join(f.codexHome, 'config.toml'), '', { mode: 0o600 });
    await mkdir(join(f.fallbackParent, '.codex')); await writeFile(join(f.fallbackParent, '.codex/config.toml'), '');
  } else {
    const managed = join(f.scratch, 'managed'); await writeFile(managed, '');
    inspection = { ...inspection, managedPaths: [join(f.scratch, 'absent-managed-config'), managed] };
  }
  const before = await inventory(f.home);
  // 0.6.1 has no hosted inspection seam. Map only its two managed-file stat
  // probes to the internal fixture paths, leaving its source, refusal, params
  // and output path untouched. Both versions encounter the same cause before
  // any native call, without accessing a real managed configuration.
  const baseline = await f.run({ args, tmpdir: primary, inspection, module: historical.module,
    mapHistoricalManagedPaths: cause === 'codex_managed' });
  assert.equal(baseline.code, args.includes('--cloud') ? 0 : 1, baseline.stdout);
  assert.deepEqual(await inventory(f.home), before); assert.deepEqual(await f.calls(), { claude: [], codex: [] });
  await assertNoAttempts(f, primary);
  const result = await f.run({ args, tmpdir: primary, inspection });
  assert.equal(result.code, args.includes('--cloud') ? 0 : 1, result.stdout);
  assert.equal(result.code, baseline.code);
  assert.equal(normalized(result.stdout, f.codexHome), normalized(baseline.stdout, f.codexHome));
  const phrase = cause === 'codex_tmpdir' ? 'TMPDIR has ancestor' : 'system-managed Codex';
  assert.equal(result.stdout.split('\n').filter(line => line.includes(phrase)).length, 1, result.stdout);
  assert.deepEqual(await inventory(f.home), before); assert.deepEqual(await f.calls(), { claude: [], codex: [] });
  await assertNoAttempts(f, primary);
});
for (const failure of [false, true]) test(`L37 fallback body and validation cleanup: failure=${failure}`, async t => {
  const f = await fixture(t, { claude: false });
  await mkdir(f.codexHome); await writeFile(join(f.codexHome, 'config.toml'), 'model = "fixture"\n', { mode: 0o600 });
  const primary = join(f.home, 'tmp'); await mkdir(primary);
  if (failure) await f.setCodexState({ failValidation: true });
  const result = await f.run({ args: ['setup', '--client', 'codex'], tmpdir: primary });
  assert.equal(result.code, failure ? 7 : 0, result.stdout);
  const calls = hostedCalls((await f.calls()).codex);
  const validation = calls.find(call => call.home.endsWith('/cx5-candidate') && call.args.join(' ') === 'mcp get cairn --json');
  assert.ok(validation, 'qualified validation-only get reached after fallback selection');
  assert.equal(dirname(validation.cwd), await realpath(f.fallbackParent));
  for (const call of calls) await assert.rejects(readdir(call.cwd), { code: 'ENOENT' });
  await assertNoAttempts(f, primary);
});

for (const relativeHome of ['settings', 'tmp/.codex']) test(`L34a endpoint reauthorization precedes selector: ${relativeHome}`, async t => {
  const f = await fixture(t, { claude: false, codexHomeRelative: relativeHome });
  await mkdir(join(f.home, 'tmp'), { recursive: true });
  assert.equal((await f.run()).code, 0);
  await mkdir(join(f.fallbackParent, '.codex')); await writeFile(join(f.fallbackParent, '.codex/config.toml'), '');
  const before = await inventory(f.home), start = (await f.calls()).codex.length;
  const args = ['setup', '--client', 'codex', '--endpoint', 'https://changed.example'];
  const control = await f.run({ args, tmpdir: f.neutralParent });
  const actual = await f.run({ args, tmpdir: join(f.home, 'tmp') });
  assert.equal(actual.code, 2, actual.stdout); assert.equal(actual.stdout, control.stdout);
  assert.match(actual.stdout, /--reauthorize/u); assert.doesNotMatch(actual.stdout, /TMPDIR has ancestor/u);
  assert.equal((await f.calls()).codex.length, start); assert.deepEqual(await inventory(f.home), before);
});

test('L06 diagnostic durability allowances bind historical, previous and current runtime bytes', async t => {
  const historical = await baselineForTest(t);
  if (!historical) return;
  const previous = acceptBaseline(t, await historicalInstaller('a46aeb18', '0.6.3'));
  if (!previous) return;
  for (const [path, pins] of durabilityRuntimeChanges) {
    const original = await readFile(new URL('../runtime/' + path, historical.module));
    const before = await readFile(new URL('../runtime/' + path, previous.module));
    const current = packagedHostedRuntime.get(path);
    assert.equal(sha256(original), pins.historical, path);
    assert.equal(sha256(before), pins.before, path);
    assert.equal(sha256(current), pins.current, path);
    for (const bytes of [original, before, current]) assertRecallRuntime(path, bytes);
    const damaged = Buffer.from(original); damaged[0] ^= 1;
    assert.throws(() => assertRecallRuntime(path, damaged), { code: 'ERR_ASSERTION' });
    const name = '.codex/cairn/runtime/0.5.3-0123456789ab/' + path;
    assert.throws(() => fileInventory([[name, damaged]], true, '/synthetic/.codex', { historical: true }),
      { code: 'ERR_ASSERTION' });
    const badManifest = Buffer.from(packagedHostedManifest.toString().replace(pins.current, '0'.repeat(64)));
    assert.throws(() => normalizeFile('.codex/cairn/runtime/0.6.3-abcdef012345/manifest.json', badManifest,
      '/synthetic/.codex', { historical: true }), { code: 'ERR_ASSERTION' });
  }
});

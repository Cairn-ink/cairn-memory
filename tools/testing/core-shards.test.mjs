import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { coreFiles, executeShard, planShards, readTimings, runFiles, validateFlakes, verifyPlan } from './core-shards.mjs';
import reporter from './file-timing-reporter.mjs';
import { createTestWorkspace } from './workspace.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('longest-first plan is complete, disjoint and independent of file/weight insertion order', () => {
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const weights = { a: 8, b: 7, c: 6, d: 5, e: 4, f: 3, g: 2 };
  const plan = planShards(files, weights, 3);
  assert.deepEqual(plan.shards.map(shard => shard.files), [['a', 'f', 'g'], ['b', 'e'], ['c', 'd']]);
  verifyPlan(files, plan.shards);
  assert.equal(plan.total, files.length);
  assert.equal(new Set(plan.shards.flatMap(shard => shard.files)).size, files.length);
  assert.deepEqual(planShards(['d', 'a', 'g', 'b', 'f', 'c', 'e'], { g: 2, f: 3, e: 4, d: 5, c: 6, b: 7, a: 8 }, 3), plan);
  assert.deepEqual(planShards(['c', 'b', 'a'], {}, 2).shards.map(shard => shard.files), [['a', 'c'], ['b']]);
  // Equal total: prefer fewer files before index, including zero weights.
  assert.deepEqual(planShards(['a', 'b', 'c', 'd'], { a: 2, b: 1, c: 1, d: 0 }, 2).shards.map(shard => shard.files), [['a', 'd'], ['b', 'c']]);
});

test('new files receive the median of current known files; stale weights are ignored', () => {
  const files = ['a', 'b', 'new'];
  const plan = planShards(files, { a: 2, b: 8, stale: 10000 }, 2);
  assert.equal(plan.fallback, 5);
  assert.deepEqual(plan.shards.map(shard => shard.files), [['b'], ['new', 'a']]);
  assert.deepEqual(plan, planShards(files, { a: 2, b: 8 }, 2));
  assert.equal(planShards(['a', 'b', 'c', 'new'], { a: 2, b: 5, c: 20 }, 1).fallback, 5);
  assert.equal(planShards(['new'], { stale: 20 }, 1).fallback, 1);
});

test('invalid weights and plans are rejected, including duplicate or missing coverage', () => {
  for (const weight of [-1, NaN, Infinity, -Infinity, '1', null, {}, true]) {
    assert.throws(() => planShards(['a'], { a: weight }, 2), /invalid weight/);
    assert.throws(() => planShards(['a'], { stale: weight }, 2), /invalid weight/);
  }
  for (const map of [null, [], 1, 'map']) assert.throws(() => planShards(['a'], map), /invalid weights/);
  for (const count of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => planShards(['a'], {}, count), /invalid shard count/);
  assert.throws(() => planShards(['a', 'a']), /invalid file list/);
  for (const shards of [[{ files: ['a', 'a'] }], [{ files: [] }], [{ files: ['b'] }]]) {
    assert.throws(() => verifyPlan(['a'], shards), /complete and disjoint/);
  }
  assert.deepEqual(planShards(['b', 'a'], {}, 4).shards.map(shard => shard.files), [['a'], ['b'], [], []]);
  assert.equal(planShards([], {}, 4).total, 0);
});

test('six real shards exactly match an independent directory read and count', () => {
  const files = readdirSync(join(root, 'core/test')).filter(file => file.endsWith('.test.mjs')).map(file => `core/test/${file}`).sort();
  const plan = planShards(coreFiles(), {}, 6);
  assert.deepEqual(plan.shards.flatMap(shard => shard.files).sort(), files);
  assert.equal(plan.total, files.length);
  assert.equal(new Set(plan.shards.flatMap(shard => shard.files)).size, files.length);
  console.log(`Core file count cross-check: readdir=${files.length}; plan=${plan.total}`);
});

function fixture(t) {
  const workspace = createTestWorkspace(t);
  const cwd = workspace.path;
  const env = { ...process.env, TMPDIR: cwd, TMP: cwd, TEMP: cwd };
  delete env.GITHUB_STEP_SUMMARY;
  function add(name, body) {
    writeFileSync(join(cwd, name), `import test from 'node:test';\nimport assert from 'node:assert/strict';\n${body}\n`);
    return name;
  }
  const pass = add('pass.test.mjs', "test('first pass', () => {}); test('second pass', () => {});");
  const fail = add('fail.test.mjs', "test('synthetic failure', () => assert.fail('synthetic'));");
  const flaky = add('flaky.test.mjs', `import { existsSync, writeFileSync } from 'node:fs';
    test('synthetic fail once', () => {
      const marker = ${JSON.stringify(join(cwd, 'attempt'))};
      const prior = existsSync(marker); writeFileSync(marker, 'attempted'); assert.ok(prior);
    });`);
  return { cwd, env, add, pass, fail, flaky, outputDir: join(cwd, 'output') };
}

test('reporter records only top-level outcomes using event.file and includes failures', async () => {
  const events = [
    { type: 'test:pass', data: { nesting: 1, file: 'ignored', name: 'nested', details: { duration_ms: 100 } } },
    { type: 'test:pass', data: { nesting: 0, file: 'a', name: 'pass', details: { duration_ms: 3 } } },
    { type: 'test:fail', data: { nesting: 0, file: 'b', name: 'fail', details: { duration_ms: 5 } } },
  ];
  const records = [];
  for await (const line of reporter(events)) records.push(JSON.parse(line));
  assert.deepEqual(records, [{ file: 'a', name: 'pass', durationMs: 3, outcome: 'pass' }, { file: 'b', name: 'fail', durationMs: 5, outcome: 'fail' }]);
});

test('the real spawn path preserves failure, identifies the failing file and records passes', async t => {
  const f = fixture(t);
  mkdirSync(f.outputDir);
  const timingsFile = join(f.outputDir, 'timings.jsonl');
  const result = await runFiles({ ...f, files: [f.pass, f.fail], timingsFile });
  assert.equal(result.code, 1);
  const records = readTimings(timingsFile, f.cwd);
  assert.ok(records.some(record => record.file === f.fail && record.outcome === 'fail'));
  assert.equal(records.filter(record => record.file === f.pass && record.outcome === 'pass').length, 2);
  const allPass = await executeShard({ ...f, files: [f.pass] });
  assert.equal(allPass.code, 0);
  assert.ok(allPass.records.every(record => record.outcome === 'pass'));
  const weights = JSON.parse(readFileSync(join(f.outputDir, 'weights.json'), 'utf8'));
  assert.equal(weights[f.pass], allPass.records.reduce((total, record) => total + record.durationMs / 1000, 0));
});

test('empty allowlist: failed shard never reruns', async t => {
  const f = fixture(t);
  const result = await executeShard({ ...f, files: [f.fail], knownFlakes: [] });
  assert.equal(result.code, 1);
  assert.deepEqual(result.reruns, []);
  assert.equal(existsSync(join(f.outputDir, 'rerun-1.jsonl')), false);
});

test('listed fail-once file is rerun once alone, passes, and is reported loudly and in summaries', async t => {
  const f = fixture(t);
  const logs = [];
  const calls = [];
  f.env.GITHUB_STEP_SUMMARY = join(f.cwd, 'step-summary.md');
  const result = await executeShard({ ...f, files: [f.pass, f.flaky], knownFlakes: [{ file: f.flaky, reason: 'synthetic fail once' }],
    log: message => logs.push(message), run: options => { calls.push(options.files); return runFiles(options); } });
  assert.equal(result.code, 0);
  assert.deepEqual(calls, [[f.pass, f.flaky], [f.flaky]]);
  assert.deepEqual(result.reruns, [{ file: f.flaky, reason: 'synthetic fail once', code: 0 }]);
  assert.ok(logs.some(message => message.includes('KNOWN-FLAKE RERUN')));
  for (const file of [f.env.GITHUB_STEP_SUMMARY, join(f.outputDir, 'summary.md')]) {
    assert.match(readFileSync(file, 'utf8'), /KNOWN-FLAKE RERUN.*flaky.test.mjs.*exit 0/);
  }
  assert.deepEqual(JSON.parse(readFileSync(join(f.outputDir, 'files.json'), 'utf8')), [f.pass, f.flaky]);
});

test('listed failure that fails again fails the shard', async t => {
  const f = fixture(t);
  const result = await executeShard({ ...f, files: [f.fail], knownFlakes: [{ file: f.fail, reason: 'synthetic persistent failure' }] });
  assert.equal(result.code, 1);
  assert.equal(result.reruns.length, 1);
  assert.equal(result.reruns[0].code, 1);
});

test('one listed and one unlisted failing file prevents every rerun', async t => {
  const f = fixture(t);
  const result = await executeShard({ ...f, files: [f.flaky, f.fail], knownFlakes: [{ file: f.flaky, reason: 'synthetic' }] });
  assert.equal(result.code, 1);
  assert.deepEqual(result.reruns, []);
  assert.equal(existsSync(join(f.outputDir, 'rerun-1.jsonl')), false);
});

test('a file-level crash preserves failure with an empty allowlist', async t => {
  const f = fixture(t);
  const crash = f.add('crash.test.mjs', 'process.kill(process.pid, "SIGKILL");');
  const result = await executeShard({ ...f, files: [crash], knownFlakes: [] });
  assert.equal(result.code, 1);
  assert.deepEqual(result.reruns, []);
  // Node can identify a crashed file via a synthetic top-level failure. Truly
  // missing records are covered separately below and cannot authorize a retry.
  assert.ok(result.records.some(record => record.file === crash && record.outcome === 'fail'));
});

test('missing, malformed, incomplete and signal failure evidence cannot authorize reruns', async t => {
  const f = fixture(t);
  for (const mode of ['empty', 'malformed', 'partial', 'unknown', 'signal', 'infrastructure']) {
    const result = await executeShard({ ...f, files: ['a', 'b'], knownFlakes: [{ file: 'a', reason: 'synthetic' }], run: async ({ timingsFile }) => {
      const fail = JSON.stringify({ file: join(f.cwd, 'a'), durationMs: 1, outcome: 'fail' });
      const pass = JSON.stringify({ file: join(f.cwd, 'b'), durationMs: 1, outcome: 'pass' });
      const content = { empty: '', malformed: '{', partial: fail, unknown: fail + '\n' + JSON.stringify({ file: 'unknown', durationMs: 1, outcome: 'fail' }), signal: fail + '\n' + pass, infrastructure: fail + '\n' + pass }[mode];
      writeFileSync(timingsFile, content);
      return { code: mode === 'infrastructure' ? 2 : 1, signal: mode === 'signal' ? 'SIGTERM' : null };
    } });
    assert.notEqual(result.code, 0);
    assert.deepEqual(result.reruns, []);
  }
  for (const entries of [{}, [null], [{ file: 'a', reason: '' }], [{ file: 'a' }], [{ file: 'a', reason: 'a' }, { file: 'a', reason: 'b' }]]) {
    assert.throws(() => validateFlakes(entries), /invalid known flakes/);
  }
});

test('summary I/O errors cannot alter either passing or failing runner status; empty shard runs nothing', async t => {
  const f = fixture(t);
  f.env.GITHUB_STEP_SUMMARY = f.cwd; // EISDIR, after the actual result is known.
  for (const code of [0, 1]) {
    const result = await executeShard({ ...f, files: ['a'], run: async () => ({ code, signal: null }), log: () => {} });
    assert.equal(result.code, code);
  }
  const result = await executeShard({ ...f, files: [] });
  assert.equal(result.code, 0);
});

// Parse just the workflow's job and step blocks, without a new YAML dependency.
function jobs(text) {
  return Object.fromEntries([...text.matchAll(/^  ([\w-]+):\n([\s\S]*?)(?=^  [\w-]+:\n|$(?![\s\S]))/gm)].map(match => [match[1], match[2]]));
}

function assertWorkflow(ci, reusable) {
  const all = jobs(ci);
  const core = all.core;
  assert.ok(core);
  assert.match(core, /^    name: core \(\$\{\{ matrix.node-version \}\}\)$/m);
  assert.match(core, /^    if: always\(\)$/m);
  assert.match(core, /^    needs: \[core-shard-22-16-0, core-shard-24, core-shard-24-22-1\]$/m);
  const entries = [...core.matchAll(/- \{node-version: ('.*?'|\d+), key: '(.*?)'\}/g)].map(match => ({ version: match[1].replaceAll("'", ''), key: match[2] }));
  assert.deepEqual(entries, [{ version: '22.16.0', key: '22-16-0' }, { version: '24', key: '24' }, { version: '24.22.1', key: '24-22-1' }]);
  assert.deepEqual(entries.map(entry => `core (${entry.version})`), ['core (22.16.0)', 'core (24)', 'core (24.22.1)']);
  assert.match(core, /^          NODE_SHARDS_SUCCEEDED: \$\{\{ needs\[format\('core-shard-\{0\}', matrix.key\)\]\.result == 'success' \}\}$/m);
  assert.match(core, /^        run: test "\$NODE_SHARDS_SUCCEEDED" = "true"$/m);
  assert.equal((core.match(/^      - /gm) ?? []).length, 1);
  assert.doesNotMatch(core, /checkout|continue-on-error/);
  for (const { version, key } of entries) {
    const job = all[`core-shard-${key}`];
    assert.match(job, /^      fail-fast: false$/m);
    assert.match(job, /^        shard: \[1, 2, 3, 4, 5, 6\]$/m);
    assert.match(job, /^    uses: \.\/\.github\/workflows\/core-shard.yml$/m);
    assert.ok(job.includes(`node-version: '${version}'`));
    assert.ok(job.includes(`node-key: '${key}'`));
    assert.match(job, /^      shard: \$\{\{ matrix.shard \}\}$/m);
  }
  const shard = jobs(reusable).shard;
  const steps = shard.split(/^      - /m).slice(1);
  const demos = steps.filter(step => step.startsWith('run: npm run demo:'));
  assert.deepEqual(demos.map(step => step.split('\n')[0]), ['store', 'history', 'moc', 'recall', 'admission', 'episodes', 'session-context', 'private-cards', 'capture', 'conflicts', 'rebuild', 'continuation'].map(name => `run: npm run demo:${name}`));
  assert.ok(demos.every(step => /^        if: inputs.shard == 1$/m.test(step)));
  assert.match(shard, /CAIRN_REQUIRE_WIDE_ARCHIVE: "1"/);
  assert.match(shard, /ls core\/test\/\*\.test.mjs \| wc -l/);
  assert.match(shard, /node tools\/testing\/core-shards.mjs --shard "\$SHARD" --of 6/);
  assert.match(shard, /git fetch --no-tags --depth=1 origin fd5c59ef8e67cc58bb855a95f8910c668150bfa3/);
  assert.match(shard, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/);
  assert.match(shard, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/);
  assert.match(shard, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
  assert.ok(steps.some(step => step.includes('Upload core shard') && /if: always\(\)/.test(step)));
  assert.match(ci, /run: npm run test:workspace-lifecycle/);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['test:workspace-lifecycle'], 'node tools/testing/run.mjs tools/testing/*.test.mjs');
  assert.equal(pkg.scripts['test:core'], 'node tools/testing/run.mjs core/test/*.test.mjs');
}

test('workflow preserves required names, strict Node mapping, six-way shards and shard-one demos', () => {
  assertWorkflow(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8'), readFileSync(join(root, '.github/workflows/core-shard.yml'), 'utf8'));
});

test('workflow guard rejects always-true aggregator and missing always(), and missing demo guards', () => {
  const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
  const reusable = readFileSync(join(root, '.github/workflows/core-shard.yml'), 'utf8');
  assert.throws(() => assertWorkflow(ci.replace("needs[format('core-shard-{0}', matrix.key)].result == 'success'", 'true'), reusable));
  assert.throws(() => assertWorkflow(ci.replace('    if: always()\n', ''), reusable));
  assert.throws(() => assertWorkflow(ci, reusable.replace('        if: inputs.shard == 1\n', '')));
});

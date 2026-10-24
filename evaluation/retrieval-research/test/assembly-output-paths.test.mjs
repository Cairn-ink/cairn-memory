import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, readlink, symlink, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { runCli } from './fixtures-tooling/cli.mjs';
import { FILES, sha256 } from '../assembly/auth.mjs';
import { resolvedOutputPath, validateOutputPath, writeOutputText } from '../assembly/output-paths.mjs';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const research = join(repository, 'evaluation/retrieval-research');
const constants = join(research, 'assembly/overhead-host-v2.json');
const protectedDirectories = ['results/hr2-final', 'results/test-final', 'fixtures'];
const stages = ['run', 'score', 'report-out', 'report-markdown'];

async function snapshot(dir, ignored = new Set()) {
  const rows = [];
  async function visit(path, prefix) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = join(prefix, entry.name), absolute = join(path, entry.name);
      if (ignored.has(name)) continue;
      if (entry.isDirectory()) { rows.push([name, 'directory']); await visit(absolute, name); }
      else if (entry.isSymbolicLink()) rows.push([name, 'symlink', await readlink(absolute)]);
      else rows.push([name, 'file', sha256(await readFile(absolute))]);
    }
  }
  await visit(dir, '');
  return rows;
}
async function frozenSnapshot() {
  return { constants: sha256(await readFile(constants)),
    directories: await Promise.all(protectedDirectories.map(async path => [path, await snapshot(join(research, path))])) };
}
const captureLogs = new Set(['child-stdout.log', 'child-stderr.log']);

function command(stage, destination, workspace, inputs = {}) {
  const absent = join(workspace.path, 'input-must-not-be-read');
  if (stage === 'run') return [join(research, 'assembly/run.mjs'), '--fixture-dir', inputs.fixture ?? absent,
    '--rankings', inputs.rankings ?? absent, '--split', 'dev', '--scale', 'S1000', '--arms', 'P-top,P-cover',
    '--rankings-select', 'A1', '--budgets', '128', '--overhead-model', 'host-v2', '--out', destination];
  if (stage === 'score') return [join(research, 'assembly/score.mjs'), '--fixture-dir', inputs.fixture ?? absent,
    '--cells', inputs.cells ?? absent, '--out', destination];
  return [join(research, 'assembly/report.mjs'), '--scores', inputs.scores ?? absent,
    '--out', stage === 'report-out' ? destination : join(workspace.path, 'must-not-exist.json'),
    '--markdown', stage === 'report-markdown' ? destination : join(workspace.path, 'must-not-exist.md')];
}

async function target(kind, workspace) {
  if (kind === 'constants') return constants;
  if (kind === 'legacy report') return join(research, 'results/hr2-final/report.md');
  if (kind === 'test-final') return join(research, 'results/test-final/.hr2-output-refusal/absent/output');
  if (kind === 'fixtures') return join(research, 'fixtures/.hr2-output-refusal/absent/output');
  if (kind === 'protected symlink') {
    const alias = join(workspace.path, 'protected-alias');
    await symlink(join(research, 'results/hr2-final'), alias, 'dir');
    return join(alias, '.hr2-output-refusal/absent/output');
  }
  const existing = join(workspace.path, 'existing-output');
  await writeFile(existing, 'existing bytes must survive\n');
  return existing;
}

for (const stage of stages) for (const kind of ['constants', 'legacy report', 'test-final', 'fixtures', 'protected symlink', 'existing regular file']) {
  test(`${stage} refuses ${kind} before input reads or any output creation`, async t => {
    const workspace = createTestWorkspace(t, { prefix: 'hr2-output-refuse-' });
    const destination = await target(kind, workspace);
    const before = await frozenSnapshot(), scratch = await snapshot(workspace.path, captureLogs);
    const result = await runCli(workspace, command(stage, destination, workspace));
    assert.equal(result.code, 1, result.stderr);
    assert.deepEqual(JSON.parse(result.stderr), { ok: false, error: 'protected_output_path' });
    assert.equal(result.stdout, '');
    assert.deepEqual(await snapshot(workspace.path, captureLogs), scratch, 'no stage-created files or directories, including the other report output');
    assert.deepEqual(await frozenSnapshot(), before, 'protected paths and all protected byte hashes are unchanged');
  });
}

for (const stage of stages) test(`${stage} protects repository roots when invoked from another cwd`, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr2-output-cwd-' });
  const destination = relative(workspace.path, join(research, 'results/hr2-final/.hr2-output-refusal/absent/output'));
  const args = command(stage, destination, workspace);
  const before = await frozenSnapshot(), scratch = await snapshot(workspace.path, captureLogs);
  const bootstrap = `process.chdir(${JSON.stringify(workspace.path)}); process.argv = [process.execPath, ...${JSON.stringify(args)}]; await import(${JSON.stringify(new URL(`../assembly/${stage.startsWith('report') ? 'report' : stage}.mjs`, import.meta.url).href)});`;
  const result = await runCli(workspace, ['--input-type=module', '-e', bootstrap]);
  assert.equal(result.code, 1, result.stderr);
  assert.deepEqual(JSON.parse(result.stderr), { ok: false, error: 'protected_output_path' });
  assert.deepEqual(await snapshot(workspace.path, captureLogs), scratch);
  assert.deepEqual(await frozenSnapshot(), before);
});

test('run preserves non-empty-directory refusal without touching its existing contents', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr2-output-nonempty-' }), out = join(workspace.path, 'cells');
  await mkdir(out); await writeFile(join(out, 'sentinel'), 'unchanged');
  const before = await snapshot(workspace.path, captureLogs);
  const result = await runCli(workspace, command('run', out, workspace));
  assert.equal(result.code, 1); assert.deepEqual(JSON.parse(result.stderr), { ok: false, error: 'output_directory_not_empty' });
  assert.deepEqual(await snapshot(workspace.path, captureLogs), before);
});

test('report preflights both output paths and refuses aliases and ancestor collisions before writing either', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr2-output-collision-' });
  const alias = join(workspace.path, 'safe-alias'); await symlink(workspace.path, alias, 'dir');
  const output = join(workspace.path, 'new-report');
  for (const markdown of [output, join(alias, 'new-report'), join(output, 'nested.md')]) {
    const before = await snapshot(workspace.path, captureLogs);
    const result = await runCli(workspace, [join(research, 'assembly/report.mjs'), '--scores', join(workspace.path, 'absent-input'),
      '--out', output, '--markdown', markdown]);
    assert.equal(result.code, 1); assert.deepEqual(JSON.parse(result.stderr), { ok: false, error: 'protected_output_path' });
    assert.deepEqual(await snapshot(workspace.path, captureLogs), before);
  }
});

test('shared guard resolves missing descendants, refuses dangling links and never overwrites a prior output', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr2-output-resolve-' });
  const real = join(workspace.path, 'real'); await mkdir(real);
  const alias = join(workspace.path, 'alias'); await symlink(real, alias, 'dir');
  assert.equal(resolvedOutputPath(join(alias, 'absent/nested/file')), join(real, 'absent/nested/file'));
  const dangling = join(workspace.path, 'dangling'); await symlink(join(real, 'missing'), dangling, 'dir');
  assert.throws(() => validateOutputPath(join(dangling, 'file')), /^Error: protected_output_path$/);
  const file = join(real, 'new.txt');
  await writeOutputText(file, 'first output');
  const hash = sha256(await readFile(file));
  await assert.rejects(writeOutputText(file, 'second output'), /^Error: protected_output_path$/);
  assert.equal(sha256(await readFile(file)), hash);
});

async function writeToy(workspace) {
  const fixture = join(workspace.path, 'fixture'), rankings = join(workspace.path, 'rankings');
  await mkdir(fixture); await mkdir(join(rankings, 'lexical-S1000'), { recursive: true });
  const queries = Array.from({ length: 7 }, (_, i) => ({ id: `q${i}`, family: `f${i}`, category: `C${i + 1}`, lang: 'en', intent: 'current', text: 'hello' }));
  const values = {
    'hr1-facts.json': { facts: [], families: [] }, 'hr1-facts-view.json': { facts: [] }, 'hr1-label-audit.json': { overrides: [] },
    'hr1-corpus.json': { memories: [{ id: 'm', namespace: 'target', scale: 'S300', state: 'current', content: 'hello', spans: [{ id: 'm#span', text: 'world' }] }] },
    'hr1-queries.json': { queries }, 'hr1-split.json': Object.fromEntries(queries.map(query => [query.family, 'dev'])),
    'hr1-labels.json': { queries: queries.map(query => ({ ...query, split: 'dev', groups: [{ members: [{ memory: 'm', namespace: 'target', scale: 'S300', where: 'body', spans: [] }] }] })) },
  };
  const hashes = {};
  for (const name of FILES) {
    const bytes = `${JSON.stringify(values[name])}\n`; hashes[name] = sha256(bytes);
    await writeFile(join(fixture, name), bytes);
  }
  await writeFile(join(fixture, 'FROZEN.md'), FILES.map(name => `| \`${name}\` | \`${hashes[name]}\` |`).join('\n'));
  await writeFile(join(rankings, 'lexical-S1000/A1.json'), JSON.stringify({ format: 'hr1-rankings-v1',
    run: { split: 'dev', scale: 'S1000', arm: 'A1', config: 'BM25-T1', model: null, lexical: null, status: 'complete', store: null, fixtureHashes: hashes },
    queries: Object.fromEntries(queries.map(query => [query.id, { ranked: ['m'] }])) }));
  return { fixture, rankings };
}

for (const overhead of ['host-v2', '0']) test(`fresh scratch permits run, score and report (${overhead}), including a safe directory symlink`, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr2-output-positive-' }), inputs = await writeToy(workspace);
  const alias = join(workspace.path, 'safe-alias'); await symlink(workspace.path, alias, 'dir');
  const cells = join(alias, 'fresh/nested/cells'), scores = join(alias, 'fresh/scores.json');
  const before = await frozenSnapshot();
  const args = command('run', cells, workspace, inputs);
  if (overhead === '0') args.splice(args.indexOf('--overhead-model'), 2, '--overheads', '0');
  const run = await runCli(workspace, args);
  assert.equal(run.code, 0, run.stderr); assert.equal(JSON.parse(run.stdout).cells, 2);
  const score = await runCli(workspace, command('score', scores, workspace, { ...inputs, cells }));
  assert.equal(score.code, 0, score.stderr);
  const report = await runCli(workspace, [join(research, 'assembly/report.mjs'), '--scores', scores,
    '--out', join(alias, 'fresh/report.json'), '--markdown', join(alias, 'fresh/report.md')]);
  assert.equal(report.code, 0, report.stderr);
  assert.equal(JSON.parse(await readFile(join(workspace.path, 'fresh/report.json'), 'utf8')).ok, true);
  assert.match(await readFile(join(workspace.path, 'fresh/report.md'), 'utf8'), /# HR-2 budgeted assembly/);
  assert.deepEqual(await frozenSnapshot(), before);
});

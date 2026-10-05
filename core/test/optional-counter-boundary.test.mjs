import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

test('I7 clean legacy and diagnostic callers do not acquire the optional indexed token counter', t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-optional-counter-' });
  const repository = fileURLToPath(new URL('../../', import.meta.url));
  // Copy only repository-tracked source, never installed dependencies or local
  // operator data. The fixture has its own genuine package-resolution boundary.
  const files = execFileSync('git', ['ls-files', '-z', '--', 'package.json', 'core',
    'evaluation/architecture', 'evaluation/live', 'evaluation/longmemeval',
    'evaluation/experiment-budget', 'plugins/cairn-memory/lib', 'adapters/openai',
    'tools/testing', 'integrations/client/testing'], { cwd: repository, encoding: 'utf8' })
    .split('\0').filter(Boolean);
  for (const file of files) {
    assert.equal(file.split('/').includes('node_modules'), false);
    const target = join(workspace.path, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(repository, file), target);
  }
  assert.equal(existsSync(join(workspace.path, 'node_modules')), false);
  assert.equal(existsSync(join(workspace.path, 'adapters/openai/node_modules')), false);
  const env = { PATH: process.env.PATH, TMPDIR: workspace.path,
    NODE_DISABLE_COMPILE_CACHE: '1' };
  const run = args => {
    const result = spawnSync(process.execPath, args, { cwd: workspace.path, env,
      encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout;
  };
  run(['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    const require = createRequire(new URL('./adapters/openai/index.mjs', import.meta.url));
    assert.throws(() => require.resolve('tiktoken'), { code: 'MODULE_NOT_FOUND' },
      'the owned tree must not resolve an ambient adapter dependency');
    const planners = await import('./evaluation/longmemeval/ingestion.mjs');
    await import('./evaluation/longmemeval/mixed-ingestion-diagnostics.mjs');
    const options = { namespace: { ownerId: 'synthetic', scope: 'personal', projectId: null },
      history: { question_id: 'lme-case-' + '0'.repeat(64), sessions: [{ session_index: 0,
        session_id: 'synthetic', date: 'synthetic', turns: [{ turn_id: 'lme-turn-' + '1'.repeat(64),
          role: 'user', content: 'Synthetic fact.' }] }] } };
    assert.equal(planners.planLongMemEvalCase(options).executable, true);
    assert.equal(planners.planQualifiedPrefixLongMemEvalCase(options).executable, true);
    for (const plan of [planners.planIndexedWindowLongMemEvalCase,
      planners.planIndexedEvidenceLongMemEvalCase]) {
      assert.throws(() => plan(options), error =>
        ['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'].includes(error.code));
    }
  `]);
  // These are the original unrelated callers which failed in clean CI, not
  // substitutes which manually assert or emit the missing-dependency error.
  for (const file of ['evaluation/architecture/test/synthetic-lineage.test.mjs',
    'core/test/extraction-text-diagnostics.test.mjs']) {
    const output = run(['tools/testing/run.mjs', '--test-reporter=tap', file]);
    assert.match(output, /# fail 0\b/u);
    assert.match(output, /# cancelled 0\b/u);
    assert.match(output, /# skipped 0\b/u);
  }
});

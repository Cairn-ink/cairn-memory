import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildArtifact, command, packageName } from '../build.mjs';

const namespace = { ownerId: 'installed-bound-owner', scope: 'personal', projectId: null };
const excerpt = 'The team considered A; adoption remains pending.';
const field = (value, evidence = []) => ({ value, evidence });
const proposal = () => ({ units: [{ source: 0, receipt: 0, kind: 'decision_state',
  subject: field(null, [0]), property: field(null), scope: field(null), applies: field(null),
  value: field(null), attribution: field('unknown'), polarity: field('unknown'),
  quantifier: field('unknown'), state: field('pending_reconfirmation', [0]),
  eventTimeContext: [], reporterContext: [] }] });

test('cold installed artifact binds source-only context without persisting proposed decisions',
  { timeout: 60000 }, async t => {
    const artifact = buildArtifact(); const root = mkdtempSync(join(tmpdir(), 'cairn-installed-bound-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-bound',
      private: true, version: '0.0.0' }), { flag: 'wx' });
    command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit',
      '--no-fund', artifact.artifactPath], root, artifact.userconfig);
    const packageRoot = join(root, 'node_modules', packageName);
    assert.equal(readFileSync(join(packageRoot, 'core/prompts/review-source-context.md'), 'utf8'),
      readFileSync(new URL('../../core/prompts/review-source-context.md', import.meta.url), 'utf8'));
    const { openMemoryCore } = await import(pathToFileURL(join(packageRoot, 'core/index.mjs')).href);
    const path = join(root, 'store.sqlite'); const requests = [];
    const model = { contextWindow: 8192, countTokens: () => 1,
      reviewSourceContext(request) { requests.push(request); return proposal(); } };
    const first = openMemoryCore({ path, model }); t.after(() => first.close());
    const admitted = first.admit({ namespace, memory: { content: 'Generated decision', kind: 'decision' },
      receipts: [{ client: 'synthetic-client', sessionId: 'synthetic-session', eventId: 'synthetic-event',
        role: 'user', excerpt }] });
    assert.equal(admitted.ok, true, JSON.stringify(admitted));
    const ref = { memoryId: admitted.value.memory.id, revision: admitted.value.memory.revision };
    const firstReview = await first.reviewSourceContext({ namespace, refs: [ref] });
    assert.equal(firstReview.ok, true, JSON.stringify(firstReview));
    assert.equal(requests[0].maxOutputTokens, 3072);
    assert.deepEqual(requests[0].input.sources[0].receipts[0].passages.map(p => p.text), [excerpt]);
    assert.equal(JSON.stringify(requests[0].input).includes('Generated decision'), false);
    assert.equal(firstReview.value.units[0].memoryId, ref.memoryId);
    assert.equal(firstReview.value.units[0].receiptId, firstReview.value.sources[0].receipts[0].id);
    assert.equal(firstReview.value.units[0].state.value, 'pending_reconfirmation');
    assert.equal(firstReview.value.units[0].interpretationStatus, 'model-proposed-unverified');
    first.close();
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { pathToFileURL } from 'node:url';
      const { openMemoryCore } = await import(pathToFileURL(process.argv[1] + '/core/index.mjs').href);
      const namespace = JSON.parse(process.argv[3]); const ref = JSON.parse(process.argv[4]);
      const field = (value, evidence = []) => ({ value, evidence });
      const model = { contextWindow: 8192, countTokens: () => 1,
        reviewSourceContext: () => ({ units: [{ source: 0, receipt: 0, kind: 'decision_state',
          subject: field(null, [0]), property: field(null), scope: field(null), applies: field(null),
          value: field(null), attribution: field('unknown'), polarity: field('unknown'),
          quantifier: field('unknown'), state: field('pending_reconfirmation', [0]),
          eventTimeContext: [], reporterContext: [] }] }) };
      const core = openMemoryCore({ path: process.argv[2], model });
      const prior = core.getRationale({ namespace, ...ref });
      const review = await core.reviewSourceContext({ namespace, refs: [ref] });
      core.close();
      process.stdout.write(JSON.stringify({ prior, review }));
    `, packageRoot, path, JSON.stringify(namespace), JSON.stringify(ref)],
    { encoding: 'utf8', timeout: 30000 });
    assert.equal(child.status, 0, child.stderr);
    const cold = JSON.parse(child.stdout);
    assert.equal(cold.prior.value.edges.length, 0);
    assert.deepEqual(cold.review.value.units, firstReview.value.units);
  });

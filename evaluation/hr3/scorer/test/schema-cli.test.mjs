import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { answerSchema, goldSchema, submissionSchema, validate } from '../schema.mjs';
import { fixture, copy } from './fixtures.mjs';

test('published JSON schemas match executable closed schemas', async () => {
  for (const [name, schema] of Object.entries({ answer: answerSchema, gold: goldSchema, submission: submissionSchema })) {
    assert.deepEqual(JSON.parse(await readFile(new URL(`../${name}.schema.json`, import.meta.url))), schema);
  }
});
test('all answer fields required; extra fields rejected at each object level', () => {
  const { submission } = fixture();
  assert.deepEqual(validate(answerSchema, submission.answer), []);
  function objects(input, path = []) {
    if (Array.isArray(input)) return input.flatMap((v, i) => objects(v, [...path, i]));
    if (!input || typeof input !== 'object') return [];
    return [path, ...Object.entries(input).flatMap(([k, v]) => objects(v, [...path, k]))];
  }
  const get = (o, path) => path.reduce((v, k) => v[k], o);
  for (const path of objects(submission.answer)) {
    const a = copy(submission.answer); get(a, path).extra = true;
    assert(validate(answerSchema, a).length, `closed at ${path.join('/')}`);
    for (const k of Object.keys(get(submission.answer, path))) {
      const b = copy(submission.answer); delete get(b, path)[k];
      assert(validate(answerSchema, b).length, `required ${[...path, k].join('/')}`);
    }
  }
});
test('typed nullable slots and decimal strings; strict citation occurrence', () => {
  const { submission } = fixture();
  submission.answer.current.rows[0].cap.value = { decimal: '1.25', unit: 'requests/day' };
  assert.deepEqual(validate(submissionSchema, submission), []);
  submission.answer.current.rows[0].cap.value.decimal = 1.25;
  assert(validate(submissionSchema, submission).length);
  submission.answer.current.rows[0].cap.value.decimal = '1x25';
  assert(validate(submissionSchema, submission).length);
  submission.answer.current.rows[0].cap.value.decimal = '1.25';
  submission.answer.reason.support[0].occurrence = 0;
  assert(validate(submissionSchema, submission).length);
});
test('gold schema excludes citations and embedded delivery labels', () => {
  const { gold } = fixture();
  assert.deepEqual(validate(goldSchema, gold), []);
  gold.current.rows[0].citations = [];
  assert(validate(goldSchema, gold).length);
  delete gold.current.rows[0].citations;
  gold.reason.acceptedGraphs[0].edges[0].delivered = true;
  assert(validate(goldSchema, gold).length);
});

async function cliTest(fn) {
  const dir = await mkdtemp(new URL('../.test-tmp-', import.meta.url).pathname);
  try {
    const { gold, submission } = fixture();
    const files = { gold: join(dir, 'gold.json'), answers: join(dir, 'answers.json'), out: join(dir, 'out.json') };
    await writeFile(files.gold, JSON.stringify(gold));
    await writeFile(files.answers, JSON.stringify(submission));
    const run = (args = ['--gold', files.gold, '--answers', files.answers, '--out', files.out]) => spawnSync(process.execPath, [resolve('evaluation/hr3/scorer/cli.mjs'), ...args], { encoding: 'utf8' });
    await fn({ dir, files, run });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
test('CLI produces deterministic JSON, including equivalent aliases', () => cliTest(async ({ files, run }) => {
  const first = run(); assert.equal(first.status, 0, first.stderr);
  const bytes = await readFile(files.out, 'utf8');
  assert.deepEqual(JSON.parse(bytes).scores, { C: 1, O: 1, R: 1, J: 1 });
  const second = run(); assert.equal(second.status, 0, second.stderr);
  assert.equal(await readFile(files.out, 'utf8'), bytes);
}));
test('CLI malformed JSON and absent/exhausted answer score zero, exit 0', () => cliTest(async ({ files, run }) => {
  for (const body of ['{bad', 'null', '{}']) {
    await writeFile(files.answers, body);
    const r = run(); assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(await readFile(files.out)).scores, { C: 0, O: 0, R: 0, J: 0 });
  }
}));
test('CLI authoring/usage/I/O errors exit 1; protect inputs', () => cliTest(async ({ files, run }) => {
  assert.equal(run([]).status, 1);
  assert.equal(run(['--gold', files.gold, '--answers', files.answers, '--out', files.gold]).status, 1);
  const original = await readFile(files.gold, 'utf8');
  assert(original.includes('supportSpans'));
  await writeFile(files.gold, '{}');
  assert.equal(run().status, 1);
  await writeFile(files.gold, original);
  assert.equal(run(['--gold', files.gold, '--answers', join(files.answers, 'absent'), '--out', files.out]).status, 1);
}));

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { openSync, closeSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { score } from '../scorer.mjs';
import { stable } from '../canonical.mjs';
import { createTriviaCase } from '../support.mjs';
import { fixture, copy } from './fixtures.mjs';
import { authored, edge, select, adapt, sha } from './trivia-fixtures.mjs';
import { unlicensedFixture } from './unlicensed-fixtures.mjs';

const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
function punctuationCase(language = 'en') {
  const f = authored([edge('Ice', 'queues', language), { production: 'source_join', language }, edge('Queues', 'the cobalt handoff', language)]);
  const optional = f.input.registry.origins[0].positions, intervals = [];
  let start = 0;
  for (const position of optional) { intervals.push([start, position]); start = position + 1; }
  intervals.push([start, f.gold.supportSpans[0].text.length]);
  select(f, 0, intervals);
  assert.equal(score(f.gold, f.submission, f.scoringOptions).scores.R, 1);
  return f;
}
async function withFiles(f, fn) {
  const dir = await mkdtemp(new URL('../.test-trivia-cli-', import.meta.url).pathname);
  try {
    const files = Object.fromEntries(['gold', 'answers', 'out', 'binding', 'freeze'].map(name => [name, join(dir, `${name}.json`)]));
    const binding = f.unlicensed?.binding ?? (f.input && { family: f.input.family, caseId: f.input.caseId, question: f.input.question, registry: f.input.registry });
    await writeFile(files.gold, JSON.stringify(f.gold));
    await writeFile(files.answers, JSON.stringify(f.submission));
    // Every failure must leave the previous output untouched, without tmp files.
    await writeFile(files.out, 'previous output\n');
    if (binding) {
      await writeFile(files.binding, JSON.stringify(binding));
      await writeFile(files.freeze, f.unlicensed?.bytes ?? f.input.freezeBytes);
    }
    const base = ['--gold', files.gold, '--answers', files.answers, '--out', files.out];
    const bound = ['--trivia-binding', files.binding, '--trivia-freeze', files.freeze, '--trivia-freeze-sha256', f.unlicensed?.pin ?? f.input?.pin];
    // Direct file descriptors also work in environments that prohibit pipes.
    const run = (args = []) => {
      const stdoutFile = join(dir, 'stdout.log'), stderrFile = join(dir, 'stderr.log');
      const stdout = openSync(stdoutFile, 'w'), stderr = openSync(stderrFile, 'w');
      let result;
      try { result = spawnSync(process.execPath, [cli, ...base, ...args], { stdio: ['ignore', stdout, stderr] }); }
      finally { closeSync(stdout); closeSync(stderr); }
      assert.ifError(result.error);
      return { ...result, stdout: readFileSync(stdoutFile, 'utf8'), stderr: readFileSync(stderrFile, 'utf8') };
    };
    const rejected = async (args = [], pattern = /trivia/i) => {
      const result = run(args);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, pattern);
      assert.equal(result.stdout, '');
      assert.equal(await readFile(files.out, 'utf8'), 'previous output\n');
      assert(!(await readdir(dir)).some(name => name.endsWith('.tmp')));
    };
    await fn({ files, binding, bound, run, rejected });
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('CLI rejects serialized English/Chinese trivia gold without a separate trusted binding', async () => {
  for (const language of ['en', 'zh']) await withFiles(punctuationCase(language), async ({ rejected }) => {
    await rejected([], /Trivia case binding required: unauthenticated_trivia_registry/);
  });
});
test('CLI rejects forged pins, handles, family identities, questions and original emission registries', async () => {
  const f = punctuationCase();
  await withFiles(f, async ({ files, binding, bound, rejected }) => {
    await rejected([...bound.slice(0, -1), '0'.repeat(64)], /pin mismatch/);
    const alteredFreeze = copy(f.input.freeze);
    alteredFreeze.optional_trivia.family_handles[f.input.family.family_id].registry_sha256 = '0'.repeat(64);
    // Even repinning a trusted configuration to the forged handle cannot make
    // the generator verifier accept the original emission against that handle.
    alteredFreeze.optional_trivia.family_handles_sha256 = sha(stable(alteredFreeze.optional_trivia.family_handles));
    const bytes = JSON.stringify(alteredFreeze);
    await writeFile(files.freeze, bytes);
    await rejected([...bound.slice(0, -1), sha(bytes)], /Invalid trivia binding/);
    await writeFile(files.freeze, f.input.freezeBytes);
    for (const edit of [
      b => b.family.family_id = 'unrelated-family',
      b => b.question += ' Another checkpoint.',
      b => b.registry.emission_inputs[0].variables.fromFact = 'Substituted cause',
      b => b.registry.rules_sha256 = '0'.repeat(64),
    ]) {
      const bad = copy(binding); edit(bad);
      await writeFile(files.binding, JSON.stringify(bad));
      await rejected(bound, /trivia/i);
    }
    await writeFile(files.binding, JSON.stringify({ triviaCase: copy(f.scoringOptions.triviaCase) }));
    await rejected(bound, /Invalid trusted trivia binding file/);
  });
});
test('CLI authenticates separate input and preserves English/Chinese final stops and joining spaces', async () => {
  for (const language of ['en', 'zh']) await withFiles(punctuationCase(language), async ({ files, bound, run }) => {
    const first = run(bound);
    assert.equal(first.status, 0, first.stderr);
    const bytes = await readFile(files.out, 'utf8'), result = JSON.parse(bytes);
    assert.equal(result.valid, true);
    assert.deepEqual(result.scores, { C: 1, O: 1, R: 1, J: 1 });
    assert.equal(result.supportAuthentication.status, 'authenticated');
    assert.equal(run(bound).status, 0);
    assert.equal(await readFile(files.out, 'utf8'), bytes);
  });
});
test('CLI no-trivia gold retains ordinary scores and malformed-reader zero observations', async () => {
  const f = fixture();
  f.unlicensed = unlicensedFixture(f.gold);
  await withFiles(f, async ({ files, run, bound }) => {
    const valid = run(bound); assert.equal(valid.status, 0, valid.stderr);
    assert.deepEqual(JSON.parse(await readFile(files.out)).scores, score(f.gold, f.submission, f.unlicensed.scoringOptions).scores);
    await writeFile(files.answers, '{bad');
    const malformed = run(bound); assert.equal(malformed.status, 0, malformed.stderr);
    assert.deepEqual(JSON.parse(await readFile(files.out)).scores, { C: 0, O: 0, R: 0, J: 0 });
  });
});
test('CLI requires all trusted binding flags and never derives the freeze pin from a binding file', async () => {
  await withFiles(punctuationCase(), async ({ files, binding, bound, rejected }) => {
    await rejected(bound.slice(0, 2), /All three trusted trivia binding options/);
    await rejected(bound.slice(0, 4), /All three trusted trivia binding options/);
    await rejected(bound.slice(2), /All three trusted trivia binding options/);
    await writeFile(files.binding, JSON.stringify({ ...binding, expectedSha256: bound.at(-1) }));
    await rejected(bound, /Invalid trusted trivia binding file/);
  });
});
test('CLI rejects mismatched or stripped normalized gold metadata instead of replacing it with a proof', async () => {
  const f = punctuationCase();
  await withFiles(f, async ({ files, bound, rejected }) => {
    for (const edit of [
      gold => gold.supportTrivia.positions[0].char = ',',
      gold => gold.supportTrivia.producer.handle_sha256 = '0'.repeat(64),
      gold => { gold.supportTrivia.producer = null; gold.supportTrivia.rules = []; gold.supportTrivia.positions = []; },
      gold => { gold.supportSpans[0].origin = 'different-source'; },
    ]) {
      const bad = copy(f.gold); edit(bad);
      await writeFile(files.gold, JSON.stringify(bad));
      await rejected(bound, /Trivia binding does not match gold registry|Invalid trivia binding/);
    }
  });
});
test('CLI authentication errors remain errors even when reader or binding JSON is malformed', async () => {
  await withFiles(punctuationCase(), async ({ files, bound, rejected }) => {
    await writeFile(files.answers, '{bad');
    await rejected([], /Trivia case binding required/);
    await writeFile(files.binding, '{bad');
    await rejected(bound, /JSON|property name/i);
  });
});
test('CLI valid authentication still scores malformed reader JSON as an attempted zero observation', async () => {
  await withFiles(punctuationCase(), async ({ files, bound, run }) => {
    await writeFile(files.answers, '{bad');
    const result = run(bound); assert.equal(result.status, 0, result.stderr);
    const scored = JSON.parse(await readFile(files.out));
    assert.equal(scored.supportAuthentication.status, 'authenticated');
    assert.equal(scored.valid, false);
    assert.deepEqual(scored.scores, { C: 0, O: 0, R: 0, J: 0 });
  });
});
test('public scorer rejects absent, invalid, failed and replayed trivia authentication before scoring', () => {
  const f = punctuationCase();
  const rejected = (gold, options) => {
    for (const submission of [f.submission, null, {}]) assert.throws(() => score(gold, submission, options), { code: 'ERR_HR3_TRIVIA_BINDING' });
  };
  rejected(f.gold);
  rejected(f.gold, { triviaCase: copy(f.scoringOptions.triviaCase) });
  rejected(copy(f.gold), f.scoringOptions);
  const anotherCase = createTriviaCase({ family: f.input.family, authority: f.input.authority, caseId: 'unrelated-checkpoint', question: f.input.question });
  rejected(f.gold, { triviaCase: anotherCase });
  const failed = adapt(f.input, f.input.registry, {});
  assert.equal(failed.producer, null); assert.equal(failed.positions.length, 0);
  rejected({ ...f.gold, supportTrivia: failed }, f.scoringOptions);
});
test('public no-trivia scoring stays available but an explicitly supplied invalid binding is an error', () => {
  const { gold, submission } = fixture();
  assert.throws(() => score(gold, submission), { code: 'ERR_HR3_TRIVIA_BINDING' });
  assert.deepEqual(score(gold, submission, unlicensedFixture(gold).scoringOptions).scores, { C: 1, O: 1, R: 1, J: 1 });
  for (const triviaCase of [undefined, null, {}, { family_id: 'fake', case_id: 'fake' }]) {
    assert.throws(() => score(gold, submission, { triviaCase }), { code: 'ERR_HR3_TRIVIA_BINDING' });
  }
});

async function strippedCli(language) {
  const f = punctuationCase(language);
  f.gold.supportTrivia = { ...f.gold.supportTrivia, producer: null, rules: [], positions: [] };
  await withFiles(f, async ({ files, bound, rejected }) => {
    await rejected([], /Trivia case binding required/);
    await rejected(bound, /Trivia binding does not match gold registry/);
    delete f.gold.supportTrivia;
    await writeFile(files.gold, JSON.stringify(f.gold));
    await rejected([], /Invalid gold/);
    await rejected(bound, /Invalid gold/);
  });
}
test('English CLI stripping: empty or absent A-6 metadata cannot select unlicensed scoring', () => strippedCli('en'));
test('Chinese CLI stripping: empty or absent A-6 metadata cannot select unlicensed scoring', () => strippedCli('zh'));
test('CLI frozen no-trivia authority authorizes only the exact trusted source target and gold', async () => {
  for (const language of ['en', 'zh']) {
    const f = fixture();
    if (language === 'zh') f.gold.question = '請回答檢查點的設定、前身與完整原因。';
    f.unlicensed = unlicensedFixture(f.gold);
    await withFiles(f, async ({ files, binding, bound, run, rejected }) => {
      await rejected([], /Trivia case binding required/);
      const bad = copy(binding); bad.target.id = 'another-source';
      await writeFile(files.binding, JSON.stringify(bad));
      await rejected(bound, /absent from frozen/);
      bad.target.id = binding.target.id; bad.target.checkpoint = 'same family, another case';
      await writeFile(files.binding, JSON.stringify(bad));
      await rejected(bound, /absent from frozen/);
      await writeFile(files.binding, JSON.stringify(binding));
      const changed = copy(f.gold); changed.current.rows[0].route.value = 'tampered';
      await writeFile(files.gold, JSON.stringify(changed));
      await rejected(bound, /gold\/target mismatch/);
      await writeFile(files.gold, JSON.stringify(f.gold));
      const valid = run(bound); assert.equal(valid.status, 0, valid.stderr);
      const result = JSON.parse(await readFile(files.out));
      assert.equal(result.supportAuthentication.status, 'authenticated_unlicensed');
      assert.deepEqual(result.scores, { C: 1, O: 1, R: 1, J: 1 });
    });
  }
});
test('CLI rejects legacy-version relabeling of A-6 gold with and without trivia metadata', async () => {
  const f = fixture();
  await withFiles(f, async ({ files, rejected }) => {
    for (const version of [undefined, 'hr3-support-a4-v2', 'hr3-support-a6-v1', 'unknown']) for (const removeTrivia of [false, true]) {
      const gold = copy(f.gold);
      if (version === undefined) delete gold.supportVersion; else gold.supportVersion = version;
      if (removeTrivia) delete gold.supportTrivia;
      await writeFile(files.gold, JSON.stringify(gold));
      await rejected([], /Invalid gold/);
    }
  });
});

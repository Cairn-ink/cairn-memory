import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, open, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { parseArguments } from '../cli.mjs';
import {
  MAX_INPUT_BYTES,
  opaqueQuestionId,
  prepareLongMemEval,
  stableTurnId,
} from '../prepare.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const clone = (value) => structuredClone(value);
const parseJsonLines = (value) => value.trimEnd().split('\n').map((line) => JSON.parse(line));

const fixture = () => [
  {
    question_id: 'temporal-case',
    question_type: 'temporal-reasoning',
    question: 'How many weeks passed? 🧭',
    answer: 15,
    question_date: '2023/10/15 (Sun) 17:53',
    haystack_session_ids: ['session-later', 'session-earlier'],
    haystack_dates: ['date kept verbatim Z', 'date kept verbatim A'],
    haystack_sessions: [
      [
        {
          role: 'user',
          content: '自然な Unicode dialogue with a legitimate answer mention: fifteen.',
          has_answer: true,
          annotation: 'TURN_ANNOTATION_POISON',
        },
        { role: 'assistant', content: 'x'.repeat(4_001), has_answer: false },
      ],
      [{ role: 'user', content: 'Earlier source remains second in source order.' }],
    ],
    answer_session_ids: ['session-later'],
    summary: 'SUMMARY_POISON',
    annotations: { answer: 'TOP_LEVEL_ANNOTATION_POISON' },
  },
  {
    question_id: 'missing-memory_abs',
    question_type: 'single-session-user',
    question: 'What did I never mention?',
    answer: 'abstain',
    question_date: 'not parsed as a date',
    haystack_session_ids: ['abstention-session'],
    haystack_dates: ['also not parsed'],
    haystack_sessions: [[
      { role: 'user', content: 'Nothing relevant here.' },
      { role: 'assistant', content: 'Acknowledged.' },
    ]],
    answer_session_ids: [],
    supplied_summary: 'SUPPLIED_SUMMARY_POISON',
  },
];

async function workspace(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cairn-longmemeval-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function writeDataset(directory, data = fixture(), filename = 'input.json') {
  const content = JSON.stringify(data);
  const inputPath = path.join(directory, filename);
  await writeFile(inputPath, content);
  return { inputPath, content, expectedSha256: digest(content) };
}

const optionsFor = (directory, input, overrides = {}) => ({
  inputPath: input.inputPath,
  expectedSha256: input.expectedSha256,
  datasetRevision: 'upstream-revision-abc123',
  datasetVariant: 's-cleaned',
  questionIds: ['temporal-case', 'missing-memory_abs'],
  outputDirectory: path.join(directory, 'prepared'),
  ...overrides,
});

const assertAbsent = async (filename) => {
  await assert.rejects(stat(filename), { code: 'ENOENT' });
};

test('CLI module is import-safe and its parser retains repeated explicit question IDs', () => {
  assert.deepEqual(parseArguments([
    '--input', 'input.json',
    '--sha256', '0'.repeat(64),
    '--revision', 'revision',
    '--variant', 's-cleaned',
    '--question-id', 'first',
    '--question-id', 'second',
    '--output', 'prepared',
  ]).questionIds, ['first', 'second']);
});

test('prepares answer-blind model files and private evaluator data without truncation', async (t) => {
  const directory = await workspace(t);
  const input = await writeDataset(directory);
  const result = await prepareLongMemEval(optionsFor(directory, input));
  const output = path.join(directory, 'prepared');
  const historyText = await readFile(path.join(output, 'history.jsonl'), 'utf8');
  const questionText = await readFile(path.join(output, 'questions.jsonl'), 'utf8');
  const evaluatorText = await readFile(path.join(output, 'evaluator.jsonl'), 'utf8');
  const histories = parseJsonLines(historyText);
  const questions = parseJsonLines(questionText);
  const evaluators = parseJsonLines(evaluatorText);

  const opaqueTemporal = opaqueQuestionId('temporal-case');
  assert.equal(histories[0].question_id, opaqueTemporal);
  assert.equal(questions[0].question_id, opaqueTemporal);
  assert.notEqual(opaqueTemporal, 'temporal-case');
  assert.deepEqual(Object.keys(histories[0]), ['question_id', 'sessions']);
  assert.deepEqual(Object.keys(histories[0].sessions[0]), ['session_index', 'session_id', 'date', 'turns']);
  assert.deepEqual(histories[0].sessions.map((session) => session.session_index), [0, 1]);
  assert.deepEqual(histories[0].sessions.map((session) => session.session_id), ['session-later', 'session-earlier']);
  assert.deepEqual(Object.keys(histories[0].sessions[0].turns[0]), ['turn_id', 'role', 'content']);
  assert.deepEqual(Object.keys(questions[0]), ['question_id', 'text', 'date']);
  assert.deepEqual(Object.keys(evaluators[0]), [
    'question_id',
    'source_question_id',
    'question_type',
    'reference_answer',
    'answer_session_ids',
    'turn_labels',
  ]);
  assert.equal(histories[0].sessions[0].turns[1].content.length, 4_001);
  assert.deepEqual(histories[0].sessions.map((session) => session.date), [
    'date kept verbatim Z',
    'date kept verbatim A',
  ]);
  assert.equal(questions[1].date, 'not parsed as a date');
  assert.deepEqual(evaluators[0].turn_labels, [
    { turn_id: stableTurnId('temporal-case', 0, 'session-later', 0), has_answer: true },
    { turn_id: stableTurnId('temporal-case', 0, 'session-later', 1), has_answer: false },
  ]);
  assert.deepEqual(evaluators[1].answer_session_ids, []);
  assert.deepEqual(evaluators[1].turn_labels, []);

  for (const poison of [
    'temporal-case',
    'missing-memory_abs',
    'SUMMARY_POISON',
    'TURN_ANNOTATION_POISON',
    'TOP_LEVEL_ANNOTATION_POISON',
    'SUPPLIED_SUMMARY_POISON',
  ]) {
    assert.doesNotMatch(historyText + questionText, new RegExp(poison));
  }
  for (const forbiddenKey of ['has_answer', 'question_type', 'reference_answer', 'answer_session_ids', 'turn_labels']) {
    assert.doesNotMatch(historyText + questionText, new RegExp(`"${forbiddenKey}"`));
  }
  assert.equal(result.manifest.compatibility.selected_raw_turns_over_core_message_limit_count, 1);
  assert.equal(result.manifest.compatibility.raw_source_measurement_only, true);
  assert.equal(
    result.manifest.compatibility.absence_of_raw_size_blockers_does_not_prove_capture_or_context_compatibility,
    true,
  );
  assert.equal(result.manifest.compatibility.measurements_are_not_token_or_cost_estimates, true);
  assert.equal(result.manifest.sizes.source_history_content_utf8_bytes
    > result.manifest.sizes.source_history_content_utf16_characters, true);
});

test('explicit selection is source-ordered and byte-identical across runs', async (t) => {
  const directory = await workspace(t);
  const input = await writeDataset(directory);
  const firstOutput = path.join(directory, 'first');
  const secondOutput = path.join(directory, 'second');
  await prepareLongMemEval(optionsFor(directory, input, {
    questionIds: ['missing-memory_abs', 'temporal-case'],
    outputDirectory: firstOutput,
  }));
  await prepareLongMemEval(optionsFor(directory, input, {
    questionIds: ['temporal-case', 'missing-memory_abs'],
    outputDirectory: secondOutput,
  }));

  for (const filename of ['history.jsonl', 'questions.jsonl', 'evaluator.jsonl', 'manifest.json']) {
    assert.equal(
      await readFile(path.join(firstOutput, filename), 'utf8'),
      await readFile(path.join(secondOutput, filename), 'utf8'),
    );
  }
  const evaluator = parseJsonLines(await readFile(path.join(firstOutput, 'evaluator.jsonl'), 'utf8'));
  assert.deepEqual(evaluator.map((record) => record.source_question_id), ['temporal-case', 'missing-memory_abs']);
});

test('preserves identical repeated source sessions as distinct indexed occurrences', async (t) => {
  const directory = await workspace(t);
  const data = fixture();
  data[1].haystack_session_ids.push('abstention-session');
  data[1].haystack_dates.push('a different preserved date');
  data[1].haystack_sessions.push(clone(data[1].haystack_sessions[0]));
  const input = await writeDataset(directory, data);
  const result = await prepareLongMemEval(optionsFor(directory, input, {
    questionIds: ['missing-memory_abs'],
  }));
  const histories = parseJsonLines(await readFile(path.join(directory, 'prepared', 'history.jsonl'), 'utf8'));
  assert.deepEqual(histories[0].sessions.map(({ session_index, session_id, date }) => ({
    session_index,
    session_id,
    date,
  })), [
    { session_index: 0, session_id: 'abstention-session', date: 'also not parsed' },
    { session_index: 1, session_id: 'abstention-session', date: 'a different preserved date' },
  ]);
  assert.notEqual(histories[0].sessions[0].turns[0].turn_id, histories[0].sessions[1].turns[0].turn_id);
  assert.equal(result.manifest.sizes.source_duplicate_session_id_occurrence_count, 1);
  assert.equal(result.manifest.sizes.selected_duplicate_session_id_occurrence_count, 1);
});

test('reports source duplicates outside the pilot without altering selected history', async (t) => {
  const directory = await workspace(t);
  const data = fixture();
  data[1].haystack_session_ids.push('abstention-session');
  data[1].haystack_dates.push('repeated filler at another date');
  data[1].haystack_sessions.push(clone(data[1].haystack_sessions[0]));
  const input = await writeDataset(directory, data);
  const result = await prepareLongMemEval(optionsFor(directory, input, {
    questionIds: ['temporal-case'],
  }));
  assert.equal(result.manifest.sizes.source_duplicate_session_id_occurrence_count, 1);
  assert.equal(result.manifest.sizes.selected_duplicate_session_id_occurrence_count, 0);
});

test('rejects conflicting repeated source sessions and ambiguous repeated evidence IDs', async (t) => {
  const directory = await workspace(t);
  const conflicting = fixture();
  conflicting[1].haystack_session_ids.push('abstention-session');
  conflicting[1].haystack_dates.push('conflicting date');
  conflicting[1].haystack_sessions.push([{ role: 'user', content: 'different source body' }]);
  const conflictingInput = await writeDataset(directory, conflicting, 'conflicting.json');
  const conflictingOutput = path.join(directory, 'conflicting-output');
  await assert.rejects(
    prepareLongMemEval(optionsFor(directory, conflictingInput, { outputDirectory: conflictingOutput })),
    { code: 'invalid_dataset' },
  );
  await assertAbsent(conflictingOutput);

  const ambiguous = fixture();
  ambiguous[1].haystack_session_ids.push('abstention-session');
  ambiguous[1].haystack_dates.push('ambiguous evidence date');
  ambiguous[1].haystack_sessions.push(clone(ambiguous[1].haystack_sessions[0]));
  ambiguous[1].answer_session_ids = ['abstention-session'];
  const ambiguousInput = await writeDataset(directory, ambiguous, 'ambiguous.json');
  const ambiguousOutput = path.join(directory, 'ambiguous-output');
  await assert.rejects(
    prepareLongMemEval(optionsFor(directory, ambiguousInput, { outputDirectory: ambiguousOutput })),
    { code: 'ambiguous_evidence_session' },
  );
  await assertAbsent(ambiguousOutput);
});

test('manifest records provenance, pilot identity, exact artifact hashes and measured sizes', async (t) => {
  const directory = await workspace(t);
  const input = await writeDataset(directory);
  await prepareLongMemEval(optionsFor(directory, input, { questionIds: ['temporal-case'] }));
  const output = path.join(directory, 'prepared');
  const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));

  assert.equal(manifest.schema_version, 'cairn-longmemeval-preparation-v1');
  assert.equal(manifest.preparation_kind, 'pilot');
  assert.equal(manifest.dataset.declared_variant, 's-cleaned');
  assert.equal(manifest.dataset.declared_revision, 'upstream-revision-abc123');
  assert.equal(manifest.dataset.input_sha256, input.expectedSha256);
  assert.equal(manifest.dataset.input_byte_count, Buffer.byteLength(input.content));
  assert.match(manifest.dataset.identity_scope, /not-upstream-authenticity-proof/);
  assert.match(manifest.dataset.oracle_warning, /do-not-certify-oracle/);
  assert.deepEqual(manifest.selection.source_question_ids, ['temporal-case']);
  assert.equal(manifest.selection.count, 1);
  assert.deepEqual(manifest.boundaries.model_facing_files, ['history.jsonl', 'questions.jsonl']);

  for (const artifact of Object.values(manifest.artifacts)) {
    const content = await readFile(path.join(output, artifact.filename));
    assert.equal(artifact.sha256, digest(content));
    assert.equal(artifact.byte_count, content.length);
    assert.equal(artifact.record_count, 1);
  }
});

test('rejects digest mismatch and malformed JSON before creating output', async (t) => {
  const directory = await workspace(t);
  const valid = await writeDataset(directory);
  const digestOutput = path.join(directory, 'digest-output');
  await assert.rejects(
    prepareLongMemEval(optionsFor(directory, valid, {
      expectedSha256: '0'.repeat(64),
      outputDirectory: digestOutput,
    })),
    { code: 'digest_mismatch' },
  );
  await assertAbsent(digestOutput);

  const malformedContent = '[{"question_id":';
  const malformed = await writeDataset(directory, fixture(), 'malformed.json');
  await writeFile(malformed.inputPath, malformedContent);
  malformed.expectedSha256 = digest(malformedContent);
  const malformedOutput = path.join(directory, 'malformed-output');
  await assert.rejects(
    prepareLongMemEval(optionsFor(directory, malformed, { outputDirectory: malformedOutput })),
    { code: 'malformed_json' },
  );
  await assertAbsent(malformedOutput);

  const invalidUtf8 = Buffer.from([0x5b, 0x22, 0xff, 0x22, 0x5d]);
  const invalidUtf8Path = path.join(directory, 'invalid-utf8.json');
  await writeFile(invalidUtf8Path, invalidUtf8);
  const invalidUtf8Output = path.join(directory, 'invalid-utf8-output');
  await assert.rejects(
    prepareLongMemEval(optionsFor(directory, {
      inputPath: invalidUtf8Path,
      expectedSha256: digest(invalidUtf8),
    }, { outputDirectory: invalidUtf8Output })),
    { code: 'malformed_json' },
  );
  await assertAbsent(invalidUtf8Output);
});

test('validates every official instance, including malformed unselected instances, before output', async (t) => {
  const mutations = [
    (data) => { data[1].question_id = data[0].question_id; },
    (data) => { data[1].question_date = ' '; },
    (data) => { data[1].question_type = 'abstention'; },
    (data) => { data[1].haystack_dates = []; },
    (data) => { data[1].haystack_session_ids = ['same', 'same']; data[1].haystack_dates = ['a', 'b']; data[1].haystack_sessions.push([]); },
    (data) => { data[1].haystack_sessions[0][0].role = 'system'; },
    (data) => { data[1].haystack_sessions[0][0].content = 7; },
    (data) => { data[1].haystack_sessions[0][0].has_answer = 'true'; },
    (data) => { data[1].answer_session_ids = ['unknown-session']; },
    (data) => { data[1].answer = null; },
  ];

  for (let index = 0; index < mutations.length; index += 1) {
    const directory = await workspace(t);
    const data = fixture();
    mutations[index](data);
    const input = await writeDataset(directory, data);
    const outputDirectory = path.join(directory, `invalid-${index}`);
    await assert.rejects(
      prepareLongMemEval(optionsFor(directory, input, {
        questionIds: ['temporal-case'],
        outputDirectory,
      })),
      { code: 'invalid_dataset' },
    );
    await assertAbsent(outputDirectory);
  }
});

test('rejects duplicate and unknown pilot selections before output', async (t) => {
  const directory = await workspace(t);
  const input = await writeDataset(directory);
  for (const [name, questionIds] of [
    ['duplicate', ['temporal-case', 'temporal-case']],
    ['unknown', ['not-in-dataset']],
    ['empty', []],
  ]) {
    const outputDirectory = path.join(directory, name);
    await assert.rejects(
      prepareLongMemEval(optionsFor(directory, input, { questionIds, outputDirectory })),
      { code: 'invalid_selection' },
    );
    await assertAbsent(outputDirectory);
  }
});

test('requires the cleaned S variant, revision, digest and a closed option allowlist', async (t) => {
  const directory = await workspace(t);
  const input = await writeDataset(directory);
  const cases = [
    { datasetVariant: 'oracle' },
    { datasetRevision: '' },
    { expectedSha256: undefined },
    { unknownOption: 'poison' },
  ];
  for (let index = 0; index < cases.length; index += 1) {
    const outputDirectory = path.join(directory, `options-${index}`);
    await assert.rejects(
      prepareLongMemEval(optionsFor(directory, input, { outputDirectory, ...cases[index] })),
      { code: 'invalid_options' },
    );
    await assertAbsent(outputDirectory);
  }
});

test('enforces the input byte bound from metadata before reading or writing', async (t) => {
  const directory = await workspace(t);
  const inputPath = path.join(directory, 'oversized.json');
  const handle = await open(inputPath, 'w');
  await handle.truncate(MAX_INPUT_BYTES + 1);
  await handle.close();
  const outputDirectory = path.join(directory, 'oversized-output');
  await assert.rejects(
    prepareLongMemEval(optionsFor(directory, {
      inputPath,
      expectedSha256: '0'.repeat(64),
    }, { outputDirectory })),
    { code: 'input_size_out_of_bounds' },
  );
  await assertAbsent(outputDirectory);
});

test('rejects a FIFO without blocking on open', async (t) => {
  const directory = await workspace(t);
  const fifoPath = path.join(directory, 'input.fifo');
  const created = spawnSync('mkfifo', [fifoPath], { encoding: 'utf8' });
  if (created.status !== 0) {
    t.skip('mkfifo is unavailable on this platform');
    return;
  }
  const outputDirectory = path.join(directory, 'fifo-output');
  const cli = path.resolve('evaluation/longmemeval/cli.mjs');
  const result = spawnSync(process.execPath, [
    cli,
    '--input', fifoPath,
    '--sha256', '0'.repeat(64),
    '--revision', 'synthetic-revision',
    '--variant', 's-cleaned',
    '--question-id', 'synthetic-question',
    '--output', outputDirectory,
  ], { encoding: 'utf8', timeout: 2_000 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stderr), { error: 'invalid_input_file' });
  await assertAbsent(outputDirectory);
});

test('uses private permissions and refuses overwrite, missing parents and symlink ancestors', async (t) => {
  const directory = await workspace(t);
  const input = await writeDataset(directory);
  const outputDirectory = path.join(directory, 'private-output');
  await prepareLongMemEval(optionsFor(directory, input, { outputDirectory }));
  assert.equal((await stat(outputDirectory)).mode & 0o777, 0o700);
  for (const filename of ['history.jsonl', 'questions.jsonl', 'evaluator.jsonl', 'manifest.json']) {
    assert.equal((await stat(path.join(outputDirectory, filename))).mode & 0o777, 0o600);
  }
  await assert.rejects(
    prepareLongMemEval(optionsFor(directory, input, { outputDirectory })),
    { code: 'output_exists' },
  );

  const missingOutput = path.join(directory, 'missing-parent', 'output');
  await assert.rejects(
    prepareLongMemEval(optionsFor(directory, input, { outputDirectory: missingOutput })),
    { code: 'unsafe_output' },
  );
  await assertAbsent(missingOutput);

  const realParent = path.join(directory, 'real-parent');
  const linkedParent = path.join(directory, 'linked-parent');
  await mkdir(realParent);
  await symlink(realParent, linkedParent, 'dir');
  const linkedOutput = path.join(linkedParent, 'output');
  await assert.rejects(
    prepareLongMemEval(optionsFor(directory, input, { outputDirectory: linkedOutput })),
    { code: 'unsafe_output' },
  );
  await assertAbsent(path.join(realParent, 'output'));

  const traversalOutput = `${path.join(directory, 'real-parent')}/../traversal-output`;
  await assert.rejects(
    prepareLongMemEval(optionsFor(directory, input, { outputDirectory: traversalOutput })),
    { code: 'unsafe_output' },
  );
  await assertAbsent(path.join(directory, 'traversal-output'));
});

test('CLI prints counts and digests only and rejects unknown flags without leaking values', async (t) => {
  const directory = await workspace(t);
  const input = await writeDataset(directory);
  const outputDirectory = path.join(directory, 'cli-output');
  const cli = path.resolve('evaluation/longmemeval/cli.mjs');
  const args = [
    cli,
    '--input', input.inputPath,
    '--sha256', input.expectedSha256,
    '--revision', 'private-revision-marker',
    '--variant', 's-cleaned',
    '--question-id', 'missing-memory_abs',
    '--output', outputDirectory,
  ];
  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, SECRET_PROVIDER_KEY: 'SECRET_PROVIDER_MARKER' },
  });
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(summary).sort(), [
    'evaluator_sha256',
    'history_sha256',
    'input_byte_count',
    'input_sha256',
    'manifest_sha256',
    'questions_sha256',
    'selected_question_count',
    'selected_session_count',
    'selected_turn_count',
    'selected_raw_turns_over_core_message_limit_count',
    'source_instance_count',
  ].sort());
  assert.doesNotMatch(result.stdout + result.stderr, /SECRET_PROVIDER_MARKER|private-revision-marker|missing-memory_abs/);
  assert.equal(result.stdout.includes(input.inputPath), false);
  assert.equal(result.stdout.includes(outputDirectory), false);

  const rejectedOutput = path.join(directory, 'rejected-cli-output');
  const rejected = spawnSync(process.execPath, [...args.slice(0, -2), '--unknown', 'SECRET_CLI_VALUE', '--output', rejectedOutput], {
    encoding: 'utf8',
  });
  assert.equal(rejected.status, 1);
  assert.deepEqual(JSON.parse(rejected.stderr), { error: 'invalid_options' });
  assert.doesNotMatch(rejected.stdout + rejected.stderr, /SECRET_CLI_VALUE/);
  await assertAbsent(rejectedOutput);
});

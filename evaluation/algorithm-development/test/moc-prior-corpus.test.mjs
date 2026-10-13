import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { prepareAlgorithmDevelopmentCase } from '../runner.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createOwnedGitFixture } from '../../../tools/testing/owned-git-fixture.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const sourcePath = 'evaluation/algorithm-development/moc-prior-cases.json';
const rubricPath = 'evaluation/algorithm-development/moc-prior-rubric.json';
const note = readFileSync(join(root, 'docs/plans/moc-prior-natural-fixtures.md'), 'utf8');
const sourceBytes = readFileSync(join(root, sourcePath));
const rubricBytes = readFileSync(join(root, rubricPath));
const source = JSON.parse(sourceBytes);
const rubric = JSON.parse(rubricBytes);
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceHash = '4446a339c252f7b863a80c059048572c8a38f805561b4f898483d0b9ccf97aad';
const rubricHash = 'c0238c7755c94be8e849a698697a36524873cf1a7756cc8988c5a72341b9d7cf';
const ids = ['P01', 'P02', 'P03', 'P04'];
const families = [
  'narrow-topic-identity-location', 'dated-scope-handoff',
  'shared-topic-interference', 'explicitly-unresolved-choice',
];
const acknowledgments = [
  "I've noted those details.", 'Thanks for the update.',
  "I've recorded that distinction.", 'Understood.', "I've noted the arrangements.",
];

// Independently hand-reviewed conclusion-to-source proofs, not generated from
// the rubric or a retrieval result. Semantic validation remains human review.
const proofs = {
  P01: {
    conclusion: "The mobile puncture bench called Stitch is kept in alcove K beside the collective's east stair as of October 10.",
    passages: [
      ['P01-s3', 'Our mobile puncture bench is the cart tagged MP-7. When I say Stitch in our workshop notes, I mean that MP-7 cart.'],
      ['P01-s11', 'Facilities calls cart MP-7 the roaming bench on its floor plan.'],
      ['P01-s17', "I finished the October 6 move: the roaming bench is now in alcove K beside the collective's east stair. Its old south-porch parking spot is no longer used for it."],
    ],
  },
  P02: {
    conclusion: "Celia Mensah was the sign-off contact for Whisk's evening beginner welcome pack on September 8.",
    passages: [
      ['P02-s4', 'Whisk is our working name for the E8 evening beginner welcome pack. The pack covers joining instructions for enrolled E8 students.'],
      ['P02-s12', 'The E8 evening beginner welcome pack had Celia Mensah as sign-off contact through September 9 inclusive. Dario Sanz took over that same sign-off role on September 10; I wrote up the completed handoff on September 14.'],
    ],
  },
  P03: {
    conclusion: 'Lantern Lives currently uses 48 kHz stereo for public listening exports.',
    passages: [
      ['P03-s6', 'For Lantern Lives public listening exports, I use the profile Listening A. Archival masters use the separate profile Vault B.'],
      ['P03-s16', "Listening A is now 48 kHz stereo after today's September 22 switch. Until September 21 it was 44.1 kHz mono."],
    ],
  },
  P04: {
    conclusion: 'Saltbrook Pantry had not adopted a carrier for the winter Wednesday insulated-box route as of October 9; the requested final carrier choice remains unresolved.',
    passages: [
      ['P04-s13', 'The September 20 committee meeting deferred the winter Wednesday carrier choice. Neither proposal was accepted at that meeting.'],
      ['P04-s19', 'As of October 9, Saltbrook Pantry has not adopted a carrier for the winter Wednesday insulated-box route. Plover Parcel and Harbor Cart remain proposals; the next discussion is scheduled for October 14.'],
    ],
  },
};

function exactKeys(value, expected) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}
function nonempty(value) {
  assert.equal(typeof value, 'string');
  assert.ok(value.trim().length > 0 && value.isWellFormed());
  assert.ok(!value.includes('\0'));
}
function utcDate(value, event = false) {
  nonempty(value);
  assert.match(value, event
    ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u
    : /^\d{4}-\d{2}-\d{2}$/u);
  const iso = new Date(event ? value : value + 'T00:00:00Z').toISOString();
  assert.equal(event ? iso.replace('.000Z', 'Z') : iso.slice(0, 10), value);
}
function unicodeBoundary(text, offset) {
  assert.ok(Number.isSafeInteger(offset) && offset >= 0 && offset <= text.length);
  assert.ok(!(offset > 0 && offset < text.length
    && /[\uD800-\uDBFF]/u.test(text[offset - 1])
    && /[\uDC00-\uDFFF]/u.test(text[offset])), 'split Unicode code point');
}
function validateSource(rows) {
  assert.ok(Array.isArray(rows));
  assert.equal(rows.length, 4);
  const totals = [];
  for (const [index, row] of rows.entries()) {
    exactKeys(row, ['id', 'family', 'question', 'sessions']);
    assert.equal(row.id, ids[index]);
    assert.equal(row.family, families[index]);
    exactKeys(row.question, ['text', 'date']);
    nonempty(row.question.text);
    utcDate(row.question.date);
    assert.ok(Array.isArray(row.sessions));
    assert.equal(row.sessions.length, 19);
    let lastTime = '';
    let points = 0;
    for (const [sessionIndex, session] of row.sessions.entries()) {
      exactKeys(session, ['id', 'eventTime', 'messages']);
      assert.equal(session.id, row.id + '-s' + (sessionIndex + 1));
      utcDate(session.eventTime, true);
      assert.ok(session.eventTime > lastTime, 'strictly chronological sessions');
      assert.ok(session.eventTime.slice(0, 10) <= row.question.date, 'event after question');
      lastTime = session.eventTime;
      assert.ok(Array.isArray(session.messages));
      assert.equal(session.messages.length, 3);
      assert.deepEqual(session.messages.map(message => message.role), ['user', 'assistant', 'user']);
      for (const message of session.messages) {
        exactKeys(message, ['role', 'content']);
        nonempty(message.content);
        points += [...message.content].length;
        if (message.role === 'user') {
          assert.ok(message.content.length <= 800, 'user message UTF-16 limit');
          assert.notEqual(message.content, row.question.text, 'question-only noise');
          assert.doesNotMatch(message.content,
            /\b(?:memorize|admit|extract|file|classify)\b.{0,50}\b(?:facts|memories|cards|MOC|topic)\b/iu);
        } else {
          assert.ok(acknowledgments.includes(message.content), 'neutral acknowledgment only');
        }
      }
    }
    assert.ok(points <= 22000, row.id + ' source code point limit');
    totals.push(points);
  }
  return totals;
}
function objectReferences(value, refs = new Set()) {
  if (value && typeof value === 'object') {
    assert.ok(!refs.has(value), 'duplicate/cyclic object reference');
    refs.add(value);
    Object.values(value).forEach(child => objectReferences(child, refs));
  }
  return refs;
}
function validateRubric(rows, gold) {
  exactKeys(gold, ['version', 'spanOffsetUnit', 'abstentionSemantics', 'cases']);
  assert.equal(gold.version, 'moc-prior-natural-four-v1');
  assert.equal(gold.spanOffsetUnit, 'utf16-code-unit');
  exactKeys(gold.cases, ids);
  exactKeys(gold.abstentionSemantics, [
    'knownDefinite', 'knownRefusal', 'unresolvedQualified',
    'unclassifiable', 'definition', 'firstOutputPolicy',
  ]);
  assert.equal(gold.abstentionSemantics.knownDefinite, false);
  assert.equal(gold.abstentionSemantics.knownRefusal, true);
  assert.equal(gold.abstentionSemantics.unresolvedQualified, true);
  assert.equal(gold.abstentionSemantics.unclassifiable, null);
  nonempty(gold.abstentionSemantics.definition);
  nonempty(gold.abstentionSemantics.firstOutputPolicy);
  const sourceRefs = objectReferences(rows);
  for (const ref of objectReferences(gold)) assert.ok(!sourceRefs.has(ref), 'source/rubric reference overlap');
  let known = 0, unresolved = 0, anchors = 0;
  for (const row of rows) {
    const rule = gold.cases[row.id], proof = proofs[row.id];
    exactKeys(rule, [
      'answerability', 'requiredPropositions', 'acceptableQualifications', 'anchors',
      'propositionBindings', 'unsupportedClaims', 'staleUseCriteria', 'severeErrors', 'examples',
    ]);
    assert.equal(rule.answerability, row.id === 'P04' ? 'unresolved' : 'known');
    if (rule.answerability === 'known') known++; else unresolved++;
    for (const field of ['requiredPropositions', 'acceptableQualifications',
      'unsupportedClaims', 'staleUseCriteria', 'severeErrors']) {
      assert.ok(Array.isArray(rule[field]) && rule[field].length > 0);
      rule[field].forEach(nonempty);
    }
    assert.deepEqual(rule.requiredPropositions, [proof.conclusion], 'unbound/unreviewed conclusion');
    assert.ok(Array.isArray(rule.anchors) && rule.anchors.length >= 1 && rule.anchors.length <= 3);
    assert.equal(rule.anchors.length, proof.passages.length);
    const coords = new Set();
    for (const [anchorIndex, anchor] of rule.anchors.entries()) {
      exactKeys(anchor, ['sessionId', 'messageIndex', 'start', 'end', 'text']);
      assert.deepEqual([anchor.sessionId, anchor.text], proof.passages[anchorIndex], 'unreviewed support passage');
      assert.ok(Number.isSafeInteger(anchor.messageIndex));
      assert.equal(anchor.messageIndex, 0);
      const session = row.sessions.find(item => item.id === anchor.sessionId);
      assert.ok(session, 'anchor session missing');
      const message = session.messages[anchor.messageIndex];
      assert.equal(message.role, 'user');
      unicodeBoundary(message.content, anchor.start);
      unicodeBoundary(message.content, anchor.end);
      assert.ok(anchor.end > anchor.start);
      assert.equal(message.content.slice(anchor.start, anchor.end), anchor.text);
      const key = JSON.stringify([anchor.sessionId, anchor.messageIndex, anchor.start, anchor.end]);
      assert.ok(!coords.has(key), 'duplicate anchor');
      coords.add(key);
      anchors++;
    }
    assert.deepEqual(rule.propositionBindings, [{
      propositionIndex: 0, anchorIndices: proof.passages.map((_, index) => index),
    }], 'unbound or missing conclusion support');
    assert.ok(new Set(rule.anchors.map(anchor => anchor.sessionId)).size >= 2);
    exactKeys(rule.examples, ['conciseCorrect', 'explainedCorrect', 'incorrect', 'knownRefusal']);
    Object.values(rule.examples).forEach(nonempty);
    assert.notEqual(rule.examples.conciseCorrect, rule.examples.incorrect);
    assert.notEqual(rule.examples.explainedCorrect, rule.examples.incorrect);
  }
  assert.equal(known, 3);
  assert.equal(unresolved, 1);
  assert.equal(anchors, 9);
}
function validateManualReview(text) {
  assert.ok(text.includes('Manual source/proposition/bridge review: complete for all four cases and all 76 sessions.'));
  assert.ok(text.includes('Fixture validation is not model QA.'));
  assert.ok(text.includes(sourceHash) && text.includes(rubricHash));
  for (const id of ids) {
    assert.match(text, new RegExp('^\\| ' + id + ' \\|', 'm'));
    const match = text.match(new RegExp('^' + id + ' session assertion counts: ([\\d, ]+)\\.$', 'm'));
    assert.ok(match, 'missing session-level manual provenance review');
    const counts = match[1].split(',').map(Number);
    assert.equal(counts.length, 19);
    assert.ok(counts.every(count => Number.isInteger(count) && count >= 1 && count <= 5));
  }
}

test('literal fixture freeze and required manual review are present', () => {
  assert.equal(hash(sourceBytes), sourceHash);
  assert.equal(hash(rubricBytes), rubricHash);
  validateManualReview(note);
  assert.throws(() => validateManualReview(note.replace('P03 session assertion counts:', 'omitted:')));
});
test('source-only exact roster, chronological roles, message and source bounds', () => {
  const totals = validateSource(source);
  console.log('Four fresh development sources; code points ' + totals.join(', ') +
    '; 76 sessions, 228 messages; at most 95 admissions per store, not a target.');
});
test('separate evaluator proofs bind known3/unresolved1 to nine exact Unicode-safe source anchors', () => {
  validateRubric(source, rubric);
  assert.equal(rubric.cases.P03.anchors[1].start, 27);
  assert.equal(source[2].sessions[15].messages[0].content.codePointAt(0), 0x1f3a7);
  assert.throws(() => unicodeBoundary('🎧 settings', 1));
  unicodeBoundary('🎧 settings', 2);
});
test('source schema rejects gold leakage and malformed bounded history', () => {
  const locations = [row => row, row => row.question,
    row => row.sessions[0], row => row.sessions[0].messages[0]];
  for (const location of locations) {
    for (const field of ['anchors', 'requiredPropositions', 'examples', 'expectedAnswer', 'gold']) {
      const copy = structuredClone(source);
      location(copy[0])[field] = 'evaluator only';
      assert.throws(() => validateSource(copy));
    }
  }
  const mutations = [
    row => { row.sessions.pop(); },
    row => { row.sessions[0].messages[0].role = 'assistant'; },
    row => { row.sessions[0].eventTime = '2026-02-30T09:15:00Z'; },
    row => { row.sessions[0].eventTime = '2027-01-01T09:15:00Z'; },
    row => { row.sessions[1].eventTime = row.sessions[0].eventTime; },
    row => { row.sessions[0].messages[0].content = 'a'.repeat(801); },
    row => { row.sessions[0].messages[0].content = '\uD800'; },
    row => { row.sessions[0].messages[1].content = 'Harbor Cart was appointed.'; },
    row => { row.sessions[0].messages[0].content = row.question.text; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(source); mutate(copy[0]);
    assert.throws(() => validateSource(copy));
  }
  const oversized = structuredClone(source);
  for (const session of oversized[0].sessions) {
    session.messages[0].content = 'a'.repeat(800);
    session.messages[2].content = 'b'.repeat(800);
  }
  assert.throws(() => validateSource(oversized), /source code point limit/);
});
test('mutated anchors, invented conclusions and omitted binding or review are rejected', () => {
  const mutations = [
    rule => { rule.anchors[0].start++; },
    rule => { rule.anchors[0].text += ' invented'; },
    rule => { rule.anchors[0].sessionId = 'P02-s4'; },
    rule => { rule.anchors[0].messageIndex = 1; },
    rule => { rule.anchors[0].end = NaN; },
    rule => { rule.anchors.push(structuredClone(rule.anchors[0])); },
    rule => { rule.requiredPropositions[0] = 'The cart is in the upstairs cutting room.'; },
    rule => { rule.propositionBindings[0].anchorIndices = [0]; },
    rule => { rule.answerability = 'unresolved'; },
    rule => { rule.unreviewedField = true; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(rubric); mutate(copy.cases.P01);
    assert.throws(() => validateRubric(source, copy));
  }
  const crossed = structuredClone(rubric);
  crossed.cases.P01.anchors = source[0].sessions;
  assert.throws(() => validateRubric(source, crossed), /reference overlap/);
});
test('existing local indexed-evidence preparation yields exactly nineteen unmodified batches per case', () => {
  let batches = 0, turns = 0;
  for (const row of source) {
    const { plan } = prepareAlgorithmDevelopmentCase(row);
    assert.equal(plan.cairnPlan.executable, true);
    assert.equal(plan.cairnPlan.captureSourcePolicy, 'indexed-evidence-v1');
    assert.deepEqual(plan.cairnPlan.blockers, []);
    assert.equal(plan.cairnPlan.batches.length, 19);
    assert.equal(plan.cairnPlan.sourceTurns.length, 57);
    for (const [index, batch] of plan.cairnPlan.batches.entries()) {
      assert.equal(batch.source.sessionIndex, index);
      assert.equal(batch.source.sourceDate, row.sessions[index].eventTime.slice(0, 10) + ' 09:15');
      assert.equal(batch.captureInput.messages.length, 3);
      assert.equal(batch.normalizedCapture.messages.length, 3);
      assert.equal(batch.sourceMap.length, 3);
      assert.equal(batch.sourceWindowCatalog.semanticCoverage, 'unassessed');
      assert.deepEqual(batch.captureInput.messages.map(message => message.role), ['user', 'assistant', 'user']);
      row.sessions[index].messages.forEach((message, turn) => {
        const text = message.content.normalize('NFKC').replace(/\s+/gu, ' ').trim();
        assert.ok(batch.normalizedCapture.messages[turn].content.includes(text), 'unchanged prepared source opportunity');
        assert.equal(batch.sourceMap[turn].role, message.role);
        assert.equal(batch.sourceMap[turn].turnIndex, turn);
        assert.equal(batch.sourceMap[turn].chunkIndex, 0);
      });
      batches++;
      turns += batch.captureInput.messages.length;
    }
    for (const anchor of rubric.cases[row.id].anchors) {
      const index = row.sessions.findIndex(session => session.id === anchor.sessionId);
      assert.equal(anchor.text.normalize('NFKC'), anchor.text);
      assert.ok(plan.cairnPlan.batches[index].indexedWindows.some(window =>
        window.role === 'user' && window.messageIndex === anchor.messageIndex && window.content.includes(anchor.text)));
    }
  }
  assert.equal(batches, 76);
  assert.equal(turns, 228);
});
function currentEvaluationJsonInventory(repository, selected) {
  const git = args => execFileSync('/usr/bin/git', args, { cwd: repository, encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0' } });
  assert.equal(git(['ls-files', '-u', '-z', '--', 'evaluation']), '', 'unmerged evaluation index cannot prove corpus inventory');
  const files = git(['ls-files', '-z', '--', 'evaluation']).split('\0').filter(selected).sort();
  const current = new Set(git(['ls-tree', '-r', '--name-only', '-z', 'HEAD', '--', 'evaluation']).split('\0').filter(Boolean));
  const staged = git(['diff', '--cached', '--no-ext-diff', '--no-renames', '--name-status', '-z', 'HEAD', '--', 'evaluation']);
  if (staged) {
    const changes = staged.split('\0');
    assert.equal(changes.pop(), '', 'staged inventory is NUL terminated');
    assert.equal(changes.length % 2, 0, 'staged inventory has status/path pairs');
    for (let index = 0; index < changes.length; index += 2) {
      const status = changes[index], path = changes[index + 1];
      assert(['A', 'M', 'D', 'T'].includes(status) && path, 'unexpected staged inventory status/path');
      if (status === 'A') { assert(!current.has(path), 'staged addition already in HEAD'); current.add(path); }
      else if (status === 'D') assert(current.delete(path), 'staged deletion absent from HEAD');
      else assert(current.has(path), 'staged edit/type change absent from HEAD');
    }
  }
  const independent = [...current].filter(selected).sort();
  assert.equal(new Set(files).size, files.length, 'duplicate indexed paths');
  assert.deepEqual(files, independent, 'tracked corpus inventory disagreement');
  return files;
}
test('current indexed JSON inventory includes staged add delete rename-equivalent and NUL paths', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-moc-index-inventory-' });
  t.after(async () => { await workspace.cleanup(); assert.equal(existsSync(workspace.path), false);
    t.diagnostic('Owned corpus inventory workspace absent ' + workspace.path); });
  const fixture = createOwnedGitFixture(workspace), dir = fixture.path;
  const git = (args, input) => execFileSync('/usr/bin/git', ['-C', dir, ...args], { encoding: 'utf8', input,
    env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0',
      GIT_AUTHOR_NAME: 'Synthetic fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Synthetic fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' } });
  mkdirSync(join(dir, 'evaluation'), { mode: 0o700 });
  const historical = '{"source":"Wholly new synthetic inventory baseline."}\n';
  const unusual = 'evaluation/unchanged\trow\n.json';
  for (const path of ['evaluation/historical.json', 'evaluation/deleted.json', 'evaluation/rename old.json', 'evaluation/edit.json', unusual]) {
    writeFileSync(join(dir, path), historical, { mode: 0o600, flag: 'wx' });
  }
  writeFileSync(join(dir, 'outside.json'), historical, { mode: 0o600, flag: 'wx' });
  fixture.commit('Synthetic inventory baseline only');
  git(['config', '--local', 'diff.renames', 'true']);
  const renamed = 'evaluation/name\tnew\n.json';
  renameSync(join(dir, 'evaluation/rename old.json'), join(dir, renamed));
  // Preserve deleted bytes outside selection instead of destructively erasing.
  renameSync(join(dir, 'evaluation/deleted.json'), join(dir, 'deleted-retained.json'));
  writeFileSync(join(dir, 'evaluation/new.json'), '{"source":"Fresh staged-only synthetic inventory."}\n', { mode: 0o600, flag: 'wx' });
  writeFileSync(join(dir, 'evaluation/edit.json'), '{"source":"Synthetic staged edit."}\n');
  git(['add', '--all']);
  writeFileSync(join(dir, 'evaluation/untracked.json'), '{}\n', { mode: 0o600, flag: 'wx' });
  const selected = path => path.startsWith('evaluation/') && path.endsWith('.json');
  assert.deepEqual(currentEvaluationJsonInventory(dir, selected), ['evaluation/historical.json', 'evaluation/edit.json',
    unusual, renamed, 'evaluation/new.json'].sort());
  assert.equal(hash(readFileSync(join(dir, 'evaluation/historical.json'))), hash(historical));
  assert.equal(git(['show', 'HEAD:evaluation/historical.json']), historical);
  assert.equal(hash(sourceBytes), sourceHash); assert.equal(hash(rubricBytes), rubricHash);
  const oid = git(['rev-parse', 'HEAD:evaluation/historical.json']).trim();
  git(['update-index', '-z', '--index-info'], [1, 2, 3].map(stage => `100644 ${oid} ${stage}\tevaluation/conflict.json\0`).join(''));
  assert(git(['ls-files', '-u', '-z', '--', 'evaluation']).includes('evaluation/conflict.json'));
  assert.throws(() => currentEvaluationJsonInventory(dir, selected), /unmerged evaluation index/);
});
test('exact questions and user source messages are checked against every tracked prior evaluation JSON string', () => {
  // Broad JSON scan includes corpus, fixture, rubric and frozen result files.
  // This is an exact duplicate check within this checkout, not global novelty.
  const skip = new Set([sourcePath, rubricPath]);
  const selected = path => path.startsWith('evaluation/') && path.endsWith('.json') && !skip.has(path);
  const files = currentEvaluationJsonInventory(root, selected);
  const prior = new Set();
  const strings = value => {
    if (typeof value === 'string') prior.add(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(strings);
  };
  for (const path of files) strings(JSON.parse(readFileSync(join(root, path), 'utf8')));
  let userCount = 0, acknowledgmentMatches = 0;
  for (const row of source) {
    assert.ok(!prior.has(row.question.text), row.id + ' duplicate question');
    for (const session of row.sessions) for (const message of session.messages) {
      if (message.role === 'user') {
        assert.ok(!prior.has(message.content), row.id + ' duplicate user source');
        userCount++;
      } else if (prior.has(message.content)) acknowledgmentMatches++;
    }
  }
  assert.equal(userCount, 152);
  console.log('Cross-checked prior inventory by git ls-files and HEAD tree plus staged delta: ' + files.length +
    ' JSON files, ' + prior.size + ' unique strings; zero duplicate questions/user messages; ' +
    acknowledgmentMatches + ' neutral acknowledgment matches.');
});
test('owned nested runner cleans scratch after real successful and failing children', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-moc-fixture-lifecycle-' });
  const script = join(workspace.path, 'child.mjs');
  // Synthetic child only: neither provider nor runtime configuration is read.
  writeFileSync(script, "import {writeFileSync} from 'node:fs'; import {join} from 'node:path';\n" +
    "writeFileSync(join(process.env.TMPDIR, 'probe.txt'), 'synthetic'); process.exitCode = Number(process.argv[2]);\n");
  const env = { PATH: process.env.PATH, TMPDIR: workspace.path, TMP: workspace.path,
    TEMP: workspace.path, NODE_DISABLE_COMPILE_CACHE: '1' };
  for (const expected of [0, 1]) {
    const result = spawnSync(process.execPath, ['tools/testing/run.mjs', '--script', script, String(expected)], {
      cwd: root, env, encoding: 'utf8',
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, expected, result.stderr);
    assert.deepEqual(readdirSync(workspace.path), ['child.mjs'], 'owned runner residue');
  }
  await workspace.cleanup();
  assert.equal(existsSync(workspace.path), false);
});

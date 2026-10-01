// Private, opt-in observation only. This module has no execution or authority hooks.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { isMixedNativeFailure } from './mixed-native-failure-shape.mjs';
import { canonical, dense, exact, fail, freeze, hash, reportSnapshot,
  safeInteger, wellFormed } from './mixed-validation.mjs';

export const MIXED_RESULT_JOURNAL_VERSION = 'cairn-lme-mixed-result-journal-v1';
const RECORD_DOMAIN = 'cairn.lme.mixed.result-journal-record.v1';
const REPORT_DOMAIN = 'cairn.lme.mixed.result-journal-report.v1';
const GENERATION_DOMAIN = 'cairn.lme.mixed.generation-report.v1';
const MANIFEST_DOMAIN = 'cairn.lme.mixed.manifest.v1';
const ROSTER_DOMAIN = 'cairn.lme.mixed-source-pair.roster.v1';
const STATES = new WeakMap();
const CODE = 'invalid_mixed_result_journal';
const MAX_RECORD_BYTES = 40 * 1024 * 1024;
const PHASES = ['generation', 'scoring'];
const NAMES = ['cairn', 'mem0'];
const TYPES = ['single-session-user', 'single-session-assistant', 'single-session-preference',
  'multi-session', 'temporal-reasoning', 'knowledge-update'];
const SHA = /^[a-f0-9]{64}$/u;
const CASE = /^lme-case-[a-f0-9]{64}$/u;
const REASON = /^[a-z][a-z0-9_]{0,79}$/u;
const filename = seq => `${String(seq).padStart(6, '0')}.json`;
const same = (left, right) => canonical(left) === canonical(right);

function privateStat(info, directory) {
  if ((directory ? !info.isDirectory() : !info.isFile()) || info.isSymbolicLink()
    || info.uid !== process.getuid() || (info.mode & 0o777) !== (directory ? 0o700 : 0o600)) fail(CODE);
}

function checkedPath(directory) {
  if (process.platform === 'win32' || typeof process.getuid !== 'function'
    || !wellFormed(directory) || !path.isAbsolute(directory)
    || path.normalize(directory) !== directory || directory === path.parse(directory).root) fail(CODE);
  // Reject symlinks in every ancestor, including a symlinked parent.
  let current = path.dirname(directory);
  while (true) {
    const info = fs.lstatSync(current);
    if (!info.isDirectory() || info.isSymbolicLink()) fail(CODE);
    if (current === path.dirname(current)) break;
    current = path.dirname(current);
  }
  privateStat(fs.lstatSync(path.dirname(directory)), true);
  return directory;
}

function syncDirectory(directory, expected) {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY
    | fs.constants.O_NOFOLLOW);
  try {
    const info = fs.fstatSync(fd);
    privateStat(info, true);
    if (expected && (info.dev !== expected.dev || info.ino !== expected.ino)) fail(CODE);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
}

function validateManifest(manifest) {
  exact(manifest, ['sourceProtocolSha256', 'contextProtocolSha256', 'answerProtocolSha256',
    'scorerProtocolSha256', 'cairn', 'mem0'], CODE);
  for (const key of ['sourceProtocolSha256', 'contextProtocolSha256', 'answerProtocolSha256', 'scorerProtocolSha256']) {
    if (typeof manifest[key] !== 'string' || !SHA.test(manifest[key])) fail(CODE);
  }
  const cairn = manifest.cairn, mem0 = manifest.mem0;
  const evidence = Object.hasOwn(cairn ?? {}, 'comparisonProfile');
  exact(cairn, ['runtimeArtifactSha256', 'adapterConfigurationSha256', 'qualificationInputProfile',
    'captureSourcePolicy', ...(evidence ? ['comparisonProfile'] : [])], CODE);
  if (!SHA.test(cairn.runtimeArtifactSha256) || !SHA.test(cairn.adapterConfigurationSha256)
    || cairn.qualificationInputProfile !== (evidence ? 'not-requested' : 'adaptive-text-catalog-v1')
    || cairn.captureSourcePolicy !== (evidence ? 'indexed-evidence-v1' : 'indexed-windows-v1')
    || evidence && cairn.comparisonProfile !== 'indexed-evidence-v1') fail(CODE);
  exact(mem0, ['version', 'sourceTreeSha256', 'dependencyLockSha256', 'configurationSha256', 'wireProfile'], CODE);
  if (mem0.version !== '2.2.0' || ['sourceTreeSha256', 'dependencyLockSha256', 'configurationSha256']
    .some(key => typeof mem0[key] !== 'string' || !SHA.test(mem0[key]))) fail(CODE);
  const wire = mem0.wireProfile;
  exact(wire, ['version', 'chat', 'embedding'], CODE);
  if (wire.version !== 'mem0-text-wire-v1') fail(CODE);
  for (const kind of ['chat', 'embedding']) {
    const value = wire[kind];
    const numeric = ['maxInputTokens', 'maxOutputTokens', 'inputFramingTokens', 'maxRequestBytes',
      'maxResponseBytes', ...(kind === 'chat' ? ['reservedMicroUsd', 'maxFacts', 'maxFactTokens']
        : ['maxItemInputTokens', 'minimumReservedMicroUsd', 'dimensions', 'maxItems'])];
    exact(value, ['model', 'endpoint', 'encoding', 'inputPrice', 'outputPrice', ...numeric,
      ...(kind === 'embedding' ? ['encodingFormat'] : [])], CODE);
    if (numeric.some(key => !safeInteger(value[key]))
      || value.model !== (kind === 'chat' ? 'gpt-4.1-mini-2025-04-14' : 'text-embedding-3-small')
      || value.endpoint !== `https://api.openai.com/v1/${kind === 'chat' ? 'chat/completions' : 'embeddings'}`
      || value.encoding !== (kind === 'chat' ? 'o200k_base' : 'cl100k_base')
      || kind === 'embedding' && value.encodingFormat !== 'float') fail(CODE);
    for (const price of ['inputPrice', 'outputPrice']) {
      exact(value[price], ['microUsdNumerator', 'tokenDenominator'], CODE);
      if (!safeInteger(value[price].microUsdNumerator)
        || !safeInteger(value[price].tokenDenominator, 1)) fail(CODE);
    }
  }
}

function identityOf(prepared) {
  const { manifest, roster, counts } = reportSnapshot(prepared);
  validateManifest(manifest);
  dense(roster, 1, 250, CODE);
  if (!safeInteger(counts?.fixedN, 1) || counts.fixedN !== roster.length) fail(CODE);
  const seen = new Set();
  for (const row of roster) {
    exact(row, ['questionId', 'protocolDigest', 'armOrder', 'arms'], CODE);
    if (!CASE.test(row.questionId) || seen.has(row.questionId) || !SHA.test(row.protocolDigest)) fail(CODE);
    seen.add(row.questionId);
    dense(row.armOrder, 2, 2, CODE);
    dense(row.arms, 2, 2, CODE);
    if (NAMES.some(name => !row.armOrder.includes(name))) fail(CODE);
    for (const [index, arm] of row.arms.entries()) {
      exact(arm, ['name', 'scopeId'], CODE);
      if (arm.name !== NAMES[index] || !CASE.test(arm.scopeId)) fail(CODE);
    }
  }
  return { schemaVersion: MIXED_RESULT_JOURNAL_VERSION, manifest, roster,
    manifestDigest: hash(MANIFEST_DOMAIN, manifest), rosterDigest: hash(ROSTER_DOMAIN, roster),
    fixedN: counts.fixedN };
}

function expectedArms(identity) {
  return identity.roster.flatMap((row, caseIndex) => row.armOrder.map(name => ({
    caseIndex, questionId: row.questionId, name, state: 'unobserved', result: null, case: null })));
}

function stateOf(identity) {
  return { identity, seq: 0, previous: null, active: null,
    phases: Object.fromEntries(PHASES.map(phase => [phase,
      { started: false, arms: expectedArms(identity), completion: null }])) };
}

function validReason(value) {
  if (value !== null && (!wellFormed(value) || !REASON.test(value))) fail(CODE);
}
function validateArm(phase, arm, name) {
  exact(arm, phase === 'generation'
    ? ['name', 'status', 'reason', 'answer', 'scope', 'diagnostics']
    : ['name', 'generationStatus', 'judgment', 'scope'], CODE);
  if (arm.name !== name) fail(CODE);
  if (arm.scope !== null) {
    exact(arm.scope, ['ordinal', 'status', 'reason'], CODE);
    if (!safeInteger(arm.scope.ordinal) || !['active', 'completed', 'failed', 'blocked']
      .includes(arm.scope.status)) fail(CODE);
    validReason(arm.scope.reason);
  }
  if (phase === 'generation') {
    if (!['completed', 'failed', 'blocked'].includes(arm.status)
      || (arm.status === 'completed') !== (arm.answer !== null)
      || (arm.status === 'completed') !== (arm.reason === null)
      || arm.status === 'completed' && arm.scope?.status !== 'completed') fail(CODE);
    validReason(arm.reason);
    if (arm.answer !== null) {
      exact(arm.answer, ['text', 'usage'], CODE);
      exact(arm.answer.usage, ['inputTokens', 'outputTokens', 'costMicroUsd'], CODE);
      if (!wellFormed(arm.answer.text) || !arm.answer.text
        || Buffer.byteLength(arm.answer.text, 'utf8') > 32 * 1024
        || Object.values(arm.answer.usage).some(value => !safeInteger(value))) fail(CODE);
    }
    const allowed = ['stage', 'ingestion', 'modelDiagnostics', 'captureBatches', 'admittedMemories',
      'recalledCards', 'receiptCount', 'provenance', 'selectedIndices', 'duplicateIndices',
      'omittedIndices', 'attempts', 'nativeResults', 'verifiedAddRecords',
      'adapterPhaseTiming', 'recallWitness', 'nativeFailure'];
    if (!arm.diagnostics || typeof arm.diagnostics !== 'object' || Array.isArray(arm.diagnostics)
      || Object.keys(arm.diagnostics).some(key => !allowed.includes(key))) fail(CODE);
    if (Object.hasOwn(arm.diagnostics, 'nativeFailure') && (name !== 'mem0'
      || arm.status !== 'failed' || arm.diagnostics.stage !== 'execution'
      || !isMixedNativeFailure(arm.diagnostics.nativeFailure))) fail(CODE);
  } else {
    if (!['completed', 'failed', 'blocked'].includes(arm.generationStatus)) fail(CODE);
    exact(arm.judgment, ['status', 'correct', 'stage', 'reason', 'attempted'], CODE);
    const value = arm.judgment;
    if (!['resolved', 'unresolved'].includes(value.status)
      || (value.status === 'resolved' ? typeof value.correct !== 'boolean' : value.correct !== null)
      || (value.status === 'resolved') !== (value.reason === null)
      || !['generation', 'compatibility', 'judge'].includes(value.stage)
      || typeof value.attempted !== 'boolean'
      || value.status === 'resolved' && (arm.scope?.status !== 'completed'
        || value.stage !== 'judge' || value.attempted !== true)) fail(CODE);
    validReason(value.reason);
  }
}

function validateCase(phase, entry, questionId) {
  exact(entry, phase === 'generation' ? ['questionId', 'question', 'caseDigest', 'preflight']
    : ['questionId', 'questionType'], CODE);
  if (entry.questionId !== questionId) fail(CODE);
  if (phase === 'generation') {
    exact(entry.question, ['text', 'date'], CODE);
    exact(entry.preflight, ['status', 'reason'], CODE);
    if (!wellFormed(entry.question.text) || !entry.question.text || !wellFormed(entry.question.date)
      || !entry.question.date || !['ready', 'failed'].includes(entry.preflight.status)
      || (entry.preflight.status === 'ready') !== (entry.caseDigest !== null)
      || (entry.preflight.status === 'ready') !== (entry.preflight.reason === null)
      || entry.caseDigest !== null && !SHA.test(entry.caseDigest)) fail(CODE);
    validReason(entry.preflight.reason);
  } else if (!TYPES.includes(entry.questionType)) fail(CODE);
}

function validateSummary(report) {
  const bucket = arms => {
    const value = { correct: 0, incorrect: 0, unresolved: 0 };
    for (const arm of arms) value[arm.judgment.status === 'unresolved' ? 'unresolved'
      : arm.judgment.correct ? 'correct' : 'incorrect']++;
    const resolved = value.correct + value.incorrect;
    return { ...value, accuracyFixedN: arms.length ? value.correct / arms.length : null,
      accuracyResolved: resolved ? value.correct / resolved : null,
      resolvedFraction: arms.length ? resolved / arms.length : null };
  };
  const perArm = cases => Object.fromEntries(NAMES.map(name => [name,
    bucket(cases.map(entry => entry.arms.find(arm => arm.name === name)))]));
  const outcomes = ['correct', 'incorrect', 'unresolved'];
  const outcomeTable = Object.fromEntries(outcomes.map(left => [left,
    Object.fromEntries(outcomes.map(right => [right, 0]))]));
  let commonResolvedN = 0;
  for (const entry of report.cases) {
    const values = entry.arms.map(arm => arm.judgment.status === 'unresolved' ? 'unresolved'
      : arm.judgment.correct ? 'correct' : 'incorrect');
    outcomeTable[values[0]][values[1]]++;
    if (!values.includes('unresolved')) commonResolvedN++;
  }
  const byCategory = Object.fromEntries(TYPES.map(type => {
    const cases = report.cases.filter(entry => entry.questionType === type);
    return [type, { fixedN: cases.length, perArm: perArm(cases) }];
  }));
  if (!same(report.summary, { fixedN: report.cases.length, perArm: perArm(report.cases),
    commonResolvedN, outcomeTable, byCategory })) fail(CODE);
}

// Validate the observation stream on writes and offline reads using the same finite state machine.
function apply(state, type, data) {
  if (type === 'identity') {
    if (state.seq !== 0 || !same(data, state.identity)) fail(CODE);
    return;
  }
  const phase = data.phase;
  if (!PHASES.includes(phase)) fail(CODE);
  const view = state.phases[phase];
  if (type === 'phase_start') {
    exact(data, phase === 'generation' ? ['phase'] : ['phase', 'generationDigest'], CODE);
    if (view.started || state.active !== null || phase === 'scoring'
      && (!state.phases.generation.completion || data.generationDigest
        !== hash(GENERATION_DOMAIN, state.phases.generation.completion.report))) fail(CODE);
    if (phase === 'generation' && state.phases.scoring.started) fail(CODE);
    view.started = true; state.active = phase; return;
  }
  if (state.active !== phase || !view.started || view.completion !== null) fail(CODE);
  if (type === 'arm_enter' || type === 'arm_terminal') {
    exact(data, type === 'arm_enter' ? ['phase', 'ordinal'] : ['phase', 'ordinal', 'case', 'result'], CODE);
    if (!safeInteger(data.ordinal) || data.ordinal >= view.arms.length) fail(CODE);
    const arm = view.arms[data.ordinal];
    if (type === 'arm_enter') {
      if (arm.state !== 'unobserved' || data.ordinal > 0
        && view.arms[data.ordinal - 1].state !== 'terminal') fail(CODE);
      arm.state = 'entered';
    } else {
      if (arm.state !== 'entered') fail(CODE);
      validateCase(phase, data.case, arm.questionId);
      validateArm(phase, data.result, arm.name);
      const ordinal = data.ordinal + (phase === 'scoring' ? view.arms.length : 0);
      if (data.result.scope !== null && data.result.scope.ordinal !== ordinal) fail(CODE);
      arm.state = 'terminal'; arm.case = data.case; arm.result = data.result;
    }
    return;
  }
  if (type !== 'phase_complete') fail(CODE);
  exact(data, ['phase', 'report', 'reportDigest'], CODE);
  const report = data.report;
  exact(report, phase === 'generation'
    ? ['schemaVersion', 'manifest', 'roster', 'manifestDigest', 'rosterDigest', 'cases', 'halted', 'haltReason']
    : ['schemaVersion', 'generationDigest', 'cases', 'summary', 'halted', 'haltReason'], CODE);
  if (report.schemaVersion !== `cairn-lme-mixed-${phase}-v1`
    || typeof report.halted !== 'boolean' || report.halted !== (report.haltReason !== null)
    || data.reportDigest !== hash(REPORT_DOMAIN, report)
    || view.arms.some(arm => arm.state === 'entered')
    || !report.halted && view.arms.some(arm => arm.state !== 'terminal')) fail(CODE);
  validReason(report.haltReason);
  if (phase === 'generation') {
    if (!same(report.manifest, state.identity.manifest) || !same(report.roster, state.identity.roster)
      || report.manifestDigest !== state.identity.manifestDigest
      || report.rosterDigest !== state.identity.rosterDigest) fail(CODE);
  } else if (report.generationDigest !== hash(GENERATION_DOMAIN,
    state.phases.generation.completion.report) || report.summary?.fixedN !== state.identity.fixedN) fail(CODE);
  dense(report.cases, state.identity.fixedN, state.identity.fixedN, CODE);
  for (const arm of view.arms) {
    const entry = report.cases[arm.caseIndex];
    const { arms, ...metadata } = entry;
    validateCase(phase, metadata, arm.questionId);
    dense(arms, 2, 2, CODE);
    arms.forEach((value, index) => validateArm(phase, value, NAMES[index]));
    const result = arms.find(value => value.name === arm.name);
    if (arm.state === 'unobserved' && (result.scope !== null || (phase === 'generation'
      ? result.status !== 'blocked' || result.answer !== null
      : result.judgment.status !== 'unresolved' || result.judgment.attempted !== false))) fail(CODE);
    if (arm.state === 'terminal' && (!same(metadata, arm.case)
      || !same(result, arm.result))) fail(CODE);
  }
  if (phase === 'scoring') validateSummary(report);
  view.completion = { report, reportDigest: data.reportDigest }; state.active = null;
}

function publish(state, type, raw) {
  if (state.poisoned) fail('mixed_result_journal_failed');
  try {
    checkedPath(state.directory);
    const current = fs.lstatSync(state.directory);
    privateStat(current, true);
    if (current.dev !== state.directoryIdentity.dev || current.ino !== state.directoryIdentity.ino) fail(CODE);
    const data = reportSnapshot(raw);
    apply(state, type, data);
    const body = { schemaVersion: MIXED_RESULT_JOURNAL_VERSION, seq: state.seq,
      previous: state.previous, type, data };
    const record = { ...body, digest: hash(RECORD_DOMAIN, body) };
    const text = JSON.stringify(record) + '\n';
    if (Buffer.byteLength(text, 'utf8') > MAX_RECORD_BYTES) fail(CODE);
    const temporary = path.join(state.directory, `.pending-${randomUUID()}`);
    const fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT
      | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try { privateStat(fs.fstatSync(fd), false); fs.writeFileSync(fd, text); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    // link is atomic and fails on an existing committed filename; rename would overwrite.
    fs.linkSync(temporary, path.join(state.directory, filename(state.seq)));
    fs.unlinkSync(temporary);
    syncDirectory(state.directory, state.directoryIdentity);
    state.previous = record.digest; state.seq++;
  } catch { state.poisoned = true; fail('mixed_result_journal_failed'); }
}

export function createMixedResultJournal(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.getPrototypeOf(options) !== Object.prototype) fail(CODE);
  const descriptors = Object.getOwnPropertyDescriptors(options ?? {});
  if (Reflect.ownKeys(descriptors).length !== 2 || ['directory', 'prepared'].some(key =>
    !Object.hasOwn(descriptors, key) || !Object.hasOwn(descriptors[key], 'value'))) fail(CODE);
  const directory = descriptors.directory.value, prepared = descriptors.prepared.value;
  if (!prepared || typeof prepared !== 'object' || !Object.isFrozen(prepared)) fail(CODE);
  const identity = identityOf(prepared);
  try {
    checkedPath(directory);
    fs.mkdirSync(directory, { mode: 0o700 }); // Exclusive fresh directory; never adopt one.
    const directoryIdentity = fs.lstatSync(directory);
    privateStat(directoryIdentity, true);
    syncDirectory(path.dirname(directory));
    const state = { ...stateOf(identity), directory, directoryIdentity, prepared, poisoned: false };
    publish(state, 'identity', identity);
    const handle = Object.freeze({ schemaVersion: MIXED_RESULT_JOURNAL_VERSION });
    STATES.set(handle, state);
    return handle;
  } catch { fail(CODE); }
}

export function startMixedJournalPhase(handle, phase, input) {
  const state = STATES.get(handle);
  if (!state || state.poisoned || !PHASES.includes(phase)) fail(CODE);
  if (phase === 'generation' ? input !== state.prepared : input !== state.generationReport) {
    state.poisoned = true; fail(CODE);
  }
  publish(state, 'phase_start', phase === 'generation' ? { phase }
    : { phase, generationDigest: hash(GENERATION_DOMAIN, input) });
}
export function enterMixedJournalArm(handle, phase, ordinal) {
  const state = STATES.get(handle);
  if (!state) fail(CODE);
  publish(state, 'arm_enter', { phase, ordinal });
}
export function recordMixedJournalArm(handle, phase, ordinal, entry, result) {
  const state = STATES.get(handle);
  if (!state) fail(CODE);
  const { arms: _arms, ...metadata } = entry;
  publish(state, 'arm_terminal', { phase, ordinal, case: metadata, result });
}
export function completeMixedJournalPhase(handle, phase, report) {
  const state = STATES.get(handle);
  if (!state) fail(CODE);
  publish(state, 'phase_complete', { phase, report, reportDigest: hash(REPORT_DOMAIN, report) });
  if (phase === 'generation') state.generationReport = report;
}

export function inspectMixedResultJournal(options) {
  try {
    const input = reportSnapshot(options);
    exact(input, ['directory'], CODE);
    const directory = checkedPath(input.directory);
    privateStat(fs.lstatSync(directory), true);
    const names = fs.readdirSync(directory).sort();
    const committed = names.filter(name => /^\d{6}\.json$/u.test(name));
    if (!committed.length || names.length > 4 * 250 * 2 + 6
      || names.some(name => !committed.includes(name)
        && !/^\.pending-[a-f0-9-]{36}$/u.test(name))) fail(CODE);
    const pending = names.filter(name => !committed.includes(name));
    if (pending.length > 1) fail(CODE);
    for (const name of pending) privateStat(fs.lstatSync(path.join(directory, name)), false);
    let state;
    for (const [seq, name] of committed.entries()) {
      if (name !== filename(seq)) fail(CODE);
      const fd = fs.openSync(path.join(directory, name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      let raw;
      try {
        const info = fs.fstatSync(fd);
        privateStat(info, false);
        if (info.size > MAX_RECORD_BYTES) fail(CODE);
        raw = JSON.parse(fs.readFileSync(fd, 'utf8'));
      } finally { fs.closeSync(fd); }
      const record = reportSnapshot(raw);
      exact(record, ['schemaVersion', 'seq', 'previous', 'type', 'data', 'digest'], CODE);
      const { digest, ...body } = record;
      if (record.schemaVersion !== MIXED_RESULT_JOURNAL_VERSION || record.seq !== seq
        || digest !== hash(RECORD_DOMAIN, body)) fail(CODE);
      if (!state) {
        const value = record.data;
        exact(value, ['schemaVersion', 'manifest', 'roster', 'manifestDigest', 'rosterDigest', 'fixedN'], CODE);
        const identity = identityOf({ manifest: value.manifest, roster: value.roster,
          counts: { fixedN: value.fixedN } });
        if (record.type !== 'identity' || !same(value, identity)) fail(CODE);
        state = stateOf(identity);
      }
      if (record.previous !== state.previous) fail(CODE);
      apply(state, record.type, record.data);
      state.previous = digest; state.seq++;
    }
    // Individual records are already bounded detached snapshots. Do not charge
    // repeated terminal/completion observations against one phase report's cap.
    return freeze({ schemaVersion: MIXED_RESULT_JOURNAL_VERSION,
      identity: state.identity, phases: state.phases });
  } catch { fail(CODE); }
}

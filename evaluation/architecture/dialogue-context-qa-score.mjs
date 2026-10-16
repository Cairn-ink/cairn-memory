import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { captureSnapshot } from '../../core/capture-input.mjs';
import { sourceWindowCatalog } from '../../core/source-windows.mjs';
import { DIALOGUE_CONTEXT_ANSWER_INSTRUCTION } from './dialogue-context-qa.mjs';

const arms = ['baseline', 'candidate'], slots = ['left', 'right'];
const groups = ['consideration', 'explicit-adoption', 'rejection', 'factual-correction', 'observation', 'insufficient-information'];
const packetVersion = 'dialogue-context-qa-judging-v1';
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');
const bytes = text => Buffer.byteLength(text, 'utf8');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
// Returned packets already have this key order: ordinary pretty JSON + newline has this SHA.
const packetHash = packet => sha(JSON.stringify(canonical(packet), null, 2) + '\n');
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const text = value => typeof value === 'string' && value.isWellFormed() && value.trim().length > 0;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const same = (a, b, code) => { if (!isDeepStrictEqual(a, b)) fail(code); };
function shape(value, required, code, optional = []) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => ![...required, ...optional].includes(key))) fail(code);
}
function list(value, min, max, code) {
  if (!Array.isArray(value) || value.length < min || value.length > max ||
      Object.keys(value).length !== value.length || Array.from({ length: value.length }, (_, i) => i).some(i => !Object.hasOwn(value, i))) fail(code);
}
function unique(value, code) { if (new Set(value).size !== value.length) fail(code); }
function clone(value, code) { try { return structuredClone(value); } catch { fail(code); } }
const captureInput = source => ({ namespace: { ownerId: 'dialogue-context-qa', scope: 'personal', projectId: null },
  client: 'dialogue-context-qa', sessionId: `case-${source.id}`, eventId: `capture-${source.id}`,
  messages: source.messages.map((message, i) => ({ id: `source-${i}`, ...message })) });

function fixtureAndRubric(rawFixture, rawRubric) {
  const fixture = clone(rawFixture, 'invalid_fixture'), rubric = clone(rawRubric, 'invalid_rubric');
  shape(fixture, ['version', 'cases'], 'invalid_fixture');
  if (fixture.version !== 'dialogue-context-qa-v1') fail('invalid_fixture');
  list(fixture.cases, 24, 24, 'invalid_fixture'); unique(fixture.cases.map(row => row?.id), 'invalid_fixture');
  const snapshots = new Map();
  for (const row of fixture.cases) {
    shape(row, ['id', 'messages', 'question'], 'invalid_fixture');
    if (typeof row.id !== 'string' || !/^[0-9a-f]{12}$/u.test(row.id) || !text(row.question) || row.question.length > 300) fail('invalid_fixture');
    list(row.messages, 1, 6, 'invalid_fixture');
    for (const [i, message] of row.messages.entries()) {
      shape(message, ['role', 'content'], 'invalid_fixture');
      if (message.role !== (i % 2 ? 'assistant' : 'user') || !text(message.content) || message.content.length > 600) fail('invalid_fixture');
    }
    if (row.messages.reduce((n, message) => n + message.content.length, row.question.length) > 2200) fail('invalid_fixture');
    try {
      const snapshot = captureSnapshot(captureInput(row), undefined, 'indexed-evidence-v1');
      if (snapshot.messages.some(message => message.content.length > 600)) fail('invalid_fixture');
      snapshots.set(row.id, snapshot);
    } catch { fail('invalid_fixture'); }
  }
  shape(rubric, ['version', 'fixtureVersion', 'cases'], 'invalid_rubric');
  if (rubric.version !== 'dialogue-context-qa-rubric-v1' || rubric.fixtureVersion !== fixture.version) fail('invalid_rubric');
  list(rubric.cases, 24, 24, 'invalid_rubric'); unique(rubric.cases.map(row => row?.id), 'invalid_rubric');
  const rubricById = new Map(), groupCounts = Object.fromEntries(groups.map(group => [group, 0]));
  for (const row of rubric.cases) {
    shape(row, ['id', 'group', 'expectedAnswer', 'claims', 'forbiddenAssertions'], 'invalid_rubric');
    const source = fixture.cases.find(source => source.id === row.id);
    if (!source || !groups.includes(row.group) || !text(row.expectedAnswer)) fail('invalid_rubric');
    groupCounts[row.group]++;
    list(row.claims, 1, 100, 'invalid_rubric'); unique(row.claims.map(claim => claim?.id), 'invalid_rubric');
    for (const claim of row.claims) {
      shape(claim, ['id', 'text', 'decision', 'evidence'], 'invalid_rubric');
      if (!text(claim.id) || !text(claim.text) || typeof claim.decision !== 'boolean') fail('invalid_rubric');
      list(claim.evidence, row.group === 'insufficient-information' ? 0 : 1, 100, 'invalid_rubric');
      for (const span of claim.evidence) {
        shape(span, ['messageIndex', 'quote'], 'invalid_rubric');
        if (!integer(span.messageIndex) || !text(span.quote) || !source.messages[span.messageIndex]?.content.includes(span.quote)) fail('invalid_rubric');
      }
    }
    list(row.forbiddenAssertions, 0, 100, 'invalid_rubric');
    for (const forbidden of row.forbiddenAssertions) {
      shape(forbidden, ['text', 'severe'], 'invalid_rubric');
      if (!text(forbidden.text) || typeof forbidden.severe !== 'boolean') fail('invalid_rubric');
    }
    rubricById.set(row.id, row);
  }
  if (Object.values(groupCounts).some(count => count !== 4)) fail('invalid_rubric');
  return { fixture, rubricById, snapshots };
}

function orderedSources(resolution) {
  const result = new Map();
  for (const role of ['extractor-selected', 'dialogue-context']) for (const row of resolution.resolved) {
    if (row.provenanceRole === role && !result.has(row.windowIndex)) result.set(row.windowIndex, {
      sourceId: `window-${row.windowIndex}`, speaker: row.receipt.role, retentionRole: role, text: row.receipt.excerpt,
      receipt: row.receipt });
  }
  return [...result.values()];
}

function validateEvidence(arm, snapshot, catalog) {
  const code = 'invalid_report';
  if (arm.binding === null || arm.coldResolution === null) {
    if (arm.status === 'completed' || arm.packed !== null) fail(code);
    return [];
  }
  shape(arm.binding, ['sidecar', 'expectedDigest'], code);
  const sidecar = arm.binding.sidecar;
  if (typeof arm.binding.expectedDigest !== 'string' || sha(JSON.stringify(sidecar)) !== arm.binding.expectedDigest) fail(code);
  same(sidecar.namespace, snapshot.namespace, code);
  same(sidecar.capture, { client: snapshot.client, sessionId: snapshot.sessionId,
    eventId: snapshot.eventId, payloadDigest: snapshot.payloadDigest }, code);
  list(sidecar.entries, 0, 20, code);
  if (sidecar.sourceWindowCount !== catalog.entries.length) fail(code);
  same(arm.capture?.value?.sourceWindowCatalog, catalog.coverage.sourceWindowCatalog, code);
  const admitted = arm.capture?.ok && arm.capture.value?.admission?.memories;
  list(admitted, 0, 5, code); unique(admitted.map(row => row?.id), code);
  const revisions = new Map(admitted.map(row => [row.id, row.revision]));
  for (const row of arm.capture.value.classification?.memoryRevisions ?? []) revisions.set(row.memoryId, row.revision);
  list(sidecar.memories, 0, 5, code); unique(sidecar.memories.map(row => row?.memoryId), code);
  if (sidecar.memories.length !== admitted.length || sidecar.memories.some(row =>
    revisions.get(row.memoryId) !== row.revision || !integer(row.receiptCount))) fail(code);
  shape(arm.coldResolution, ['resolved', 'rejected'], code);
  list(arm.coldResolution.resolved, 0, 20, code); list(arm.coldResolution.rejected, 0, 20, code);
  if (arm.coldResolution.rejected.length) {
    if (arm.status === 'completed' || arm.packed !== null) fail(code);
    return []; // Explicit failed binding is not valid retained evidence.
  }
  if (arm.coldResolution.resolved.length !== sidecar.entries.length) fail(code);
  const seen = new Set();
  for (const row of arm.coldResolution.resolved) {
    shape(row, ['itemIndex', 'windowIndex', 'provenanceRole', 'memoryId', 'revision', 'receipt'], code);
    shape(row.receipt, ['id', 'role', 'excerpt', 'client', 'sessionId', 'eventId'], code);
    const key = JSON.stringify([row.itemIndex, row.windowIndex, row.memoryId, row.receipt.id]);
    if (seen.has(key)) fail(code); seen.add(key);
    const bound = sidecar.entries.filter(entry => entry.itemIndex === row.itemIndex && entry.windowIndex === row.windowIndex &&
      entry.memoryId === row.memoryId && entry.receiptId === row.receipt.id);
    if (bound.length !== 1 || !integer(row.itemIndex) || row.itemIndex > 4 || !integer(row.windowIndex) || row.windowIndex > 63 ||
        !text(row.memoryId) || !integer(row.revision) || row.revision < 1 ||
        revisions.get(row.memoryId) !== row.revision ||
        !['extractor-selected', 'dialogue-context'].includes(row.provenanceRole)) fail(code);
    const entry = bound[0], receipt = row.receipt;
    const message = snapshot.messages.find(message => message.id === receipt.eventId);
    const window = catalog.entries[row.windowIndex];
    if (!window || window.id !== receipt.eventId || window.messageIndex !== entry.messageIndex ||
        window.start !== entry.start || window.end !== entry.end || window.content !== receipt.excerpt || window.role !== receipt.role ||
        !message || !text(receipt.id) || receipt.client !== snapshot.client || receipt.sessionId !== snapshot.sessionId ||
        receipt.role !== message.role || entry.messageIndex !== snapshot.messages.indexOf(message) ||
        !integer(entry.start) || !integer(entry.end) || entry.start >= entry.end || entry.end > message.content.length ||
        message.content.slice(entry.start, entry.end) !== receipt.excerpt || entry.revision !== row.revision ||
        entry.provenanceRole !== row.provenanceRole ||
        sha(receipt.excerpt) !== entry.receiptContentDigest ||
        sha(JSON.stringify([receipt.client, receipt.sessionId, receipt.eventId, receipt.role, receipt.excerpt])) !== entry.receiptIdentityDigest) fail(code);
  }
  for (const memory of sidecar.memories) {
    const receiptIds = arm.coldResolution.resolved.filter(row => row.memoryId === memory.memoryId).map(row => row.receipt.id);
    if (new Set(receiptIds).size !== memory.receiptCount) fail(code);
  }
  const sources = orderedSources(arm.coldResolution);
  for (const source of sources) {
    const matching = arm.coldResolution.resolved.filter(row => `window-${row.windowIndex}` === source.sourceId);
    if (matching.some(row => row.receipt.eventId !== source.receipt.eventId || row.receipt.role !== source.speaker || row.receipt.excerpt !== source.text)) fail(code);
  }
  return sources;
}

function validateReport(raw, data) {
  const report = clone(raw, 'invalid_report'), code = 'invalid_report';
  shape(report, ['status', 'reason', 'rows', 'counts', 'caseCount', 'completedArms', 'failedArms', 'notRunArms', 'durationMs'], code);
  if (!['completed', 'stopped'].includes(report.status) || (report.status === 'completed' ? report.reason !== null : !text(report.reason)) ||
      report.caseCount !== 24 || !Number.isFinite(report.durationMs) || report.durationMs < 0) fail(code);
  list(report.rows, 24, 24, code); unique(report.rows.map(row => row?.id), code);
  const evidence = new Map(), totals = { completedArms: 0, failedArms: 0, notRunArms: 0 };
  const calls = { extract: 0, classify: 0, answer: 0, replays: 0 };
  for (const [i, row] of report.rows.entries()) {
    shape(row, ['id', 'order', 'sharedExtraction', 'baseline', 'candidate'], code, ['durationMs']);
    if (row.id !== data.fixture.cases[i].id) fail(code);
    same(row.order, i % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'], code);
    const snapshot = data.snapshots.get(row.id), catalog = sourceWindowCatalog(snapshot), byArm = {};
    if (!integer(row.sharedExtraction?.replays) || row.sharedExtraction.replays > 1) fail(code);
    calls.replays += row.sharedExtraction.replays;
    for (const armName of arms) {
      const arm = row[armName];
      shape(arm, ['status', 'reason', 'failedPhase', 'capture', 'transformedOutput', 'binding', 'coldResolution',
        'packed', 'answer', 'answerOutput', 'classificationOutput', 'cleanupCompleted', 'modelCalls', 'durations'], code);
      if (!['completed', 'failed', 'not-run'].includes(arm.status) || typeof arm.cleanupCompleted !== 'boolean') fail(code);
      totals[arm.status === 'completed' ? 'completedArms' : arm.status === 'failed' ? 'failedArms' : 'notRunArms']++;
      shape(arm.modelCalls, ['extract', 'classify', 'answer'], code);
      for (const phase of ['extract', 'classify', 'answer']) {
        if (!integer(arm.modelCalls[phase]) || arm.modelCalls[phase] > 1) fail(code);
        calls[phase] += arm.modelCalls[phase];
      }
      if (arm.status === 'completed') {
        if (arm.reason !== null || arm.failedPhase !== null || !arm.cleanupCompleted || !text(arm.answer) ||
            !arm.capture?.ok || arm.capture.value?.duplicate !== false ||
            !['applied', 'skipped'].includes(arm.capture.value.classification?.status) || arm.modelCalls.answer !== 1) fail(code);
        same(arm.answerOutput, { answer: arm.answer }, code);
      } else if (arm.status === 'not-run') {
        if (arm.reason !== null || arm.failedPhase !== null || !arm.cleanupCompleted ||
            ['capture', 'transformedOutput', 'binding', 'coldResolution', 'packed', 'answer', 'answerOutput', 'classificationOutput'].some(key => arm[key] !== null) ||
            Object.values(arm.modelCalls).some(count => count !== 0)) fail(code);
      } else if (!text(arm.reason) || !text(arm.failedPhase) || (arm.answer !== null && !text(arm.answer))) fail(code);
      const retained = validateEvidence(arm, snapshot, catalog);
      if (armName === 'baseline' && retained.some(source => source.retentionRole !== 'extractor-selected')) fail(code);
      let packed = [];
      if (arm.packed !== null) {
        const value = arm.packed;
        shape(value, ['request', 'includedIds', 'omittedIds', 'includedBytes', 'omittedBytes', 'includedCount', 'omittedCount',
          'retainedCount', 'retainedBytes', 'inputTokens'], code);
        shape(value.request, ['system', 'input', 'maxOutputTokens'], code);
        shape(value.request.input, ['sources', 'question'], code);
        if (value.request.system !== DIALOGUE_CONTEXT_ANSWER_INSTRUCTION || value.request.maxOutputTokens !== 512 ||
            value.request.input.question !== data.fixture.cases[i].question || !integer(value.inputTokens) || value.inputTokens > 4000) fail(code);
        list(value.request.input.sources, 0, 20, code); list(value.includedIds, 0, 20, code); list(value.omittedIds, 0, 20, code);
        unique([...value.includedIds, ...value.omittedIds], code);
        const expectedPacked = retained.filter(source => value.includedIds.includes(source.sourceId));
        same(value.includedIds, expectedPacked.map(source => source.sourceId), code);
        same(value.omittedIds, retained.filter(source => !value.includedIds.includes(source.sourceId)).map(source => source.sourceId), code);
        packed = value.request.input.sources;
        same(packed, expectedPacked.map(({ receipt, ...source }) => source), code);
        const includedBytes = packed.reduce((n, source) => n + bytes(source.text), 0);
        const retainedBytes = retained.reduce((n, source) => n + bytes(source.text), 0);
        same([value.includedCount, value.omittedCount, value.retainedCount, value.includedBytes, value.omittedBytes, value.retainedBytes],
          [packed.length, retained.length - packed.length, retained.length, includedBytes, retainedBytes - includedBytes, retainedBytes], code);
      } else if (arm.status === 'completed') fail(code);
      byArm[armName] = { retained, packed: packed.map(source => retained.find(row => row.sourceId === source.sourceId)) };
    }
    if (row.baseline.modelCalls.extract + row.candidate.modelCalls.extract > 1) fail(code);
    if (row.baseline.coldResolution && row.candidate.coldResolution &&
        !row.baseline.coldResolution.rejected.length && !row.candidate.coldResolution.rejected.length) {
      const anchors = arm => arm.coldResolution.resolved.filter(entry => entry.provenanceRole === 'extractor-selected')
        .map(entry => [entry.itemIndex, entry.windowIndex, entry.receipt.eventId, entry.receipt.role, entry.receipt.excerpt]);
      same(anchors(row.baseline), anchors(row.candidate), code);
    }
    evidence.set(row.id, byArm);
  }
  same(report.counts, calls, code);
  for (const [key, value] of Object.entries(totals)) if (report[key] !== value) fail(code);
  if (report.status === 'completed' && report.notRunArms !== 0) fail(code);
  return { report, evidence };
}

function preparation({ fixture, rubric, report, seed }) {
  if (typeof seed !== 'string' || !/^[0-9a-f]{64}$/iu.test(seed)) fail('invalid_seed');
  seed = seed.toLowerCase();
  const data = fixtureAndRubric(fixture, rubric), validated = validateReport(report, data);
  const pairs = [], mapping = [];
  for (const source of data.fixture.cases) {
    const reference = data.rubricById.get(source.id), row = validated.report.rows.find(row => row.id === source.id);
    const pairId = `pair-${sha(`${seed}:pair:${source.id}`).slice(0, 24)}`;
    const order = parseInt(sha(`${seed}:slots:${source.id}`).slice(0, 2), 16) % 2 ? [...arms].reverse() : arms;
    pairs.push({ pairId, dialogue: source.messages, question: source.question,
      insufficientInformation: reference.group === 'insufficient-information',
      requiredClaims: reference.claims.map(({ id, ...claim }) => ({ claimId: id, ...claim })),
      illustrativeAnswer: reference.expectedAnswer, forbiddenExamples: reference.forbiddenAssertions,
      slots: slots.map((slot, i) => ({ slot, status: row[order[i]].status,
        answer: row[order[i]].answer, sources: row[order[i]].packed?.request.input.sources ?? [] })) });
    mapping.push({ pairId, caseId: source.id, slots: Object.fromEntries(slots.map((slot, i) => [slot, order[i]])) });
  }
  pairs.sort((a, b) => sha(`${seed}:order:${a.pairId}`).localeCompare(sha(`${seed}:order:${b.pairId}`)));
  const packet = canonical({ version: packetVersion, pairs }), packetSha256 = packetHash(packet);
  const key = canonical({ version: 'dialogue-context-qa-mask-key-v1', packetSha256,
    pairs: packet.pairs.map(pair => mapping.find(row => row.pairId === pair.pairId)) });
  return { packet, key, packetSha256, data, ...validated };
}

/** Pure label masking, not guaranteed intervention blindness. Key is never part of the packet. */
export function createDialogueContextJudgingPacket(options) {
  const { packet, key, packetSha256 } = preparation(options);
  return { packet, key, packetSha256 };
}

/** Validate a complete masked adjudication; semantic equivalence remains the raters' responsibility. */
export function validateDialogueContextJudgments(rawPacket, rawJudgments) {
  const packet = clone(rawPacket, 'invalid_packet'), judgments = clone(rawJudgments, 'invalid_judgments');
  const code = 'invalid_judgments';
  shape(packet, ['version', 'pairs'], 'invalid_packet');
  if (packet.version !== packetVersion) fail('invalid_packet');
  list(packet.pairs, 24, 24, 'invalid_packet'); unique(packet.pairs.map(pair => pair?.pairId), 'invalid_packet');
  shape(judgments, ['packetSha256', 'pairs'], code);
  if (judgments.packetSha256 !== packetHash(packet)) fail(code);
  list(judgments.pairs, 24, 24, code); unique(judgments.pairs.map(row => row?.pairId), code);
  for (const pair of packet.pairs) {
    shape(pair, ['pairId', 'dialogue', 'question', 'insufficientInformation', 'requiredClaims', 'illustrativeAnswer', 'forbiddenExamples', 'slots'], 'invalid_packet');
    if (!text(pair.pairId) || typeof pair.insufficientInformation !== 'boolean' || !text(pair.question) || !text(pair.illustrativeAnswer)) fail('invalid_packet');
    list(pair.dialogue, 1, 6, 'invalid_packet');
    for (const [i, message] of pair.dialogue.entries()) {
      shape(message, ['role', 'content'], 'invalid_packet');
      if (message.role !== (i % 2 ? 'assistant' : 'user') || !text(message.content)) fail('invalid_packet');
    }
    list(pair.requiredClaims, 1, 100, 'invalid_packet'); unique(pair.requiredClaims.map(claim => claim?.claimId), 'invalid_packet');
    for (const claim of pair.requiredClaims) {
      shape(claim, ['claimId', 'text', 'decision', 'evidence'], 'invalid_packet');
      if (!text(claim.claimId) || !text(claim.text) || typeof claim.decision !== 'boolean') fail('invalid_packet');
      list(claim.evidence, pair.insufficientInformation ? 0 : 1, 100, 'invalid_packet');
      for (const span of claim.evidence) {
        shape(span, ['messageIndex', 'quote'], 'invalid_packet');
        if (!integer(span.messageIndex) || !text(span.quote) || !pair.dialogue[span.messageIndex]?.content.includes(span.quote)) fail('invalid_packet');
      }
    }
    list(pair.forbiddenExamples, 0, 100, 'invalid_packet');
    for (const forbidden of pair.forbiddenExamples) {
      shape(forbidden, ['text', 'severe'], 'invalid_packet');
      if (!text(forbidden.text) || typeof forbidden.severe !== 'boolean') fail('invalid_packet');
    }
    list(pair.slots, 2, 2, 'invalid_packet'); same(pair.slots.map(slot => slot.slot), slots, 'invalid_packet');
    for (const slot of pair.slots) {
      shape(slot, ['slot', 'status', 'answer', 'sources'], 'invalid_packet');
      if (!['completed', 'failed', 'not-run'].includes(slot.status) ||
          (slot.status === 'completed' ? !text(slot.answer) : slot.answer !== null && !text(slot.answer))) fail('invalid_packet');
      list(slot.sources, 0, 20, 'invalid_packet'); unique(slot.sources.map(source => source?.sourceId), 'invalid_packet');
      for (const source of slot.sources) {
        shape(source, ['sourceId', 'speaker', 'retentionRole', 'text'], 'invalid_packet');
        if (typeof source.sourceId !== 'string' || !/^window-\d+$/u.test(source.sourceId) ||
            !['user', 'assistant'].includes(source.speaker) || !['extractor-selected', 'dialogue-context'].includes(source.retentionRole) || !text(source.text)) fail('invalid_packet');
      }
    }
    const judged = judgments.pairs.find(row => row.pairId === pair.pairId);
    shape(judged, ['pairId', 'slots', 'issues', 'resolved', 'reason'], code);
    if (!text(judged.reason) || typeof judged.resolved !== 'boolean') fail(code);
    list(judged.slots, 2, 2, code); unique(judged.slots.map(slot => slot?.slot), code);
    for (const actual of pair.slots) {
      const slot = judged.slots.find(slot => slot.slot === actual.slot);
      shape(slot, ['slot', 'claims'], code); list(slot.claims, pair.requiredClaims.length, pair.requiredClaims.length, code);
      unique(slot.claims.map(claim => claim?.claimId), code);
      for (const expected of pair.requiredClaims) {
        const claim = slot.claims.find(claim => claim.claimId === expected.claimId);
        shape(claim, ['claimId', 'correct', 'supported', 'sourceIds', 'reason'], code);
        if (![true, false, null].includes(claim.correct) || ![true, false, null].includes(claim.supported) ||
            (claim.supported === true && claim.correct !== true) || !text(claim.reason)) fail(code);
        list(claim.sourceIds, 0, actual.sources.length, code); unique(claim.sourceIds, code);
        if (claim.sourceIds.some(id => !actual.sources.some(source => source.sourceId === id)) ||
            (!pair.insufficientInformation && claim.correct === true && claim.supported === true && !claim.sourceIds.length) ||
            (actual.status !== 'completed' && (claim.correct !== false || claim.supported !== false))) fail(code);
      }
    }
    list(judged.issues, 0, 100, code); unique(judged.issues.map(issue => issue?.issueId), code);
    for (const issue of judged.issues) {
      shape(issue, ['issueId', 'meaning', 'occurrences'], code);
      if (!text(issue.issueId) || !text(issue.meaning)) fail(code);
      list(issue.occurrences, 1, 2, code); unique(issue.occurrences.map(row => row?.slot), code);
      for (const occurrence of issue.occurrences) {
        shape(occurrence, ['slot', 'answerQuote', 'unsupported', 'severe', 'stale', 'reason'], code);
        const actual = pair.slots.find(slot => slot.slot === occurrence.slot);
        if (!actual || !text(occurrence.answerQuote) || !actual.answer?.includes(occurrence.answerQuote) || !text(occurrence.reason) ||
            ['unsupported', 'severe', 'stale'].some(flag => typeof occurrence[flag] !== 'boolean') ||
            !['unsupported', 'severe', 'stale'].some(flag => occurrence[flag])) fail(code);
      }
    }
  }
  return judgments;
}

function coverage(reference, sources) {
  const claims = reference.claims.filter(claim => claim.evidence.every(span => sources.some(source =>
    source.receipt.eventId === `source-${span.messageIndex}` && source.text.includes(span.quote))));
  return { claims: claims.length, fullCase: claims.length === reference.claims.length,
    bytes: sources.reduce((n, source) => n + bytes(source.text), 0) };
}

/** Aggregate supplied judgments only; exact quote coverage is not semantic answer verification. */
export function scoreDialogueContextQa(options) {
  const prepared = preparation(options);
  const judgments = validateDialogueContextJudgments(prepared.packet, options.judgments);
  const result = { version: 'dialogue-context-qa-score-v1', packetSha256: prepared.packetSha256,
    semanticAuthority: 'supplied-judgments-only', primaryStructuralAuditRequired: true,
    denominators: { cases: 24, claims: 0, positiveCases: 20, positiveClaims: 0, insufficientCases: 4 },
    gains: [], regressions: [], completionLosses: [], lostDecisions: [], newIssues: [], unresolved: [], rows: [] };
  for (const arm of arms) result[arm] = { completed: 0, failed: 0, notRun: 0, supportedAnswers: 0, wrongAnswers: 0,
    unresolvedAnswers: 0, correctClaims: 0, supportedClaims: 0, incorrectClaims: 0, unresolvedClaims: 0,
    issues: { unsupported: 0, severe: 0, stale: 0, occurrences: 0 }, sourceBytes: { retained: 0, packed: 0 },
    coverage: { retained: { claims: 0, fullCases: 0, bytes: 0 }, packed: { claims: 0, fullCases: 0, bytes: 0 } } };
  for (const source of prepared.data.fixture.cases) {
    const reference = prepared.data.rubricById.get(source.id), report = prepared.report.rows.find(row => row.id === source.id);
    const key = prepared.key.pairs.find(row => row.caseId === source.id);
    const judged = judgments.pairs.find(row => row.pairId === key.pairId), row = { id: source.id };
    if (!judged.resolved) result.unresolved.push({ caseId: source.id, kind: 'pair', reason: judged.reason });
    result.denominators.claims += reference.claims.length;
    if (reference.group !== 'insufficient-information') result.denominators.positiveClaims += reference.claims.length;
    for (const arm of arms) {
      const slot = slots.find(slot => key.slots[slot] === arm), claims = judged.slots.find(row => row.slot === slot).claims;
      const issues = judged.issues.flatMap(issue => issue.occurrences.filter(occurrence => occurrence.slot === slot));
      const completed = report[arm].status === 'completed', summary = result[arm];
      const unresolved = claims.filter(claim => claim.correct === null || claim.supported === null);
      const supportedAnswer = completed && judged.resolved && claims.every(claim => claim.correct === true && claim.supported === true) && !issues.length;
      row[arm] = { status: report[arm].status, supportedAnswer, claims, issues, coverage: {} };
      summary[completed ? 'completed' : report[arm].status === 'failed' ? 'failed' : 'notRun']++;
      if (supportedAnswer) summary.supportedAnswers++;
      else if (completed && (!judged.resolved || (unresolved.length && !issues.length && claims.every(claim => claim.correct !== false && claim.supported !== false)))) summary.unresolvedAnswers++;
      else if (completed) summary.wrongAnswers++;
      if (completed) {
        summary.correctClaims += claims.filter(claim => claim.correct === true).length;
        summary.supportedClaims += claims.filter(claim => claim.correct === true && claim.supported === true).length;
        summary.incorrectClaims += claims.filter(claim => claim.correct === false).length;
      }
      summary.unresolvedClaims += unresolved.length;
      for (const claim of unresolved) result.unresolved.push({ caseId: source.id, kind: 'claim', arm, claimId: claim.claimId,
        fields: ['correct', 'supported'].filter(field => claim[field] === null) });
      for (const issue of issues) {
        summary.issues.occurrences++;
        for (const flag of ['unsupported', 'severe', 'stale']) if (issue[flag]) summary.issues[flag]++;
      }
      const evidence = prepared.evidence.get(source.id)[arm];
      for (const phase of ['retained', 'packed']) {
        summary.sourceBytes[phase] += evidence[phase].reduce((n, source) => n + bytes(source.text), 0);
        if (reference.group === 'insufficient-information') continue;
        const measured = coverage(reference, evidence[phase]); row[arm].coverage[phase] = measured;
        summary.coverage[phase].claims += measured.claims;
        summary.coverage[phase].fullCases += Number(measured.fullCase);
        summary.coverage[phase].bytes += measured.bytes;
      }
    }
    if (!row.baseline.supportedAnswer && row.candidate.supportedAnswer) result.gains.push(source.id);
    if (row.baseline.supportedAnswer && !row.candidate.supportedAnswer) result.regressions.push(source.id);
    if (row.baseline.status === 'completed' && row.candidate.status !== 'completed') result.completionLosses.push(source.id);
    for (const claim of reference.claims.filter(claim => claim.decision)) {
      const baseline = row.baseline.claims.find(row => row.claimId === claim.id), candidate = row.candidate.claims.find(row => row.claimId === claim.id);
      if (row.baseline.status === 'completed' && baseline.correct === true && baseline.supported === true &&
          (row.candidate.status !== 'completed' || candidate.correct !== true || candidate.supported !== true)) {
        result.lostDecisions.push({ caseId: source.id, claimId: claim.id });
      }
    }
    const slotFor = arm => slots.find(slot => key.slots[slot] === arm);
    for (const issue of judged.issues) {
      const baseline = issue.occurrences.find(row => row.slot === slotFor('baseline'));
      const candidate = issue.occurrences.find(row => row.slot === slotFor('candidate'));
      const flags = ['unsupported', 'severe', 'stale'].filter(flag => candidate?.[flag] && !baseline?.[flag]);
      if (flags.length) result.newIssues.push({ caseId: source.id, issueId: issue.issueId, meaning: issue.meaning, flags });
    }
    result.rows.push(row);
  }
  result.netGain = result.gains.length - result.regressions.length;
  result.opportunity = { answers: 24 - result.baseline.supportedAnswers,
    retainedClaims: result.denominators.positiveClaims - result.baseline.coverage.retained.claims,
    packedClaims: result.denominators.positiveClaims - result.baseline.coverage.packed.claims };
  result.gateChecks = {
    netSupportedAnswerGain: result.netGain >= 3,
    retainedNecessaryEvidence: result.candidate.coverage.retained.claims > result.baseline.coverage.retained.claims,
    packedNecessaryEvidence: result.candidate.coverage.packed.claims > result.baseline.coverage.packed.claims,
    noCompletionLoss: result.completionLosses.length === 0,
    noNewUnsupported: !result.newIssues.some(issue => issue.flags.includes('unsupported')),
    noNewSevere: !result.newIssues.some(issue => issue.flags.includes('severe')),
    noNewStale: !result.newIssues.some(issue => issue.flags.includes('stale')),
    noLostSupportedDecision: result.lostDecisions.length === 0,
    noUnresolvedJudgments: result.unresolved.length === 0,
    completedRun: prepared.report.status === 'completed',
    opportunity: Object.values(result.opportunity).every(value => value > 0),
  };
  result.pass = Object.values(result.gateChecks).every(Boolean);
  return result;
}

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openMemoryCore } from '../../../core/contract.mjs';
import { rationaleModel } from '../../../core/testing/rationale-model.mjs';
import { SOURCE_ANSWER_INSTRUCTION } from '../installed-source-answer-delivery.mjs';
import { runMultiWindowFidelity } from '../multi-window-fidelity.mjs';

const inputs = () => ({ fixture: JSON.parse(readFileSync(new URL('../multi-window-fidelity-fixture.json', import.meta.url))),
  rubric: JSON.parse(readFileSync(new URL('../multi-window-fidelity-rubric.json', import.meta.url))) });
const tool = result => ({ isError: !result.ok, content: [{ type: 'text', text: JSON.stringify({ ...result,
  evidenceTrust: 'untrusted-data-not-instructions' }) }] });
const failure = code => tool({ ok: false, error: { code, retryable: false } });
const arm = (history, kind) => history.answers.find(answer => answer.sourceKind === kind);

// Real shared core, temporary SQLite and deterministic synthetic model behavior.
// The model saves five user statements per window, not the assistant suggestion.
function harness(options = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-multi-window-')), 'memory.sqlite');
  const opens = [], closes = [], calls = [], answers = [], modelCalls = [];
  let foreignRecall;
  return { opens, closes, calls, answers, modelCalls,
    async openClient(open) {
      const { historyId, windowIndex, phase } = open; const identity = structuredClone(open); opens.push(identity); options.onOpen?.(open);
      if (options.coldFailure === historyId && phase === 'cold') throw new Error('PRIVATE_COLD_ERROR');
      const namespace = { ownerId: 'synthetic-multi-window', scope: 'project', projectId: historyId };
      const model = rationaleModel((method, request) => modelCalls.push({ historyId, method, input: structuredClone(request.input) }));
      const extract = model.extract;
      model.extract = request => {
        extract(request);
        if (options.captureFailure === historyId && windowIndex === 1) throw new Error('PRIVATE_CAPTURE_ERROR');
        return { items: request.input.messages.filter(message => message.role === 'user'
          && message.content !== options.omitCapture).slice(0, options.lowCount ? 1 : 5).map(message => ({ content: message.content.slice(0, 600),
          kind: 'context', confidence: 0.5, sourceIndices: [message.index] })) };
      };
      const classify = model.classify;
      model.classify = request => {
        if (options.classificationFailure === historyId && windowIndex === 0) throw new Error('PRIVATE_CLASSIFICATION_ERROR');
        return classify(request);
      };
      const select = model.select;
      model.select = request => {
        select(request);
        return { refs: request.input.maps.flatMap(map => map.items.filter(item => item.type === 'unfiled')
          .sort((a, b) => Number(Boolean(options.omitRecall && b.label?.includes(options.omitRecall.slice(0, 80))))
            - Number(Boolean(options.omitRecall && a.label?.includes(options.omitRecall.slice(0, 80)))))
          .slice(0, 12).map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref })))
          .slice(0, request.input.maxRefs ?? 12) };
      };
      const rank = model.rank;
      model.rank = request => {
        rank(request);
        return { refs: request.input.candidates.filter(candidate => !candidate.receipts.some(receipt => receipt.excerpt === options.omitRecall))
          .slice(0, request.input.limit).map(candidate => ({ namespaceIndex: candidate.namespaceIndex,
            memoryId: candidate.memory.id, revision: candidate.memory.revision })) };
      };
      const core = openMemoryCore({ path, model, captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1' });
      return { async callTool(request) {
        const { name, arguments: args } = request; calls.push({ historyId, windowIndex, phase, ...structuredClone(request) });
        let result;
        if (name === 'capture_memory') {
          result = tool(await core.capture({ namespace, client: 'cairn-local-mcp', sessionId: 'submitted-capture', eventId: args.batchId,
            messages: args.messages.map((message, index) => ({ ...message,
              id: createHash('sha256').update(JSON.stringify(['cairn.mcp.submitted-message.v1', args.batchId, index])).digest('hex') })) }));
          if (options.mutate) args.messages[0].content = 'MUTATED_CAPTURE';
        } else if (name === 'inspect_capture_evidence') {
          result = tool(core.inspectCaptureEvidence({ namespace, client: 'cairn-local-mcp', eventId: args.batchId }));
          if (options.oversizedSource === historyId) result.content[0].text = 'PRIVATE_OVERSIZED_SOURCE'.repeat(15000);
        } else if (name === 'inspect_memory') {
          const tamper = options.inspectTamper?.historyId === historyId ? options.inspectTamper.mode : null;
          const requestArgs = { ...args };
          if (tamper === 'list-cursor') delete requestArgs.cursor;
          if (tamper === 'receipt-cursor') delete requestArgs.receiptCursor;
          const inspected = args.memoryId ? core.get({ namespace, ...requestArgs }) : core.list({ namespace, ...requestArgs });
          if (inspected.ok && tamper) {
            const value = inspected.value;
            if (!args.memoryId && tamper === 'list-cursor') { value.nextCursor = 'repeat-list-cursor'; value.exhausted = false;
              if (args.cursor) value.memories = []; }
            if (!args.memoryId && tamper === 'listed-id') value.memories.push(structuredClone(value.memories[0]));
            if (args.memoryId && tamper === 'revision') value.memory.revision++;
            if (args.memoryId && tamper === 'receipt-text') value.receipts[0].excerpt = 'FOREIGN_TAMPERED_SOURCE';
            if (args.memoryId && tamper === 'receipt-cursor') { value.nextReceiptCursor = 'repeat-receipt-cursor'; value.exhausted = false;
              if (args.receiptCursor) value.receipts = []; }
            if (args.memoryId && tamper === 'receipt-id') value.receipts.push(structuredClone(value.receipts[0]));
          }
          result = tool(inspected);
        }
        else if (name === 'read_memory_sources') {
          const snapshot = core.sourceSnapshot({ readSet: [namespace], ...args });
          if (options.partialSnapshot === historyId) snapshot.value = { sources: [{ content: 'PRIVATE_PARTIAL_SNAPSHOT' }] };
          result = tool(snapshot);
        }
        else if (name === 'recall_memory') {
          if (options.recallFailure === historyId) return failure('synthetic_recall_failure');
          const recalled = await core.recall({ readSet: [namespace], query: args.query, limit: args.limit, contextMode: args.contextMode });
          if (options.partialRecall === historyId && recalled.ok) recalled.value.coverage = 'budget_exhausted';
          result = tool(recalled);
          if (options.foreignRecall) { if (foreignRecall) return structuredClone(foreignRecall); foreignRecall = structuredClone(result); }
        } else throw new Error('unexpected_tool');
        return result;
      }, async close() {
        closes.push(structuredClone(identity)); core.close();
        if (options.closeFailure === historyId && phase === 'cold') throw new Error('PRIVATE_CLOSE_ERROR');
      } };
    },
    async answer(input) {
      answers.push(structuredClone(input));
      if (options.answerFailure && input.sourceKind === 'retrieved') throw new Error('PRIVATE_ANSWER_ERROR');
      if (options.mutate) { input.question = 'MUTATED_QUESTION'; input.instructions = 'MUTATED_INSTRUCTION';
        if (input.sources[0]) input.sources[0].content = 'MUTATED_SOURCE'; }
      return 'Synthetic answer retained without semantic assessment.';
    } };
}

function denominators(report) {
  assert.equal(report.histories.length, 6); assert.equal(report.histories.flatMap(history => history.captures).length, 18);
  assert.equal(report.histories.flatMap(history => history.answers).length, 12);
  assert.equal(report.semanticStatus, 'unassessed');
}

test('actual fifteen-memory histories exceed snapshot cap while bounded recall and twelve unassessed answer slots remain distinct', async () => {
  const data = inputs(), h = harness(); const report = await runMultiWindowFidelity({ ...data, openClient: h.openClient, answer: h.answer });
  denominators(report); assert.equal(h.answers.length, 12); assert.equal(new Set(report.histories.map(history => history.pairId)).size, 3);
  for (const [index, history] of report.histories.entries()) {
    assert.equal(history.activeAdmittedCount, 15); assert.equal(history.beyondSnapshotCap, true);
    assert.deepEqual(history.captures.map(capture => capture.status), ['completed', 'completed', 'completed']);
    assert.equal(history.snapshot.status, 'failed'); assert.equal(history.snapshot.error.code, 'context_item_too_large');
    assert.equal(history.snapshot.boundary, 'expected_over_cap_rejection'); assert.equal(history.snapshot.coverage, null);
    assert.equal(Object.hasOwn(history.snapshot, 'sources'), false);
    assert.equal(history.recall.status, 'completed'); assert.ok(history.recall.sources.length <= 6);
    assert.deepEqual(history.answerOrder, index % 2 ? ['canonical-control', 'retrieved'] : ['retrieved', 'canonical-control']);
    assert.ok(history.answers.every(answer => answer.status === 'completed' && answer.semanticStatus === 'unassessed'));
    const requests = h.calls.filter(call => call.historyId === history.id);
    assert.equal(requests.filter(call => call.name === 'capture_memory').length, 3);
    assert.equal(requests.filter(call => call.name === 'read_memory_sources').length, 1);
    assert.equal(requests.find(call => call.name === 'read_memory_sources').arguments.limit, 12);
    assert.equal(requests.filter(call => call.name === 'recall_memory').length, 1);
  }
  assert.deepEqual(h.closes, h.opens);
  assert.ok(h.answers.every(answer => answer.instructions === SOURCE_ANSWER_INSTRUCTION));
  assert.deepEqual(h.answers.map(answer => answer.sourceKind), report.histories.flatMap(history => history.answerOrder));
  for (let index = 0; index < h.answers.length; index += 2) assert.equal(h.answers[index].question, h.answers[index + 1].question);
  const callbackData = JSON.stringify({ opens: h.opens, calls: h.calls, answers: h.answers, models: h.modelCalls });
  for (const field of ['pairId', 'requiredSourceIds', 'irrelevantSourceIds', 'qualifierSourceId', 'qualifierQuote', 'expectedCommitment', 'actor', 'reason', 'temporalLimit']) {
    assert.equal(callbackData.includes(`"${field}"`), false);
  }
});

test('mid-history capture failure preserves eighteen capture slots, does not retry or rescue recall from staged source', async () => {
  const data = inputs(), id = data.fixture.histories[0].id, h = harness({ captureFailure: id });
  const report = await runMultiWindowFidelity({ ...data, openClient: h.openClient, answer: h.answer }); denominators(report);
  const failed = report.histories[0]; assert.deepEqual(failed.captures.map(capture => capture.status), ['completed', 'failed', 'not_run']);
  assert.equal(failed.activeAdmittedCount, null); assert.equal(failed.beyondSnapshotCap, null);
  assert.equal(failed.recall.status, 'not_run'); assert.equal(arm(failed, 'retrieved').status, 'not_run');
  assert.equal(arm(failed, 'canonical-control').status, 'completed'); assert.equal(h.answers.length, 11);
  assert.equal(h.calls.filter(call => call.historyId === id && call.name === 'capture_memory').length, 2);
  assert.equal(JSON.stringify(report).includes('PRIVATE_CAPTURE_ERROR'), false);
});

test('actual under-cap admission is reported without padding or claiming the beyond-cap challenge', async () => {
  const h = harness({ lowCount: true });
  const report = await runMultiWindowFidelity({ ...inputs(), openClient: h.openClient, answer: h.answer }); denominators(report);
  for (const history of report.histories) {
    assert.equal(history.activeAdmittedCount, 3); assert.equal(history.beyondSnapshotCap, false);
    assert.equal(history.snapshot.status, 'completed'); assert.equal(history.snapshot.boundary, 'within_cap');
    assert.ok(history.captures[2].admitted.coverage.missingSourceIds.length > 0);
  }
  assert.equal(h.calls.filter(call => call.name === 'capture_memory').length, 18);
});

test('failed snapshot carrying partial source payload cannot be labeled an expected clean cap rejection', async () => {
  const data = inputs(), h = harness({ partialSnapshot: data.fixture.histories[0].id });
  const report = await runMultiWindowFidelity({ ...data, openClient: h.openClient, answer: h.answer }); denominators(report);
  const history = report.histories[0]; assert.equal(history.activeAdmittedCount, 15);
  assert.equal(history.snapshot.boundary, 'unexpected'); assert.equal(history.snapshot.status, 'failed');
  assert.equal(history.snapshot.coverage, null); assert.equal(history.recall.status, 'completed');
  assert.equal(JSON.stringify(report).includes('PRIVATE_PARTIAL_SNAPSHOT'), false);
});

test('classification failure keeps admitted sources and later captures while remaining an explicit error', async () => {
  const data = inputs(), h = harness({ classificationFailure: data.fixture.histories[0].id });
  const report = await runMultiWindowFidelity({ ...data, openClient: h.openClient, answer: h.answer }); denominators(report);
  const history = report.histories[0]; assert.equal(history.captures[0].capture.classification.status, 'failed');
  assert.deepEqual(history.captures.map(capture => capture.status), ['completed', 'completed', 'completed']);
  assert.equal(history.activeAdmittedCount, 15); assert.equal(h.answers.length, 12);
  assert.equal(report.status, 'observed-with-failures'); assert.equal(JSON.stringify(report).includes('PRIVATE_CLASSIFICATION_ERROR'), false);
});

test('cold-open and close failures halt later windows and preserve control-only outcome without raw errors', async () => {
  for (const option of ['coldFailure', 'closeFailure']) {
    const data = inputs(), id = data.fixture.histories[0].id, h = harness({ [option]: id });
    const report = await runMultiWindowFidelity({ ...data, openClient: h.openClient, answer: h.answer }); denominators(report);
    const history = report.histories[0]; assert.ok(history.errors.length > 0);
    assert.equal(history.activeAdmittedCount, null); assert.equal(history.beyondSnapshotCap, null);
    assert.deepEqual(history.captures.slice(1).map(capture => capture.status), ['not_run', 'not_run']);
    assert.equal(arm(history, 'retrieved').status, 'not_run'); assert.equal(arm(history, 'canonical-control').status, 'completed');
    assert.equal(h.calls.filter(call => call.historyId === id && call.name === 'capture_memory').length, 1);
    assert.equal(JSON.stringify(report).includes('PRIVATE_'), false);
  }
});

test('failed and partial recall or answer failure preserve answer denominators without extra attempts', async () => {
  for (const options of ['recallFailure', 'partialRecall', 'answerFailure']) {
    const data = inputs(), h = harness({ [options]: options === 'answerFailure' ? true : data.fixture.histories[0].id });
    const report = await runMultiWindowFidelity({ ...data, openClient: h.openClient, answer: h.answer }); denominators(report);
    const history = report.histories[0]; assert.equal(arm(history, 'canonical-control').status, 'completed');
    assert.equal(arm(history, 'retrieved').status, options === 'answerFailure' ? 'failed' : 'not_run');
    assert.equal(h.calls.filter(call => call.name === 'recall_memory').length, 6);
    assert.equal(JSON.stringify(report).includes('PRIVATE_ANSWER_ERROR'), false); assert.deepEqual(h.closes, h.opens);
  }
});

test('foreign recalled projections and oversized source responses never count as validated evidence', async () => {
  const data = inputs(), foreign = harness({ foreignRecall: true });
  const report = await runMultiWindowFidelity({ ...data, openClient: foreign.openClient, answer: foreign.answer }); denominators(report);
  for (const history of report.histories.slice(1)) { assert.equal(history.recall.status, 'failed'); assert.equal(arm(history, 'retrieved').status, 'not_run'); }
  const oversized = harness({ oversizedSource: data.fixture.histories[0].id });
  const rejected = await runMultiWindowFidelity({ ...data, openClient: oversized.openClient, answer: oversized.answer }); denominators(rejected);
  assert.equal(rejected.histories[0].captures[0].staged.status, 'failed');
  assert.equal(JSON.stringify(rejected).includes('PRIVATE_OVERSIZED_SOURCE'), false);
  assert.equal(arm(rejected.histories[0], 'retrieved').status, 'not_run');
});

test('bounded inspection rejects repeated pages, duplicate identities, changed revisions and noncanonical receipt text', async () => {
  for (const mode of ['list-cursor', 'listed-id', 'revision', 'receipt-text', 'receipt-cursor', 'receipt-id']) {
    const data = inputs(), historyId = data.fixture.histories[0].id, h = harness({ inspectTamper: { historyId, mode } });
    const report = await runMultiWindowFidelity({ ...data, openClient: h.openClient, answer: h.answer }); denominators(report);
    const history = report.histories[0]; assert.equal(history.captures[0].admitted.status, 'failed', mode);
    assert.equal(history.captures[0].admitted.coverage, null, mode);
    assert.deepEqual(history.captures.slice(1).map(capture => capture.status), ['not_run', 'not_run'], mode);
    assert.equal(arm(history, 'retrieved').status, 'not_run', mode);
    assert.equal(history.recall.status, 'not_run', mode); assert.equal(history.activeAdmittedCount, null, mode);
    const inspected = h.calls.filter(call => call.historyId === historyId && call.name === 'inspect_memory');
    assert.ok(inspected.filter(call => !call.arguments.memoryId).length <= 3, mode);
    assert.ok(inspected.filter(call => call.arguments.memoryId).length <= 2, mode);
    if (mode === 'list-cursor') assert.equal(inspected.filter(call => !call.arguments.memoryId).length, 2);
    if (mode === 'receipt-cursor') assert.equal(inspected.filter(call => call.arguments.memoryId).length, 2);
    assert.equal(JSON.stringify(report).includes('FOREIGN_TAMPERED_SOURCE'), false, mode);
  }
});

test('capture versus recall omission remains localized by exact decisive-source coverage', async () => {
  for (const option of ['omitCapture', 'omitRecall']) {
    const data = inputs(), history = data.fixture.histories[0];
    const decisive = history.windows[1][4], h = harness({ [option]: decisive.content });
    const report = await runMultiWindowFidelity({ ...data, openClient: h.openClient, answer: h.answer }); denominators(report);
    const result = report.histories[0]; assert.equal(result.captures[1].staged.coverage.qualifierPresent, true);
    assert.equal(result.captures[2].admitted.coverage.qualifierPresent, option !== 'omitCapture');
    assert.equal(result.recall.coverage.qualifierPresent, false);
    if (option === 'omitRecall') assert.ok(h.modelCalls.filter(call => call.historyId === history.id && call.method === 'rank')
      .some(call => call.input.candidates.some(candidate => candidate.receipts.some(receipt => receipt.excerpt === decisive.content))),
    'The omitted qualifier must reach ranking before the scripted ranker removes it');
    assert.equal(result.activeAdmittedCount, option === 'omitCapture' ? 14 : 15);
    assert.equal(arm(result, 'canonical-control').status, 'completed');
  }
});

test('malformed fixture, foreign source labels and oversized messages reject before callbacks', async () => {
  const changes = [
    data => { data.fixture.histories.pop(); },
    data => { data.fixture.histories[0].windows[0].pop(); },
    data => { data.fixture.histories[0].windows[0][0].content = 'x'.repeat(801); },
    data => { data.fixture.histories[0].windows[0][0].role = 'system'; },
    data => { data.fixture.histories[0].windows[0][1].id = data.fixture.histories[0].windows[0][0].id; },
    data => {
      const old = data.fixture.histories[1].windows[0][0].id, duplicate = data.fixture.histories[0].windows[0][0].id;
      data.fixture.histories[1].windows[0][0].id = duplicate;
      for (const field of ['requiredSourceIds', 'irrelevantSourceIds']) data.rubric.histories[1][field] =
        data.rubric.histories[1][field].map(id => id === old ? duplicate : id);
    },
    data => { data.rubric.id = 'foreign'; },
    data => { data.rubric.histories[0].expectedCommitment = 'unknown'; },
    data => { data.rubric.histories[0].expectedCommitment = data.rubric.histories[1].expectedCommitment; },
    data => { data.rubric.histories[0].requiredSourceIds = [data.fixture.histories[1].windows[0][0].id]; },
    data => { data.rubric.histories[0].irrelevantSourceIds = [...data.rubric.histories[0].requiredSourceIds]; },
    data => { data.rubric.histories[0].qualifierSourceId = data.fixture.histories[0].windows[0][0].id;
      data.rubric.histories[0].qualifierQuote = data.fixture.histories[0].windows[0][0].content; },
  ];
  for (const change of changes) {
    const data = inputs(); change(data); let called = 0;
    await assert.rejects(runMultiWindowFidelity({ ...data, openClient: () => { called++; }, answer: () => { called++; } }));
    assert.equal(called, 0);
  }
});

test('callback mutations cannot alter frozen later windows, rubric decisions or complete canonical controls', async () => {
  const data = inputs(), original = structuredClone(data); let mutated = false;
  const h = harness({ mutate: true, onOpen: open => {
    open.historyId = 'MUTATED_OPEN';
    if (!mutated) { mutated = true; data.fixture.histories[0].windows[2][0].content = 'MUTATED_LATE_WINDOW';
      data.rubric.histories[0].qualifierQuote = 'MUTATED_RUBRIC'; }
  } });
  const report = await runMultiWindowFidelity({ ...data, openClient: h.openClient, answer: h.answer }); denominators(report);
  assert.equal(h.answers.length, 12); assert.equal(JSON.stringify(report).includes('MUTATED_'), false);
  assert.equal(JSON.stringify(h.answers).includes('MUTATED_'), false);
  assert.deepEqual(h.answers.filter(answer => answer.sourceKind === 'canonical-control').map(answer => answer.sources),
    original.fixture.histories.map(history => history.windows.flat()));
  assert.ok(h.answers.every(answer => answer.instructions === SOURCE_ANSWER_INSTRUCTION));
});

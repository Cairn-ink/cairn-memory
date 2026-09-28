import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeModel, interpretation, interpretationInput, request, envelope, setup, captureInput, ok, ns } from './openai-episodes.mjs';
import { DEFAULT_MODEL, EXPERIMENTAL_EXTRACTION_MODEL, LUNA_EXTRACTION_MODEL, SOL_RATIONALE_MODEL } from '../profiles.mjs';
import { callModel } from '../../../core/model-call.mjs';
import { episodeSchemasFor } from '../schemas.mjs';

test('E3 interpretation has no default; explicit profiles select only the new port', async () => {
  const absent = fakeModel({ episodeModel: undefined });
  assert.equal(absent.model.interpretEpisode, undefined);
  assert.equal(absent.model.episodeMetadata, undefined);
  assert.equal(absent.calls.length, 0);
  for (const episodeModel of [DEFAULT_MODEL, EXPERIMENTAL_EXTRACTION_MODEL, LUNA_EXTRACTION_MODEL, SOL_RATIONALE_MODEL]) {
    const f = fakeModel({ episodeModel });
    assert.deepEqual(await f.model.interpretEpisode(request()), interpretation());
    assert.equal(f.model.episodeMetadata.model, episodeModel);
    assert.equal(f.calls.length, 2);
    const [count, generation] = f.calls.map(call => call.payload);
    assert.equal(count.model, episodeModel);
    const { max_output_tokens, store, stream, ...shared } = generation;
    assert.deepEqual(shared, count);
    assert.equal(max_output_tokens, 1024); assert.equal(store, false); assert.equal(stream, false);
    assert.equal(count.truncation, 'disabled');
    assert.equal(count.reasoning?.effort, episodeModel === DEFAULT_MODEL ? undefined : 'none');
    assert.deepEqual(f.diagnostics, []);
  }
  assert.throws(() => fakeModel({ episodeModel: 'unknown' }), /invalid_openai_configuration/);
  assert.throws(() => fakeModel({ episodeModel: null }), /invalid_openai_configuration/);
});

test('E1/E2 detached source-only interpretation, language and explicit step-reference transport', async () => {
  for (const language of ['en', 'zh-Hant', 'mixed']) for (const action of [null, 'completed', 'cancelled', 'replaced']) {
    const input = interpretationInput();
    input.prior.nextStep = { value: 'Review', stepRef: 'prior-next-step', anchors: [{ sourceIndex: 0, start: 0, end: 2 }] };
    const result = interpretation(input); result.language = language;
    if (action) result.disposition = { stepRef: 'prior-next-step', action, anchors: result.gist.anchors };
    if (action === 'replaced') result.nextStep = { ...result.gist, value: 'Review again' };
    const f = fakeModel({ transport: ({ url, payload }) => {
      if (url.endsWith('/input_tokens')) {
        input.sources[0].text = 'changed during count';
        input.prior.nextStep.stepRef = 'forged';
        return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
      }
      return Response.json(envelope(payload.model, result));
    } });
    assert.deepEqual(await f.model.interpretEpisode(request('interpret-episode', input)), result);
    assert.equal(f.calls[0].payload.input[0].content[0].text, f.calls[1].payload.input[0].content[0].text);
    assert.equal(f.calls[0].signal, f.calls[1].signal);
    assert.equal(JSON.stringify(f.calls).includes('private-session'), false);
  }
});

const malformed = [
  value => { delete value.gist; }, value => { value.extra = true; },
  value => { value.type = null; }, value => { value.type.value = 'other'; },
  value => { value.language = '中文'; }, value => { value.language = 'en-' + 'x'.repeat(34); },
  value => { value.gist.value = 'x'.repeat(401); }, value => { value.gist.value = '\ud800'; },
  value => { value.gist.value = ' '; }, value => { value.gist.value = 'ﬃ'.repeat(134); },
  value => { value.gist.anchors = []; }, value => { value.gist.anchors = Array(5).fill(value.type.anchors[0]); },
  value => { value.gist.anchors[0].sourceIndex = 99; }, value => { value.gist.anchors[0].end = 800; },
  value => { value.gist.anchors[0].end = 0; }, value => { value.gist.anchors[0].end = 23; },
  value => { value.outcome = { ...value.gist, value: 'x'.repeat(241) }; },
  value => { value.disposition = { stepRef: 'forged', action: 'completed', anchors: value.gist.anchors }; },
];
test('E2/E4 partial, foreign, Unicode and over-limit interpretations are typed and diagnosed', async () => {
  for (const mutate of malformed) {
    const output = interpretation(); mutate(output);
    const f = fakeModel({ respond: () => output });
    await assert.rejects(callModel(f.model, 'interpretEpisode', request().system, interpretationInput(),
      { failureCode: 'episode_failed' }), { code: 'invalid_model_output' });
    assert.equal(f.calls.length, 2);
    assert.deepEqual(f.diagnostics, [
      { version: 1, stage: 'interpretEpisode', layer: 'adapter', reason: 'output_shape' },
      { version: 1, stage: 'interpretEpisode', layer: 'core_call', reason: 'adapter_output_invalid' },
    ]);
    assert.ok(f.diagnostics.every(Object.isFrozen));
  }
});

test('E2 step action and replacement shape are correlated; missing prior reference cannot close', async () => {
  for (const action of ['completed', 'replaced']) {
    const input = interpretationInput(); input.prior.nextStep = { stepRef: 'prior-next-step' };
    const output = interpretation(); output.disposition = { stepRef: 'prior-next-step', action, anchors: output.gist.anchors };
    if (action === 'completed') output.nextStep = output.gist;
    const f = fakeModel({ respond: () => output });
    await assert.rejects(f.model.interpretEpisode(request('interpret-episode', input)), { code: 'invalid_model_output' });
  }
});

test('E4 interpretation failures preserve normal admission and a content-free gap', async t => {
  const f = setup(t, { respond: (method, input) => method === 'interpretEpisode' ? { partial: true }
    : method === 'extract' ? { items: [] } : assert.fail(method) });
  const captured = ok(await f.core.capture(captureInput()));
  assert.equal(captured.episode.error.code, 'invalid_model_output');
  assert.equal(captured.admission.status, 'completed');
  const inspected = ok(f.core.getEpisode({ namespace: ns, episodeId: captured.episode.id }));
  assert.equal(inspected.episode.gist, null);
  assert.equal(inspected.episode.processing.errorCode, 'invalid_model_output');
  const before = f.calls.length;
  ok(await f.core.capture(captureInput()));
  assert.equal(f.calls.length, before);
});

test('E4 budgets, transport cancellation and observers preserve finite failures', async () => {
  const cases = [
    { count: 7025, code: 'context_budget_exceeded', reason: 'request_bounds' },
    { count: -1, code: 'token_count_unavailable', reason: 'token_count_response' },
    { response: body => ({ ...body, status: 'incomplete' }), code: 'invalid_model_output', reason: 'response_envelope' },
    { response: body => ({ ...body, usage: { input_tokens: 120, output_tokens: 1025, total_tokens: 1145 } }), code: 'invalid_model_output', reason: 'response_usage' },
    { response: body => { body.output[0].content[0].text = '{'; return body; }, code: 'invalid_model_output', reason: 'output_json' },
    { response: body => { body.output[0].content[0].text = 'x'.repeat(40001); return body; }, code: 'invalid_model_output', reason: 'output_bounds' },
  ];
  for (const item of cases) {
    const f = fakeModel({ transport: ({ url, payload }) => Response.json(url.endsWith('/input_tokens')
      ? { object: 'response.input_tokens', input_tokens: item.count ?? 120 }
      : item.response(envelope(payload.model, interpretation()))) });
    await assert.rejects(f.model.interpretEpisode(request()), { code: item.code });
    assert.equal(f.diagnostics[0].reason, item.reason);
    assert.equal(f.calls.length, item.count === undefined ? 2 : 1);
  }
  for (const onDiagnostic of [() => { throw Error('private'); }, () => Promise.reject(Error('private'))]) {
    const f = fakeModel({ onDiagnostic, respond: () => ({}) });
    await assert.rejects(f.model.interpretEpisode(request()), { code: 'invalid_model_output' });
  }
  const controller = new AbortController(); controller.abort();
  const f = fakeModel();
  await assert.rejects(f.model.interpretEpisode({ ...request(), signal: controller.signal }), { name: 'AbortError' });
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.diagnostics, [{ version: 1, stage: 'interpretEpisode', layer: 'adapter', reason: 'model_cancelled' }]);
});

test('E2 sixteen-source bound includes closure proof and nullable semantic fields', async () => {
  const input = interpretationInput();
  input.sources = Array.from({ length: 17 }, (_, sourceIndex) => ({ sourceIndex, role: 'user', text: 'Evidence' }));
  input.prior.nextStep = { stepRef: 'prior-next-step' };
  const output = interpretation(input);
  for (const [position, field] of ['type', 'gist', 'outcome', 'nextStep'].entries()) {
    output[field] = { value: field === 'type' ? 'work' : 'Evidence', anchors: Array.from({ length: 4 }, (_, offset) =>
      ({ sourceIndex: position * 4 + offset, start: 0, end: 8 })) };
  }
  output.disposition = { stepRef: 'prior-next-step', action: 'replaced', anchors: [{ sourceIndex: 16, start: 0, end: 8 }] };
  const f = fakeModel({ respond: () => output });
  await assert.rejects(f.model.interpretEpisode(request('interpret-episode', input)), { code: 'invalid_model_output' });
  output.disposition.anchors[0].sourceIndex = 15;
  assert.deepEqual(await f.model.interpretEpisode(request('interpret-episode', input)), output);
});

test('E4 local budget, malformed requests and in-flight abort stop before generation', async () => {
  const large = interpretationInput();
  large.sources = Array.from({ length: 24 }, (_, sourceIndex) => ({ sourceIndex, role: 'user', text: 'x '.repeat(400) }));
  const f = fakeModel();
  await assert.rejects(f.model.interpretEpisode(request('interpret-episode', large)), { code: 'context_budget_exceeded' });
  await assert.rejects(f.model.interpretEpisode(request('interpret-episode', { sources: [] })), /invalid_openai_request/);
  assert.equal(f.calls.length, 0);
  const controller = new AbortController();
  const cancelled = fakeModel({ transport: () => {
    controller.abort();
    return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
  } });
  await assert.rejects(cancelled.model.interpretEpisode({ ...request(), signal: controller.signal }), { name: 'AbortError' });
  assert.equal(cancelled.calls.length, 1);
  assert.deepEqual(cancelled.diagnostics.map(event => event.reason), ['model_cancelled']);
});

test('E4 malformed interpretation arrays use the adapter request error before HTTP', async () => {
  const invalidRequest = error => {
    assert.equal(error.constructor, Error);
    assert.equal(error.message, 'invalid_openai_request');
    assert.equal(error.code, undefined);
    return true;
  };
  for (const classificationTarget of [undefined, null, {}, [], Array(25).fill(0), Array(1),
    [0, 0], [-1], [1], [0.5], ['0']]) {
    const input = { ...interpretationInput(), classificationTarget };
    assert.throws(() => episodeSchemasFor('interpretEpisode', input), invalidRequest);
    const f = fakeModel();
    await assert.rejects(f.model.interpretEpisode(request('interpret-episode', input)), invalidRequest);
    assert.equal(f.calls.length, 0);
    assert.deepEqual(f.diagnostics, [
      { version: 1, stage: 'interpretEpisode', layer: 'adapter', reason: 'request_invalid' },
    ]);
  }
  for (const sources of [null, [], Array(1553), Array(1)]) {
    assert.throws(() => episodeSchemasFor('interpretEpisode', { ...interpretationInput(), sources }), invalidRequest);
  }
});

test('E1/E4 transport errors and bounded response bodies disclose no private provider text', async () => {
  const privateText = ['sk', 'synthetic', 'private'].join('-');
  for (const transport of [() => { throw Error(privateText); },
    () => new Response(privateText.repeat(30000)), () => new Response('{')]) {
    const f = fakeModel({ transport });
    await assert.rejects(callModel(f.model, 'interpretEpisode', request().system, interpretationInput(),
      { failureCode: 'episode_failed' }), { code: 'episode_failed' });
    assert.equal(f.calls.length, 1);
    assert.equal(JSON.stringify(f.diagnostics).includes(privateText), false);
    assert.equal(f.diagnostics.at(-1).reason, 'provider_failure');
    assert.ok(f.diagnostics.every(event => Object.keys(event).join(',') === 'version,stage,layer,reason'));
  }
});

test('E2/E10 fake HTTP step dispositions bind real core guards and replay without interpretation', async t => {
  for (const action of ['completed', 'cancelled', 'replaced']) await t.test(action, async t => {
    const f = setup(t, { respond: (method, input) => {
      if (method === 'extract') return { items: [] };
      assert.equal(method, 'interpretEpisode');
      const output = interpretation(input);
      if (!input.prior.nextStep) output.nextStep = { ...output.gist, value: 'Review the proposal' };
      else {
        output.disposition = { stepRef: input.prior.nextStep.stepRef, action, anchors: output.gist.anchors };
        if (action === 'replaced') output.nextStep = { ...output.gist, value: 'Review the replacement' };
      }
      return output;
    } });
    const first = ok(await f.core.capture(captureInput()));
    const before = ok(f.core.getEpisode({ namespace: ns, episodeId: first.episode.id })).episode.nextStep;
    const later = captureInput(2); later.episodeContext.origin = 'precompact';
    const second = ok(await f.core.capture(later));
    assert.equal(second.episode.status, 'interpreted');
    const detail = ok(f.core.getEpisode({ namespace: ns, episodeId: first.episode.id }));
    assert.equal(detail.episode.nextStep.status, action === 'replaced' ? 'open' : 'closed');
    if (action === 'replaced') assert.notEqual(detail.episode.nextStep.id, before.id);
    assert.equal(Object.hasOwn(detail.episode, 'stepClosure'), false);
    const count = f.calls.length;
    ok(await f.core.capture(later));
    assert.equal(f.calls.length, count);
  });
});

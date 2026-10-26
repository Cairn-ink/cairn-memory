import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { episodeRequest } from '../episode-capture.mjs';
import { interpretation } from '../testing/episode-capture-helpers.mjs';
import { digest } from '../testing/episode-helpers.mjs';
import { fixture, ns, request, splitRaw, config, ok, completed } from '../testing/raw-capture-fixtures.mjs';

const text = 'Synthetic source: the team chose a blue tent.';
const storageNs = { ...ns, projectId: '' };
const extract = () => ({ items: [{ content: 'Synthetic blue tent decision.', kind: 'fact', confidence: .8, sourceIndices: [0] }] });
const legacy = (input, eventId) => ({ namespace: input.namespace, client: input.client,
  sessionId: input.sessionId, eventId, episodeContext: { clientLabel: 'Synthetic client', generation: 'initial', origin: 'ordinary' },
  messages: input.messages.map(({ id, role, content }) => ({ id, role, content, occurredAt: null })) });
function coldState(f) {
  const db = new DatabaseSync(f.path); f.workspace.defer(() => db.close());
  return { gists: db.prepare('SELECT record FROM session_episodes').all().map(row => JSON.parse(row.record).gist).filter(Boolean),
    sources: db.prepare('SELECT count(*) n FROM episode_sources').get().n };
}
async function seed(t, client) {
  const hooks = {};
  const f = fixture(t, { lineage: true, model: { extract,
    countTokens: text => { hooks.count?.(text); return 1; } } });
  const input = request(splitRaw(text)[0], { client });
  const first = completed(await f.core.captureRaw(input));
  const memory = ok(f.core.get({ namespace: ns, memoryId: first.admission.memories[0].id })).memory;
  const episode = openMemoryCore({ path: f.path, ...config('episode'), model: { ...f.model,
    extract: () => ({ items: [] }), interpretEpisode: value => {
      hooks.interpret?.(value); return f.model.interpretEpisode(value);
    } } });
  f.workspace.defer(() => episode.close());
  const mutate = action => action === 'forget'
    ? ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }))
    : ok(f.core.correct({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
      content: 'Synthetic explicit replacement.', kind: 'fact',
      receipt: { client: 'manual', sessionId: 'independent', eventId: 'replacement', role: 'user', excerpt: 'Independent replacement.' } }));
  return { f, input, episode, mutate, hooks };
}

for (const client of ['claude-code', 'codex']) for (const forgotten of [false, true]) {
  test(`P3a-07 ${client}: ${forgotten ? 'excluded source cannot dispatch or publish an episode' : 'unexcluded episode control dispatches and publishes'}`, async t => {
    const f = fixture(t, { lineage: true, model: { extract } });
    const input = request(splitRaw(text)[0], { client });
    const first = completed(await f.core.captureRaw(input));
    if (forgotten) {
      const memory = ok(f.core.get({ namespace: ns, memoryId: first.admission.memories[0].id })).memory;
      ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
    }
    const episode = openMemoryCore({ path: f.path, model: { ...f.model, extract: () => ({ items: [] }) }, ...config('episode') });
    f.workspace.defer(() => episode.close());
    const result = await episode.capture(legacy(input, 'episode-fresh'));
    const calls = f.calls.filter(call => call.method === 'interpretEpisode').length;
    const state = coldState(f);
    if (forgotten) {
      assert.deepEqual(result, { ok: false, error: { code: 'source_excluded', retryable: false } });
      assert.deepEqual({ calls, ...state }, { calls: 0, gists: [], sources: 0 });
      assert.equal(f.db.prepare('SELECT outcome_code FROM episode_attempts').get().outcome_code, 'episode_failed');
      assert.deepEqual(await episode.capture(legacy(input, 'episode-fresh')),
        { ok: false, error: { code: 'capture_evidence_closed', retryable: false } });
      assert.equal(f.db.prepare('SELECT count(*) n FROM episode_attempts').get().n, 1);
      assert.equal(f.calls.filter(call => call.method === 'interpretEpisode').length, 0);
    } else {
      ok(result); assert.equal(calls, 1); assert.equal(state.gists.length, 1); assert.equal(state.sources, 1);
    }
  });
}

for (const client of ['claude-code', 'codex']) {
  test(`P3a-07 ${client}: mixed excluded and eligible messages retain original omission and role mapping`, async t => {
    const { f, input, episode, mutate } = await seed(t, client);
    mutate('forget');
    const mixed = legacy(input, 'mixed');
    mixed.messages.push({ id: 'eligible', role: 'assistant', content: 'Synthetic eligible assistant source.', occurredAt: null });
    const captured = ok(await episode.capture(mixed));
    assert.equal(captured.episode.status, 'interpreted');
    const call = f.calls.find(call => call.method === 'interpretEpisode');
    assert.deepEqual(call.input.sources, [{ sourceIndex: 0, role: 'assistant', text: mixed.messages[1].content }]);
    assert.deepEqual(call.input.classificationTarget, [0]);
    const row = f.db.prepare('SELECT omitted_count,omitted_indices FROM episode_events').get();
    assert.equal(row.omitted_count, 1); assert.equal(row.omitted_indices, '[0]');
    const db = new DatabaseSync(f.path); f.workspace.defer(() => db.close());
    assert.equal(db.prepare('SELECT text FROM episode_sources').get().text, mixed.messages[1].content);
  });

  for (const action of ['forget', 'correct']) for (const trigger of ['precompact', 'end', 'lazy']) {
    test(`P3a-07 ${client}: ${action} filters prior zero-Memory passages before ${trigger}`, async t => {
      const { f, input, episode, mutate } = await seed(t, client);
      const first = ok(await episode.capture(legacy(input, 'episode-A')));
      assert.equal(first.admission.memories.length, 0);
      assert.equal(f.db.prepare('SELECT count(*) n FROM episode_memory_links').get().n, 0);
      assert.equal(coldState(f).sources, 1);
      mutate(action); f.calls.length = 0;
      const next = legacy(input, 'episode-B');
      next.messages = [{ id: 'message-B', role: 'assistant', content: 'Synthetic independent evidence B.', occurredAt: null }];
      if (trigger === 'precompact') next.episodeContext.origin = trigger;
      ok(await episode.capture(next));
      if (trigger === 'end') ok(await episode.endEpisodeSession({ namespace: ns, client,
        sessionId: input.sessionId, eventId: 'end', generation: 'initial' }));
      if (trigger === 'lazy') ok(await episode.capture({ ...next, sessionId: 'new-session', eventId: 'episode-C',
        messages: [{ id: 'message-C', role: 'user', content: 'Synthetic new session C.', occurredAt: null }] }));
      const calls = f.calls.filter(call => call.method === 'interpretEpisode');
      assert.ok(calls.length > 0, 'eligible sources still interpret');
      assert.ok(calls.every(call => call.input.sources.every(source => source.text !== text)));
      assert.ok(calls.some(call => call.input.sources.some(source => source.role === 'assistant')));
      const db = new DatabaseSync(f.path); f.workspace.defer(() => db.close());
      assert.equal(db.prepare('SELECT count(*) n FROM episode_sources WHERE text=?').get(text).n, 0);
      assert.ok(coldState(f).gists.length > 0);
    });
  }

  for (const action of ['forget', 'correct']) for (const point of ['count', 'microtask', 'model']) {
    test(`P3a-07 ${client}: ${action} at episode ${point} blocks dispatch/publication`, async t => {
      const { f, input, episode, mutate, hooks } = await seed(t, client);
      let fired = false;
      const run = () => { fired = true; mutate(action); };
      if (point === 'model') hooks.interpret = run;
      else hooks.count = value => {
        if (fired || !value.includes('classificationTarget')) return;
        fired = true;
        if (point === 'microtask') queueMicrotask(run); else run();
      };
      await episode.capture(legacy(input, 'race-A'));
      assert.equal(fired, true);
      assert.equal(f.calls.filter(call => call.method === 'interpretEpisode').length, point === 'model' ? 1 : 0);
      assert.deepEqual(coldState(f), { gists: [], sources: 0 });
      assert.equal(f.db.prepare('SELECT count(*) n FROM raw_source_exclusions').get().n, 1);
    });
  }

  test(`P3a-07 ${client}: actual commit rejects an excluded inherited source under its original identity`, async t => {
    const { f, input, episode, mutate } = await seed(t, client);
    const first = ok(await episode.capture(legacy(input, 'origin-A')));
    const source = ok(episode.getEpisode({ namespace: ns, episodeId: first.episode.id })).sources.items[0];
    const runtime = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } });
    f.workspace.defer(() => runtime.close());
    const messages = [{ id: 'consumer-B', role: 'assistant', content: 'Synthetic independent consumer B.', occurredAt: null }];
    const batch = { client: client === 'codex' ? 'claude-code' : 'codex', sessionId: 'consumer-session', eventId: 'consumer-event',
      messages, clientLabel: 'Synthetic client', generation: 'initial', payloadDigest: digest('consumer-B'),
      view: { messages: messages.map(({ id, role, content }) => ({ id, role, content })),
        retainedSourceWindow: { maxUnitsPerMessage: 800, truncatedMessageIndices: [] } } };
    const draft = value => {
      const registered = runtime.reserveEpisodeBatch(storageNs, value);
      const writer = runtime.claimEpisodeWriter(storageNs, { episodeId: registered.episodeId, generation: 'initial' });
      const claim = runtime.claimEpisodeDraft(storageNs, { episodeId: registered.episodeId, generation: 'initial',
        writerToken: writer.token, trigger: 'batch', watermark: registered.position });
      return { owned: { episodeId: registered.episodeId, token: claim.token }, writer,
        planned: episodeRequest(f.model, runtime.episodeDraftSnapshot(storageNs, { episodeId: registered.episodeId, token: claim.token })) };
    };
    const commit = job => ({ ...job.owned,
      result: interpretation({ input: { sources: [{ role: source.role, text: source.text }], classificationTarget: [0] } }),
      sources: [{ sourceId: source.id }], dispositions: job.planned.dispositions, modelMetadata: { adapter: null, model: null, profile: null,
        promptVersion: 'synthetic', digest: digest('synthetic'), portVersion: 'episode-v1' } });
    const copied = draft(batch);
    runtime.commitEpisodeDraft(storageNs, commit(copied));
    const admission = runtime.claimAdmission(storageNs, { client: batch.client, eventId: batch.eventId,
      payloadDigest: batch.payloadDigest, leaseMs: 125000 });
    runtime.finishAdmission(storageNs, { client: batch.client, eventId: batch.eventId,
      payloadDigest: batch.payloadDigest, token: admission.token, items: [] });
    runtime.releaseEpisodeWriter(storageNs, { episodeId: copied.owned.episodeId, token: copied.writer.token });
    mutate('forget');
    const next = { ...batch, eventId: 'consumer-next', payloadDigest: digest('consumer-next'),
      messages: [{ ...messages[0], id: 'consumer-next' }],
      view: { ...batch.view, messages: [{ ...batch.view.messages[0], id: 'consumer-next' }] } };
    const current = draft(next);
    assert.equal(current.planned.input.sources.some(item => item.text === text), false,
      'copied prior source uses the original client/session, not the consumer identity');
    assert.throws(() => runtime.commitEpisodeDraft(storageNs, commit(current)),
    error => error.code === 'source_excluded');
    const db = new DatabaseSync(f.path); f.workspace.defer(() => db.close());
    assert.equal(db.prepare('SELECT count(*) n FROM episode_sources WHERE episode_id=?').get(current.owned.episodeId).n, 1,
      'only the previously accepted source remains; rejected publication made no new rows');
    assert.equal(db.prepare('SELECT state FROM admission_claims WHERE event_id=?').get(next.eventId).state, 'reserved');
  });

  for (const pinned of ['gist', 'nextStep', 'closed-step']) {
    test(`P3a-07 ${client}: excluded ${pinned} cannot be reattached during publication`, async t => {
      const { f, input, episode, mutate } = await seed(t, client);
      const first = ok(await episode.capture(legacy(input, 'pinned-A')));
      const detail = ok(episode.getEpisode({ namespace: ns, episodeId: first.episode.id }));
      const source = detail.sources.items[0], field = pinned === 'gist' ? 'gist' : 'nextStep';
      ok(episode.correctEpisode({ namespace: ns, episodeId: first.episode.id, expectedRevision: detail.episode.revision,
        patch: { [field]: { text: 'Synthetic pinned source-bound field.', anchors: [{ sourceId: source.id,
          digest: source.digest, start: 0, end: source.text.length }] } } }));
      if (pinned === 'closed-step') {
        const updated = ok(episode.getEpisode({ namespace: ns, episodeId: first.episode.id })).episode;
        ok(episode.closeEpisodeNextStep({ namespace: ns, episodeId: first.episode.id, expectedRevision: updated.revision,
          stepId: updated.nextStep.id, actionId: 'close-original', action: 'completed' }));
      }
      const before = ok(episode.getEpisode({ namespace: ns, episodeId: first.episode.id })).episode.interpretedAt;
      mutate('forget'); f.calls.length = 0;
      const next = legacy(input, 'pinned-B'); next.episodeContext.origin = 'precompact';
      next.messages = [{ id: 'pinned-message-B', role: 'assistant', content: 'Synthetic allowed new evidence.', occurredAt: null }];
      const result = ok(await episode.capture(next));
      assert.equal(result.episode.status, 'failed');
      assert.equal(result.episode.error.code, 'source_excluded');
      const call = f.calls.find(call => call.method === 'interpretEpisode');
      assert.ok(call); assert.equal(call.input.sources.some(item => item.text === text), false);
      assert.equal(Object.hasOwn(call.input.prior, field), false);
      const db = new DatabaseSync(f.path); f.workspace.defer(() => db.close());
      const record = JSON.parse(db.prepare('SELECT record FROM session_episodes WHERE id=?').get(first.episode.id).record);
      assert.equal(record.interpretedAt, before, 'no fresh prose publication');
      assert.equal(db.prepare('SELECT count(*) n FROM episode_sources WHERE text=?').get(next.messages[0].content).n, 0);
      assert.equal(db.prepare("SELECT outcome_code FROM episode_attempts WHERE marker='batch:2'").get().outcome_code, 'episode_failed');
    });
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, readFile, writeFile, readdir } from 'node:fs/promises';
import { harness, row } from './capture-window-harness.mjs';

const active = { paused: false, generation: 0, enforced: true };
const time = '2026-11-10T00:00:00.000Z';
const ids = f => f.captures.flatMap(body => body.messages.map(message => message.id));
const noTags = state => {
  assert.equal(Object.hasOwn(state, 'hostedGeneration'), false, 'no_generation_authority');
  assert.equal(Object.hasOwn(state, 'hostedTarget'), false, 'no_target_authority');
};
async function start(t, options = {}) {
  const f = await harness(t, { portable: true, ...options });
  await f.write(''); await f.run('start-boundary');
  return f;
}

test('portable first prompt authorizes exactly the new first-turn bytes', async t => {
  const f = await start(t);
  await f.run('recall');
  const state = await f.state();
  const bytes = row('first-user', time) + row('first-answer', time, { type: 'assistant' });
  await appendFile(f.transcript, bytes); await f.run('capture');
  assert.equal(f.captures.length, 1, 'first_turn_actual_post');
  assert.deepEqual(f.captures[0].messages, [
    { role: 'user', content: 'Synthetic first-user', id: 'first-user', occurred_at: time },
    { role: 'assistant', content: 'Synthetic first-answer', id: 'first-answer', occurred_at: time },
  ], 'exact_first_turn_messages');
  assert.equal(state.hostedGeneration, 0, 'first_prompt_authority');
  assert.match(state.hostedTarget, /^[a-f0-9]{64}$/u);
  assert.equal((await f.state()).offset, Buffer.byteLength(bytes));
  const names = await readdir(f.dataDir);
  assert.equal(names.some(name => /^hosted-pause(?:-rotation|-rotated|\.gate)/u.test(name)), false,
    'portable_never_uses_root_checkpoint');
});

for (const [name, remote] of [
  ['paused', { ...active, paused: true, generation: 1 }],
  ['unavailable', {}], ['unenforced', { ...active, enforced: false }],
  ['invalid', { ...active, generation: -1 }],
]) test(`portable ${name} first GET never grants authority`, async t => {
  const f = await start(t, { pauseState: () => remote });
  await f.run('recall'); noTags(await f.state());
  await appendFile(f.transcript, row('denied-first-turn', time));
  await f.run('capture'); assert.deepEqual(ids(f), []);
});

test('portable resumed first prompt fences every byte already on disk', async t => {
  let remote = { ...active, paused: true, generation: 1 };
  const f = await start(t, { pauseState: () => remote });
  const prefix = row('paused-shell-output', time);
  await appendFile(f.transcript, prefix);
  remote = { ...active, generation: 2 };
  await f.run('recall');
  const promptState = await f.state();
  const fresh = row('fresh-first-user', time) + row('fresh-answer', time, { type: 'assistant' });
  await appendFile(f.transcript, fresh); await f.run('capture');
  assert.deepEqual(ids(f), ['fresh-first-user', 'fresh-answer'], 'no_pre_prompt_bytes');
  assert.equal(promptState.offset, Buffer.byteLength(prefix), 'prompt_byte_fence');
  assert.equal((await f.state()).offset, Buffer.byteLength(prefix + fresh));
});

test('portable prompt record already appended is conservatively excluded', async t => {
  const f = await start(t);
  const before = row('already-appended-prompt', time);
  await appendFile(f.transcript, before); await f.run('recall');
  await appendFile(f.transcript, row('answer-after-hook', time, { type: 'assistant' }));
  await f.run('capture');
  assert.deepEqual(ids(f), ['answer-after-hook'], 'only_bytes_after_hook_stat');
});

test('portable pause during turn one invalidates first prompt tags at Stop', async t => {
  let remote = active;
  const f = await start(t, { pauseState: () => remote });
  await f.run('recall');
  remote = { ...active, paused: true, generation: 1 };
  await appendFile(f.transcript, row('paused-during-first-turn', time));
  await f.run('capture'); assert.deepEqual(ids(f), []);
  remote = { ...active, generation: 2 };
  await f.run('capture'); assert.deepEqual(ids(f), [], 'resumed_tag_mismatch_sets_eof');
  await appendFile(f.transcript, row('after-resume-boundary', time)); await f.run('capture');
  assert.deepEqual(ids(f), ['after-resume-boundary'], 'later_actual_post');
});

test('portable paused first turn without Stop cannot be authorized by a later prompt', async t => {
  let remote = { ...active, paused: true, generation: 1 };
  const f = await start(t, { pauseState: () => remote });
  await f.run('recall'); const first = await f.state(); noTags(first);
  await appendFile(f.transcript, row('paused-no-stop', time));
  remote = { ...active, generation: 2 };
  await f.run('recall'); noTags(await f.state());
  assert.equal((await f.state()).firstPromptAt, first.firstPromptAt);
  await f.run('capture'); assert.deepEqual(ids(f), [], 'later_prompt_cannot_release_paused_turn');
});

for (const extension of [{ hostedGeneration: 7, hostedTarget: 'old-target' }, { captureSeen: true }])
  test(`portable first prompt preserves preexisting ${Object.keys(extension)[0]}`, async t => {
    const f = await start(t);
    await writeFile(f.statePath, JSON.stringify({ ...await f.state(), ...extension }));
    await f.run('recall');
    const state = await f.state();
    for (const [key, value] of Object.entries(extension)) assert.equal(state[key], value, 'preserve_existing_authority');
    if (extension.captureSeen) noTags(state);
    await appendFile(f.transcript, row('not-authorized', time)); await f.run('capture');
    assert.deepEqual(ids(f), [], 'preexisting_state_cannot_be_reauthorized');
  });

test('portable target switch after recall rejects the first-turn range', async t => {
  const f = await start(t), other = await start(t);
  await f.run('recall');
  const tagged = await f.state();
  await appendFile(other.transcript, row('other-target-first-turn', time));
  await writeFile(other.statePath, JSON.stringify(tagged));
  await other.run('capture');
  assert.deepEqual(ids(other), [], 'target_match_is_required');
});

test('portable busy prompt lock writes no tags and Stop still establishes EOF', async t => {
  const f = await start(t);
  // A foreign live owner makes try-only acquisition return immediately.
  await writeFile(f.statePath + '.lock', JSON.stringify({ pid: process.pid, token: 'synthetic-owner' }));
  const before = await readFile(f.statePath);
  await f.run('recall'); assert.deepEqual(await readFile(f.statePath), before);
  noTags(await f.state());
});

for (const changed of ['paused', 'unavailable', 'same-generation'])
  test(`portable ${changed} in-process observation after GET prevents prompt tags`, async t => {
    let calls = 0;
    const f = await start(t, {
      pauseState: () => ++calls === 1 ? active : changed === 'paused'
        ? { ...active, paused: true, generation: 1 } : changed === 'unavailable' ? {} : active,
      mutateRuntime(source) {
        // Simulate another observation in this same process while recall was
        // in flight. Production recall still makes exactly one pre-fetch GET.
        const needle = '  if (!Array.isArray(result?.memories) || result.memories.length === 0) return;';
        assert.equal(source.split(needle).length, 2);
        return source.replace(needle,
          '  await observeHostedPause(hostedConfig, token, recallSignal).catch(() => {});\n' + needle);
      },
    });
    await f.run('recall');
    assert.equal(calls, 2, 'changed_observation_exercised');
    const state = await f.state(); noTags(state);
    assert.equal(typeof state.firstPromptAt, 'string', 'denied_authority_still_records_first_prompt');
  });

test('portable unknown transcript fence records the prompt without authority', async t => {
  const f = await start(t);
  await f.run('recall', { transcript_path: f.transcript + '.missing' });
  const state = await f.state(); noTags(state);
  assert.equal(typeof state.firstPromptAt, 'string');
  await appendFile(f.transcript, row('unknown-fence', time)); await f.run('capture');
  assert.deepEqual(ids(f), []);
});

test('portable insufficient finally headroom skips first prompt authority', async t => {
  const f = await start(t, { mutateRuntime(source) {
    const needle = '} finally {\n  // First-prompt classification';
    assert.equal(source.split(needle).length, 2);
    return source.replace(needle,
      '} finally {\n  if (action === "recall") performance.now = () => recallEnd - 200;\n  // No fetch');
  } });
  await f.run('recall'); noTags(await f.state());
  assert.equal(Object.hasOwn(await f.state(), 'firstPromptAt'), false);
  await appendFile(f.transcript, row('late-finally-turn', time)); await f.run('capture');
  assert.deepEqual(ids(f), []);
});


test('portable byte fence never reconstructs a pre-prompt partial record', async t => {
  const f = await start(t);
  await appendFile(f.transcript, '{"type":"user","uuid":"paused-partial","message":{"content":"paused prefix');
  await f.run('recall');
  await appendFile(f.transcript, ' suffix"}}\n' + row('complete-after-fence', time));
  await f.run('capture');
  assert.deepEqual(ids(f), ['complete-after-fence'], 'partial_pre_prompt_record_excluded');
});

import assert from 'node:assert/strict';
import { appendFile, readFile } from 'node:fs/promises';
import test from 'node:test';
import { harness, oldTime, row } from './capture-window-harness.mjs';

const keys = ['end', 'final', 'id', 'initial', 'parser', 'slice', 'slices', 'start'];
const rows = count => Array.from({ length: count }, (_, index) => row(`message-${index}`)).join('');

async function captureServer(t, { holdCapture, ...options } = {}) {
  const windows = new Map(), violations = [];
  const f = await harness(t, {
    ...options,
    async holdCapture(body) {
      const { window } = body;
      try {
        assert.deepEqual(Object.keys(window).sort(), keys);
        const { id, slice, slices, start, end, final, parser } = window;
        assert.ok(end > start);
        assert.equal(typeof final, 'boolean');
        if (final) assert.equal(slice, slices);

        // The frozen byte range spans group IDs. A retry can repeat a slice.
        if (!windows.has(start)) windows.set(start, { end, parser, slices: new Map() });
        const frozen = windows.get(start);
        assert.equal(end, frozen.end);
        assert.equal(parser, frozen.parser);
        const sliceId = `${id}:${slice}`;
        if (frozen.slices.has(sliceId)) assert.deepEqual(window, frozen.slices.get(sliceId));
        else frozen.slices.set(sliceId, window);
      } catch (error) {
        violations.push(error.message);
      }
      await holdCapture?.();
    },
  });
  t.after(() => {
    assert.deepEqual(violations, [], 'server window violations');
    for (const frozen of windows.values()) {
      const slices = [...frozen.slices.values()];
      assert.deepEqual(slices.map(window => window.final), slices.map((_, i) => i === slices.length - 1));
    }
  });
  return f;
}

const windowsOf = f => f.captures.map(body => body.window);

test('one request carries all eight keys and the persisted window bounds', async t => {
  let pending;
  const f = await captureServer(t, { holdCapture: async () => { pending = await f.state(); } });
  const complete = row('complete', oldTime, { message: { content: 'Synthetic 中文' } });
  await f.write(complete + '{"type":');
  await f.run('capture');
  assert.equal(f.captures.length, 1);
  const [window] = windowsOf(f);
  assert.deepEqual(Object.keys(window).sort(), keys);
  assert.equal(window.start, pending.offset);
  assert.equal(window.start, 0);
  assert.equal(window.end, pending.pendingEnd);
  assert.equal(window.end, Buffer.byteLength(complete));
  assert.equal(window.final, true);
  assert.equal(window.parser, 1);
});

test('all sent batches carry the same bounds and parser, with one final slice', async t => {
  const f = await captureServer(t);
  const text = rows(72) + row('withheld-tail', oldTime, { isMeta: true });
  await f.write(text);
  await f.run('capture');
  assert.deepEqual(f.captures.map(body => body.messages.length), [24, 24, 24]);
  assert.deepEqual(windowsOf(f).map(({ slice, slices, start, end, final, parser }) =>
    [slice, slices, start, end, final, parser]), [
    [1, 3, 0, Buffer.byteLength(text), false, 1],
    [2, 3, 0, Buffer.byteLength(text), false, 1],
    [3, 3, 0, Buffer.byteLength(text), true, 1],
  ]);
});

test('group IDs change while the frozen range and final slice span all groups', async t => {
  const f = await captureServer(t, { groupingLimit: 2 });
  const text = rows(97);
  await f.write(text);
  await f.run('capture');
  const windows = windowsOf(f);
  assert.deepEqual(windows.map(({ slice, slices, final }) => [slice, slices, final]), [
    [1, 2, false], [2, 2, false], [1, 2, false], [2, 2, false], [1, 1, true],
  ]);
  const [first, second, third, fourth, last] = windows;
  assert.equal(first.id, second.id);
  assert.equal(third.id, fourth.id);
  assert.equal(new Set([first.id, third.id, last.id]).size, 3);
  assert.ok(windows.every(window => window.start === 0 && window.end === Buffer.byteLength(text) && window.parser === 1));
});

test('retry after a middle failure resends identical windows after transcript growth', async t => {
  const f = await captureServer(t, { groupingLimit: 2, fail: (_body, attempt) => attempt === 2 });
  const text = rows(51);
  await f.write(text);
  await f.run('capture');
  assert.equal(f.captures.length, 2);
  const { pendingEnd } = await f.state();
  assert.equal(pendingEnd, Buffer.byteLength(text));
  await appendFile(f.transcript, row('later'));
  await f.run('capture');
  const windows = windowsOf(f);
  assert.equal(windows.length, 5);
  assert.deepEqual(windows.slice(2, 4), windows.slice(0, 2));
  // The server deduplicates a resent slice by event_id; a new id for the same window slice fails the window closed.
  assert.deepEqual(f.captures.slice(2, 4).map(body => body.event_id), f.captures.slice(0, 2).map(body => body.event_id));
  assert.equal(new Set(f.captures.map(body => body.event_id)).size, 3);
  assert.ok(windows.every(window => window.end === pendingEnd));
  assert.deepEqual(windows.map(window => window.final), [false, false, false, false, true]);
  assert.equal(windows[4].slice, windows[4].slices);
  assert.ok(f.captures.every(body => body.messages.every(message => message.id !== 'later')));
});

test('an initial window starts after the copied prefix in bytes', async t => {
  const f = await captureServer(t, { observedAt: '2025-06-01T12:00:00.000Z' });
  const prefix = row('copied', oldTime, { message: { content: 'Synthetic 中文' } });
  const fresh = row('fresh', '2025-06-01T12:01:00.000Z');
  await f.write(prefix);
  await f.run('recall');
  await appendFile(f.transcript, fresh);
  await f.run('capture');
  assert.equal(f.captures.length, 1);
  const [window] = windowsOf(f);
  assert.deepEqual(f.captures[0].messages.map(message => message.id), ['fresh']);
  assert.equal(window.start, Buffer.byteLength(prefix));
  assert.equal(window.end, Buffer.byteLength(prefix + fresh));
  assert.equal(window.initial, true);
});

test('a second Stop starts a non-initial window at the previous end', async t => {
  const f = await captureServer(t);
  const first = row('first'), second = row('second');
  await f.write(first);
  await f.run('capture');
  await appendFile(f.transcript, second);
  await f.run('capture');
  assert.equal(f.captures.length, 2);
  const [initial, next] = windowsOf(f);
  assert.equal(initial.initial, true);
  assert.equal(next.initial, false);
  assert.equal(next.start, initial.end);
  assert.equal(next.end, Buffer.byteLength(first + second));
  assert.equal(next.parser, 1);
  assert.equal(next.final, true);
});

test('the grouped cases lower the real 4096-slice group limit', async () => {
  // The harness rewrites this exact declaration for groupingLimit; if it drifts, the grouped cases would silently test the default.
  const source = await readFile(new URL('../scripts/hook.mjs', import.meta.url), 'utf8');
  assert.equal(source.split('const CAPTURE_WINDOW_SLICES = 4096;').length - 1, 1);
});

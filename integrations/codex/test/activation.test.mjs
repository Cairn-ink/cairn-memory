import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, header, item, session } from './helpers.mjs';
import { sessionStartedAt } from '../parser.mjs';
import { markActive, startedWhileActive } from '../activation.mjs';
import { runWorker, establishPauseBoundary } from '../worker.mjs';
import { readControlState, setPaused } from '../../client/control-state.mjs';
import { rotateAutomaticBoundary } from '../../client/automatic-policy.mjs';

const line = text => Buffer.from(text.slice(0, text.indexOf('\n')));
const iso = ms => new Date(ms).toISOString();
const stored = async root => JSON.parse(await readFile(join(root, 'control.json'), 'utf8'));
const captured = f => [...f.receiver.values()].flatMap(x => x.messages.map(m => m.content));

test('session start is the recorder header time bound to this session, or unknown', () => {
  assert.equal(sessionStartedAt(line(header({ timestamp: '2026-10-14T02:40:00.123Z' })), session),
    Date.parse('2026-10-14T02:40:00.123Z'));
  for (const timestamp of [undefined, null, 1791445117367, '2026-10-14T02:40:00Z', '2026-10-14T02:40:00.123+00:00',
    '2026-10-14T02:40:00.123456Z', '2026-02-30T00:00:00.000Z', ' 2026-10-14T02:40:00.123Z'])
    assert.equal(sessionStartedAt(line(header({ timestamp })), session), null, String(timestamp));
  assert.equal(sessionStartedAt(line(header()), 'another-session'), null);
  assert.equal(sessionStartedAt(Buffer.from(item('not a header')), session), null);
  assert.equal(sessionStartedAt(Buffer.from('{'), session), null);
});

test('only an active generation is stamped, once; shared writers drop the stamp', async t => {
  const f = await fixture(t);
  let clock = 1_000;
  const now = () => clock;
  // No control file: the "initial" generation already captures unseen sessions.
  assert.equal(await markActive(f.root, { now }), null);
  await assert.rejects(readFile(join(f.root, 'control.json')), { code: 'ENOENT' });
  await setPaused(f.root, true);
  const paused = await readFile(join(f.root, 'control.json'), 'utf8');
  assert.equal(await markActive(f.root, { now }), null);
  assert.equal(await readFile(join(f.root, 'control.json'), 'utf8'), paused);
  const { generation } = await setPaused(f.root, false);
  assert.equal(await markActive(f.root, { now }), 1_000);
  assert.deepEqual(await stored(f.root), { version: 1, paused: false, generation, activeSince: 1_000 });
  // Shared readers still see the same barrier; a repeat keeps the earlier stamp.
  assert.deepEqual(await readControlState(f.root), { paused: false, generation, valid: true });
  clock = 2_000;
  assert.equal(await markActive(f.root, { now }), 1_000);
  for (const write of [() => setPaused(f.root, false), () => rotateAutomaticBoundary(f.root),
    async () => { await setPaused(f.root, true); await setPaused(f.root, false); }]) {
    await write();
    assert.equal((await stored(f.root)).activeSince, undefined);
    assert.equal(await startedWhileActive(f.root, await readControlState(f.root), line(header({ timestamp: iso(5_000) })), session), false);
    assert.equal(await markActive(f.root, { now }), clock);
    clock += 1_000;
  }
  // A legacy marker pauses every generation; nothing is stamped behind it.
  await writeFile(join(f.root, 'control.json'), JSON.stringify({ version: 1, paused: false, generation }));
  await writeFile(join(f.root, 'paused'), 'paused\n');
  assert.equal(await markActive(f.root, { now }), null);
  assert.equal((await stored(f.root)).activeSince, undefined);
});

for (const [name, offset, expected] of [['after', 1, 'captured'], ['at', 0, 'boundary'], ['before', -1, 'boundary']])
  test(`an unseen session that began ${name} the stamp is ${expected === 'captured' ? 'captured from its first unit' : 'skipped to EOF'}`, async t => {
    const f = await fixture(t);
    await setPaused(f.root, true); await setPaused(f.root, false);
    const since = await markActive(f.root);
    await writeFile(f.path, header({ timestamp: iso(since + offset) }) + item('First turn'));
    const start = await establishPauseBoundary(f.binding);
    if (expected === 'captured') {
      assert.equal(start.status, 'context_unavailable');assert.equal(await f.cursor(), null);
      assert.equal((await runWorker(f.binding, { guard: f.guard, transport: f.transport })).status, 'idle');
      assert.deepEqual(captured(f), ['First turn']);
      const cursor = await f.cursor();assert.equal(cursor.skipped.pause_boundary, 0);assert.ok(cursor.accepted > 0);
    } else {
      assert.equal(start.status, 'pause_boundary');
      assert.equal((await f.cursor()).skipped.pause_boundary, Buffer.byteLength(await readFile(f.path)));
      await runWorker(f.binding, { guard: f.guard, transport: f.transport });
      assert.deepEqual(captured(f), []);
    }
  });

test('Stop without SessionStart applies the same rule, and an unreadable header time keeps the boundary', async t => {
  const f = await fixture(t);
  await setPaused(f.root, true); await setPaused(f.root, false);
  const since = await markActive(f.root);
  await writeFile(f.path, header({ timestamp: iso(since + 1) }) + item('First turn'));
  await runWorker(f.binding, { guard: f.guard, transport: f.transport });
  assert.deepEqual(captured(f), ['First turn']);
  const g = await fixture(t);
  await setPaused(g.root, true); await setPaused(g.root, false);
  await markActive(g.root);
  await writeFile(g.path, header({ timestamp: 'later' }) + item('First turn'));
  assert.equal((await runWorker(g.binding, { guard: g.guard, transport: g.transport })).status, 'pause_boundary');
  assert.deepEqual(captured(g), []);
});

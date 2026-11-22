import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { readHostConfiguration, readHostProfile } from '../raw/local-host-profile.mjs';
import { withSessionIdentity } from '../raw/local-session-fence.mjs';
import { sessionStartSource, writeSessionStartAttempt } from '../raw/local-session-start.mjs';
import { lazyFixture } from './fixtures/local-setup-workspace.mjs';
import { sessionId } from './fixtures/raw-fixtures.mjs';

const expectedTurns = ['Synthetic first turn', 'Synthetic second turn'];

async function fixture(t) {
  const f = await lazyFixture(t, 'claude-code');
  const profile = await readHostProfile(join(f.request.installationDirectory, 'host-profile.json'));
  const config = await readHostConfiguration(profile);
  const selection = { sessionId, sourcePath: f.sourcePath };
  const records = await withSessionIdentity(profile, config, selection, async identity => {
    const source = sessionStartSource(identity, selection);
    const marker = join(identity.stateRoot, 'starts', `${identity.sessionKey}.json`);
    await writeSessionStartAttempt(identity, source, 'fresh');
    return { marker, binding: { authority: identity.authorityCommitment, source } };
  });
  writeFileSync(f.sourcePath, '');
  for (const turn of expectedTurns) f.append(turn);
  return { ...f, ...records };
}

function markerBytes(binding) {
  return Buffer.from(JSON.stringify({ version: 'local-raw-start-v1', ...binding }));
}

async function stopWithLateWriter(f, bytes) {
  assert.equal(existsSync(f.marker), false);
  const writerFile = join(f.root, 'late-writer.json');
  writeFileSync(writerFile, bytes, { mode: 0o600, flag: 'wx' });
  const link = fs.link;
  let injected = false;
  fs.link = async (from, to) => {
    if (!injected && to === f.marker) {
      // Take the empty slot with a real hard link just before recovery's link.
      await link(writerFile, to);
      injected = true;
    }
    return link(from, to);
  };
  syncBuiltinESMExports();
  let outcome;
  try {
    outcome = await f.hook('Stop');
  } finally {
    fs.link = link;
    syncBuiltinESMExports();
  }
  assert.equal(injected, true, 'the late writer must reach the exclusive recovery link');
  return { outcome, writerFile };
}

function savedTurns(f) {
  const db = new DatabaseSync(f.request.databasePath, { readOnly: true });
  try {
    return db.prepare(`SELECT p.sealed FROM raw_messages m JOIN raw_parts p
      ON m.conversation_id=p.conversation_id AND m.message_id=p.message_id
      WHERE p.saved=1 ORDER BY m.ordinal,p.part_index`).all().map(row => Buffer.from(row.sealed).toString());
  } finally {
    db.close();
  }
}

test('fresh recovery promotes a legacy attempt that wins the exclusive link', async t => {
  const f = await fixture(t);
  const legacy = JSON.stringify({ version: 'local-raw-start-attempt-v1', ...f.binding, kind: 'fresh' });
  const { outcome } = await stopWithLateWriter(f, legacy);

  assert.equal(outcome.status, 'progress');
  assert.deepEqual(readFileSync(f.marker), markerBytes(f.binding), 'recovery must promote the legacy attempt');
  assert.deepEqual(savedTurns(f), expectedTurns);
  assert.equal(f.cursor().offset, statSync(f.sourcePath).size);
});

test('a late matching marker wins and the next Stop does not recapture', async t => {
  const f = await fixture(t);
  const marker = markerBytes(f.binding);
  const { outcome, writerFile } = await stopWithLateWriter(f, marker);

  assert.equal(outcome.status, 'progress');
  assert.deepEqual(readFileSync(f.marker), marker);
  assert.equal(statSync(f.marker).ino, statSync(writerFile).ino, 'recovery must keep the winning marker');
  assert.deepEqual(savedTurns(f), expectedTurns);

  const cursor = f.cursor();
  assert.equal((await f.hook('Stop')).status, 'ready');
  assert.deepEqual(f.cursor(), cursor);
  assert.deepEqual(savedTurns(f), expectedTurns);
});

test('a late conflicting marker blocks recovery and keeps its bytes', async t => {
  const f = await fixture(t);
  const source = (f.binding.source[0] === '0' ? '1' : '0') + f.binding.source.slice(1);
  const marker = markerBytes({ ...f.binding, source });
  const { outcome } = await stopWithLateWriter(f, marker);

  assert.equal(outcome.status, 'blocked');
  assert.equal(outcome.reason, 'state_invalid');
  assert.deepEqual(readFileSync(f.marker), marker);
  assert.deepEqual(readdirSync(f.directory), []);
  assert.deepEqual(savedTurns(f), []);
});

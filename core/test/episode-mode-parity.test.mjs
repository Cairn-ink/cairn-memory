import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createEpisodeStorage } from '../episode-storage.mjs';
import { captureEpisodeParity } from '../testing/episode-parity.mjs';
import { setup, input, assertError } from '../testing/episode-capture-helpers.mjs';
import { openMemoryCore } from '../index.mjs';

test('E10 frozen committed v14/v15 mode-off prompts, requests, outputs, rows and digests', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'se2-parity-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const version of [14, 15]) {
    const fixture = JSON.parse(readFileSync(new URL(`../testing/episode-v${version}-fixture.json`, import.meta.url), 'utf8'));
    for (const [index, { config, expected }] of fixture.parity.entries()) {
      const path = join(dir, `${version}-${index}.sqlite`);
      assert.deepEqual(await captureEpisodeParity(new URL('../../', import.meta.url).pathname, path, config), expected);
      const db = new DatabaseSync(path);
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, 19);
      assert.equal(db.prepare('SELECT count(*) n FROM episode_messages').get().n, 0);
      db.close();
    }
  }
});

test('E10 unexpected automatic tag remains rejected off; indexed evidence rejects before option getters', async t => {
  const f = setup(t, { extract: () => ({ items: [{ content: 'Review', kind: 'instruction', confidence: 1,
    sourceIndices: [0], procedural: true }] }) });
  const legacy = openMemoryCore({ path: f.path, model: f.model });
  t.after(() => legacy.close());
  const { episodeContext, ...plain } = input();
  plain.messages = plain.messages.map(({ occurredAt, ...message }) => message);
  assertError(await legacy.capture(plain), 'invalid_model_output');
  let reads = 0;
  const config = { path: f.path, captureSourcePolicy: 'indexed-evidence-v1' };
  Object.defineProperty(config, 'sessionEpisodes', { get() { reads++; throw Error('getter'); }, enumerable: true });
  assert.throws(() => openMemoryCore(config), { code: 'invalid_input' });
  assert.equal(reads, 0);
});

test('E10 frozen base diagnostics preserve missing commitment and itemIndex sequences', async () => {
  const { captureDiagnosticParity } = await import('../testing/episode-diagnostic-parity.mjs');
  const frozen = JSON.parse(readFileSync(new URL('../testing/episode-v15-diagnostics.json', import.meta.url), 'utf8'));
  assert.deepEqual(await captureDiagnosticParity(new URL('../../', import.meta.url).pathname), frozen.cases);
});

test('E10 mode-off admission guard and completion perform no keep lookup queries', t => {
  const { db } = setup(t);
  const queries = [], prepare = db.prepare.bind(db);
  db.prepare = sql => { queries.push(sql); return prepare(sql); };
  const storage = createEpisodeStorage({ db, advanceEpoch() {}, epoch: () => 0 });
  const key = { client: 'legacy', eventId: 'episode-keep:ordinary', payloadDigest: 'a'.repeat(64) };
  assert.equal(storage.guard({ ownerId: 'legacy', scope: 'personal', projectId: '' }, key), null);
  storage.admitted({ ownerId: 'legacy', scope: 'personal', projectId: '' }, key, []);
  assert.equal(queries.length, 2);
  assert.ok(queries.every(sql => sql.startsWith('SELECT * FROM episode_events')));
});

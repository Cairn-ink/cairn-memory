import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readSqliteFixture } from '../../../../core/testing/content-safety-s2h-fixture.mjs';
import { createMemoryRuntime } from '../../../../core/runtime.mjs';
import { batch, digest } from '../../../../core/testing/episode-helpers.mjs';
import { assertRecorded, episodeRole } from './forget-episode-recording.mjs';
import { sql, range, forgottenText, stepText } from './forget-episode.mjs';

export const layouts = [{ layout: 29 }, { layout: 33 }, { layout: 48 }, { layout: 53 }, { layout: 53, cardLineage: true }];
export const label = options => options.layout + (options.cardLineage ? ' lineage' : options.layout === 53 ? ' event time' : '');
export function snapshot(f) {
  return sql(f.path, db => ({
    episodes: db.prepare('SELECT * FROM session_episodes ORDER BY id').all(),
    sources: db.prepare('SELECT * FROM episode_sources ORDER BY id').all(),
    headers: db.prepare('SELECT * FROM raw_conversations ORDER BY id').all(),
  }));
}
export function noNeedles(value, needles = [forgottenText, stepText]) {
  for (const needle of needles) assert.equal(JSON.stringify(value).includes(needle), false, 'whole result must withhold ' + needle);
}
export function assertStored(f, before, { named = [], consumers = [], upstream = [] } = {}) {
  const after = snapshot(f);
  assert.equal(after.episodes.length, before.episodes.length, 'no Episode row disappears');
  for (const old of before.episodes) {
    const row = after.episodes.find(value => value.id === old.id);
    if (named.includes(old.id) || consumers.includes(old.id)) {
      assert.equal(row.deleted, Number(named.includes(old.id)), 'only named Episodes are deleted');
      assert.equal(JSON.parse(row.record).processing.state, 'invalidated');
      assert.equal(JSON.parse(row.record).nextStep, null);
      assert.deepEqual(after.sources.filter(value => value.episode_id === row.id), []);
    } else {
      const bump = Number(upstream.includes(old.id));
      assert.equal(row.revision, old.revision + bump, 'exact upstream Episode revision bump, zero elsewhere');
      assert.deepEqual({ ...row, revision: old.revision }, { ...old }, 'all other Episode columns remain identical');
      assert.deepEqual(after.sources.filter(value => value.episode_id === row.id),
        before.sources.filter(value => value.episode_id === row.id), 'sorted source rows remain byte-identical');
    }
  }
  for (const old of before.headers) {
    const origin = before.episodes.find(row => row.client === old.client && row.session_key === old.session_key);
    if (origin && !named.includes(origin.id) && !consumers.includes(origin.id)) {
      const row = after.headers.find(value => value.id === old.id), bump = Number(upstream.includes(origin.id));
      assert.equal(row.revision, old.revision + bump, 'exact upstream Raw-header bump, zero elsewhere');
      assert.deepEqual({ ...row, revision: old.revision }, { ...old }, 'all other neighbour Raw-header columns remain identical');
    }
  }
  return after;
}
export function checkpoint(f) { sql(f.path, db => db.exec('PRAGMA wal_checkpoint(TRUNCATE)')); }
export function bytes(f) {
  return Object.fromEntries(['', '-wal'].map(suffix => [suffix,
    existsSync(f.path + suffix) ? readSqliteFixture(f.path + suffix) : Buffer.alloc(0)]));
}
// Publish copied passages through the same supported storage seams as Episode
// capture tests. No SQL identity rewrite or disabled safety trigger is involved.
export function copySummary(f, sourceIds, session = 'consumer') {
  const ns = { ...f.namespace, projectId: f.namespace.projectId ?? '' };
  const runtime = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } });
  try {
    const input = { ...batch(session + '-event', 'Consumer registration evidence.', session), client: f.client,
      eventStart: new Date().toISOString(), eventEnd: new Date().toISOString(), eventTimeCoverage: 'complete' };
    const registered = runtime.reserveEpisodeBatch(ns, input);
    // The shared draft helper uses its own fixed namespace. Claim and publish
    // with this fixture's namespace throughout the reserve/claim/commit cycle.
    const writer = runtime.claimEpisodeWriter(ns, { episodeId: registered.episodeId, generation: input.generation });
    const claim = runtime.claimEpisodeDraft(ns, { episodeId: registered.episodeId, generation: input.generation,
      writerToken: writer.token, trigger: 'batch', watermark: registered.position });
    const sources = sql(f.path, db => sourceIds.map(id => db.prepare('SELECT * FROM episode_sources WHERE id=?').get(id)));
    const anchors = sources.map((source, sourceIndex) => ({ sourceIndex, start: 0, end: source.text.length }));
    const field = value => ({ value, anchors });
    runtime.commitEpisodeDraft(ns, { episodeId: registered.episodeId, token: claim.token,
      sources: sourceIds.map(sourceId => ({ sourceId })),
      result: { type: field('work'), language: 'mixed', gist: field('consumerneedle derived summary'), outcome: null,
        nextStep: field('consumerstep act on derived evidence'), disposition: null },
      dispositions: [{ eventId: input.eventId, omitted: 0 }],
      modelMetadata: { adapter: 'scripted', model: null, profile: null, promptVersion: 'storage-test',
        digest: digest('prompt'), portVersion: 'episode-v1' } });
    runtime.releaseEpisodeWriter(ns, { episodeId: registered.episodeId, token: writer.token });
    return registered.episodeId;
  } finally { runtime.close(); }
}
export async function assertReads(f, before, { named = [], needles = [forgottenText, stepText], pin } = {}) {
  const namespace = f.namespace, after = snapshot(f);
  assertRecorded(await f.core.get({ namespace, memoryId: f.target.id }), pin.get, needles);
  assertRecorded(await f.core.list({ namespace, limit: 50 }), pin.list, needles);
  for (const timeBasis of ['event', 'receipt']) {
    const result = await f.core.listEpisodes({ namespace, ...range, timeBasis });
    const value = assertRecorded(result, pin['listEpisodes[' + timeBasis + ']'], needles);
    if (value) {
      const candidates = after.episodes.filter(row => !row.deleted && (timeBasis === 'receipt' || JSON.parse(row.record).eventEnd));
      for (const id of named) assert.equal(value.items.some(item => item.id === id), false, 'named Episode never lists');
      for (const row of candidates) assert.ok(value.items.some(item => item.id === row.id), 'eligible retained metadata still lists');
    }
  }
  for (const episode of before.episodes) {
    const result = await f.core.getEpisode({ namespace, episodeId: episode.id });
    const value = assertRecorded(result, pin['getEpisode:' + episodeRole(episode)], needles);
    if (value) assert.equal(value.episode.id, episode.id, 'the requested retained Episode or blank consumer still reads');
  }
  for (const [mode, extra] of [
    ['default', {}], ['default+qual', { includeQualification: true }],
    ['rationale-evidence', { contextMode: 'rationale-evidence' }],
  ]) {
    const result = await f.core.recall({ readSet: [namespace], query: 'synthetic', limit: 12, ...extra });
    assertRecorded(result, pin['recall[' + mode + ']'], needles);
  }
  // Session start is the public next-step reader. Pin both complete envelopes;
  // a successful call need not select any particular retained step.
  for (const [mode, groups] of [
    ['nextSteps', { nextSteps: true, procedural: false }],
    ['nextSteps+procedural+background', { nextSteps: true, procedural: true, background: true }],
  ]) {
    const result = await f.core.sessionStartContext({ namespace, groups, maxChars: 8000, maxTokens: 2000 });
    assertRecorded(result, pin['sessionStartContext[' + mode + ']'], needles);
  }
}

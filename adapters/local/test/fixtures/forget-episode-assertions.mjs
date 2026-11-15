import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readSqliteFixture } from '../../../../core/testing/content-safety-s2h-fixture.mjs';
import { createMemoryRuntime } from '../../../../core/runtime.mjs';
import { batch, digest } from '../../../../core/testing/episode-helpers.mjs';
import { sql, ok, range, forgottenText, stepText } from './forget-episode.mjs';

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
function fencedSources(f, rows) {
  return sql(f.path, db => rows.some(row => db.prepare(`SELECT 1 FROM episode_sources s
    JOIN session_episodes e ON e.id=s.origin_episode_id JOIN raw_session_fences f
      ON f.owner_id=e.owner_id AND f.scope=e.scope AND f.project_id=e.project_id AND f.client=e.client AND f.session_key=e.session_key
    WHERE s.episode_id=? LIMIT 1`).get(row.id)));
}
export async function assertReads(f, before, { named = [], consumers = [], needles = [forgottenText, stepText] } = {}) {
  const namespace = f.namespace, after = snapshot(f), safety = Boolean(f.layout.suppressionRevision);
  noNeedles(await f.core.get({ namespace, memoryId: f.target.id }), needles);
  const listed = await f.core.list({ namespace, limit: 50 });
  // core/runtime.mjs:547: the retained same-session survivor has a fenced Raw source, as on main.
  if (safety) assert.deepEqual(listed, { ok: false, error: { code: 'revision_conflict', retryable: false } });
  else ok(listed);
  noNeedles(listed, needles);
  for (const timeBasis of ['event', 'receipt']) {
    const candidates = after.episodes.filter(row => !row.deleted && (timeBasis === 'receipt' || JSON.parse(row.record).eventEnd));
    const result = await f.core.listEpisodes({ namespace, ...range, timeBasis });
    // Unchanged readers refuse a fenced retained neighbour; read-time filtering is separate work.
    if (safety && fencedSources(f, candidates)) assert.deepEqual(result, { ok: false, error: { code: 'conversation_deleted', retryable: false } });
    else {
      const items = ok(result).items;
      for (const id of named) assert.equal(items.some(item => item.id === id), false, 'named Episode never lists');
      for (const row of candidates) assert.ok(items.some(item => item.id === row.id), 'eligible retained metadata still lists');
    }
    noNeedles(result, needles);
  }
  for (const episode of before.episodes) {
    const result = await f.core.getEpisode({ namespace, episodeId: episode.id });
    if (named.includes(episode.id)) assert.equal(result.error?.code, 'episode_not_found');
    else if (safety && fencedSources(f, [episode])) assert.deepEqual(result, { ok: false, error: { code: 'conversation_deleted', retryable: false } });
    else assert.equal(ok(result).episode.id, episode.id, 'unfenced retained Episode or blank consumer still reads');
    noNeedles(result, needles);
  }
  for (const extra of [{}, { includeQualification: true }, { contextMode: 'rationale-evidence' }]) {
    const result = await f.core.recall({ readSet: [namespace], query: 'synthetic', limit: 12, ...extra });
    // Main also filters the survivor's fenced receipt without suppression:
    // core/runtime.mjs:597,632 refuses evidence when no safe receipt remains.
    if (!safety && extra.contextMode === 'rationale-evidence')
      assert.deepEqual(result, { ok: false, error: { code: 'source_unavailable', retryable: false } });
    else ok(result);
    noNeedles(result, needles);
  }
  const openSteps = after.episodes.filter(row => !row.deleted && JSON.parse(row.record).nextStep?.status === 'open');
  for (const groups of [{ nextSteps: true, procedural: false }, { nextSteps: true, procedural: true, background: true }]) {
    const result = await f.core.sessionStartContext({ namespace, groups, maxChars: 8000, maxTokens: 2000 });
    if (safety && fencedSources(f, openSteps)) assert.deepEqual(result, { ok: false, error: { code: 'conversation_deleted', retryable: false } });
    else {
      ok(result);
      const independent = openSteps.find(row => !named.includes(row.id) && !consumers.includes(row.id));
      if (independent) assert.ok(JSON.stringify(result).includes(JSON.parse(independent.record).nextStep.text), 'a retained next step still delivers');
    }
    noNeedles(result, needles);
  }
}

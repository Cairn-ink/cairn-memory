import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createMemoryRuntime } from '../runtime.mjs';
import { openMemoryCore } from '../index.mjs';

export const ns = { ownerId: 'synthetic', scope: 'project', projectId: 'project' };
export const options = { sessionEpisodes: { mode: 'episode-v1' }, captureEvidence: 'staged-v1', captureQualification: 'source-bound-v2' };
export const digest = text => createHash('sha256').update(text).digest('hex');
export const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
export function fixture(t, config = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'se1-synthetic-')), path = join(dir, 'store.sqlite');
  const runtime = createMemoryRuntime({ path, sessionEpisodes: { mode: 'episode-v1', ...config } });
  const db = new DatabaseSync(path); db.exec('PRAGMA foreign_keys=ON');
  const core = openMemoryCore({ path });
  t.after(() => { runtime.close(); core.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { runtime, core, db, path };
}
export function batch(id = 'one', text = 'Synthetic 中文 English 😀 evidence.', sessionId = 'private-host-session') {
  return { client: 'synthetic', clientLabel: 'Synthetic client', sessionId, eventId: id, payloadDigest: digest(id+text), generation: 'initial',
    messages: [{ id: `message-${id}`, role: 'user', content: text, occurredAt: null }],
    view: { messages: [{ id: `message-${id}`, role: 'user', content: text }], retainedSourceWindow: { maxUnitsPerMessage: 800, truncatedMessageIndices: [] } } };
}
export function register(f, input = batch()) { return f.runtime.reserveEpisodeBatch(ns, input); }
export function finish(f, input, items = []) {
  const writer=f.db.prepare('SELECT writer_token FROM session_episodes WHERE id=(SELECT episode_id FROM episode_events WHERE event_id=?)').get(input.eventId)?.writer_token;
  const claim = f.runtime.claimAdmission(ns, { ...input, episodeWriterToken: writer, leaseMs: 125000 });
  return claim.duplicate ? claim : f.runtime.finishAdmission(ns, { ...input, token: claim.token, items });
}
export function draft(f, registered, input, overrides = {}) {
  const writer = f.runtime.claimEpisodeWriter(ns, { episodeId: registered.episodeId, generation: 'initial' });
  const claim = f.runtime.claimEpisodeDraft(ns, { episodeId: registered.episodeId, generation: 'initial', writerToken: writer.token,
    trigger: 'batch', watermark: registered.position });
  const field = value => ({ value, anchors: [{ sourceIndex: 0, start: 0, end: input.view.messages[0].content.length }] });
  const commit = { episodeId: registered.episodeId, token: claim.token,
    sources: [{ eventId: input.eventId, messageId: input.view.messages[0].id }],
    result: { type: field('work'), language: 'mixed', gist: field('Synthetic 中文 gist'), outcome: null, nextStep: field('Review evidence'), disposition: null },
    dispositions: [{ eventId: input.eventId, omitted: 0 }],
    modelMetadata: { adapter: 'scripted', model: null, profile: null, promptVersion: 'storage-test', digest: digest('prompt'), portVersion: 'episode-v1' }, ...overrides };
  return { claim, commit, writer };
}
export const inspect = (f, id, extra = {}) => ok(f.core.getEpisode({ namespace: ns, episodeId: id, ...extra }));

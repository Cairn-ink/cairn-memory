import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

// Compare legacy bytes, excluding only generated identities and wall-clock values.
// Additive schema-only metadata is deliberately not projected into legacy parity.
export async function captureEpisodeParity(root, path, config) {
  const { openMemoryCore } = await import(pathToFileURL(root + '/core/index.mjs'));
  const { rationaleModel } = await import(pathToFileURL(root + '/core/testing/rationale-model.mjs'));
  const calls = [], model = rationaleModel();
  for (const method of ['extract', 'qualifyCandidates', 'classify']) {
    const run = model[method];
    if (run) model[method] = request => { calls.push([method, request]); return run(request); };
  }
  const core = openMemoryCore({ path, model, ...config });
  const input = { namespace: { ownerId: 'parity', scope: 'personal', projectId: null },
    client: 'scripted', sessionId: 'legacy-session', eventId: 'event',
    messages: [{ id: 'source', role: 'user', content: 'I prefer offline tools.' }] };
  let result, replay;
  try {
    result = await core.capture(input);
    replay = await core.capture(input);
    if (!result.ok) throw new Error(JSON.stringify(result));
  } finally { core.close(); }
  const db = new DatabaseSync(path);
  let rows;
  try {
    rows = Object.fromEntries(['memories', 'receipts', 'admission_claims'].map(name =>
      [name, db.prepare('SELECT * FROM ' + name).all()]));
    rows.memories = rows.memories.map(({ review_state, ...legacy }) => legacy);
    rows.staged_capture_evidence = db.prepare(`SELECT owner_id,scope,project_id,client,event_id,
      state,created_at,expires_at,payload,payload_bytes FROM staged_capture_evidence`).all();
  } finally { db.close(); }
  return JSON.parse(JSON.stringify({ calls, result, replay, rows }, (key, item) =>
    key === 'signal' ? undefined : typeof item === 'string' ? item
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'UUID')
      .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, 'TIME')
      : ['created_at', 'expires_at'].includes(key) && typeof item === 'number' ? 0 : item));
}

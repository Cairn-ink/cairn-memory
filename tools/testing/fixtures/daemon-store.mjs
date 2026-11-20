// Synthetic qualification input and independent SQLite-only inspection. The
// driver copies with a child cp; this module never opens the supplied source.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { openMemoryCore } from '../../../core/index.mjs';
import { captureLocal } from '../../../adapters/local/capture.mjs';

const [action, path, amount = '0', owner = 'synthetic-daemon-owner', project = ''] = process.argv.slice(2);
const namespace = { ownerId: owner, scope: project ? 'project' : 'personal', projectId: project || null };
const ok = result => { if (!result.ok) throw Error(JSON.stringify(result.error)); return result.value; };
async function capture(count, offset) {
  const core = openMemoryCore({ path, rawConversations: { mode: 'off', readPolicy: () => ({ generation: 'synthetic', reason: null }) } });
  let authority;
  try {
    const current = ok(core.getLocalCaptureControl({ namespace, client: 'claude-code' }));
    const granted = ok(core.setLocalCaptureControl({ namespace, client: 'claude-code', targetId: 'synthetic-daemon-qualification', expectedStoreId: current.storeId,
      expectedRevision: current.revision, automaticCaptureEnabled: true, rawNoticeVersion: 'local-plain-v1' }));
    authority = { version: 'local-capture-authority-v1', targetId: granted.targetId, storeId: granted.storeId, namespace, client: 'claude-code',
      expectedControlRevision: granted.revision, expectedConsentGeneration: granted.consentGeneration,
      expectedNamespaceGeneration: ok(core.getCaptureControl({ namespace })).generation,
      expectedRawRevision: ok(core.getRawCaptureControl({ ownerId: owner, client: 'claude-code' })).revision };
  } finally { await core.close(); }
  const config = { databasePath: path, authority, interpretation: 'raw-only', raw: { mode: 'local-plain-v1', capBytes: 512 * 1024 * 1024 }, timeouts: { captureMs: 120000 } };
  for (let i = 0; i < count; i += 20) {
    const session = 'synthetic-qualification-' + offset + '-' + i;
    const messages = Array.from({ length: Math.min(20, count-i) }, (_, j) => {
      const content = `Synthetic cobalt telescope conversation ${offset + i + j}. ` + 'Synthetic engineering observation and source discussion. '.repeat(12);
      return { id: randomUUID(), role: j % 2 ? 'assistant' : 'user', occurred_at: '2026-01-01T00:00:00.000Z', message_ordinal: j + 1,
        content, part: { index: 0, start: 0, totalUnits: content.length, totalBytes: Buffer.byteLength(content) } };
    });
    const result = await captureLocal(config, { version: 2, client: 'claude-code', session_id: session, event_id: session, messages }, { env: {}, fetchImpl: () => { throw Error('qualification_network_forbidden'); } });
    if (result.status !== 200) throw Error('qualification_raw_capture_failed:' + JSON.stringify(result.body));
  }
}
if (action === 'seed') {
  const core = openMemoryCore({ path, raw: false });
  try {
    for (let i=0;i<Number(amount);i++) ok(core.admit({ namespace, memory: { content: `Synthetic cobalt telescope memory ${i}. ` + 'Synthetic engineering decision and documented evidence. '.repeat(4), kind: 'fact' },
      receipts: [{ client: 'synthetic', sessionId: 'synthetic-seed-' + Math.floor(i/20), eventId: 'memory-' + i, role: 'user', excerpt: 'Synthetic cobalt telescope source ' + i }] }));
  } finally { await core.close(); }
  await capture(Number(amount), 0);
} else if (action === 'capture') await capture(Number(amount), randomUUID());
else if (action !== 'inspect') throw Error('qualification_store_action');
const db = new DatabaseSync(path, { readOnly: true });
try {
  const table = name => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  const ns = db.prepare('SELECT owner_id,scope,project_id FROM memories ORDER BY rowid LIMIT 1').get();
  console.log(JSON.stringify({ schema_digest: createHash('sha256').update(JSON.stringify(db.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name').all())).digest('hex'), schema_version: db.prepare('PRAGMA user_version').get().user_version,
    memories: db.prepare('SELECT count(*) n FROM memories WHERE deleted=0').get().n,
    raw_parts: table('raw_parts') ? db.prepare('SELECT count(*) n FROM raw_parts').get().n : 0,
    raw_conversations: table('raw_conversations') ? db.prepare('SELECT count(*) n FROM raw_conversations').get().n : 0,
    namespace: ns ? { ownerId: ns.owner_id, scope: ns.scope, projectId: ns.project_id || null } : namespace }));
} finally { db.close(); }

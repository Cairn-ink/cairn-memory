// Reference execution in a fresh child: no repository history is read at runtime.
// Only the privacy helper and its two new calls are replaced in reference mode.
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const [path, mode, operation, memoryId, expectedRevision] = process.argv.slice(2);
const referenceHide = "  function hideMemoryInside(ns, memory) {\n    required();\n    // Snapshot is taken under the very same write transaction as correction or\n    // forgetting, before any receipt deletion. Never read receipt text.\n    const receipts = db.prepare('SELECT client,session_id,created_at FROM receipts WHERE memory_id=?').all(memory.id);\n    const anchors = receipts.map(row => finiteTime(row.created_at)).filter(value => value !== null);\n    // A broken receipt clock must not prevent forgetting. Retain every valid\n    // receipt anchor and conservatively add both memory clocks on any gap.\n    if (anchors.length !== receipts.length || !receipts.length)\n      anchors.push(...[memory.created_at, memory.updated_at].map(finiteTime).filter(value => value !== null));\n    if (!anchors.length) fail('local_raw_hide_anchor_missing');\n    try {\n      for (const anchor of anchors) addWindowInside(ns, anchor - LOCAL_RAW_HIDE_WINDOW_MS, anchor + LOCAL_RAW_HIDE_WINDOW_MS);\n      for (const receipt of receipts) {\n        if (!['claude-code','codex'].includes(receipt.client) || !receipt.session_id || receipt.session_id === 'explicit-tool') continue;\n        // Persist only hashed keys, never a real client's session ID. If the\n        // receipt already carries a stored key, conservatively cover both forms.\n        const sessions = [hashSession(ns, receipt.client, receipt.session_id)];\n        if (/^s1:[a-f0-9]{64}$/.test(receipt.session_id)) sessions.push(receipt.session_id);\n        for (const session of new Set(sessions))\n          fenceInside(ns, receipt.client, session);\n      }\n      // Compatibility scans only conversations without a range row. Once\n      // filled, forget uses the range index and never revisits their messages.\n      const missing = db.prepare(`SELECT c.client,c.session_key FROM raw_conversations c\n        LEFT JOIN local_raw_session_ranges r ON r.owner_id=c.owner_id AND r.scope=c.scope AND r.project_id=c.project_id\n          AND r.client=c.client AND r.session_key=c.session_key\n        WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND r.session_key IS NULL`).all(...rawBoundary(ns));\n      for (const session of missing) saveRangeInside(ns, session.client, session.session_key, legacyRange(ns, session.client, session.session_key));\n      const matches = new Map();\n      for (const anchor of anchors) {\n        const sessions = db.prepare(`SELECT client,session_key FROM local_raw_session_ranges\n          WHERE ${nsWhere} AND unknown_time=0 AND min_ms<=? AND max_ms>=?\n          UNION ALL SELECT client,session_key FROM local_raw_session_ranges WHERE ${nsWhere} AND unknown_time=1`)\n          .all(...rawBoundary(ns), anchor + LOCAL_RAW_HIDE_WINDOW_MS, anchor - LOCAL_RAW_HIDE_WINDOW_MS, ...rawBoundary(ns));\n        for (const session of sessions) matches.set(JSON.stringify([session.client,session.session_key]), session);\n      }\n      for (const session of matches.values()) fenceInside(ns, session.client, session.session_key);\n    } catch (error) {\n      if (isStorageBusy(error)) throw error;\n      fail('local_raw_privacy_write_failed');\n    }\n  }\n";
if (mode === 'reference') registerHooks({ load(url, context, next) {
  const result = next(url, context);
  const decode = value => typeof value === 'string' ? value : Buffer.from(value).toString('utf8');
  if (url.endsWith('/core/runtime.mjs')) result.source = decode(result.source)
    .replaceAll('      localRawPrivacy?.invalidateMemoryEpisodesInside(ns, current, episodes);\n', '');
  if (url.endsWith('/core/local-authority-storage.mjs')) {
    const source = decode(result.source), start = source.indexOf('  function hideMemoryInside('), end = source.indexOf('  function readRange(', start);
    result.source = source.slice(0, start) + referenceHide + source.slice(end);
  }
  return result;
} });
// Both children use identical clocks and allocation streams, so unrelated
// receipt/suppression audit bytes cannot hide an unintended legacy change.
let allocation = 0;
crypto.randomUUID = () => '00000000-0000-4000-8000-' + (++allocation).toString(16).padStart(12, '0');
syncBuiltinESMExports();
const OriginalDate = Date;
globalThis.Date = class extends OriginalDate {
  constructor(...args) { super(...(args.length ? args : ['2030-01-02T03:04:05.000Z'])); }
  static now() { return OriginalDate.parse('2030-01-02T03:04:05.000Z'); }
};
const { openMemoryCore } = await import('../../../../core/index.mjs');
const core = openMemoryCore({ path, raw: true, rawSearch: false });
const input = { namespace: { ownerId: 'synthetic-local', scope: 'personal', projectId: null }, memoryId, expectedRevision: Number(expectedRevision) };
let result;
try { result = await core[operation]({ ...input, ...(operation === 'correct' ? {
  content: 'synthetic corrected replacement', kind: 'context', receipt: { client: 'cairn-local-mcp', sessionId: 'explicit-tool',
    eventId: 'correction', role: 'user', excerpt: 'Explicit replacement.' } } : {}) }); }
finally { await core.close(); }
const db = new DatabaseSync(path), tables = {};
try {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  for (const { name } of db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all())
    tables[name] = db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"').all().map(row => JSON.stringify(row)).sort();
} finally { db.close(); }
process.stdout.write(JSON.stringify({ result, tables, digest: crypto.createHash('sha256').update(readFileSync(path)).digest('hex') }));

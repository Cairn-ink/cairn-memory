import { cachedContentLayout, installedContentLayout } from './content-safety-schema.mjs';
import { contentSuppressionTargetMatches, writeContentSuppressionInside, contentSuppressionReasonInside } from './content-suppression-storage.mjs';
import { createHash, createHmac } from 'node:crypto';
import { fail } from './validation.mjs';
import { createRawSourceRoots, rawSessionKeys } from './raw-source-roots.mjs';
import { createRawCardInvalidation } from './card-raw-sources.mjs';

const boundary = ns => [ns.ownerId, ns.scope, ns.projectId || ''];
// Internal evidence is projected by Episode SELECTs, never by a serving callback.
// Each LIMIT retains one overflow row. Validators refuse it; absence is never
// inferred from a truncated set. Raw exclusions/fences are indexed EXISTS proofs.
const episodeProofLimit = 4096;
const sha = value => createHash('sha256').update(value).digest('hex');
const receiptDigest = value => sha(JSON.stringify(value));
const episodeTargetKey = target => JSON.stringify([target.kind,target.key,target.revision,target.version,target.messageId,target.start,target.end]);
const lineageDigest = (secret, value) => createHmac('sha256', Buffer.from(secret, 'hex')).update(JSON.stringify(value)).digest('hex');
export function episodeSourceKeys(ns, headers, secret) {
  const sources = headers.flatMap(row => row.sources);
  const raw = secret !== undefined;
  const identityAvailable = typeof secret === 'string' && /^[0-9a-f]{64}$/.test(secret);
  const hmac = value => lineageDigest(secret, value);
  return sources.map(source => ({ id: source.id,
    // Missing identity is explicit incomplete evidence. Defer its refusal until
    // after origin/receipt denials, in the old validator's decision order.
    ...(raw ? { identityAvailable } : {}),
    ...(!raw || !identityAvailable ? {} : { session: source.session,
      hashed: rawSessionKeys(ns, source.client, source.session, secret)[1],
      sourceKey: hmac(['raw-source-v1', source.role, source.text]) }) }));
}
// Flat, request-wide enumeration precedes every nested JSON aggregate. Each
// stage retains at most the shared allowance plus one overflow witness. Receipt
// identity has no leading index: bound the indexed inputs before filtering, and
// explicitly ask the conservative validator to finish an incomplete enumeration.
export function episodeSourceEvidenceCTE(raw) {
  const count = name => `(SELECT count(*) FROM ${name})`;
  const allowance = names => `max(0,4097-${names.map(count).join('-')})`;
  const prior = ['proof_sources','proof_parents'];
  const ancestry = raw ? `SELECT p.source_id,p.id receipt_id,l.conversation_id,l.message_id,l.start,l.end,
      c.owner_id,c.scope,c.project_id FROM proof_parents p
      CROSS JOIN proof_ancestry_input l ON l.memory_id=p.memory_id
      LEFT JOIN raw_conversations c ON c.id=l.conversation_id LIMIT ${allowance(prior)}`
    : `SELECT NULL source_id,NULL receipt_id,NULL conversation_id,NULL message_id,NULL start,NULL end,
        NULL owner_id,NULL scope,NULL project_id WHERE 0`;
  prior.push('proof_ancestry');
  const roots = raw ? `SELECT s.id source_id,r.id,m.role,m.total_units,
      EXISTS(SELECT 1 FROM raw_source_maps a WHERE a.conversation_id=r.id AND a.message_id=s.message_id) known,
      EXISTS(SELECT 1 FROM raw_source_exclusions x WHERE x.conversation_id=r.id AND x.message_id=s.message_id
        AND x.start<m.total_units AND x.end>0) excluded
      FROM proof_sources s CROSS JOIN raw_conversations r
      CROSS JOIN raw_messages m ON m.conversation_id=r.id AND m.message_id=s.message_id
      WHERE r.owner_id=s.read_owner AND r.scope=s.read_scope AND r.project_id=s.read_project
        AND r.client=s.origin_client AND r.session_key IN (s.session,s.hashed)
      LIMIT ${allowance(prior)}`
    : `SELECT NULL source_id,NULL id,NULL role,NULL total_units,NULL known,NULL excluded WHERE 0`;
  prior.push('proof_raw');
  const maps = raw ? `SELECT r.source_id,r.id conversation_id,a.start,a.end,a.precision,
      EXISTS(SELECT 1 FROM raw_source_exclusions x WHERE x.conversation_id=a.conversation_id
        AND x.message_id=a.message_id AND x.start<a.end AND x.end>a.start) excluded
      FROM proof_raw r JOIN proof_sources s ON s.id=r.source_id
      CROSS JOIN raw_source_maps a ON a.conversation_id=r.id AND a.message_id=s.message_id AND a.source_key=s.source_key
      LIMIT ${allowance(prior)}`
    : `SELECT NULL source_id,NULL conversation_id,NULL start,NULL end,NULL precision,NULL excluded WHERE 0`;
  const scalar = (table, fields) => `SELECT *,json_object(${fields.map(f => `'${f}',${f}`).join(',')}) payload FROM ${table}
    WHERE (SELECT rows<=4096 AND ancestry_input<=4096 FROM proof_size)
      AND (SELECT bytes FROM proof_bytes)<=(SELECT bytes FROM proof_budget)`;
  const sourceFields = ['key_present','identity_available','id','ordinal','digest','text','role','message_id',
    'origin_client','origin_session','owner_id','scope','project_id','deleted','fenced'];
  const sizes = { proof_sources: sourceFields,
    proof_parents: ['id','memory_id','receipt_key','memory_revision','memory_deleted'],
    proof_ancestry: ['conversation_id','message_id','start','end','owner_id','scope','project_id'],
    proof_raw: ['id','role','total_units','known','excluded'], proof_maps: ['start','end','precision','excluded'] };
  return `proof_budget AS MATERIALIZED (SELECT ? bytes),proof_sources AS MATERIALIZED (
      SELECT s.*,c.owner_id read_owner,c.scope read_scope,c.project_id read_project,
        o.client origin_client,o.session_key origin_session,o.owner_id,o.scope,o.project_id,o.deleted,
        k.value IS NOT NULL key_present,json_extract(k.value,'$.identityAvailable') identity_available,
        json_extract(k.value,'$.session') session,json_extract(k.value,'$.hashed') hashed,
        json_extract(k.value,'$.sourceKey') source_key,
        ${raw ? `EXISTS(SELECT 1 FROM raw_session_fences f WHERE f.owner_id=c.owner_id AND f.scope=c.scope
          AND f.project_id=c.project_id AND f.client=o.client AND f.session_key IN
          (json_extract(k.value,'$.session'),json_extract(k.value,'$.hashed')))` : '0'} fenced
      FROM candidates c CROSS JOIN episode_sources s INDEXED BY episode_source_page ON s.episode_id=c.id
      LEFT JOIN session_episodes o ON o.id=s.origin_episode_id
      LEFT JOIN source_keys k ON json_extract(k.value,'$.id')=s.id LIMIT 817),
    proof_memories AS MATERIALIZED (
      SELECT m.id,m.revision,m.deleted FROM memories m INDEXED BY namespace_memories
      WHERE (m.owner_id,m.scope,m.project_id)=(SELECT owner_id,scope,project_id FROM candidates LIMIT 1) LIMIT 4097),
    proof_receipt_input AS MATERIALIZED (
      SELECT r.rowid receipt_row,m.id memory_id,m.revision memory_revision,m.deleted memory_deleted
      FROM proof_memories m CROSS JOIN receipts r INDEXED BY memory_receipts ON r.memory_id=m.id LIMIT 4097),
    proof_incomplete AS MATERIALIZED (SELECT ${count('proof_memories')}>4096 OR ${count('proof_receipt_input')}>4096 value),
    proof_parents AS MATERIALIZED (
      SELECT s.id source_id,r.id,r.memory_id,r.receipt_key,p.memory_revision,p.memory_deleted
      FROM proof_sources s CROSS JOIN proof_receipt_input p CROSS JOIN receipts r ON r.rowid=p.receipt_row
      WHERE NOT (SELECT value FROM proof_incomplete) AND r.client=s.origin_client AND r.session_id=s.origin_session
        AND r.event_id=s.message_id AND r.role=s.role AND r.excerpt=s.text LIMIT ${allowance(['proof_sources'])}),
    proof_ancestry_input AS MATERIALIZED (${raw ? `
      SELECT p.memory_id,l.conversation_id,l.message_id,l.start,l.end
      FROM (SELECT DISTINCT memory_id FROM proof_parents) p
      CROSS JOIN receipts ar INDEXED BY memory_receipts ON ar.memory_id=p.memory_id
      CROSS JOIN raw_receipt_lineage l ON l.receipt_id=ar.id LIMIT 4097` : `
      SELECT NULL memory_id,NULL conversation_id,NULL message_id,NULL start,NULL end WHERE 0`}),
    proof_ancestry AS MATERIALIZED (${ancestry}),
    proof_raw AS MATERIALIZED (${roots}),
    proof_maps AS MATERIALIZED (${maps}),
    proof_size AS MATERIALIZED (SELECT ${['proof_sources','proof_parents','proof_ancestry','proof_raw','proof_maps'].map(count).join('+')} rows,
      ${count('proof_memories')} memories,${count('proof_receipt_input')} receipts,
      ${count('proof_ancestry_input')} ancestry_input,
      ${count('proof_ancestry')} ancestry,${count('proof_parents')} parents,
      ${count('proof_sources')} sources,${count('proof_raw')} roots,${count('proof_maps')} maps),
    proof_bytes AS MATERIALIZED (SELECT ${Object.entries(sizes).map(([table,fields]) =>
      `coalesce((SELECT sum(${fields.map(f => `coalesce(length(CAST(${f} AS BLOB)),0)`).join('+')}) FROM ${table}),0)`).join('+')} bytes),
    proof_source_json AS MATERIALIZED (${scalar('proof_sources', sourceFields)}),
    proof_parent_json AS MATERIALIZED (${scalar('proof_parents',['id','memory_id','receipt_key','memory_revision','memory_deleted'])}),
    proof_ancestry_json AS MATERIALIZED (${scalar('proof_ancestry',['conversation_id','message_id','start','end','owner_id','scope','project_id'])}),
    proof_raw_json AS MATERIALIZED (${scalar('proof_raw',['id','role','total_units','known','excluded'])}),
    proof_map_json AS MATERIALIZED (${scalar('proof_maps',['start','end','precision','excluded'])}),
    proof_state AS MATERIALIZED (SELECT *,rows>4096 OR ancestry_input>4096 OR
      (SELECT bytes FROM proof_bytes)>(SELECT bytes FROM proof_budget) OR
      ${['proof_source_json','proof_parent_json','proof_ancestry_json','proof_raw_json','proof_map_json'].map(name =>
        `coalesce((SELECT sum(length(CAST(payload AS BLOB))+64) FROM ${name}),0)`).join('+')}>(SELECT bytes FROM proof_budget) overflow FROM proof_size)`;
}
export function episodeSourceEvidenceSQL() {
  // No JSON ancestry or maps are built on overflow. Scalar payloads and the
  // structural allowance above charge the aggregate state before nesting it.
  return `CASE WHEN (SELECT overflow FROM proof_state) THEN '[]' ELSE
    (SELECT json_group_array(json_patch(s.payload,json_object(
      'receipts',json((SELECT json_group_array(json_patch(p.payload,json_object('ancestry',json((
        SELECT json_group_array(json(a.payload)) FROM proof_ancestry_json a WHERE a.source_id=s.id AND a.receipt_id=p.id)))))
        FROM proof_parent_json p WHERE p.source_id=s.id)),
      'raw',json((SELECT json_group_array(json_patch(r.payload,json_object('maps',json((
        SELECT json_group_array(json(m.payload)) FROM proof_map_json m WHERE m.source_id=s.id AND m.conversation_id=r.id)))))
        FROM proof_raw_json r WHERE r.source_id=s.id)))))
      FROM proof_source_json s WHERE s.episode_id=c.id) END`;
}
/** Data only: no DB, no callback, no serving-predicate re-entry. */
export function assertEpisodeSourceProof(ns, sources, facts, budget = { remaining: episodeProofLimit }, indexedDenials) {
  if (!Array.isArray(sources) || sources.length > 16 || !Array.isArray(facts)) fail('episode_sources_unavailable');
  const denied = target => indexedDenials?.has(episodeTargetKey(target)) || facts.some(fact => {
    if (fact.owner_id !== ns.ownerId || fact.scope !== 'owner' && (fact.scope !== ns.scope || fact.project_id !== (ns.projectId || '')) ||
        !['owner','namespace'].includes(fact.match_mode) && (fact.kind !== target.kind || fact.stable_key !== target.key)) return false;
    // The shared matcher returns true only for eligible matches. Preserve its
    // serving caller's separate fail-closed treatment of ineligible versions.
    if (fact.match_mode === 'version') {
      if (target.version === undefined) return true;
      const bound = JSON.parse(fact.source_version);
      if (target.kind === 'memory' && (bound.length !== 2 || bound[0] !== 'memory-revision-v1' || !Number.isSafeInteger(bound[1]) || bound[1] < 1)) return true;
    }
    if (fact.match_mode === 'revision-through' && !Number.isSafeInteger(target.revision)) return true;
    if (fact.match_mode === 'span' && ![fact.span_start,fact.span_end].every(Number.isSafeInteger)) return true;
    return contentSuppressionTargetMatches(fact, ns, target);
  });
  if (denied({})) fail('episode_not_found');
  if (sources.some(s => s.deleted || s.owner_id !== ns.ownerId || s.scope !== ns.scope || s.project_id !== (ns.projectId || ''))) fail('revision_conflict');
  const charge = rows => { budget.remaining -= rows.length; if (rows.length > episodeProofLimit || budget.remaining < 0) fail('episode_sources_unavailable'); };
  charge(sources);
  // Match the old decision order: all receipt parents precede Raw checks.
  for (const source of sources) {
    if (!source.key_present || !Number.isSafeInteger(source.ordinal)) fail('episode_sources_unavailable');
    charge(source.receipts);
    // Native SQLite row reads refuse non-representable integers. JSON numbers
    // must not silently round them into usable canonical versions instead.
    if (source.receipts.some(row => !Number.isSafeInteger(row.memory_revision) || row.memory_revision < 1)) fail('source_excluded');
    const receipt = { client: source.origin_client, sessionId: source.origin_session,
      eventId: source.message_id, role: source.role, excerpt: source.text };
    for (const row of source.receipts) {
      if (row.memory_deleted || receiptDigest(receipt) !== row.receipt_key ||
          denied({ kind: 'memory', key: row.memory_id, revision: row.memory_revision,
            version: JSON.stringify(['memory-revision-v1', row.memory_revision]) }) ||
          denied({ kind: 'receipt', key: row.id })) fail('source_excluded');
      charge(row.ancestry);
      for (const anchor of row.ancestry) if (anchor.owner_id !== ns.ownerId || anchor.scope !== ns.scope || anchor.project_id !== (ns.projectId || '') ||
          !Number.isSafeInteger(anchor.start) || !Number.isSafeInteger(anchor.end) || anchor.start < 0 || anchor.end <= anchor.start ||
          denied({ kind: 'raw', key: anchor.conversation_id, messageId: anchor.message_id, start: anchor.start, end: anchor.end })) fail('source_excluded');
    }
  }
  for (const source of sources) {
    if (source.identity_available === 0) fail('episode_identity_unavailable');
    if (source.fenced) fail('conversation_deleted');
    charge(source.raw);
    if (source.raw.length > 1) fail('raw_lineage_unavailable');
    for (const row of source.raw) {
      if (row.role !== source.role) fail('event_payload_conflict');
      charge(row.maps);
      if (!row.maps.length && row.known) fail('raw_lineage_unavailable');
      const maps = row.maps.length ? row.maps : [{ start: 0, end: row.total_units, precision: 'whole-message', excluded: row.excluded }];
      for (const span of maps) {
        if (!Number.isSafeInteger(row.total_units) || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) ||
            span.start < 0 || span.end <= span.start || span.end > row.total_units || !['exact','whole-message'].includes(span.precision) ||
            span.precision === 'whole-message' && (span.start !== 0 || span.end !== row.total_units)) fail('raw_lineage_unavailable');
        if (denied({ kind: 'raw', key: row.id, messageId: source.message_id, start: span.start, end: span.end }) || span.excluded) fail('source_excluded');
      }
    }
  }
  // Source digest integrity is an added refusal, after the existing denials.
  for (const source of sources) if (sha(source.text) !== source.digest) fail('revision_conflict');
}

/** Schema-presence driven: current option-off writers enforce retained fences. */
export function createRawLineageStorage(db, { readMemo } = {}) {
  const roots = createRawSourceRoots(db, { readMemo });
  const rawCards = createRawCardInvalidation(db);
  let available;
  const enabled = () => available === true || (available = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE name='raw_source_maps'").get()));
  const digest = value => lineageDigest(db.prepare('SELECT secret FROM episode_identity WHERE singleton=1').get().secret, value);
  const sourceKey = receipt => digest(['raw-source-v1', receipt.role, receipt.excerpt]);
  const sessionKey = (ns, client, session) => 's1:' + digest(['episode-v1', ...boundary(ns), client, session]);

  function register(conversationId, maps) {
    if (!enabled()) return;
    if (!db.isTransaction) fail('raw_transaction_required');
    const insert = db.prepare('INSERT OR IGNORE INTO raw_source_maps VALUES(?,?,?,?,?,?)');
    for (const map of maps) for (const entry of map.entries) insert.run(conversationId, map.messageId,
      sourceKey({ role: map.role, excerpt: entry.excerpt }), entry.start, entry.end, entry.precision);
  }

  function anchors(ns, receipt) {
    if (!enabled()) return [];
    const hashed = sessionKey(ns, receipt.client, receipt.sessionId);
    const rows = db.prepare(`SELECT c.id,m.total_units,m.role FROM raw_conversations c JOIN raw_messages m ON m.conversation_id=c.id
      WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND c.client=? AND c.session_key IN (?,?) AND m.message_id=?`)
      .all(...boundary(ns), receipt.client, receipt.sessionId, hashed, receipt.eventId);
    if (rows.length > 1) fail('raw_lineage_unavailable');
    if (!rows.length) return [];
    const row = rows[0];
    if (row.role !== receipt.role) fail('event_payload_conflict');
    const maps = db.prepare('SELECT start,end,precision FROM raw_source_maps WHERE conversation_id=? AND message_id=? AND source_key=?')
      .all(row.id, receipt.eventId, sourceKey(receipt));
    const known = db.prepare('SELECT 1 FROM raw_source_maps WHERE conversation_id=? AND message_id=?').get(row.id, receipt.eventId);
    if (!maps.length && known) fail('raw_lineage_unavailable');
    return (maps.length ? maps : [{ start: 0, end: row.total_units, precision: 'whole-message' }])
      .map(span => ({ conversationId: row.id, messageId: receipt.eventId, ...span }));
  }

  function assertAnchors(values) {
    for (const anchor of values) if (db.prepare(`SELECT 1 FROM raw_source_exclusions WHERE conversation_id=? AND message_id=?
      AND start<? AND end>?`).get(anchor.conversationId, anchor.messageId, anchor.end, anchor.start)) fail('source_excluded');
  }
  function assertReceipts(ns, receipts, readExisting = false, rawTargets) {
    if (!readExisting && (cachedContentLayout(db)??installedContentLayout(db)).suppressionRevision) {
      if (contentSuppressionReasonInside(db, ns)) fail('source_excluded');
      for (const receipt of receipts) {
        const rows = db.prepare(`SELECT r.*,m.revision AS memory_revision,m.deleted AS memory_deleted FROM receipts r JOIN memories m ON m.id=r.memory_id
          WHERE m.owner_id=? AND m.scope=? AND m.project_id=? AND r.client=? AND r.session_id=? AND r.event_id=? AND r.role=? AND r.excerpt=?`)
          .all(...boundary(ns), receipt.client, receipt.sessionId, receipt.eventId, receipt.role, receipt.excerpt);
        for (const row of rows) {
          // Preserve the old history decision's canonical identity checks here,
          // without calling back into a read entry from lineage validation.
          const source = { client: row.client, sessionId: row.session_id, eventId: row.event_id, role: row.role, excerpt: row.excerpt };
          if (row.memory_deleted || receiptDigest(source) !== row.receipt_key ||
              contentSuppressionReasonInside(db, ns, { kind: 'memory', key: row.memory_id,
                revision: row.memory_revision, version: JSON.stringify(['memory-revision-v1', row.memory_revision]) }) ||
              contentSuppressionReasonInside(db, ns, { kind: 'receipt', key: row.id })) fail('source_excluded');
        }
      }
    }
    if (!enabled()) return;
    for (const receipt of receipts) {
      roots.assertSession(ns, receipt.client, receipt.sessionId, readExisting);
      const values = anchors(ns, receipt);
      for (const anchor of values) if (!readExisting && contentSuppressionReasonInside(db, ns, { kind: 'raw', key: anchor.conversationId,
        messageId: anchor.messageId, start: anchor.start, end: anchor.end })) fail('source_excluded');
      assertAnchors(values);
      rawTargets?.push(...values);
    }
  }
  // Only fallback reads complete missing receipt inputs or seek facts by key.
  // Return data (never a predicate callback) to the same pure validator. Limits
  // are checked while enumerating, before any nested JSON can be constructed.
  function completeEpisodeProof(ns, sources, budget, incomplete) {
    const denials = new Set();
    // The pure validator retains origin precedence over later matching errors.
    if (sources.some(s => s.deleted || s.owner_id !== ns.ownerId || s.scope !== ns.scope || s.project_id !== (ns.projectId || ''))) return denials;
    let remaining = budget.remaining - sources.length - sources.reduce((n,s) => n+s.raw.length+s.raw.reduce((a,r) => a+r.maps.length,0),0);
    const charge = rows => {
      remaining -= rows.length;
      if (remaining < 0) fail('episode_sources_unavailable');
      for (const row of rows) budget.bytesRemaining -= Buffer.byteLength(JSON.stringify(row),'utf8')+64;
      if (budget.bytesRemaining < 0) fail('episode_sources_unavailable');
    };
    const observe = target => { if (contentSuppressionReasonInside(db, ns, target)) denials.add(episodeTargetKey(target)); };
    for (const source of sources) {
      const receipt = { client: source.origin_client, sessionId: source.origin_session,
        eventId: source.message_id, role: source.role, excerpt: source.text };
      if (incomplete) {
        source.receipts = db.prepare(`SELECT r.id,r.memory_id,r.receipt_key,
          m.revision memory_revision,m.deleted memory_deleted FROM memories m INDEXED BY namespace_memories
          CROSS JOIN receipts r INDEXED BY memory_receipts ON r.memory_id=m.id
          WHERE m.owner_id=? AND m.scope=? AND m.project_id=? AND r.client=? AND r.session_id=?
            AND r.event_id=? AND r.role=? AND r.excerpt=? LIMIT ?`)
          .all(...boundary(ns), receipt.client, receipt.sessionId, receipt.eventId, receipt.role, receipt.excerpt, maxAllowance());
        charge(source.receipts);
      }
      for (const parent of source.receipts) {
        if (incomplete) {
          parent.ancestry = cachedContentLayout(db).rawLineage ? db.prepare(`
            SELECT l.conversation_id,l.message_id,l.start,l.end,c.owner_id,c.scope,c.project_id
            FROM receipts r INDEXED BY memory_receipts CROSS JOIN raw_receipt_lineage l ON l.receipt_id=r.id
            LEFT JOIN raw_conversations c ON c.id=l.conversation_id WHERE r.memory_id=? LIMIT ?`)
            .all(parent.memory_id,maxAllowance()) : [];
          charge(parent.ancestry);
        }
        observe({ kind: 'memory', key: parent.memory_id, revision: parent.memory_revision,
          version: JSON.stringify(['memory-revision-v1', parent.memory_revision]) });
        observe({ kind: 'receipt', key: parent.id });
        for (const anchor of parent.ancestry) observe({ kind: 'raw', key: anchor.conversation_id,
          messageId: anchor.message_id, start: anchor.start, end: anchor.end });
      }
    }
    for (const source of sources) for (const root of source.raw) {
      const maps = root.maps.length ? root.maps : [{ start: 0, end: root.total_units }];
      for (const span of maps) observe({ kind: 'raw', key: root.id, messageId: source.message_id, start: span.start, end: span.end });
    }
    return denials;
    function maxAllowance() { if (remaining < 0) fail('episode_sources_unavailable'); return remaining+1; }
  }
  // Canonical readers and qualified automatic dedup inspect original anchor rows.
  // The admission transaction owns all reads; no Raw body is opened or rewritten.
  function assertStoredReceipts(ns, receipts, { readExisting = false, rawTargets } = {}) {
    if (!db.isTransaction) fail('raw_transaction_required');
    const required = ['raw_conversations','raw_messages','raw_source_maps','raw_receipt_lineage',
      'raw_receipt_origins','raw_source_exclusions','raw_deletion_actions','raw_session_fences',
      'raw_job_sources','episode_identity','session_episodes','episode_messages','episode_sources',
      'episode_memory_links','episode_keep_actions'];
    const tables = readExisting && readMemo?.get('lineage-tables') || new Set(db.prepare(`SELECT name FROM sqlite_master WHERE type='table'
      AND name IN (${required.map(() => '?').join(',')})`).all(...required).map(row => row.name));
    if (readExisting) readMemo?.set('lineage-tables', tables);
    if (!['raw_conversations','raw_source_maps','raw_receipt_lineage','raw_deletion_actions'].some(name => tables.has(name))) return;
    const deletion = tables.has('raw_deletion_actions') || tables.has('raw_job_sources');
    const inspected = readExisting && !deletion ? required.filter(name => !['raw_deletion_actions','raw_job_sources'].includes(name)) : required;
    if (inspected.some(name => !tables.has(name))) fail('raw_lineage_unavailable');
    for (const receipt of receipts) {
      const stored = db.prepare(`SELECT l.conversation_id AS conversationId,l.message_id AS messageId,l.start,l.end,l.precision,
        c.owner_id,c.scope,c.project_id,c.client,c.session_key,m.role,m.total_units
        FROM raw_receipt_lineage l LEFT JOIN raw_conversations c ON c.id=l.conversation_id
        LEFT JOIN raw_messages m ON m.conversation_id=l.conversation_id AND m.message_id=l.message_id
        WHERE l.receipt_id=?`).all(receipt.id);
      for (const anchor of stored) {
        if (anchor.owner_id !== ns.ownerId || anchor.scope !== ns.scope || anchor.project_id !== (ns.projectId || '') ||
            anchor.role !== receipt.role || anchor.messageId !== receipt.event_id ||
            !Number.isSafeInteger(anchor.total_units) || !Number.isSafeInteger(anchor.start) ||
            !Number.isSafeInteger(anchor.end) || anchor.start < 0 || anchor.end <= anchor.start || anchor.end > anchor.total_units ||
            !['exact','whole-message'].includes(anchor.precision) ||
            anchor.precision === 'whole-message' && (anchor.start !== 0 || anchor.end !== anchor.total_units)) fail('raw_lineage_unavailable');
        roots.assertSession(ns, anchor.client, anchor.session_key, readExisting);
      }
      assertAnchors(stored);
      // A proven empty source session and absent keep links are reusable root facts.
      if (readExisting && readMemo && !stored.length) {
        const key = JSON.stringify(['memory-links', receipt.memory_id]);
        if (!readMemo.has(key)) readMemo.set(key, Boolean(db.prepare('SELECT 1 FROM episode_memory_links WHERE memory_id=? LIMIT 1').get(receipt.memory_id)));
        if (!readMemo.get(key) && roots.emptySession(ns, receipt) &&
            db.prepare('SELECT kind FROM raw_receipt_origins WHERE receipt_id=?').get(receipt.id)?.kind !== 'derived') {
          roots.assertSession(ns, receipt.client, receipt.session_id, true); continue;
        }
      }
      const authority = roots.receipt(ns, receipt, readExisting);
      // Pre-Raw receipts retain their ordinary read contract; this does not classify them.
      if (readExisting && authority.unknown && !authority.legacyKeep && !stored.length &&
          !db.prepare("SELECT 1 FROM raw_receipt_origins WHERE receipt_id=? AND kind='derived'").get(receipt.id) &&
          !db.prepare(`SELECT 1 FROM episode_memory_links l JOIN json_each(l.receipt_ids) r
            WHERE l.memory_id=? AND r.value=? LIMIT 1`).get(receipt.memory_id, receipt.id)) {
        assertReceipts(ns, [{ client: receipt.client, sessionId: receipt.session_id,
          eventId: receipt.event_id, role: receipt.role, excerpt: receipt.excerpt }], true, rawTargets);
        continue;
      }
      if (authority.unknown || authority.legacyKeep && authority.roots.length !== 1) fail('raw_lineage_unavailable');
      if (authority.independent) roots.assertSession(ns, receipt.client, receipt.session_id, readExisting);
      for (const root of authority.roots) {
        roots.assertSession(ns, root.client, root.sessionKey, readExisting);
        const episodeId = root.episodeId ?? root.episode_id;
        if (episodeId) {
          const episode = db.prepare(`SELECT deleted FROM session_episodes WHERE owner_id=? AND scope=? AND project_id=?
            AND id=? AND client=? AND session_key=?`).get(...boundary(ns), episodeId, root.client, root.sessionKey);
          if (!episode) fail('raw_lineage_unavailable');
          if (episode.deleted) fail('conversation_deleted');
        }
        if (!stored.length) {
          const values = anchors(ns, { client: root.client, sessionId: root.sessionKey,
            eventId: receipt.event_id, role: receipt.role, excerpt: receipt.excerpt });
          assertAnchors(values); rawTargets?.push(...values);
        }
      }
    }
  }
  function attach(ns, receiptId, receipt, origin) {
    if (!enabled()) return;
    const values = anchors(ns, receipt);
    assertAnchors(values);
    const insert = db.prepare('INSERT OR IGNORE INTO raw_receipt_lineage VALUES(?,?,?,?,?,?)');
    let changed = 0;
    for (const anchor of values) changed += insert.run(receiptId, anchor.conversationId, anchor.messageId,
      anchor.start, anchor.end, anchor.precision).changes;
    const kind = values.length ? 'derived' : origin === 'independent' ? 'independent' : 'unknown';
    const previous = db.prepare('SELECT kind FROM raw_receipt_origins WHERE receipt_id=?').get(receiptId)?.kind;
    db.prepare(`INSERT INTO raw_receipt_origins VALUES(?,?) ON CONFLICT(receipt_id) DO UPDATE SET
      kind=CASE WHEN excluded.kind='derived' OR raw_receipt_origins.kind='derived' THEN 'derived'
        ELSE raw_receipt_origins.kind END`).run(receiptId, kind);
    return changed > 0 || previous === undefined || previous !== kind && kind === 'derived';
  }
  function excludeMemory(ns, memoryId, suppression = { reason: 'purge', actionId: 'source-exclusion-'+memoryId }) {
    if (!enabled()) return;
    if (!db.isTransaction) fail('raw_transaction_required');
    // An opted-in schema may serve ordinary-only namespaces too. There is no
    // retained Raw to exclude there; missing legacy keep proof must not turn
    // ordinary correction/forgetting into a new provenance-repair requirement.
    if (!db.prepare('SELECT 1 FROM raw_conversations WHERE owner_id=? AND scope=? AND project_id=? LIMIT 1')
      .get(...boundary(ns))) return;
    // Resolve before any receipt/source purge; historical Memory is included.
    const receipts = db.prepare('SELECT * FROM receipts WHERE memory_id=?').all(memoryId);
    const values = receipts.flatMap(receipt => {
      const stored = db.prepare(`SELECT conversation_id AS conversationId,message_id AS messageId,start,end,precision
        FROM raw_receipt_lineage WHERE receipt_id=?`).all(receipt.id);
      if (stored.length) return stored;
      const authority = roots.receipt(ns,receipt);
      if (authority.legacyKeep) {
        if (authority.unknown) fail('raw_lineage_unavailable');
        return authority.roots.flatMap(root => anchors(ns,{ client: root.client,sessionId: root.sessionKey,
          eventId: receipt.event_id,role: receipt.role,excerpt: receipt.excerpt }));
      }
      return anchors(ns, { client: receipt.client, sessionId: receipt.session_id,
        eventId: receipt.event_id, role: receipt.role, excerpt: receipt.excerpt });
    });
    if (!values.length) return;
    return rawCards.mutate(ns,'source-exclusion-'+memoryId,() => {
      rawCards.collect(ns,values);
      db.prepare(`INSERT INTO raw_exclusion_clocks VALUES(?,?,?,1) ON CONFLICT(owner_id,scope,project_id)
        DO UPDATE SET generation=generation+1`).run(...boundary(ns));
      const generation = db.prepare('SELECT generation FROM raw_exclusion_clocks WHERE owner_id=? AND scope=? AND project_id=?')
        .get(...boundary(ns)).generation;
      const insert = db.prepare('INSERT OR IGNORE INTO raw_source_exclusions VALUES(?,?,?,?,?)');
      for (const anchor of values) {
        writeContentSuppressionInside(db, { namespace: ns, kind: 'raw', key: anchor.conversationId, matchMode: 'span',
          messageId: anchor.messageId, start: anchor.start, end: anchor.end, ...suppression });
        insert.run(anchor.conversationId, anchor.messageId, anchor.start, anchor.end, generation);
      }
    });
  }
  function filter(ns, receipts) {
    const layout = cachedContentLayout(db);
    if (!layout) fail('unsupported_database');
    if (!layout.suppressionRevision && !enabled()) return receipts.map((_, index) => index);
    return receipts.flatMap((receipt, index) => {
      try { assertReceipts(ns, [receipt]); return [index]; }
      catch (error) { if (error.code === 'source_excluded') return []; throw error; }
    });
  }
  return { assertEpisodeProof: assertEpisodeSourceProof, completeEpisodeProof, register, attach, assertReceipts, assertStoredReceipts, excludeMemory, filter, enabled };
}

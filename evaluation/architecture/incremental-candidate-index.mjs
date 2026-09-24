// Offline synthetic experiment only. Never accept an existing database path.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openMemoryCore } from '../../core/contract.mjs';
import { fingerprint } from '../../core/validation.mjs';

export const FIXTURE = Object.freeze(JSON.parse(readFileSync(fileURLToPath(
  new URL('./incremental-candidate-index-fixtures.json', import.meta.url)), 'utf8')));
export const NAMESPACE = Object.freeze({ ownerId: 'ci-synthetic-owner', scope: 'project', projectId: 'authorized' });
export const FOREIGN = Object.freeze({ ...NAMESPACE, projectId: 'foreign' });
const SQLITE_NS = ns => [ns.ownerId, ns.scope, ns.projectId];
const WORDS = /[\p{L}\p{N}]+/gu;
const ASCII = /^[a-z0-9]+$/u;
const MAX_SQLITE_POSTING_UNKNOWN = 'unknown';
const uuid = (prefix, ordinal) => `${prefix}-0000-4000-8000-${String(ordinal).padStart(12, '0')}`;
const receiptId = ordinal => uuid('20000000', ordinal);
const memoryId = ordinal => uuid('00000000', ordinal);
const foreignId = ordinal => uuid('10000000', ordinal);
const checked = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const terms = text => [...new Set([...text.matchAll(WORDS)].map(match => match[0].toLowerCase())
  .filter(word => ASCII.test(word)))];
const score = (wanted, text) => {
  const found = new Set();
  for (const match of text.matchAll(WORDS)) {
    const word = match[0].toLowerCase();
    if (wanted.has(word)) found.add(word);
  }
  return found.size;
};
const elapsed = start => Math.max(0, performance.now() - start);
const safeTime = value => Number.isFinite(value) && value >= 0 ? value : null;

export function preflightFts() {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`PRAGMA trusted_schema=OFF;
      CREATE TABLE ci_probe(id INTEGER PRIMARY KEY, content TEXT);
      CREATE VIRTUAL TABLE ci_probe_fts USING fts5(content, tokenize='unicode61 remove_diacritics 0');
      CREATE VIRTUAL TABLE ci_probe_vocab USING fts5vocab(ci_probe_fts,'instance');
      CREATE TRIGGER ci_probe_insert AFTER INSERT ON ci_probe BEGIN
        INSERT INTO ci_probe_fts(rowid,content) VALUES(NEW.id,NEW.content); END;
      INSERT INTO ci_probe VALUES(1,'alpha');`);
    assert.equal(db.prepare('PRAGMA trusted_schema').get().trusted_schema, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM ci_probe_vocab WHERE term=?').get('alpha').n, 1);
    db.exec('BEGIN IMMEDIATE; INSERT INTO ci_probe VALUES(2,\'beta\'); ROLLBACK;');
    assert.equal(db.prepare('SELECT count(*) AS n FROM ci_probe_vocab WHERE term=?').get('beta').n, 0);
    return true;
  } finally { db.close(); }
}

export function installSidecar(db) {
  assert.equal(db.prepare('PRAGMA trusted_schema').get().trusted_schema, 0);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE ci_documents (
        docid INTEGER PRIMARY KEY, memory_id TEXT NOT NULL,
        receipt_id TEXT, memory_revision INTEGER NOT NULL CHECK(memory_revision>0),
        doc_kind TEXT NOT NULL CHECK(doc_kind IN ('body','receipt')),
        content TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX ci_document_body ON ci_documents(memory_id) WHERE doc_kind='body';
      CREATE UNIQUE INDEX ci_document_receipt ON ci_documents(receipt_id) WHERE doc_kind='receipt';
      CREATE INDEX ci_document_memory ON ci_documents(memory_id,doc_kind,receipt_id);
      CREATE VIRTUAL TABLE ci_fts USING fts5(content, tokenize='unicode61 remove_diacritics 0');
      CREATE VIRTUAL TABLE ci_vocab USING fts5vocab(ci_fts,'instance');
      CREATE TRIGGER ci_document_insert AFTER INSERT ON ci_documents BEGIN
        INSERT INTO ci_fts(rowid,content) VALUES(NEW.docid,NEW.content); END;
      CREATE TRIGGER ci_document_delete AFTER DELETE ON ci_documents BEGIN
        DELETE FROM ci_fts WHERE rowid=OLD.docid; END;
      CREATE TRIGGER ci_document_update AFTER UPDATE OF content ON ci_documents BEGIN
        DELETE FROM ci_fts WHERE rowid=OLD.docid;
        INSERT INTO ci_fts(rowid,content) VALUES(NEW.docid,NEW.content); END;
      CREATE TRIGGER ci_memory_insert AFTER INSERT ON memories
      WHEN NEW.deleted=0 AND NEW.currentness='current' BEGIN
        INSERT INTO ci_documents(memory_id,memory_revision,doc_kind,content)
          VALUES(NEW.id,NEW.revision,'body',NEW.content); END;
      CREATE TRIGGER ci_memory_update AFTER UPDATE ON memories BEGIN
        DELETE FROM ci_documents WHERE memory_id=OLD.id;
        INSERT INTO ci_documents(memory_id,memory_revision,doc_kind,content)
          SELECT NEW.id,NEW.revision,'body',NEW.content WHERE NEW.deleted=0 AND NEW.currentness='current';
        INSERT INTO ci_documents(memory_id,receipt_id,memory_revision,doc_kind,content)
          SELECT NEW.id,r.id,NEW.revision,'receipt',r.excerpt FROM receipts r
          WHERE r.memory_id=NEW.id AND NEW.deleted=0 AND NEW.currentness='current'; END;
      CREATE TRIGGER ci_memory_delete AFTER DELETE ON memories BEGIN
        DELETE FROM ci_documents WHERE memory_id=OLD.id; END;
      CREATE TRIGGER ci_receipt_insert AFTER INSERT ON receipts BEGIN
        INSERT INTO ci_documents(memory_id,receipt_id,memory_revision,doc_kind,content)
          SELECT NEW.memory_id,NEW.id,m.revision,'receipt',NEW.excerpt FROM memories m
          WHERE m.id=NEW.memory_id AND m.deleted=0 AND m.currentness='current'; END;
      CREATE TRIGGER ci_receipt_update AFTER UPDATE ON receipts BEGIN
        DELETE FROM ci_documents WHERE receipt_id=OLD.id;
        INSERT INTO ci_documents(memory_id,receipt_id,memory_revision,doc_kind,content)
          SELECT NEW.memory_id,NEW.id,m.revision,'receipt',NEW.excerpt FROM memories m
          WHERE m.id=NEW.memory_id AND m.deleted=0 AND m.currentness='current'; END;
      CREATE TRIGGER ci_receipt_delete AFTER DELETE ON receipts BEGIN
        DELETE FROM ci_documents WHERE receipt_id=OLD.id; END;`);
    db.exec(`INSERT INTO ci_documents(memory_id,memory_revision,doc_kind,content)
      SELECT id,revision,'body',content FROM memories WHERE deleted=0 AND currentness='current';
      INSERT INTO ci_documents(memory_id,receipt_id,memory_revision,doc_kind,content)
      SELECT r.memory_id,r.id,m.revision,'receipt',r.excerpt FROM receipts r JOIN memories m ON m.id=r.memory_id
      WHERE m.deleted=0 AND m.currentness='current';`);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

function seed(db, size) {
  assert.ok(FIXTURE.sizes.includes(size));
  const special = new Map(FIXTURE.special.filter(row => row.key !== 'tail')
    .map((row, index) => [index, row]));
  const tail = FIXTURE.special.find(row => row.key === 'tail');
  const insertMemory = db.prepare(`INSERT INTO memories
    (id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,
    deleted,created_at,updated_at,filing_status,currentness)
    VALUES(?,?,?,?,?,?,'fact','explicit',1,1,0,'2025-01-01','2025-01-01','unfiled','current')`);
  const insertReceipt = db.prepare(`INSERT INTO receipts
    (id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
    VALUES(?,?,?,'ci-synthetic','ci-session',?,'user',?,'2025-01-01')`);
  const labels = new Map();
  let receiptOrdinal = 1;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (let ordinal = 0; ordinal <= size; ordinal += 1) {
      const row = ordinal === size ? tail : special.get(ordinal);
      const id = memoryId(ordinal);
      if (row) labels.set(row.key, id);
      const padded = String(ordinal).padStart(6, '0');
      const content = row?.content ?? FIXTURE.ordinaryTemplate.replaceAll('{ordinal}', padded);
      insertMemory.run(id, ...SQLITE_NS(NAMESPACE), fingerprint(content), content);
      const receiptTexts = row?.key === 'fifth'
        ? [...FIXTURE.neutralReceipts, row.receipt]
        : [row?.receipt ?? `Neutral source record ${padded}.`];
      for (const text of receiptTexts) {
        const rid = receiptId(receiptOrdinal++);
        const normalized = { client: 'ci-synthetic', sessionId: 'ci-session', eventId: rid,
          role: 'user', excerpt: text };
        const key = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
        insertReceipt.run(rid, id, key, rid, text);
      }
    }
    if (size === 10000) {
      for (let ordinal = 0; ordinal < 10000; ordinal += 1) {
        const padded = String(ordinal).padStart(6, '0');
        const id = foreignId(ordinal);
        const content = FIXTURE.foreignTemplate.replace('{ordinal}', padded);
        insertMemory.run(id, ...SQLITE_NS(FOREIGN), fingerprint(content), content);
      }
    } else {
      const id = foreignId(0);
      const content = FIXTURE.foreignTemplate.replace('{ordinal}', '000000');
      insertMemory.run(id, ...SQLITE_NS(FOREIGN), fingerprint(content), content);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return labels;
}

export function createSyntheticFixture(size) {
  if (!FIXTURE.sizes.includes(size)) throw new Error('invalid_fixture_size');
  preflightFts();
  const directory = mkdtempSync(join(tmpdir(), 'cairn-ci-offline-'));
  const path = join(directory, 'synthetic.sqlite');
  let core = openMemoryCore({ path });
  let db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;');
  let closed = false;
  try {
    const start = performance.now();
    const labels = seed(db, size);
    const seedMs = elapsed(start);
    const seedDatabaseBytes = statSync(path).size;
    const buildStart = performance.now();
    installSidecar(db);
    core.close();
    core = openMemoryCore({ path });
    const buildMs = elapsed(buildStart);
    const close = () => {
      if (closed) return;
      closed = true;
      core.close(); db.close();
      rmSync(directory, { recursive: true, force: true });
    };
    const reopen = () => {
      if (closed) throw new Error('fixture_closed');
      core.close(); db.close();
      db = new DatabaseSync(path);
      db.exec('PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;');
      core = openMemoryCore({ path });
    };
    return { get core() { return core; }, get db() { return db; }, labels, size, path, directory,
      seedMs, seedDatabaseBytes, buildMs, close, reopen };
  } catch (error) {
    core.close(); db.close(); rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

const epoch = (db, ns) => db.prepare(`SELECT epoch FROM namespace_epochs
  WHERE owner_id=? AND scope=? AND project_id=?`).get(...SQLITE_NS(ns))?.epoch ?? 1;
const activeGeneration = (db, ns) => {
  const state = db.prepare(`SELECT active_generation AS generation FROM namespace_index_state
    WHERE owner_id=? AND scope=? AND project_id=?`).get(...SQLITE_NS(ns));
  if (!state?.generation) throw new Error('active_generation_unavailable');
  return state.generation;
};
const currentRef = (db, ns, ref) => Boolean(db.prepare(`SELECT 1 FROM index_read_memories i
  JOIN memories m ON m.id=i.id AND m.revision=i.revision
  WHERE m.owner_id=? AND m.scope=? AND m.project_id=?
    AND i.owner_id=? AND i.scope=? AND i.project_id=?
    AND m.deleted=0 AND m.currentness='current' AND m.id=? AND m.revision=?`)
  .get(...SQLITE_NS(ns), ...SQLITE_NS(ns), ref.memoryId, ref.revision));
const assertFence = (db, ns, startEpoch, generation) => {
  if (epoch(db, ns) !== startEpoch || activeGeneration(db, ns) !== generation) {
    throw new Error('index_epoch_changed');
  }
};
const queryTerms = query => {
  if (typeof query !== 'string' || query.length > 4000) throw new Error('invalid_query');
  const words = terms(query);
  if (words.length > FIXTURE.queryTermCap) throw new Error('query_term_cap');
  return words;
};
const exactQueryInput = input => {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['db', 'namespace', 'query'].includes(key))
    || !Object.hasOwn(input, 'db') || !Object.hasOwn(input, 'query')) throw new Error('invalid_query_input');
};

/** Per-term indexed FTS postings; distinct-term scores and top refs stay in SQL. */
export function indexedSearch(input) {
  exactQueryInput(input);
  const { db, namespace = NAMESPACE, query } = input;
  const wanted = queryTerms(query);
  const startEpoch = epoch(db, namespace);
  const generation = activeGeneration(db, namespace);
  if (wanted.length === 0) return { refs: [], matchingDocuments: 0, incomplete: false,
    sqlitePostingWork: MAX_SQLITE_POSTING_UNKNOWN, epoch: startEpoch, generation };
  const postings = wanted.map((_, ordinal) => `SELECT rowid AS docid, ${ordinal} AS term_ordinal
    FROM ci_fts WHERE ci_fts MATCH ?`).join(' UNION ALL ');
  const docScores = `SELECT d.docid,d.memory_id,m.revision,COUNT(DISTINCT v.term_ordinal) AS score
    FROM (${postings}) v
    JOIN ci_documents d ON d.docid=v.docid
    JOIN memories m ON m.id=d.memory_id
    JOIN index_read_memories i ON i.id=m.id AND i.revision=m.revision
    WHERE m.owner_id=? AND m.scope=? AND m.project_id=?
      AND i.owner_id=? AND i.scope=? AND i.project_id=?
      AND m.deleted=0 AND m.currentness='current' AND d.memory_revision=m.revision
      AND (d.doc_kind='body' OR d.receipt_id IN (
        SELECT id FROM receipts INDEXED BY capture_memory_receipts
        WHERE memory_id=d.memory_id ORDER BY id LIMIT 4))
    GROUP BY d.docid`;
  const params = [...wanted.map(word => `"${word}"`), ...SQLITE_NS(namespace), ...SQLITE_NS(namespace)];
  const matchingDocuments = db.prepare(`WITH doc_scores AS (${docScores})
    SELECT count(*) AS n FROM (SELECT 1 FROM doc_scores LIMIT ?)`)
    .get(...params, FIXTURE.matchingDocumentCap + 1).n;
  assertFence(db, namespace, startEpoch, generation);
  if (matchingDocuments > FIXTURE.matchingDocumentCap) return { refs: [], matchingDocuments,
    incomplete: true, sqlitePostingWork: MAX_SQLITE_POSTING_UNKNOWN, epoch: startEpoch, generation };
  const refs = db.prepare(`WITH doc_scores AS (${docScores}),
    memory_scores AS (SELECT memory_id,revision,MAX(score) AS score FROM doc_scores
      GROUP BY memory_id,revision)
    SELECT memory_id AS memoryId,revision FROM memory_scores
    ORDER BY score DESC,memory_id ASC LIMIT ?`).all(...params, FIXTURE.topK)
    .map(row => ({ memoryId: row.memoryId, revision: row.revision }));
  assertFence(db, namespace, startEpoch, generation);
  return { refs, matchingDocuments,
    incomplete: false, sqlitePostingWork: MAX_SQLITE_POSTING_UNKNOWN, epoch: startEpoch, generation };
}

/** Comparator scans only this namespace's active projection, with explicit exhaustion. */
export function scanSearch(input) {
  exactQueryInput(input);
  const { db, namespace = NAMESPACE, query } = input;
  const wanted = new Set(queryTerms(query));
  const startEpoch = epoch(db, namespace);
  const generation = activeGeneration(db, namespace);
  let anchor = '';
  let scanned = 0;
  const scored = [];
  while (true) {
    const batch = db.prepare(`SELECT m.id,m.content,m.revision FROM index_read_memories i
      JOIN memories m ON m.id=i.id AND m.revision=i.revision
      WHERE m.owner_id=? AND m.scope=? AND m.project_id=?
        AND i.owner_id=? AND i.scope=? AND i.project_id=?
        AND m.deleted=0 AND m.currentness='current' AND m.id>?
      ORDER BY m.id LIMIT ?`).all(...SQLITE_NS(namespace), ...SQLITE_NS(namespace), anchor,
      Math.min(500, FIXTURE.scanCap - scanned + 1));
    if (batch.length === 0) break;
    for (const memory of batch) {
      if (scanned === FIXTURE.scanCap) return { refs: [], scanned, incomplete: true,
        sqlitePostingWork: null, epoch: startEpoch, generation };
      scanned += 1;
      anchor = memory.id;
      const receiptRows = db.prepare(`SELECT excerpt AS content FROM receipts INDEXED BY capture_memory_receipts
        WHERE memory_id=? ORDER BY id LIMIT 4`).all(memory.id);
      const best = Math.max(score(wanted, memory.content), ...receiptRows.map(row => score(wanted, row.content)));
      if (best > 0) scored.push({ memoryId: memory.id, revision: memory.revision, score: best });
    }
    if (batch.length < Math.min(500, FIXTURE.scanCap - scanned + 1)) break;
  }
  assertFence(db, namespace, startEpoch, generation);
  scored.sort((a, b) => b.score - a.score || a.memoryId.localeCompare(b.memoryId));
  return { refs: scored.slice(0, FIXTURE.topK).map(({ memoryId, revision }) => ({ memoryId, revision })),
    scanned, incomplete: false, sqlitePostingWork: null, epoch: startEpoch, generation };
}

/** Public get is deliberately supplemented by a physical+active-generation check. */
export function materialize({ fixture, selection, namespace = NAMESPACE, beforeGet }) {
  if (selection.incomplete || selection.refs.length > FIXTURE.materializationCap) throw new Error('incomplete_selection');
  const { db, core } = fixture;
  if (beforeGet) beforeGet();
  assertFence(db, namespace, selection.epoch, selection.generation);
  let receiptsRead = 0;
  for (const ref of selection.refs) {
    if (!currentRef(db, namespace, ref)) throw new Error('stale_candidate');
    let cursor;
    let pages = 0;
    do {
      if (pages >= 26) throw new Error('receipt_page_cap');
      const value = checked(core.get({ namespace, memoryId: ref.memoryId, receiptLimit: 4,
        ...(cursor ? { receiptCursor: cursor } : {}) }));
      if (value.memory.revision !== ref.revision || value.memory.state !== 'active') throw new Error('stale_candidate');
      receiptsRead += value.receipts.length;
      cursor = value.nextReceiptCursor;
      pages += 1;
      assertFence(db, namespace, selection.epoch, selection.generation);
    } while (cursor);
    if (!currentRef(db, namespace, ref)) throw new Error('stale_candidate');
  }
  assertFence(db, namespace, selection.epoch, selection.generation);
  return { materialized: selection.refs.length, receiptsRead };
}

export function publishGeneration(fixture, namespace = NAMESPACE) {
  const { db, core } = fixture;
  const expectedIndexRevision = epoch(db, namespace);
  let cursor;
  let pages = 0;
  do {
    const value = checked(core.rebuildIndex({ namespace, expectedIndexRevision, limit: 500,
      ...(cursor ? { cursor } : {}) }));
    cursor = value.nextCursor;
    if (++pages > 100) throw new Error('rebuild_page_cap');
  } while (cursor);
  return { pages, generation: activeGeneration(db, namespace) };
}

export function fixtureReceipt(text, suffix = randomUUID()) {
  return { client: 'ci-synthetic', sessionId: 'ci-session', eventId: suffix,
    role: 'user', excerpt: text };
}

export function storageCounts(fixture) {
  const { db, path } = fixture;
  return { currentMemories: db.prepare(`SELECT count(*) AS n FROM memories WHERE owner_id=?
    AND scope=? AND project_id=? AND deleted=0 AND currentness='current'`).get(...SQLITE_NS(NAMESPACE)).n,
  foreignCurrentMemories: db.prepare(`SELECT count(*) AS n FROM memories WHERE owner_id=?
    AND scope=? AND project_id=? AND deleted=0 AND currentness='current'`).get(...SQLITE_NS(FOREIGN)).n,
  documents: db.prepare('SELECT count(*) AS n FROM ci_documents').get().n,
  ftsRows: db.prepare('SELECT count(*) AS n FROM ci_fts').get().n,
  databaseBytes: statSync(path).size,
  walBytes: (() => { try { return statSync(`${path}-wal`).size; } catch { return 0; } })() };
}

export function applySyntheticLifecycle(fixture) {
  const { core, db, labels } = fixture;
  const measured = {};
  const timed = (name, work) => {
    const start = performance.now();
    const value = work();
    measured[name] = safeTime(elapsed(start));
    return value;
  };
  const corrected = labels.get('corrected');
  const forgotten = labels.get('forgotten');
  const historical = labels.get('historical');
  timed('correctMs', () => checked(core.correct({ namespace: NAMESPACE, memoryId: corrected,
    expectedRevision: 1, content: FIXTURE.correctedReplacement, kind: 'fact',
    receipt: fixtureReceipt(FIXTURE.correctedReplacement, 'corrected-source') })));
  timed('forgetMs', () => checked(core.forget({ namespace: NAMESPACE, memoryId: forgotten,
    expectedRevision: 1 })));
  const successor = timed('supersedeMs', () => checked(core.supersede({ namespace: NAMESPACE,
    memoryId: historical, expectedRevision: 1,
    replacement: { content: FIXTURE.supersessionReplacement, kind: 'fact' },
    receipts: [fixtureReceipt(FIXTURE.supersessionReplacement, 'successor-source')] })));
  labels.set('successor', successor.memory.id);
  const fresh = timed('admitMs', () => checked(core.admit({ namespace: NAMESPACE,
    memory: { content: FIXTURE.generationMutation, kind: 'fact' },
    receipts: [fixtureReceipt(FIXTURE.generationMutation, 'fresh-source')] })));
  labels.set('fresh', fresh.memory.id);
  timed('freshForgetMs', () => checked(core.forget({ namespace: NAMESPACE,
    memoryId: fresh.memory.id, expectedRevision: fresh.memory.revision })));
  const exactId = labels.get('exact');
  const exactBefore = checked(core.get({ namespace: NAMESPACE, memoryId: exactId })).memory;
  const dedup = timed('receiptAdmitMs', () => checked(core.admit({ namespace: NAMESPACE,
    memory: { content: FIXTURE.special.find(row => row.key === 'exact').content, kind: 'fact' },
    receipts: [fixtureReceipt('A second cobalt astrolabe source.', 'dedup-source')] })));
  assert.equal(dedup.deduplicated, true);
  assert.equal(dedup.memory.id, exactId);
  const exactNow = checked(core.get({ namespace: NAMESPACE, memoryId: exactId })).memory;
  assert.ok(exactNow.revision >= exactBefore.revision);
  timed('placementMs', () => checked(core.applyPlacement({ namespace: NAMESPACE,
    expectedIndexRevision: epoch(db, NAMESPACE),
    expectedMemoryRevisions: [{ memoryId: exactId, revision: exactNow.revision }],
    proposal: { items: [{ memoryId: exactId, parentIds: [],
      newL1: { title: 'Synthetic index topic', parentL2Ids: [] } }] } })));
  assert.equal(storageCounts(fixture).currentMemories, fixture.size);
  return measured;
}

export function runOfflineExperiment(size) {
  const started = performance.now();
  const fixture = createSyntheticFixture(size);
  try {
    const buildStart = performance.now();
    const generation = publishGeneration(fixture);
    const generationBuildMs = safeTime(elapsed(buildStart));
    const maintenance = applySyntheticLifecycle(fixture);
    const outcomes = [];
    for (const item of FIXTURE.queries) {
      const indexedMs = [];
      const scannedMs = [];
      let indexed;
      let comparator;
      for (let repeat = 0; repeat < FIXTURE.repeats; repeat += 1) {
        const startIndex = performance.now();
        indexed = indexedSearch({ db: fixture.db, query: item.query });
        indexedMs.push(safeTime(elapsed(startIndex)));
        const startScan = performance.now();
        comparator = scanSearch({ db: fixture.db, query: item.query });
        scannedMs.push(safeTime(elapsed(startScan)));
      }
      if (indexed.incomplete || comparator.incomplete) throw new Error('query_work_incomplete');
      assert.deepEqual(indexed.refs, comparator.refs, `index/scan mismatch: ${item.name}`);
      const materialized = materialize({ fixture, selection: indexed });
      const hits = item.expected.filter(key => indexed.refs.some(ref => ref.memoryId === fixture.labels.get(key))).length;
      const unexpected = indexed.refs.filter(ref => !item.expected.some(key => ref.memoryId === fixture.labels.get(key))).length;
      outcomes.push({ name: item.name, expectedCount: item.expected.length, hits, unexpected,
        selected: indexed.refs.length, matchingDocuments: indexed.matchingDocuments,
        scanned: comparator.scanned, materialized: materialized.materialized,
        receiptsRead: materialized.receiptsRead,
        indexMeanMs: safeTime(indexedMs.reduce((a, b) => a + b, 0) / indexedMs.length),
        scanMeanMs: safeTime(scannedMs.reduce((a, b) => a + b, 0) / scannedMs.length) });
    }
    const forbidden = ['forgotten', 'historical'];
    const forbiddenRefs = forbidden.map(key => fixture.labels.get(key));
    for (const result of outcomes) {
      const query = FIXTURE.queries.find(item => item.name === result.name).query;
      const refs = indexedSearch({ db: fixture.db, query }).refs;
      assert.ok(refs.every(ref => !forbiddenRefs.includes(ref.memoryId)), 'forbidden ref returned');
      if (result.name === 'fifth_receipt_boundary') {
        assert.ok(refs.every(ref => ref.memoryId !== fixture.labels.get('fifth')),
          'fifth-only receipt was ranked');
      }
    }
    const counts = storageCounts(fixture);
    return { schemaVersion: FIXTURE.version, size, queryCount: outcomes.length,
      repetitionCount: FIXTURE.repeats, topK: FIXTURE.topK, materializationCap: FIXTURE.materializationCap,
      scanCap: FIXTURE.scanCap, matchingDocumentCap: FIXTURE.matchingDocumentCap,
      sqlitePostingWork: MAX_SQLITE_POSTING_UNKNOWN, seedMethod: 'synthetic-sql-setup',
      seedMs: safeTime(fixture.seedMs), sidecarBuildMs: safeTime(fixture.buildMs),
      preSidecarDatabaseBytes: fixture.seedDatabaseBytes,
      generationBuildMs, generationPages: generation.pages, maintenance, counts,
      queries: outcomes, totalMs: safeTime(elapsed(started)),
      timingQualification: 'shared-host means of three repeats per fixed query; no percentile or causal speedup claim' };
  } finally { fixture.close(); }
}

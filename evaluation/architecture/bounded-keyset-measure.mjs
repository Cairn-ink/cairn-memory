// Synthetic-only bounded resource cells. No provider, corpus or saved user store.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { openMemoryCore } from '../../core/contract.mjs';
import { createMemoryRuntime } from '../../core/runtime.mjs';
import { createQueryScore } from '../../core/query-candidates.mjs';

const namespace = { ownerId: 'keyset-measure', scope: 'personal', projectId: null };
const cells = ['0', '100', '1000', '1024', '1025', '10000', '20000', '20001',
  'worst1000', 'foreign1000'];
const id = (owner, index) => `${owner}-${String(index).padStart(6, '0')}`;

function seed(db, owner, count, receiptsPerRow, receiptLength) {
  const memory = db.prepare(`INSERT INTO memories
    (id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,
      deleted,created_at,updated_at,filing_status,currentness)
    VALUES (?,?,'personal','',?,?,'fact','explicit',1,1,0,'2026-01-01','2026-01-01','unfiled','current')`);
  const receipt = db.prepare(`INSERT INTO receipts
    (id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
    VALUES (?,?,?,'synthetic','resource',?,'user',?,'2026-01-01')`);
  db.exec('BEGIN');
  try {
    for (let index = 1; index <= count; index += 1) {
      const memoryId = id(owner, index);
      const content = `${index === count ? 'tailmarker ' : ''}synthetic row ${index}`;
      memory.run(memoryId, owner, `${owner}-fingerprint-${index}`, content);
      for (let ordinal = 1; ordinal <= receiptsPerRow; ordinal += 1) {
        const receiptId = `${memoryId}-r${ordinal}`;
        const suffix = ` source ${index} ${ordinal}`;
        const excerpt = `${'r'.repeat(receiptLength - [...suffix].length)}${suffix}`;
        assert.equal([...excerpt].length, receiptLength);
        const eventId = receiptId;
        const receiptKey = createHash('sha256').update(JSON.stringify({ client: 'synthetic',
          sessionId: 'resource', eventId, role: 'user', excerpt })).digest('hex');
        receipt.run(receiptId, memoryId, receiptKey, eventId, excerpt);
      }
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

function seedExcluded(db) {
  const row = db.prepare(`INSERT INTO memories
    (id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,
      deleted,created_at,updated_at,filing_status,currentness)
    VALUES (?,?,'personal','',?,?,'fact','explicit',1,1,?,'2026-01-01','2026-01-01',
      'unfiled',?)`);
  for (const [suffix, deleted, currentness] of [['history', 0, 'historical'],
    ['tombstone', 1, 'current']]) {
    const memoryId = `${namespace.ownerId}-${suffix}`;
    row.run(memoryId, namespace.ownerId, memoryId,
      deleted ? null : 'excludedmarker tailmarker', deleted, currentness);
    db.prepare(`INSERT INTO receipts
      (id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
      VALUES (?,?,?,'synthetic','resource',?,'user',?,'2026-01-01')`)
      .run(`${memoryId}-r`, memoryId, 'invalid', memoryId, 'excludedmarker tailmarker');
  }
}

function measure(cell) {
  assert.ok(cells.includes(cell));
  const root = mkdtempSync(join(tmpdir(), 'cairn-keyset-resource-'));
  const path = join(root, 'store.sqlite');
  let core;
  let db;
  let runtime;
  try {
    core = openMemoryCore({ path, sourceCandidatePolicy: 'bounded-keyset-v1' });
    db = new DatabaseSync(path);
    const authorized = cell === 'worst1000' || cell === 'foreign1000' ? 1000 : Number(cell);
    const receiptsPerRow = cell === 'worst1000' ? 4 : 1;
    const receiptLength = cell === 'worst1000' ? 800 : 80;
    seed(db, namespace.ownerId, authorized, receiptsPerRow, receiptLength);
    seedExcluded(db);
    if (cell === 'foreign1000') seed(db, 'foreign-keyset-measure', 10_000, 1, 80);
    runtime = createMemoryRuntime({ path });
    const score = createQueryScore('tailmarker');
    let scored = 0;
    let sentinelScored = false;
    let excludedScored = false;
    const started = performance.now();
    const result = runtime.queryCandidateRows({ ...namespace, projectId: '' }, {
      score(text) {
        scored += 1;
        if (authorized === 20_001 && text.includes('tailmarker')) sentinelScored = true;
        if (text.includes('excludedmarker')) excludedScored = true;
        return score(text);
      },
      memoryLabel: text => [...text].slice(0, 120).join(''),
      sourceReceiptLimit: 4, sourceCandidatePolicy: 'bounded-keyset-v1',
    });
    const elapsedMs = performance.now() - started;
    const inspected = Math.min(authorized, 20_000);
    assert.equal(scored, inspected * (receiptsPerRow + 1));
    assert.equal(sentinelScored, false);
    assert.equal(excludedScored, false);
    assert.equal(result.rows.length, Math.min(inspected, 1_024));
    assert.equal(result.scanExhausted, authorized <= 1_024);
    if (authorized > 0 && authorized <= 20_000) {
      assert.equal(result.rows[0].item.ref.memoryId, id(namespace.ownerId, authorized));
    }
    const queryPlan = db.prepare(`EXPLAIN QUERY PLAN SELECT id,revision FROM memories
      INDEXED BY capture_current_memories WHERE owner_id=? AND scope=? AND project_id=?
        AND deleted=0 AND currentness='current' AND id>? ORDER BY id LIMIT ?`)
      .all(namespace.ownerId, 'personal', '', '', 256);
    assert.ok(queryPlan.some(row => row.detail.includes('SEARCH memories USING INDEX capture_current_memories')));
    assert.ok(queryPlan.every(row => !row.detail.includes('TEMP B-TREE')));
    const fileBytes = suffix => existsSync(`${path}${suffix}`) ? statSync(`${path}${suffix}`).size : 0;
    return { synthetic: true, semanticAccuracy: 'not-measured', cell,
      authorized, foreign: cell === 'foreign1000' ? 10_000 : 0,
      bodyCondition: authorized === 0 ? 'no authorized body'
        : 'short synthetic row; one tailmarker in final authorized row',
      sourceCharacterSet: 'ASCII', sourceCodePointsPerReceipt: receiptLength,
      receiptsPerRow,
      scannedPhysicalUpperBound: inspected, scored, retained: result.rows.length,
      sentinelScored, excludedScored, scanExhausted: result.scanExhausted,
      elapsedMs: Number(elapsedMs.toFixed(3)), residentBytes: process.memoryUsage().rss,
      databaseMainBytes: fileBytes(''), databaseWalBytes: fileBytes('-wal'),
      databaseShmBytes: fileBytes('-shm'), sqlitePostingWork: 'not-measured' };
  } finally {
    runtime?.close();
    db?.close();
    core?.close();
    rmSync(root, { recursive: true, force: true });
  }
}

const cell = process.argv[2];
if (cell === '--cell') {
  process.stdout.write(`${JSON.stringify(measure(process.argv[3]))}\n`);
} else {
  assert.equal(cell, undefined);
  const observations = new Map();
  for (const name of cells) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--cell', name], {
      encoding: 'utf8', timeout: 60_000, maxBuffer: 65_536,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', NODE_NO_WARNINGS: '1' },
    });
    if (child.status !== 0 || child.error) {
      process.stderr.write(`${JSON.stringify({ cell: name, status: child.status,
        signal: child.signal, error: child.error?.code ?? null,
        output: child.stdout?.trim() ?? '' })}\n`);
      process.exitCode = 1;
      break;
    }
    observations.set(name, JSON.parse(child.stdout));
    process.stdout.write(child.stdout);
  }
  if (!process.exitCode) {
    const plain = observations.get('1000');
    const foreign = observations.get('foreign1000');
    assert.deepEqual([foreign.scored, foreign.retained, foreign.scanExhausted],
      [plain.scored, plain.retained, plain.scanExhausted]);
  }
}

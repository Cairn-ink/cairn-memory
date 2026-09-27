// Isolated test process: bind the real core to a controlled monotonic clock.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const mutation = process.argv[2];
assert.ok(mutation === undefined || mutation === 'remove-post-work-check');
let mutatedModules = 0;
if (mutation) registerHooks({ load(url, context, nextLoad) {
  const loaded = nextLoad(url, context);
  if (!url.endsWith('/core/database.mjs')) return loaded;
  const source = String(loaded.source);
  const target = '    const result = work();\n    check?.();\n    db.exec("COMMIT");';
  assert.equal(source.split(target).length, 2, 'one transaction post-work check');
  mutatedModules++;
  return { ...loaded, source: source.replace(target,
    '    const result = work();\n    db.exec("COMMIT");') };
} });

const realNow = process.hrtime.bigint;
let now = 0n;
process.hrtime.bigint = () => now;
const advance = milliseconds => { now += BigInt(milliseconds) * 1_000_000n; };
const root = mkdtempSync(join(tmpdir(), 'cairn-placement-clock-'));
let core, db;
const prepare = DatabaseSync.prototype.prepare;
let reached = 0, inside;
try {
  // capture-deadline.mjs captures process.hrtime.bigint at import time.
  const { openMemoryCore } = await import('../contract.mjs');
  if (mutation) assert.equal(mutatedModules, 1);
  const path = join(root, 'memory.sqlite');
  const namespace = { ownerId: 'placement-clock-synthetic', scope: 'personal', projectId: null };
  let classified = 0;
  const model = { contextWindow: 8192, countTokens: () => 1,
    extract: ({ input }) => ({ items: [{ content: input.messages[0].content,
      kind: 'fact', confidence: 0.8, sourceIndices: [0] }] }),
    classify: ({ input }) => {
      classified++;
      return { items: input.memories.map(memory => ({ memoryId: memory.id,
        parentIds: [], newL1: { title: 'Synthetic deadline topic', parentL2Ids: [] } })) };
    },
  };
  core = openMemoryCore({ path, model, captureDeadlineMs: 120_000 });
  db = new DatabaseSync(path);
  DatabaseSync.prototype.prepare = function(sql) {
    const connection = this;
    const statement = prepare.call(this, sql);
    if (!sql.includes("SET status='applied',final_refs")) return statement;
    return new Proxy(statement, { get(target, property) {
      if (property === 'run') return (...args) => {
        const value = target.run(...args);
        reached++;
        inside = { mocs: connection.prepare('SELECT count(*) AS n FROM mocs').get().n,
          journal: connection.prepare("SELECT status FROM capture_initial_classification WHERE event_id='placement-precommit'").get()?.status };
        advance(120_001); // After the real applied SQL, before transaction COMMIT.
        return value;
      };
      return Reflect.get(target, property, target);
    } });
  };
  const result = await core.capture({ namespace, client: 'deadline-client',
    eventId: 'placement-precommit', sessionId: 'deadline-session',
    messages: [{ id: 'message-placement-precommit', role: 'user',
      content: 'Synthetic placement-precommit source.' }] });
  const observed = { classified, reached, inside,
    classification: result.value?.classification ?? null,
    memories: db.prepare('SELECT count(*) AS n FROM memories').get().n,
    receipts: db.prepare('SELECT count(*) AS n FROM receipts').get().n,
    mocs: db.prepare('SELECT count(*) AS n FROM mocs').get().n,
    journal: db.prepare("SELECT status FROM capture_initial_classification WHERE event_id='placement-precommit'").get()?.status,
    filing: result.value?.admission?.memories?.[0]?.id
      ? core.get({ namespace, memoryId: result.value.admission.memories[0].id }).value?.memory?.filing?.status
      : null };
  process.stdout.write(`${JSON.stringify(observed)}\n`);
  assert.equal(result.ok, true);
  assert.equal(classified, 1, 'classification model reached');
  assert.equal(reached, 1, 'applied-journal SQL executed once');
  assert.deepEqual(inside, { mocs: 1, journal: 'applied' },
    'placement writes visible before the deadline is advanced');
  assert.equal(observed.memories, 1);
  assert.equal(observed.receipts, 1);
  // A missing post-work check lets the real transaction commit these writes.
  assert.equal(observed.mocs, 0, 'placement MOC must roll back');
  assert.equal(observed.filing, 'unfiled', 'filing must roll back');
  assert.equal(observed.journal, 'failed', 'applied journal must roll back');
  assert.equal(observed.classification?.status, 'failed');
  assert.equal(observed.classification?.error?.code, 'model_timeout');
} catch (error) {
  if (error?.code === 'ERR_ASSERTION') {
    process.stderr.write(`PLACEMENT_ROLLBACK_ASSERTION_FAILED:${error.message}\n`);
    process.exitCode = 2;
  } else throw error;
} finally {
  DatabaseSync.prototype.prepare = prepare;
  try { core?.close(); }
  finally {
    try { db?.close(); }
    finally {
      rmSync(root, { recursive: true, force: true });
      process.hrtime.bigint = realNow;
    }
  }
}

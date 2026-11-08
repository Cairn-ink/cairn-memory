// Synthetic, offline body-only recall. Run each N separately under the shared
// heavy-slot runner; larger cells belong on a quiet measurement host.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../core/contract.mjs';
import { QUERY_CANDIDATES, QUERY_SCAN_BUDGET_MS } from '../core/query-candidates.mjs';
import { createTestWorkspace } from '../tools/testing/workspace.mjs';
import { seed, ns, namespace, model, marker, key, ok } from '../core/testing/recall-recency-fixture.mjs';

async function measure(count) {
  const workspace = createTestWorkspace(null, { prefix: 'recall-measure-' });
  const path = join(workspace.path, 'store.sqlite');
  try {
    const initial = openMemoryCore({ path }); initial.close();
    const db = new DatabaseSync(path); seed(db,count,ns); db.close();
    let scanStart, scanEnd, holdStart, longestPageHoldMs, boundary;
    const exec = DatabaseSync.prototype.exec, prepare = DatabaseSync.prototype.prepare;
    DatabaseSync.prototype.prepare = function(sql) {
      if (scanStart === undefined && sql.startsWith('SELECT id, revision, updated_at FROM memories')) {
        scanStart = performance.now();
      }
      return prepare.call(this,sql);
    };
    DatabaseSync.prototype.exec = function(sql) {
      const value = exec.call(this,sql);
      if (scanStart !== undefined && scanEnd === undefined) {
        if (sql === 'BEGIN') holdStart = performance.now();
        if (sql === 'COMMIT' && holdStart !== undefined) {
          longestPageHoldMs = Math.max(longestPageHoldMs,performance.now()-holdStart);
          holdStart = undefined;
        }
      }
      return value;
    };
    const port = model();
    port.countTokens = text => {
      if (scanStart !== undefined && scanEnd === undefined && text) {
        const frame = JSON.parse(text);
        if (frame.value?.nextCursor && frame.value?.items) {
          scanEnd = performance.now();
          boundary = JSON.parse(Buffer.from(frame.value.nextCursor.split('.')[0],'base64url')).a.scanBoundary;
        }
      }
      return 1;
    };
    const core = openMemoryCore({ path,model:port });
    try {
      for (const temperature of ['cold','warm']) {
        scanStart=undefined; scanEnd=undefined; holdStart=undefined; longestPageHoldMs=0; boundary=undefined;
        const started = performance.now();
        const result = ok(await core.recall({readSet:[namespace],query:marker(count)}));
        const totalRecallMs=performance.now()-started;
        assert.ok(boundary,'signed map cursor carries scan measurements');
        assert.ok(result.memories.some(row=>row.memory.id===key(count)),'latest synthetic note is actually returned');
        // Every physical row in this fixture is eligible; the signed stop cause
        // and visited-row count determine exhaustion including top-K pruning.
        console.log(JSON.stringify({synthetic:true,node:process.version,count,temperature,
          bodyCharacters:[150,600],rowsScanned:boundary.rows,
          scanExhausted:boundary.stop==='end'&&boundary.rows<=QUERY_CANDIDATES.top,
          scanBudgetMs:QUERY_SCAN_BUDGET_MS,
          stop:boundary.stop,scanMs:scanEnd-scanStart,totalRecallMs,longestPageHoldMs,
          returned:result.memories.length,
          coldDefinition:'first recall on a reopened core; OS caches are not cleared',
          scanTiming:'physical-statement preparation through first map envelope; includes placement/fences'}));
      }
    } finally { core.close(); DatabaseSync.prototype.exec=exec; DatabaseSync.prototype.prepare=prepare; }
  } finally { await workspace.cleanup(); }
}

const count = Number(process.argv.at(-1));
assert.ok(Number.isSafeInteger(count)&&count>0&&count<=1000000,'supply a positive synthetic namespace size');
if (process.argv[2]==='--child') await measure(count);
else {
  const result=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--child',String(count)],{
    encoding:'utf8',timeout:60000,maxBuffer:65536,
  });
  process.stdout.write(result.stdout??''); process.stderr.write(result.stderr??'');
  if(result.error) console.error(result.error.code);
  process.exitCode=result.status??1;
}

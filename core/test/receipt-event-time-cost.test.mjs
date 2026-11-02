import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { SAFETY_SCHEMA_VERSIONS, resolveContentLayout } from '../content-safety-layout.mjs';
import { childCostKey, costTriple } from '../testing/content-safety-s2h-unmigrated-probe.mjs';
const inventory = JSON.parse(readFileSync(new URL('./fixtures/content-safety-s2h-cost-inventory.json',import.meta.url),'utf8')).receiptEventTime;
const main = JSON.parse(readFileSync(new URL('./fixtures/content-safety-s2h-unmigrated-counts.json',import.meta.url),'utf8'));
const frozen = JSON.parse(readFileSync(new URL('./fixtures/content-safety-s2h-path-counts.json',import.meta.url),'utf8')).zero;
const expectedMain = new Map((main.byNode?.[process.version.slice(1)] ?? main.records).map(row => [row.key,row.counts]));
const oldCell = {18:34,23:38,33:48};
const cache = new Map(), seen = [];
function measure(kind, physical, n, facts, absent) {
  const key = JSON.stringify([...arguments]); if (cache.has(key)) return cache.get(key);
  const args = ['core/testing/content-safety-s2h-path-cost-probe.mjs', kind, String(physical), String(n), String(facts), absent ? 'absent' : 'match', 'lexical','12'];
  const child = spawnSync(process.execPath,args,{ encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024 });
  assert.equal(child.status,0,JSON.stringify(args)+'\n'+child.stderr+'\n'+child.stdout.slice(-3000));
  const rows = child.stdout.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line))
    .filter(row => row.tag !== 'R3_NATIVE_CELL' && [undefined,'query','maintenance'].includes(row.phase));
  assert.ok(rows.length); for (const row of rows) assert.equal(row.node,process.version);
  cache.set(key,rows); return rows;
}

test('event-time cost inventory maps exactly 51/52/53 and every declared path variant', () => {
  assert.deepEqual(Object.fromEntries(SAFETY_SCHEMA_VERSIONS.filter(v => resolveContentLayout(v).receiptEventTime).map(v => [v,resolveContentLayout(v).base])),inventory.cells);
  assert.deepEqual(Object.keys(inventory.paths).sort(),['memory','topic','card','raw','query','context','status','evidence','maintenance'].sort());
});

for (const [kind,variant] of Object.entries(inventory.paths)) for (const base of variant.bases)
test(`event-time cost ${kind} base ${base}: exact S2h statements, BEGIN, ports and outcomes at zero/five facts`, () => {
  const physical = Number(Object.keys(inventory.cells).find(v => inventory.cells[v] === base));
  for (const n of variant.sizes) for (const facts of [0,5]) for (const absent of kind === 'maintenance' ? [false] : [false,true]) {
    const old = measure(kind,oldCell[base],n,facts,absent), current = measure(kind,physical,n,facts,absent);
    assert.equal(current.length,old.length,'same complete method/case set');
    for (const [i,row] of current.entries()) {
      const previous = old[i];
      assert.deepEqual([row.method,row.variant,row.label,row.kind,row.case,row.limit],
        [previous.method,previous.variant,previous.label,previous.kind,previous.case,previous.limit]);
      assert.deepEqual(costTriple(row),costTriple(previous),'zero additional work: '+JSON.stringify({kind,physical,n,facts,absent,method:row.method}));
      assert.deepEqual([row.ok,row.error,row.empty],[previous.ok,previous.error,previous.empty]);
      assert.equal(row.physical,physical);
      assert.ok(row.hostInvocations >= (row.portCalls ?? row.opened ?? row.counterCalls ?? row.ports ?? 0));
      if (row.safetyTrace) {
        assert.equal(row.safetyTrace.filter(s => /SELECT schema_version AS cookie/.test(s.sql)).length,
          previous.safetyTrace.filter(s => /SELECT schema_version AS cookie/.test(s.sql)).length);
        assert.deepEqual(row.safetyTrace.filter(s => /FROM owner_suppression_epochs/.test(s.sql)).map(s => s.transaction),
          previous.safetyTrace.filter(s => /FROM owner_suppression_epochs/.test(s.sql)).map(s => s.transaction),'same E1 snapshots');
      }
      seen.push([kind,base,n,facts,absent,row.method,row.variant ?? row.label ?? row.kind ?? row.limit ?? null]);
    }
    // A focused subset of the frozen <=main gate: all three original cells.
    // Its full inventory and counts remain unchanged.
    if (facts === 0 && ['memory','topic','card','raw','context','status'].includes(kind)) {
      const legacy = measure(kind,base,n,0,absent);
      const job = `${kind}-${base}-${n}-${absent ? 'True' : 'False'}-lexical-12`;
      for (const row of legacy) {
        const expected = expectedMain.get(childCostKey(job,row));
        assert.ok(expected,'mapped frozen main cell: '+childCostKey(job,row));
        costTriple(row).forEach((count,i) => assert.ok(count <= expected[i],'original <=main counts: '+childCostKey(job,row)));
      }
      if (!absent && ['memory','topic','card','raw'].includes(kind)) for (const [i,row] of old.entries()) {
        const method = row.kind ?? (kind === 'raw' ? row.limit : row.method);
        const pin = frozen[JSON.stringify([kind,oldCell[base],n,'lexical',12,method])];
        assert.ok(pin,'mapped frozen S2h cell');
        assert.deepEqual([costTriple(legacy[i]).slice(0,2),costTriple(row).slice(0,2),row.opened ?? row.portCalls ?? 0],pin);
      }
    }
  }
});

test('event-time cost measurements cover every inventory cell and case without duplicates', t => {
  const expected = [];
  const methods = {memory:['scope.get','scope.list','scope.search','sourceSnapshot','get','list','map','fetch','recall','session'],topic:['members','overview'],card:['getCard','listCards'],raw:[1,4],
    query:['current-first','current-repeat','current-cursor','history-first','history-repeat','history-cursor'],
    context:['current-first','current-repeat','history-first','history-repeat'],status:['current-first','current-repeat','history-first','history-repeat'],
    evidence:['current-first','current-repeat','current-snapshot','history-first','history-repeat','history-snapshot'],maintenance:['current-first','current-repeat','history-first','history-repeat']};
  // Validate the exact observed variant set independently from probe output.
  for (const [kind,v] of Object.entries(inventory.paths)) for (const base of v.bases) for (const n of v.sizes) for (const facts of [0,5])
    for (const absent of kind === 'maintenance' ? [false] : [false,true]) {
      const selected = kind === 'query' && absent ? methods[kind].filter(s => !s.endsWith('cursor')) : methods[kind];
      for (const value of selected) expected.push(JSON.stringify([kind,base,n,facts,absent,value]));
    }
  const actual = seen.map(([kind,base,n,facts,absent,method,variant]) => JSON.stringify([kind,base,n,facts,absent,
    ['topic','raw','query','context','status','evidence','maintenance'].includes(kind) ? variant : method]));
  assert.equal(new Set(actual).size,actual.length);
  assert.deepEqual(actual.sort(),expected.sort());
  t.diagnostic(`event-time cost inventory: ${actual.length} measured method/case cells; original <=main pins unchanged`);
});

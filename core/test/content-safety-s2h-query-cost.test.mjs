import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const probe = fileURLToPath(new URL('../testing/content-safety-s2h-cost-probe.mjs', import.meta.url));
// Counts include configuration and transaction exec, not prepare() calls.
// Zero-fact budget: entry header + owner epoch, delivery header + owner epoch.
const budget = 4;
const bases = new Map([[34,18],[38,23],[48,33]]);
const cache = new Map();
function measure(physical, n, facts = 0, absent = false, mode = 'lexical') {
  const key = JSON.stringify([physical,n,facts,absent,mode]);
  if (cache.has(key)) return cache.get(key);
  const child = spawnSync(process.execPath, [probe,'working',String(n),String(physical),String(facts),absent?'absent':'match',mode],
    { encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024 });
  assert.equal(child.error,undefined); assert.equal(child.signal,null);
  assert.equal(child.status,0,child.stderr+'\n'+child.stdout.slice(-5000));
  const samples = child.stdout.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  const row = samples.find(row => row.label === 'current-repeat');
  assert.equal(samples.find(row => row.label === 'history-repeat').totalExecuted,row.totalExecuted,'current/history counts');
  cache.set(key,row); return row;
}

for (const [physical,base] of bases) test(`R2 v${physical}: zero-fact constant budget, five-fact slope and corpus-independent no-hit`, t => {
  const rows = [];
  const zero = [], legacy = [], five = [], absent = [];
  for (const n of [300,600]) {
    for (const [target,facts,noHit,label] of [[base,0,false,'base'],[physical,0,false,'zero'],[physical,5,false,'five'],[physical,5,true,'no-hit']]) {
      const row = measure(target,n,facts,noHit);
      rows.push({node:process.version,physical:target,n,facts,noHit,label,count:row.totalExecuted,exec:row.exec});
      ({base:legacy,zero,five,'no-hit':absent}[label]).push(row);
    }
  }
  t.diagnostic('R2_QUERY_COUNTS '+JSON.stringify(rows));
  const delta = zero.map((row,i) => row.totalExecuted-legacy[i].totalExecuted);
  assert.equal(delta[0],delta[1],'zero facts add no corpus-dependent SQL');
  assert.ok(delta[0]>=0 && delta[0]<=budget,`incremental executed statements ${delta} exceed ${budget}`);
  assert.deepEqual(zero.map(row=>row.exec),legacy.map(row=>row.exec),'zero additional transactions or configuration exec');
  const fences = [];
  for (const row of zero) {
    assert.equal(row.sqlSummary.filter(s=>/FROM content_suppressions\b/.test(s.sql)).reduce((n,s)=>n+s.executions,0),0,
      'zero owner epoch proves an empty fact set without per-identity seeks');
    const headers=row.sqlSummary.filter(s=>/SELECT schema_version AS cookie/.test(s.sql)).reduce((n,s)=>n+s.executions,0);
    assert.equal(headers,2,'one request header, one independent delivery header');
    const ownerEpochs=row.sqlSummary.filter(s=>/SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs WHERE owner_id=\?/.test(s.sql))
      .reduce((n,s)=>n+s.executions,0);
    assert.equal(ownerEpochs,2,'one request owner epoch, one independent delivery owner epoch');
    fences.push({node:process.version,physical,n:row.n,headers,ownerEpochs,extraExec:row.exec-legacy[zero.indexOf(row)].exec});
  }
  t.diagnostic('R2_ZERO_FACT_BUDGET '+JSON.stringify(fences));
  const slope = series => (series[1].totalExecuted-series[0].totalExecuted)/300;
  assert.ok(Math.abs(slope(five)-slope(zero))<=0.05,'five facts preserve the candidate statement slope');
  assert.equal(absent[0].totalExecuted,absent[1].totalExecuted,'no-hit query never walks the corpus');
  if (base === 18) assert.deepEqual(legacy.map(row=>row.totalExecuted),[782,1384],'preserve main S1 query baseline');
});

for (const [physical,base] of bases) test(`R2 semantic fallback v${physical}: empty-owner proof prevents retained-candidate revalidation`, t => {
  const counts=[];
  for (const n of [12,24,300,600]) {
    const legacy=measure(base,n,0,false,'semantic'),zero=measure(physical,n,0,false,'semantic');
    counts.push({node:process.version,physical,base,n,legacy:legacy.totalExecuted,zero:zero.totalExecuted,
      legacyExec:legacy.exec,zeroExec:zero.exec,
      legacyBegin:legacy.sqlSummary.filter(s=>/^BEGIN/.test(s.sql)).reduce((n,s)=>n+s.exec,0),
      zeroBegin:zero.sqlSummary.filter(s=>/^BEGIN/.test(s.sql)).reduce((n,s)=>n+s.exec,0)});
  }
  t.diagnostic('R2_SEMANTIC_COUNTS '+JSON.stringify(counts));
  for(const row of counts) {
    assert.equal(row.zero-row.legacy,4,'header and owner epoch at entry and delivery only');
    assert.equal(row.zeroExec,row.legacyExec,'no safety-only transactions');
    assert.equal(row.zeroBegin,row.legacyBegin,'no extra BEGIN');
  }
  const five=[300,600].map(n=>measure(physical,n,5,false,'semantic'));
  const noHit=[300,600].map(n=>measure(physical,n,5,true,'semantic'));
  t.diagnostic('R2_SEMANTIC_FACT_COUNTS '+JSON.stringify({node:process.version,physical,five:five.map(r=>r.totalExecuted),noHit:noHit.map(r=>r.totalExecuted)}));
  assert.ok(Math.abs((five[1].totalExecuted-five[0].totalExecuted)-(counts[3].zero-counts[2].zero))<=15);
  assert.equal(noHit[0].totalExecuted,noHit[1].totalExecuted);
  const begins=row=>row.sqlSummary.filter(s=>/^BEGIN/.test(s.sql)).reduce((n,s)=>n+s.exec,0);
  for(const [i,n] of [300,600].entries()){
    const lexical=measure(physical,n,5,true);
    assert.equal(noHit[i].exec,lexical.exec,'empty semantic filters open no safety-only transaction, including owners with facts');
    assert.equal(begins(noHit[i]),begins(lexical),'no extra BEGIN for a no-hit semantic fallback');
  }
  const erased=measure(physical,12,'owner',false,'semantic');
  assert.equal(erased.ok,false);assert.equal(erased.error,'evidence_unavailable');
  const advanced=measure(physical,12,0,false,'semantic-late-fact');
  assert.equal(advanced.ok,false);assert.equal(advanced.error,'evidence_unavailable');
});

/** Opt-in synthetic-only refresh profile. No provider or durability changes.
 * node tools/testing/measure-context-read-u5a.mjs --run [--sizes=1000,10000]
 *   [--repeats=20] [--warmup=3]
 * COMMIT timings include SQLite journal/sync costs; JS does not isolate syscalls.
 */
import { cpus, platform, release, totalmem, loadavg } from 'node:os';
import { lstatSync, unlinkSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { openContextReadSidecar } from '../../core/context-read-sidecar.mjs';
import { fixture, request, drain, ns, ok, receipt } from '../../core/testing/context-read-fixture.mjs';

const args = process.argv.slice(2), value = (name, fallback) => args.find(arg => arg.startsWith('--'+name+'='))?.split('=').slice(1).join('=') ?? fallback;
const percentile = (rows, fraction) => [...rows].sort((a,b)=>a-b)[Math.max(0, Math.ceil(rows.length*fraction)-1)];
function summary(samples) {
  const keys = Object.keys(samples[0]).filter(key => typeof samples[0][key] === 'number');
  return Object.fromEntries(keys.map(key => [key, { p50: percentile(samples.map(row=>row[key]),.5), p95: percentile(samples.map(row=>row[key]),.95) }]));
}
if (!args.includes('--run')) console.log('Opt in with --run. Synthetic Memories only; no provider or network.');
else {
  if (args.some(arg => arg !== '--run' && !/^--(sizes|repeats|warmup)=/.test(arg))) throw Error('invalid_measurement_arguments');
  const sizes = value('sizes','1000,10000').split(',').map(Number), repeats = Number(value('repeats','20')), warmup = Number(value('warmup','3'));
  if (sizes.some(size=>!Number.isSafeInteger(size)||size<1||size>100000) || !Number.isInteger(repeats)||repeats<1||repeats>100 ||
      !Number.isInteger(warmup)||warmup<0||warmup>20) throw Error('invalid_measurement_size');
  const modes = [['current',openContextReadSidecar]];
  console.log(JSON.stringify({kind:'environment',node:process.version,platform:platform(),release:release(),cpu:cpus()[0]?.model,
    logicalCpus:cpus().length,memoryBytes:totalmem(),loadAverage:loadavg(),repeats,warmup,syncObserved:false,
    corpus:'synthetic public-API Memories; zero Cards or provider calls',synchronous:'SQLite default FULL; rollback DELETE'}));
  {
    for (const size of sizes) {
      const f = fixture(null); let target;
      try {
        const seedStarted = performance.now();
        for (let i=0;i<size;i++) {
          const memory=f.admit(`Synthetic apple project ${i} deployment policy partition ${i%31} 資料庫`);
          if (i===Math.floor(size/2)) target=memory;
          if ((i+1)%1000===0) console.log(JSON.stringify({kind:'seed_progress',size,rows:i+1}));
        }
        console.log(JSON.stringify({kind:'seed_complete',size,seedMs:performance.now()-seedStarted}));
        for (const [mode,open] of modes) {
          const index=open({path:f.path,db:f.db}); f.workspace.defer(()=>index.close());
          const buildStarted=performance.now(), built=drain(index), buildMs=performance.now()-buildStarted;
          const measured=[]; let cold;
          for (let iteration=0;iteration<1+warmup+repeats;iteration++) {
            target=ok(f.core.correct({namespace:ns,memoryId:target.id,expectedRevision:target.revision,
              content:`Synthetic ${mode} ${iteration%2?'banana':'cherry'} corrected deployment policy ${iteration} 資料庫`,kind:'fact',
              receipt:receipt(`measurement-${mode}-${iteration}`)})).memory;
            const started=performance.now(), refreshed=drain(index), wallMs=performance.now()-started;
            const m=refreshed.totals;
            const row={wallMs,canonicalMs:m.projectionMs,sidecarMs:m.sidecarScanMs,deltaDetectionMs:m.deltaDetectionMs,
              retokenizeMs:m.retokenizeMs,postingsStatisticsMs:m.postingsStatisticsMs,unchangedDocumentSqlMs:m.unchangedDocumentSqlMs,
              beginMs:m.beginMs,commitMs:m.commitMs,writeSqlMs:m.writeSqlMs,fenceSqlMs:m.fenceSqlMs,fenceTransactionMs:m.fenceTransactionMs,
              checkpointTransactionMs:m.checkpointTransactionMs,publicationTransactionMs:m.publicationTransactionMs,
              transactions:m.writeTransactions,rowWrites:m.rowWrites,canonicalRows:m.canonicalRows,sidecarRows:m.sidecarRows,
              textRows:m.textRows,journalPeakBytes:Math.max(...refreshed.calls.map(call=>call.metrics.journalPeakBytes)),
              calls:refreshed.calls.length};
            if (iteration===0) cold=row;
            else if (iteration>warmup) measured.push(row);
            console.log(JSON.stringify({kind:'refresh_sample',node:process.version,mode,size,iteration,
              phase:iteration===0?'cold':iteration<=warmup?'warmup':'measured',...row}));
          }
          console.log(JSON.stringify({kind:'profile',node:process.version,mode,size,buildMs,build:built.totals,cold,
            repeats,warmup,summary:summary(measured),targetMs:size===1000?100:size===10000?250:null,
            targetMet:size>10000?null:percentile(measured.map(row=>row.wallMs),.95)<=(size===1000?100:250),
            sidecarBytes:lstatSync(f.path+'.context-read-v1.sqlite').size,peakRssKiB:process.resourceUsage().maxRSS,loadAverage:loadavg()}));
          index.close(); unlinkSync(f.path+'.context-read-v1.sqlite');
        }
      } finally { await f.workspace.cleanup(); }
    }
  }
}

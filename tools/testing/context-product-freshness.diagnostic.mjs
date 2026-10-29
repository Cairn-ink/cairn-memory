// Report-only native early signal. Not a test or a 30-second qualification gate.
// Run through cairn-heavy. --checkout selects an untouched comparison checkout.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { loadavg } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// --profile four|wide16|cards16|wide26|cards26|all; --smoke is a short
// functional run (one commit, no minute alignment), never a timing campaign.
const profiles = {
  four: { memories:1642,cards:26,namespaces:4 },
  wide16: { memories:1640,cards:26,namespaces:16 },
  cards16: { memories:1640,cards:121,namespaces:16 },
  wide26: { memories:1644,cards:26,namespaces:26 },
  cards26: { memories:1644,cards:121,namespaces:26 },
};
const smoke=process.argv.includes('--smoke');
const profileArg=process.argv.indexOf('--profile');
const selected=profileArg<0?'four':process.argv[profileArg+1];
const mono = () => Number(process.hrtime.bigint()) / 1e6;
const checkoutArg = process.argv.indexOf('--checkout');
const root = isMainThread ? (checkoutArg < 0 ? fileURLToPath(new URL('../..', import.meta.url)) : resolve(process.argv[checkoutArg + 1])) : workerData.root;
const moduleAt = path => import(pathToFileURL(resolve(root, path)).href);
const requireSuccess = raw => { if (!raw.ok) throw Error(JSON.stringify(raw)); return raw.value; };

if (!isMainThread) {
  const { openMemoryCore } = await moduleAt('core/contract.mjs');
  const { rationaleModel } = await moduleAt('core/testing/rationale-model.mjs');
  let text;
  const core = openMemoryCore({ path: workerData.path, decisionReview: 'required-v1',
    model: { ...rationaleModel(), extract: () => ({ items: [{ content: text, kind: 'fact', confidence: .8, sourceIndices: [0] }] }) } });
  parentPort.on('message', async ({ count, burst }) => {
    try {
      for (let index = 0; index < count; index++) {
        const query = 'freshnessprobe' + burst + 'item' + index;
        text = query + ': The team records a project planning decision and checks its search evidence.';
        const capture = requireSuccess(await core.capture({ namespace: workerData.readSet[(burst + index) % workerData.readSet.length],
          client: 'synthetic-freshness', sessionId: 'burst-' + burst, eventId: randomUUID(),
          messages: [{ id: 'message', role: 'user', content: text }] }));
        // Timestamp immediately after successful canonical commit acknowledgement,
        // in the shared process.hrtime clock domain (before IPC to the observer).
        parentPort.postMessage({ commit: { burst, index, query, id: capture.admission.memories[0].id,
          committedMonoMs: mono(), committedUtcMs: Date.now() } });
      }
      parentPort.postMessage({ burstDone: burst });
    } catch (error) { parentPort.postMessage({ writerError: error.message }); }
  });
  parentPort.once('close', () => core.close());
  parentPort.postMessage({ ready: true });
} else {
  if(selected!=='all'&&!profiles[selected])throw Error('unknown diagnostic profile');
  for(const name of selected==='all'?Object.keys(profiles):[selected])await runProfile(name,profiles[name]);
}
async function runProfile(profile,shape) {
  const time = new Date();
  // Runtime guard also applies after a queue wait. Never enter the reserved slot.
  const localMinutes = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(time).slice(0, 2)) * 60 +
    Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', minute: '2-digit' }).format(time));
  if (!smoke && (localMinutes >= 22 * 60 + 20 || localMinutes < 30)) throw Error('diagnostic needs ten minutes before the 22:30 cutoff');
  const { fixture } = await moduleAt('core/testing/context-read-fixture.mjs');
  const { configured, prebuild, card, four, personal, project } = await moduleAt('core/testing/context-product-owner-fixture.mjs');
  const { renewContextMaintenancePump, maintenancePumpPhaseDiagnostic } = await moduleAt('core/context-product-pump.mjs');
  const readSet=shape.namespaces===4?four:[personal,...Array.from({length:shape.namespaces-1},(_,i)=>project('diagnostic-'+i))];
  const cleanups = [], t = { after: fn => cleanups.push(fn) }, start = mono(), loadStart = loadavg();
  let pump, writer, tick, campaign, readerHandle, windowBoundary;
  const pumpInstances=new Set();
  const nudges = new Set(), commits = [], events = [], samples = [], pumpEvents = [];
  let writerError;
  try {
    const f = fixture(t, { cards: true });
    for (let i = 0; i < shape.memories; i++) f.admit(`${i}: The orchard team reviews project planning, maintenance budgets, durable checkpoints and search evidence.`, readSet[i % readSet.length]);
    for (let i = 0; i < shape.cards; i++) card(f, readSet[i % readSet.length], 'Orchard planning ' + i, 'Authored project evidence and weekly planning.');
    const seeded = { memories: f.db.prepare('SELECT count(*) AS n FROM memories').get().n,
      cards: f.db.prepare('SELECT count(*) AS n FROM private_cards').get().n };
    process.stderr.write(profile+' fixture seeded ' + JSON.stringify(seeded) + '\n');
    const service = configured(t, f.path, readSet, { service: true });
    await prebuild(service); process.stderr.write('both intents prebuilt\n');
    writer = new Worker(fileURLToPath(import.meta.url), { workerData: { root, path: f.path, readSet }, env: {}, execArgv: [] });
    writer.on('error', error => { writerError = error.message; process.stderr.write('writer error ' + writerError + '\n'); });
    const [ready] = await once(writer, 'message');
    if (ready?.ready !== true) throw Error('writer readiness failed');
    const id = randomUUID();
    function renew() {
      try {
        const utc = Date.now(), status = pump?.getStatus(), windowId = String(Math.floor(utc / 60000));
        if (status?.error) {
          pumpEvents.push({ atMs: mono() - campaign, phase: 'status', code: status.error });
          process.stderr.write('pump error at host tick/nudge ' + status.error + '\n');
        }
        if (windowBoundary?.id !== windowId) windowBoundary = { id: windowId, endsAtMonoMs: Math.floor(mono() + 60000 - utc % 60000) };
        pump = renewContextMaintenancePump({ supervisor: service.supervisor, id, serviceCredential: service.token,
          window: { ...windowBoundary,
            usedItems: status?.windowId === windowId ? status.usedItems : 0, usedMs: status?.windowId === windowId ? status.usedMs : 0 },
          budgets: { maxItems: 2048, maxMs: 60000 }, quantum: { maxItems: 32, maxMs: 1000 }, pollMs: 25, renewalMs: 60000,
          projections: [{ options: service.options, types: ['memory', 'card'] }] });
        pumpInstances.add(pump);
      } catch (error) {
        const code = error.code ?? error.message; pumpEvents.push({ atMs: mono() - campaign, phase: 'renew', code });
        process.stderr.write('pump renewal error ' + code + '\n');
      }
    }
    writer.on('message', message => {
      if (message.writerError) { writerError = message.writerError; process.stderr.write('writer error ' + writerError + '\n'); }
      if (message.commit) {
        commits.push(message.commit);
        process.stderr.write('commit ' + commits.length + (smoke?'/1':'/21') + '\n');
        const timer = setTimeout(() => { nudges.delete(timer); renew(); }, 3000); nudges.add(timer);
      }
    });
    // Align both campaigns to a fresh real UTC-minute window. No simulated time.
    if(!smoke)await delay(60000 - Date.now() % 60000);
    campaign = mono(); const loadCampaign = loadavg(); process.stderr.write('campaign started ' + new Date().toISOString() + '\n'); renew(); tick = setInterval(renew, 20000);
    const bursts = smoke?[1]:[1, 2, 3, 4, 5, 1, 2, 3]; // 21 ordinary commits over 84 seconds.
    const writerTask = (async () => {
      for (let burst = 0; burst < bursts.length; burst++) {
        await delay(Math.max(0, campaign + burst * 12000 - mono()));
        writer.postMessage({ count: bursts[burst], burst });
      }
    })();
    const input = { readSet, types: ['memory', 'card'], intent: 'current', deadlineMs: 5000 };
    while (mono() - campaign < (smoke?6500:240000)) {
      let phase = 'open';
      // A request binding/reservation is single-use, including failed opens.
      const reader = configured(t, f.path, readSet);
      try {
        readerHandle = await reader.open(); phase = 'status';
        const status = await readerHandle.getContextIndexStatus(input, reader.token);
        if (!status.ok) events.push({ atMs: mono() - campaign, phase, readerError: status.error });
        if (status.ok && status.value.lexical.state === 'ready') {
          phase = 'find';
          for (const commit of commits.filter(c => c.latencyMs === undefined)) {
            const result = await readerHandle.findCandidates({ ...input, query: commit.query }, reader.token);
            if (!result.ok) events.push({ atMs: mono() - campaign, phase, readerError: result.error });
            if (result.ok && result.value.items.some(item => item.ref.memoryId === commit.id)) {
              commit.latencyMs = mono() - commit.committedMonoMs;
              samples.push(commit.latencyMs);
              process.stderr.write(`ready ${samples.length}/${smoke?1:21} latencyMs=${commit.latencyMs.toFixed(3)}\n`);
            }
          }
        }
      } catch (error) {
        // A concurrent ordinary commit can refuse a cold native reader open.
        // This is an unavailable observation, not readiness or a latency gate.
        events.push({ atMs: mono() - campaign, phase, readerError: { code: error.code ?? error.message } });
        process.stderr.write('reader unavailable ' + (error.code ?? error.message) + '\n');
      } finally { await readerHandle?.close(); readerHandle = undefined; await reader.supervisor.close(); }
      if ((samples.length === (smoke?1:21)&&(!smoke||mono()-campaign>=3500)) || writerError) break;
      await delay(100);
    }
    await writerTask;
    const sorted = [...samples].sort((a, b) => a - b), percentile = p => sorted.length ? sorted[Math.ceil(p * sorted.length) - 1] : null;
    const finalPumpStatus=pump?.getStatus();
    clearInterval(tick);for(const timer of nudges)clearTimeout(timer);nudges.clear();
    for(const instance of pumpInstances)await instance.close(); // Include native drains.
    const snapshots=[...pumpInstances].map(instance=>maintenancePumpPhaseDiagnostic?.(instance.getStatus())).filter(Boolean);
    const lanes=snapshots.flatMap((snapshot,pump)=>snapshot.projections.map((lane,projection)=>({pump,projection,...lane}))),counts=Array(502).fill(0);
    for(const lane of lanes)lane.elapsedBuckets.forEach((n,i)=>{counts[i]+=n;});
    const total=counts.reduce((a,b)=>a+b,0),rank=Math.ceil(total*.95);
    let cumulative=0,p95Upper=null;
    for(let i=0;i<counts.length;i++){cumulative+=counts[i];if(total&&cumulative>=rank){p95Upper=i===501?null:i*10;break;}}
    const zeros=lanes.map(l=>l.first).filter(q=>q?.number===0).map(q=>q.elapsedMs).sort((a,b)=>a-b);
    const opens=lanes.reduce((n,l)=>n+l.opens,0),openAttempts=lanes.reduce((n,l)=>n+l.phases.open.count,0);
    const phaseReport=snapshots.length?{
      // Fixed histogram counters include every settled quantum, including failures.
      // Nearest-rank p95 is a 10-ms bucket upper bound, overflow is explicit.
      quantum0:{n:zeros.length,maxMs:zeros.at(-1)??null,p95Ms:zeros.length?zeros[Math.ceil(.95*zeros.length)-1]:null},
      allQuanta:{n:total,maxMs:Math.max(0,...lanes.map(l=>l.worstElapsedMs)),p95UpperMs:p95Upper,bucketMs:10,overflow:counts[501]},
      opens,openAttempts,opensPerMinute:opens*60000/(mono()-campaign),openAttemptsPerMinute:openAttempts*60000/(mono()-campaign),
      projections:lanes.map(({elapsedBuckets,...lane})=>lane),
    }:null;
    const report = { smoke,profile,purpose: 'Non-gating early signal for the product 30 s freshness target; not qualification evidence.',
      runtime: process.version, fixture: { ...seeded, namespaces: readSet.length, residentOwners: 1 },
      configuration: { quantum: { maxItems: 32, maxMs: 1000 }, minuteBudget: { maxItems: 2048, maxMs: 60000 }, tickMs: 20000, renewalMs: 60000, nudgeMs: 3000, pollMs: 25 },
      writer: { burstSizes: bursts, intervalMs: 12000, reviewBurst: false },
      measurement: 'Commit acknowledgement to first observed current-intent ready status with document findable; real timers, 100 ms waits between native observations.',
      n: samples.length, p50Ms: percentile(.5), p95Ms: percentile(.95), maxMs: sorted.at(-1) ?? null,
      rawLatenciesMs: samples, commits, unresolved: commits.filter(c => c.latencyMs === undefined).length,
      phaseTelemetry:phaseReport,pump: finalPumpStatus, writerError, pumpEvents, readerEvents: events, loadStart, loadCampaign, loadEnd: loadavg(),
      wallMs: mono() - start, campaignMs: mono() - campaign, startedUtc: time.toISOString(), finishedUtc: new Date().toISOString() };
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    // No latency, sample-count or freshness pass/fail assertion in this tool.
  } finally {
    clearInterval(tick); for (const timer of nudges) clearTimeout(timer);
    await readerHandle?.close(); for(const instance of pumpInstances)await instance.close(); await writer?.terminate();
    for (const cleanup of cleanups.reverse()) await cleanup();
  }
}

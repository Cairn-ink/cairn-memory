import assert from 'node:assert/strict';
import { appendFileSync,existsSync,readFileSync,writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

export const CONTENTION_STRESS_BOUNDS=Object.freeze({writerMs:10_000,retryBackoffMs:10,maxRetryBackoffMs:250});
export function stressReaderOptions(deadlineAt) {
  assert.ok(Number.isSafeInteger(deadlineAt));
  // Even immediate busy outcomes cannot exhaust this retry budget before the
  // overall deadline: every retry waits at least retryBackoffMs.
  const {retryBackoffMs,maxRetryBackoffMs}=CONTENTION_STRESS_BOUNDS;
  return {deadlineAt,failOnBusy:false,retryBackoffMs,maxRetryBackoffMs,
    maxBusyRetries:Math.ceil(Math.max(0,deadlineAt-Date.now())/retryBackoffMs)};
}
export function stressWriterStopReason(config,startedAt,now=Date.now()) {
  assert.ok(Number.isFinite(config.stressWriterMs)&&config.stressWriterMs>0,'finite stress writer duration');
  if(existsSync(config.readerPassDone))return 'reader-complete';
  if(now>=startedAt+config.stressWriterMs)return 'writer-duration';
  if(existsSync(config.stop))return readFileSync(config.stop,'utf8');
  return null;
}
// A stress writer is bounded independently of reader progress. Once it stops,
// the reader can finish the same page/cursor and verify a complete exact read.
export async function waitForStressObservation(config,alive) {
  for(;;) {
    alive();assert.ok(Date.now()<config.deadlineAt,'stress observation deadline');
    const entered=existsSync(config.writerEntered)?JSON.parse(readFileSync(config.writerEntered,'utf8')):null;
    const reason=stressWriterStopReason(config,entered?.at??Infinity);
    if(reason) {
      if(!existsSync(config.stop))writeFileSync(config.stop,reason,{flag:'wx'});
      return reason;
    }
    await delay(25);
  }
}
export function assertStressObservation({reader,writer,exits}) {
  for(const name of ['reader','writer']) {
    assert.equal(exits[name].signal,null,name+' signal');assert.equal(exits[name].code,0,name+' exit code');
    assert.equal(({reader,writer})[name].status,'complete',name+' completed before deadline');
  }
  assert.notEqual(reader.pid,writer.pid,'independent processes');
  assert.ok(reader.passes>=1,'complete maximum-version read');
  assert.equal(reader.readCompleted,true,'stress read eventually completed');
  assert.equal(reader.byteExact,true,'stress read matched exact bytes');
  assert.equal(writer.storageBusy,0,'stress writer error');
}

export function appendTimings(path,records) {
  if(path && records.length)appendFileSync(path,records.map(record=>JSON.stringify(record)+'\n').join(''));
}
export function readTimings(path) {
  if(!path || !existsSync(path))return [];
  const text=readFileSync(path,'utf8'),end=text.lastIndexOf('\n');
  // A live append may be incomplete. Only consume complete records.
  return end<0?[]:text.slice(0,end).split('\n').filter(Boolean).map(line=>JSON.parse(line));
}
export function overlapPageReport(pages,window) {
  const intervals=(Array.isArray(window)?window:[window]).filter(interval=>
    Number.isFinite(interval?.startedAt)&&Number.isFinite(interval?.finishedAt))
    .sort((a,b)=>a.startedAt-b.startedAt);
  const merged=[];
  for(const interval of intervals) {
    assert.ok(interval.finishedAt>=interval.startedAt,'ordered writer call interval');
    if(interval.finishedAt===interval.startedAt)continue;
    const previous=merged.at(-1);
    if(previous && interval.startedAt<=previous.finishedAt)previous.finishedAt=Math.max(previous.finishedAt,interval.finishedAt);
    else merged.push({...interval});
  }
  let i=0;const times=[];
  for(const page of [...pages].sort((a,b)=>a.startedAt-b.startedAt)) {
    while(i<merged.length && merged[i].finishedAt<=page.startedAt)i++;
    if(i<merged.length && merged[i].startedAt<page.finishedAt && page.finishedAt>page.startedAt)times.push(page.elapsedMs);
  }
  const sorted=[...times].sort((a,b)=>a-b),percentile=p=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]??0;
  return {pages:times.length,p50Ms:percentile(.5),p95Ms:percentile(.95),maxMs:sorted.at(-1)??0};
}
// Stop only after observing enough *actual calls*, not time spent pacing or
// publishing reports. Both children keep running while this parent samples.
export async function waitForActiveOverlap(config,alive) {
  let reportedAt=Date.now();
  for(;;) {
    alive();assert.ok(Date.now()<config.deadlineAt,'active writer overlap deadline');
    const calls=readTimings(config.writerCalls),pages=readTimings(config.readerPages);
    const activePages=overlapPageReport(pages,calls).pages;
    if(Date.now()-reportedAt>=1000) {
      console.error(JSON.stringify({measurement:'active-overlap',scenario:config.scenario,calls:calls.length,pages:pages.length,activePages}));
      reportedAt=Date.now();
    }
    if(calls.length>=100 && existsSync(config.readerPassDone) && activePages>=200) {
      writeFileSync(config.stop,'active-overlap-complete',{flag:'wx'});return;
    }
    await delay(25);
  }
}

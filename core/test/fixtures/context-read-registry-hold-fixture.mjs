import { testClock } from '../../testing/context-product-test-clock.mjs';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { fixture } from '../../testing/context-read-fixture.mjs';
import { configured } from '../../testing/context-product-owner-fixture.mjs';
import { createSupervisorRegistry, createContextReadSupervisor, supervisorOwner, SUPERVISOR_LIMITS } from '../../context-read-supervisor.mjs';
import * as reader from '../../context-product-reader.mjs';
const hostUrl = new URL('../../testing/context-product-disposal-host.mjs', import.meta.url).href;
const bits = ['workerStopped','nativeDisposed','leasesReleased','providersSettled'];
const retained = []; after(async () => { for (const cleanup of retained) await cleanup(); });
export async function guard(promise, label, ms=30000) {
  const abort = new AbortController();
  try { return await Promise.race([promise, delay(ms, undefined, {signal:abort.signal}).then(() => { throw Error('hang: '+label); })]); }
  finally { abort.abort(); }
}
export const nativeTest = (name, body) => test(name, t => guard(body(t), name, 60000));
export async function until(check, label) {
  let done = false;
  try { await guard((async () => { while (!done && !check()) await delay(1); })(), label); }
  finally { done = true; }
}
export const flush = async () => { for (let n=0;n<30;n++) await Promise.resolve(); };
export function tracked(promise) {
  const state = { settled:false };
  state.promise = promise.then(value => { state.value=value;state.settled=true;return value; }, error => { state.error=error;state.settled=true;return error; });
  return state;
}
export async function setup(t, { failed=false, limit, global=false }={}) {
  const f=fixture(failed?{after:fn=>retained.push(fn)}:t);
  const selections=['a','b','c'].map(tag=>({ownerId:'hold-'+tag+'-'+randomUUID(),scope:'personal',projectId:null}));
  for (const ns of selections) f.admit('Synthetic shared-file evidence '+ns.ownerId,ns);
  f.core.close();
  const registry=global?null:createSupervisorRegistry({now:testClock.now,limits:{...SUPERVISOR_LIMITS,...(limit?{live:limit}:{})}});
  const captures=[],configs=[],supervisors=[],timers=new Map();let timerArms=0;
  const scope={after(){}};
  function configuration(owner=0,{service=false,mode='normal',path=f.path,supervisor}={}) {
    supervisor??=registry?registry.supervisor():createContextReadSupervisor();supervisors.push(supervisor);
    const c=configured(scope,path,[selections[owner]],{service,supervisor}),state=new Int32Array(new SharedArrayBuffer(32));
    c.state=state;c.service=service;c.options.host={moduleUrl:hostUrl,configuration:{...c.options.host.configuration,disposalState:state.buffer,disposalMode:mode}};
    configs.push(c);return c;
  }
  function runtime(service=false, hook) {
    return reader.createProductReaderRuntime({maintenance:service,setTimer(fn,ms){
      timerArms++;let id;id=setTimeout(()=>{timers.delete(id);fn();},ms);timers.set(id,ms);return id;
    },clearTimer(id){timers.delete(id);clearTimeout(id);},spawnWorker(data) {
      const worker=new Worker(new URL('../../context-product-worker.mjs',import.meta.url),{workerData:data,env:{},execArgv:[],stdout:true,stderr:true});
      const c={worker,data,resources:new Int32Array(data.resources),sent:[],received:[],forced:0};captures.push(c);
      const post=worker.postMessage.bind(worker),terminate=worker.terminate.bind(worker);
      worker.postMessage=(m,...args)=>{c.sent.push(m);return post(m,...args);};worker.terminate=()=>{c.forced++;return terminate();};
      worker.on('message',m=>{c.received.push(m);hook?.(m,c);});c.exited=new Promise(resolve=>worker.once('exit',resolve));return worker;
    }});
  }
  const open=(c,opts={})=>runtime(c.service)( {...c.options,...opts} );
  function proof(c) {
    const owner=supervisorOwner(c.options.supervisor).owner,record=[...owner.records].find(r=>r.resources);
    assert.ok(record);return {record,status:()=>c.options.supervisor.getCleanupStatus(record.id)};
  }
  function release(c) { Atomics.store(c.state,1,1);Atomics.notify(c.state,1); }
  async function closing(c,h) { const work=tracked(h.close());await until(()=>c.state[0]===1,'host close rendezvous');return work; }
  const cleanup=async()=>{
    for(const c of configs)release(c);
    await Promise.allSettled(supervisors.map(s=>s.close()));
  };
  f.workspace.defer(cleanup);if(failed)t.after(cleanup);
  return {f,selections,configuration,open,runtime,captures,registry,proof,release,closing,timers,get timerArms(){return timerArms;}};
}

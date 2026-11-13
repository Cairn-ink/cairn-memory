// Test-only entropy and SQL controls, also preloaded into native reader Workers.
import crypto from 'node:crypto';
import threads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';

let uuid=0,random=0;
crypto.randomUUID=()=>`00000000-0000-4000-8000-${String(++uuid).padStart(12,'0')}`;
crypto.randomBytes=n=>Buffer.alloc(n,++random);
const NativeDate=Date;
globalThis.Date=class extends NativeDate {
  constructor(...args){super(...(args.length?args:['2026-01-01T00:00:00.000Z']));}
  static now(){return 1767225600000;}
};
Object.defineProperty(performance,'now',{value:()=>0,configurable:true});

export const statements=[];
export const normalizeTraceSQL=sql=>sql.replace(/\s+/g,' ').trim();
export const effectWitnesses=[];
const prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;
const marker='synthetic-lineage-off-sql-v1';
const effectMarker='synthetic-lineage-off-effect-v1';
const witness=row=>{
  effectWitnesses.push(structuredClone(row));
  if(!threads.isMainThread)threads.parentPort.postMessage({[effectMarker]:row});
};
const record=entry=>{
  statements.push(entry);
  if(!threads.isMainThread)threads.parentPort.postMessage({[marker]:entry});
};
export function startTrace() {
  DatabaseSync.prototype.prepare=function(sql){
    const statement=Reflect.apply(prepare,this,[sql]);
    for(const method of ['get','all','iterate','run']) {
      const fn=statement[method];
      statement[method]=function(...args){
        // Snapshot arguments before execution, including exact binary bytes.
        record([normalizeTraceSQL(sql),method,structuredClone(args)]);
        const result=Reflect.apply(fn,this,args);
        if(method==='get'&&normalizeTraceSQL(sql)==='SELECT * FROM "card_effects" WHERE "effect_id" IS ?'&&
          /^[0-9a-f]{32}$/.test(result?.effect_id))witness(result);
        return result;
      };
    }
    return statement;
  };
  DatabaseSync.prototype.exec=function(sql){
    record([normalizeTraceSQL(sql),'exec',[]]);
    return Reflect.apply(exec,this,[sql]);
  };
}
export function stopTrace(){DatabaseSync.prototype.prepare=prepare;DatabaseSync.prototype.exec=exec;}

const NativeWorker=threads.Worker;
threads.Worker=class extends NativeWorker {
  constructor(url,options){super(url,{...options,execArgv:['--import',import.meta.url]});}
  emit(event,...args){
    if(event==='message'&&args[0]?.[marker]){record(args[0][marker]);return true;}
    if(event==='message'&&args[0]?.[effectMarker]){witness(args[0][effectMarker]);return true;}
    return super.emit(event,...args);
  }
};
syncBuiltinESMExports();
if(!threads.isMainThread)startTrace();

// Minimal synthetic trusted host for the actual product reader/maintainer.
export function createContextReadHost(configuration) {
  const binding=configuration.serviceBinding??configuration.requestBinding;
  return {authorize:()=>binding,isCurrent:()=>true,counter:{id:'synthetic-exact',countTokens:()=>1}};
}

// Test-only resolution recorder. Registration and hooks share this module so
// the gate runs normally in a fresh process; no production module is replaced.
import { register } from 'node:module';
import { isMainThread } from 'node:worker_threads';
import { appendFileSync } from 'node:fs';
let log;
export function initialize(data) { log=data.log; }
export async function resolve(specifier,context,next) {
 const record={specifier,parent:context.parentURL??null};
 try {
  const result=await next(specifier,context);record.url=result.url;return result;
 }catch(error){record.error=error.code??error.name;throw error;}
 finally {appendFileSync(log,JSON.stringify(record)+'\n');}
}
if(isMainThread)register(import.meta.url,{parentURL:import.meta.url,data:{log:process.env.S2H_ORACLE_RESOLVE_LOG}});

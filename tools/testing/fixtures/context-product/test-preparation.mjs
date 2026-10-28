// Functional/test setup only. Qualification and rehearsal cells use series.build.
import { Worker } from 'node:worker_threads';
import { configure } from './engine.mjs';
import { build } from './series.mjs';

export const PREPARATION_WATCHDOG_MS=120000;
export async function buildForTests(config,write=async()=>{}) {
  const { createProductReaderRuntime }=await import('../../../../core/context-product-reader.mjs');
  // A frozen clock removes wall-time admission from fixture construction. Keep
  // the real public maintainer, worker, authorization, refresh and cleanup paths.
  // The independent real-time watchdog terminates stuck work; never retry it.
  const open=createProductReaderRuntime({maintenance:true,now:()=>0n,
    setTimer:fn=>setTimeout(fn,PREPARATION_WATCHDOG_MS),clearTimer:clearTimeout,
    spawnWorker:data=>new Worker(new URL('./test-preparation-worker.mjs',import.meta.url),{
      workerData:data,env:{},execArgv:[],stdout:true,stderr:true,
      resourceLimits:{maxOldGenerationSizeMb:192},
    }),
  });
  return build(config,write,{configure:async(...args)=>{
    const c=await configure(...args);
    return {...c,open:control=>open(c.options,control)};
  }});
}

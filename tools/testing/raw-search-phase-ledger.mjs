import {performance} from 'node:perf_hooks';
let totals={};
export function sample(name,ms){totals[name]=(totals[name]??0)+ms;}
export function measured(name,work){const start=performance.now();try{return work();}finally{sample(name,performance.now()-start);}}
export function takePhases(){const result=totals;totals={};return result;}

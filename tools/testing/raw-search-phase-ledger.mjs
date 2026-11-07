import {performance} from 'node:perf_hooks';
let totals={},units=[];
export function sample(name,ms){totals[name]=(totals[name]??0)+ms;}
export function measured(name,work){const start=performance.now();try{return work();}finally{sample(name,performance.now()-start);}}
export function selectionUnit(rows,holdMs){units.push({rows,holdMs});}
export function takeSelectionUnits(){const result=units;units=[];return result;}
export function takePhases(){const result=totals;totals={};return result;}

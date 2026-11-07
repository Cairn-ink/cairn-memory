import {performance} from 'node:perf_hooks';
let totals={},units=[];
export function sample(name,ms){totals[name]=(totals[name]??0)+ms;}
export function measured(name,work){const start=performance.now();try{return work();}finally{sample(name,performance.now()-start);}}
export function selectionUnit(rows,holdMs,checked=rows){units.push({rows,holdMs,checked});}
export function takeSelectionUnits(){const result=units;units=[];return result;}
export function takePhases(){const result=totals;totals={};return result;}
let failures=[],overshoots=[];
export function internalFailure(error){failures.push(error?.code??'unknown');}
export function takeInternalErrors(){const result=failures;failures=[];return result;}
export function measurementError(error){const internalCodes=takeInternalErrors();return {code:error?.code??'unknown',internalCode:internalCodes.find(code=>code!=='raw_search_unavailable')??internalCodes.at(-1)??error?.code??'unknown',internalCodes};}
export function operationEnd(deadlineAt){overshoots.push(Math.max(0,performance.now()-deadlineAt));}
export function takeOperationOvershoots(){const result=overshoots;overshoots=[];return result;}

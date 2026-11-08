import {performance} from 'node:perf_hooks';
let totals={},units=[];
export function sample(name,ms){totals[name]=(totals[name]??0)+ms;}
export function measured(name,work){const start=performance.now();try{return work();}finally{sample(name,performance.now()-start);}}
export function selectionUnit(rows,holdMs,checked=rows){units.push({rows,holdMs,checked});}
export function takeSelectionUnits(){const result=units;units=[];return result;}
export function takePhases(){const result=totals;totals={};return result;}
let failures=[],records=[],failureCounts={},overshoots=[];
export function internalFailure(error,site='mapping'){
  const code=error?.code??'unknown';failures.push(code);records.push({code,site});failureCounts[code]=(failureCounts[code]??0)+1;
}
// Counts survive operation drains and error rendering, including handled stops.
export function takeInternalErrorCounts(){const result=failureCounts;failureCounts={};return result;}
export function takeInternalErrors(){const result=failures;failures=[];records=[];return result;}
export function measurementError(error){
  const internalRecords=records,internalCodes=takeInternalErrors();
  const originInternalCode=internalCodes.find(code=>code!=='raw_search_unavailable')??error?.code??'unknown';
  const finalInternalCode=internalCodes.findLast(code=>code!=='raw_search_unavailable')??error?.code??'unknown';
  return {code:error?.code??'unknown',internalCode:originInternalCode,originInternalCode,finalInternalCode,internalCodes,internalRecords};
}
export function operationEnd(deadlineAt){overshoots.push(Math.max(0,performance.now()-deadlineAt));}
export function takeOperationOvershoots(){const result=overshoots;overshoots=[];return result;}

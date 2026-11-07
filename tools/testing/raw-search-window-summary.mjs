// Measurement-only availability summaries. Empty partials remain unavailable.
export const outcomeNames=['complete','partial-with-candidates','empty-partial','error'];
export function searchOutcome(result){
  return result.coverage.status==='complete'?'complete':result.candidates.length?'partial-with-candidates':'empty-partial';
}
export function distribution(values){
  const sorted=values.toSorted((a,b)=>a-b),at=q=>sorted[Math.ceil(sorted.length*q)-1]??null;
  return {samples:sorted.length,p50:at(.5),p95:at(.95),p99:at(.99),max:sorted.at(-1)??null};
}
export function outcomeSummary(samples){
  const outcomes=Object.fromEntries(outcomeNames.map(name=>[name,samples.filter(row=>row.outcome===name).length]));
  const available=samples.filter(row=>['complete','partial-with-candidates'].includes(row.outcome));
  return {outcomes,unavailableRate:samples.length?(outcomes.error+outcomes['empty-partial'])/samples.length:null,
    all:distribution(samples.map(row=>row.ms)),available:distribution(available.map(row=>row.ms))};
}
export function selectionSummary(units){
  return {count:units.length,checked:distribution(units.map(unit=>unit.checked??unit.rows)),rows:distribution(units.map(unit=>unit.rows)),holdMs:distribution(units.map(unit=>unit.holdMs))};
}

// Keep the complete operation chain in compact console summaries as in JSON.
export function errorSummary(error){
  const {code,internalCode,originInternalCode,finalInternalCode,internalCodes,internalRecords}=error;
  return {code,internalCode,originInternalCode,finalInternalCode,internalCodes,internalRecords};
}

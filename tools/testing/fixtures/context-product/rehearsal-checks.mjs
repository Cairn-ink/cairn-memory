// Functional assertions only. These can never grant a qualification decision.
export const rehearsalDecision=(errors=[])=>({decision:errors.length?'failed':'inconclusive',reason:'non_qualifying_rehearsal',functionalPassed:errors.length===0,errors});
export function readWorks(r,allowUnavailable=false) {
  return !!r&&r.validated===true&&r.bounds===true&&r.telemetry==='complete'&&
    (r.ok===true?r.expected===true:allowUnavailable&&r.code==='index_unavailable');
}
export function writerWorks(w) {
  return w?.exit?.code===0&&!w.exit.signal&&w.diagnostics?.coverage==='complete'&&w.diagnostics?.inFlight===0&&
    w.calls?.length>0&&w.calls.every(c=>c.code===null&&c.nativeCommit!==false);
}
export function rehearsalSession(session,e) {
  const errors=[];
  if(!writerWorks(e.writerResult))errors.push('writer');
  if(e.availabilityRecords.length!==session.availability.length||e.omittedReleases)errors.push('availability_omission');
  for(const scheduled of session.availability) {
    const actual=e.availabilityRecords.filter(r=>r.scheduledId===scheduled.id);
    if(actual.length!==1||['methodLabel','language','intent','releaseMs'].some(k=>actual[0][k]!==scheduled[k]))errors.push('availability_identity:'+scheduled.id);
  }
  if(!e.records.length||e.records.some(r=>!readWorks(r,true)))errors.push('read');
  for(const recipe of session.targets)for(const intent of ['current','history']) {
    const targets=e.targets.filter(t=>t.targetId===recipe.id&&t.type===recipe.type&&t.intent===intent);
    if(targets.length!==1||targets[0].observedAt===null||targets[0].eligibilityCoverage!=='complete'||targets[0].firstEligibility!==true)errors.push('unobserved_target:'+recipe.id+':'+intent);
    else {
      const t=targets[0],native=e.writerResult.diagnostics.records.find(r=>r.sequence===t.nativeCommitSequence&&r.operation===t.nativeCommitOperation&&r.commit&&r.at===t.committedAt);
      if(!native)errors.push('target_commit:'+recipe.id+':'+intent);
    }
  }
  return rehearsalDecision(errors);
}

// Retain observed functional evidence; omit all duration/quantile/interval claims.
export function functionalEvidence(value) {
  if(Array.isArray(value))return value.map(functionalEvidence);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value).filter(([k])=>!/(?:Ms|At|Mono|Ns|Seconds|Loop|^at$|^loop$|^gc$|resources|scheduling|samples|pacing|metrics|populations|readExceededAdapterDefault|writerDeadlineOverrun|lateSuccess|checks|observedFailure|cutoff|overshoot|peak|Bytes|trace|raw|diagnostics|maintenance)$/.test(k)).map(([k,v])=>[k,functionalEvidence(v)]));
}

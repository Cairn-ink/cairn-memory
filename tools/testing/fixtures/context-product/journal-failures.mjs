// SQLite-free durable failure vocabulary shared by journal writers and replay.
// Contextual latency/overlap, percentile and T-subprobe rules stay with replay.
export function failedVerdict(value) {
  if(!value||typeof value!=='object')return false;
  if(value.decision==='failed'||value.observedFailure===true||value.functionalPassed===false)return true;
  return Object.values(value).some(v=>v&&typeof v==='object'&&failedVerdict(v));
}
export function journalFailure(series,record) {
  if(failedVerdict(record)||['failure','lane-failure','session-supervision'].includes(series)||
    series==='maintenance'&&Object.hasOwn(record??{},'status')&&!['complete','partial','rebuilding'].includes(record.status)||
    series==='resumed-checkpoints'&&record?.retainedDecisions?.includes('failed')||
    series==='capability'&&record?.ready===false&&!record.blocked)return true;
  function bad(value) {
    if(!value||typeof value!=='object')return false;
    // Pump completions and renewal exceptions, including nested renewal status.
    if(series==='pump'&&value.state==='failed')return true;
    if(['writer_failed','writer_startup_failed','parent_sampler_failed'].includes(value.error))return true;
    // All process evidence uses exit/processExit or a scalar exitCode, including
    // lane, writer, locker, sampler and session child evidence. Signals fail too.
    if(Object.hasOwn(value,'exitCode')&&value.exitCode!=null&&value.exitCode!==0)return true;
    if(Object.hasOwn(value,'exitCode')&&value.signal)return true;
    for(const [key,v] of Object.entries(value)){
      if(['exit','processExit'].includes(key)&&v&&
        (Object.hasOwn(v,'code')&&v.code!==0||v.signal||v.disconnected===false))return true;
      if(v&&typeof v==='object'&&bad(v))return true;
    }
    return false;
  }
  return bad(record);
}

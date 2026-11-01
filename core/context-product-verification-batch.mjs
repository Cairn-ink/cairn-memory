// Private, unqualified policy P. Work admission still delegates to Fix A.
import { fail } from './validation.mjs';
export const verificationBound=Symbol('verification batch bound');
const chunks=8, rows=1024, bytes=1024*1024, activeMs=100;
export function verificationBatch({now,quantum,state}) {
  const cap=new Int32Array(state), start=quantum.batchStart??now(), duration=Math.max(0,quantum.cutoff-start);
  // Live controls stay at zero until shortage; seeded one is a qualification seam.
  // Recalibrate each call so another lane never inherits a wider first batch.
  let calibrated=Atomics.load(cap,0)===1;
  let reserve=quantum.reserve, finalization=20, workEstimate=10;
  const observe=began=>{
    const observed=now()-began+10;
    finalization=Math.max(finalization,2*observed);
    reserve=Math.min(duration,Math.max(reserve,2*observed,finalization));
  };
  return {observe,
    admitLegacy:()=>finalization<=reserve && now()+workEstimate<quantum.cutoff-reserve,
    legacy:phase=>Boolean(Atomics.load(cap,1)&(1<<phase)),
    // A bounded kind preference avoids repeating a rejected probe next call.
    fallback:phase=>Atomics.or(cap,1,1<<phase),
    begin() {
    const began=now();let tailStarted, shortage=false;
    const work=()=>finalization<=reserve && now()+workEstimate<Math.min(began+activeMs,quantum.cutoff-reserve) && quantum.admit('verify-scan') && quantum.admit('verification');
    const tail=()=>{
      if(now()>=quantum.cutoff)fail('read_timeout');
      if(finalization>quantum.cutoff-now()) {shortage=true;Atomics.store(cap,0,-1);throw verificationBound;}
      tailStarted??=now();
    };
    return {width:calibrated&&Atomics.load(cap,0)>=0?chunks:1,work,tail,get shortage(){return shortage;},
      quantum:{...quantum,admit:kind=>work()&&quantum.admit(kind),measure(work,kind,diagnostic) {
        const before=now();try{return quantum.measure(work,kind,diagnostic);}
        finally {workEstimate=Math.max(workEstimate,2*(now()-before));}
      }},
      committed() {
        observe(tailStarted);
        // Shortage is sticky for this supervisor, including successor Workers.
        calibrated=true;
      }
    };
  }};
}
// Length metadata is evaluated before payloads. Repeated reads, reset writes,
// lookups and staged mutations consume this same conservative logical allowance.
// A savepoint lets a denied chunk discard its tentative prefix while retaining
// earlier complete chunks. The attempt's telemetry is deliberately not refunded.
export function verificationMeter(side,attribution,checkpointBytes=0,bindingRows=0) {
  let usedRows=16+bindingRows, usedBytes=65536+12*checkpointBytes+512*bindingRows;
  const charge=(n,b)=>{
    if(usedRows+n>rows || usedBytes+b>bytes)throw verificationBound;
    usedRows+=n;usedBytes+=b;
  };
  const quote=name=>'"'+name.replaceAll('"','""')+'"';
  // Identity bytes occur in every posting tuple, not just its document lookup.
  const api={get rows(){return usedRows;},get bytes(){return usedBytes;},
    repeat(text,count){charge(0,6*Buffer.byteLength(text)*count);},db:{prepare(sql) {
    const statement=side.prepare(sql);
    const read=(method,args)=>{
      const reset=sql.startsWith('UPDATE statistics SET verified_df=0');
      const query=reset?sql.slice(sql.indexOf('(SELECT')+1,sql.lastIndexOf(')')):
        sql+(method==='get'&&!/LIMIT\s+\d+\s*$/.test(sql)?' LIMIT 1':'');
      const parameters=reset?args.slice(1):args;
      const columns=reset?['term_id']:statement.columns().map(column=>column.name);
      const size=columns.map(name=>'coalesce(length(CAST('+quote(name)+' AS BLOB)),0)+16').join('+');
      // Each original query remains bounded by the existing (or smaller) LIMIT.
      const maximum=method==='get'?1:Number(/LIMIT\s+(\d+)\s*$/.exec(query)?.[1]);
      if(!Number.isSafeInteger(maximum))throw verificationBound;
      // Reserve the metadata scan before executing it; denial itself cannot
      // exceed the transaction's row bound. Unused reservations stay charged.
      charge(1+maximum,256);
      const hint=side.prepare(`SELECT count(*) AS n,coalesce(sum(${size}),0) AS b FROM (${query})`).get(...parameters);
      attribution?.add('scanRows',hint.n);
      // Include both metadata and payload rows; JSON escaping and tuple copies
      // are bounded conservatively by twelve bytes per source byte, plus frames.
      charge(2*hint.n,12*hint.b+256*hint.n);
      return statement[method](...args);
    };
    return {all:(...args)=>read('all',args),get:(...args)=>read('get',args),run(...args) {
      charge(1,256+sql.length+args.reduce((n,arg)=>n+Buffer.byteLength(String(arg)),0));
      return statement.run(...args);
    }};
  }}};
  if(usedRows>rows || usedBytes>bytes)throw verificationBound;
  return api;
}

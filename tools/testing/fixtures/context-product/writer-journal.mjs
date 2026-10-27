import { isDeepStrictEqual } from 'node:util';
export const WRITER_PROTOCOL = 'product-writer-v1';
const stages = ['open','configure','prepare','execute','iterate','iterator_next','iterator_return','begin','commit','rollback','close','dispose'];
const phases = ['open','write','inspect','close','shutdown'];
const exact=(value,keys)=>value&&Object.keys(value).sort().join(',')===keys.split(',').sort().join(',');
const validCounters=c=>exact(c,'begun,completed,inFlight,failures,busy,commits,overflow')&&Object.values(c).every(v=>Number.isSafeInteger(v)&&v>=0);
const zero = () => ({ begun:0, completed:0, inFlight:0, failures:0, busy:0, commits:0, overflow:0 });
export function createWriterJournal({ stream, epoch, capacity, clock=Date.now }) {
  let sequence = 0, acked = 0, operation = null, phase = null, lastCommitAt = null;
  const records = [], counters = zero();
  const append = data => {
    if (records.length >= capacity) { counters.overflow++; return; }
    records.push({ sequence: ++sequence, at:clock(), operation, phase, ...data });
  };
  return {
    enter(id, next) { if (operation !== null || !phases.includes(next)) throw Error('writer_operation'); operation=id; phase=next; append({ kind:'operation_begin' }); },
    leave() { append({ kind:'operation_end' }); operation=null; phase=null; },
    invoke(stage, work, commit = false) {
      if (!stages.includes(stage) || operation === null) counters.overflow++;
      counters.begun++; counters.inFlight++; append({ kind:'native_begin', stage });
      let code=0, ok=false;
      try { const value=work(); ok=true; return value; }
      catch(e) { code=e?.code === 'ERR_SQLITE_ERROR' && Number.isInteger(e.errcode) ? e.errcode : 0;
        counters.failures++; if ([5,6].includes(code & 255)) counters.busy++; throw e; }
      finally { const outcomeAt=clock();counters.completed++; counters.inFlight--; if (ok && commit && phase === 'write') { counters.commits++; lastCommitAt=outcomeAt; }
        append({ at:outcomeAt,kind:'native_end', stage, ok, primary:code & 255, extended:code, commit:ok && commit && phase === 'write' }); }
    },
    lastCommitAt() { return lastCommitAt; },
    chunk() { return { type:'diagnostic_chunk', protocol:WRITER_PROTOCOL, stream, epoch, from:acked+1, through:sequence,
      records:records.map(r=>({...r})), counters:{...counters} }; },
    ack(through) { if (through < acked || through > sequence) throw Error('writer_ack'); acked=through; while(records.length && records[0].sequence<=through)records.shift(); },
    seal(expectedOperations, disposed) { return { type:'diagnostic_seal', protocol:WRITER_PROTOCOL, stream, epoch,
      through:sequence, expectedOperations, counters:{...counters}, disposed }; },
  };
}
export function createWriterLedger({ stream, epoch, capacity }) {
  let armed=false, bad=false, seal=null, sealAck=false, exited=false, disconnected=false, last=0,knownBusy=0,knownFailures=0;
  const records=[], seen=new Map(), expected=new Map(), stack=[], counts=zero();
  let active=null;
  const mark = () => { bad=true; };
  const identity = m => m?.protocol === WRITER_PROTOCOL && m.stream === stream && m.epoch === epoch;
  function consume(r) {
    const keys=r?.kind==='native_begin'?'sequence,at,operation,phase,kind,stage':r?.kind==='native_end'?'sequence,at,operation,phase,kind,stage,ok,primary,extended,commit':'sequence,at,operation,phase,kind';
    if(!exact(r,keys)||!Number.isFinite(r.at)||r.at<0)mark();
    if (!r || r.sequence !== ++last || !expected.has(r.operation) || !phases.includes(r.phase)) { mark(); return; }
    records.push(r);
    if (r.kind === 'operation_begin') {
      if (active || expected.get(r.operation).has(r.phase)) mark(); active={id:r.operation,phase:r.phase};
      expected.get(r.operation).add(r.phase);
    } else if (!active || active.id !== r.operation || active.phase !== r.phase) mark();
    if (r.kind === 'operation_end') { if(stack.length)mark(); active=null; }
    else if (r.kind === 'native_begin') { if(!stages.includes(r.stage))mark(); stack.push(r.stage); counts.begun++; counts.inFlight++; }
    else if (r.kind === 'native_end') {
      if(stack.pop() !== r.stage || typeof r.ok !== 'boolean' || typeof r.commit !== 'boolean' || !Number.isSafeInteger(r.extended) || r.extended < 0 || r.primary !== (r.extended & 255) || (r.ok && r.extended !== 0))mark();
      counts.completed++; counts.inFlight--;
      if (!r.ok) counts.failures++;
      if ([5,6].includes(r.primary)) counts.busy++;
      if(r.commit) { if(!r.ok || r.stage !== 'commit' || r.phase !== 'write')mark(); counts.commits++; }
    } else if (!['operation_begin','operation_end'].includes(r.kind)) mark();
  }
  return {
    expect(id, requiredPhases) { if(expected.has(id))mark(); else expected.set(id,new Set()); expected.get(id).required=requiredPhases; },
    arm(m) { if(!identity(m) || m.type!=='armed' || m.capacity !== capacity || m.boundary !== 'loader-before-open-v1' || armed)mark(); else armed=true; },
    chunk(m) {
      if(identity(m)&&Number.isSafeInteger(m.counters?.busy))knownBusy=Math.max(knownBusy,m.counters.busy);
      if(identity(m)&&Number.isSafeInteger(m.counters?.failures))knownFailures=Math.max(knownFailures,m.counters.failures);
      if(m.type!=='diagnostic_chunk'||!Number.isSafeInteger(m.from)||!Number.isSafeInteger(m.through)||m.from<1||m.through<0||!exact(m,'type,protocol,stream,epoch,from,through,records,counters')||!validCounters(m.counters))mark();
      if(!armed || !identity(m) || !Array.isArray(m.records) || m.records.length > capacity) { mark(); return null; }
      if(m.from > last+1 || m.records.length !== m.through-m.from+1) { mark(); return null; }
      for(const r of m.records) { if(r.sequence<=last){if(!isDeepStrictEqual(seen.get(r.sequence),r))mark();}else{consume(r);seen.set(r.sequence,structuredClone(r));} }
      const watermark=seen.get('watermark:'+m.through);
      if(watermark ? !isDeepStrictEqual(m.counters,watermark) : !isDeepStrictEqual(m.counters,counts))mark();
      seen.set('watermark:'+m.through,structuredClone(m.counters));
      // Identical transfer resends never repeat native outcomes.
      return bad ? null : last;
    },
    seal(m) {
      if(identity(m)&&Number.isSafeInteger(m.counters?.busy))knownBusy=Math.max(knownBusy,m.counters.busy);
      if(identity(m)&&Number.isSafeInteger(m.counters?.failures))knownFailures=Math.max(knownFailures,m.counters.failures);
      if(m.type!=='diagnostic_seal'||!exact(m,'type,protocol,stream,epoch,through,expectedOperations,counters,disposed')||!validCounters(m.counters))mark();
      if(!identity(m) || !armed || m.through !== last || !isDeepStrictEqual(m.counters,counts) ||
        !isDeepStrictEqual(m.expectedOperations,[...expected.keys()]) || active || stack.length || counts.inFlight || counts.overflow || m.disposed !== true)mark();
      for(const done of expected.values())if(!isDeepStrictEqual([...done],done.required))mark();
      if(seal && !isDeepStrictEqual(seal,m))mark(); seal=m;
      return !bad;
    },
    acknowledgedSeal() { sealAck=true; },
    exit(code, signal, disconnect) { exited=code===0 && signal===null; disconnected=disconnect; },
    result() { return { coverage:armed&&!bad&&seal&&sealAck&&exited&&disconnected?'complete':'incomplete',
      ...counts,busy:Math.max(counts.busy,knownBusy),failures:Math.max(counts.failures,knownFailures), records:[...records], sealed:Boolean(seal), acknowledged:sealAck }; },
  };
}
// Receives the real native module, or a deterministic fake in P2-23 tests.
export function observedDatabase(Native, journal) {
  function wrap(native) {
    return new Proxy(native,{ get(target,key) {
      if(key === 'constructor')return Database;
      const value=Reflect.get(target,key,target);
      if(typeof value !== 'function')return value;
      if(key === 'prepare')return (...args) => {
        const statement=journal.invoke('prepare',()=>Reflect.apply(value,target,args));
        return new Proxy(statement,{get(s,k) {
          const f=Reflect.get(s,k,s);if(typeof f !== 'function')return f;
          return (...a) => {
            const stage=k==='iterate'?'iterate':k===Symbol.dispose?'dispose':k==='close'?'close':'execute';
            const v=journal.invoke(stage,()=>Reflect.apply(f,s,a));
            if(k!=='iterate')return v;
            let p;p=new Proxy(v,{get(i,n){if(n===Symbol.iterator)return ()=>p;const f=Reflect.get(i,n,i);
              return typeof f !== 'function'?f:(...a)=>journal.invoke(n==='return'?'iterator_return':'iterator_next',()=>Reflect.apply(f,i,a));}});return p;
          };
        }});
      };
      return (...args) => {
        const verb=key==='exec'?String(args[0]).trim().replace(/;\s*$/,'').toLowerCase():'';
        const stage=key===Symbol.dispose?'dispose':key==='close'?'close':['begin','commit','rollback'].includes(verb)?verb:'configure';
        return journal.invoke(stage,()=>Reflect.apply(value,target,args),stage==='commit');
      };
    }});
  }
  function Database(...args) { return wrap(journal.invoke('open',()=>Reflect.construct(Native,args))); }
  Database.observerBoundary='loader-before-open-v1';
  return Database;
}

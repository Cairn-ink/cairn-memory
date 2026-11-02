// Offline authority and close barriers for the real coordinator Worker.
import { DatabaseSync } from 'node:sqlite';
import { MessageChannel } from 'node:worker_threads';
import { sqliteFileStat } from '../../sqlite-journal-probe.mjs';
import { createContextReadHost as base } from '../../testing/context-semantic-host.mjs';

export async function createContextReadHost(c) {
  const host=await base(c),control=new Int32Array(c.closeControl);
  const wait=async at=>{
    // Startup has not installed the service's message listener yet. Keep the
    // real Worker alive while the host's disposal-proof callback is held.
    const {port1,port2}=new MessageChannel();port1.on('message',()=>{});
    try{while(Atomics.load(control,at)===0)await Atomics.waitAsync(control,at,0).value;}
    finally{port1.close();port2.close();}
  };
  const entered=at=>{Atomics.add(control,at,1);Atomics.notify(control,at);};
  function owns() {
    try{sqliteFileStat(c.ownershipPath);}catch(error){if(error.code==='ENOENT')return false;throw error;}
    let db;
    try {
      // The policy owns and closes a refused native open.
      db=c.resourceOwner.sqlitePolicy.open(new DatabaseSync(c.ownershipPath),c.ownershipPath).db;
      db.exec('BEGIN EXCLUSIVE');db.exec('ROLLBACK');
      return false;
    } catch(error) {
      if(error.code==='storage_busy'||error.code==='ERR_SQLITE_ERROR'&&[5,6].includes(error.errcode&255))return true;
      throw error;
    } finally {db?.close();}
  }
  const authority=host.semanticLedgerAuthority;
  return {...host,semanticLedgerAuthority:{...authority,
    async load(...args) {
      if(Atomics.load(control,4)===1){entered(5);await wait(6);}
      return authority.load(...args);
    },
    async confirmDisposed() {
      entered(7);Atomics.store(control,8,owns()?1:-1);
      if(Atomics.load(control,10)===1){entered(11);await wait(12);}
      return Atomics.load(control,13)!==1;
    },
    compareAndSwap(...args) {
      if(Atomics.load(control,14)===1){entered(15);Atomics.store(control,16,owns()?1:-1);}
      return authority.compareAndSwap(...args);
    },
  },async close() {
    entered(1);
    if(Atomics.load(control,0)===1)await wait(2);
    return host.close();
  }};
}

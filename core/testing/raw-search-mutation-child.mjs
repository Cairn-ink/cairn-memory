import { openMemoryCore } from '../contract.mjs';
import { openDatabase } from '../database.mjs';
import { transaction } from '../database.mjs';
import { suppressOwnerInside } from '../content-suppression-storage.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';

const [path]=process.argv.slice(2);
const core=openMemoryCore({path});
process.once('message',async({operation,input})=>{
  let result;
  try {
    if(operation==='capture-burst') {
      const raw=openRawCaptureCore({path,model:{contextWindow:8192,countTokens:()=>1,extract:()=>({items:[]})}},
        {mode:'raw-v1',lineage:true,deletion:true,port:{version:'raw-seal-v1',async sealRaw({text}){
          return {format:'local-plain-v1',keyVersion:null,sealed:Buffer.from(text)};},async openRaw(){throw Error('unused');}},
        readPolicy:()=>({generation:'synthetic',reason:null})});
      try {
        const samples=[];
        for(let i=0;i<input.count;i++){
          const id='capture-'+input.phase+'-'+i,text='Synthetic capture payload '+i+' '+('sample '.repeat(80));
          const start=process.hrtime.bigint();if(i===0)process.send({started:true});
          const value=await raw.captureRaw({namespace:input.namespace,client:'codex',sessionId:'capture-'+input.phase,eventId:id,
            messages:[{id,role:'user',occurredAt:null,messageOrdinal:i+1,content:text,
              part:{index:0,start:0,totalUnits:text.length,totalBytes:Buffer.byteLength(text)}}]});
          const end=process.hrtime.bigint();if(!value.ok)throw Error(value.error.code);
          samples.push({start:String(start),end:String(end),ms:Number(end-start)/1e6});
          // Leave a scheduling opportunity between calls; this gap is outside
          // the measured capture latency and gives the real reader a turn.
          if(i+1<input.count)await new Promise(resolve=>setTimeout(resolve,2));
        }
        result={ok:true,value:{samples}};
      } finally {raw.close();}
    } else if(operation==='fence'||operation==='exclude'||operation==='erase') {
      const db=openDatabase(path);
      try {transaction(db,()=>{
        if(operation==='fence') {
          const row=db.prepare('SELECT owner_id,scope,project_id,client,session_key FROM raw_conversations WHERE id=?').get(input.conversationId);
          db.prepare('INSERT OR IGNORE INTO raw_session_fences VALUES(?,?,?,?,?)').run(...Object.values(row));
        } else if(operation==='exclude') db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,1)')
          .run(input.conversationId,input.messageId,input.start,input.end);
        else suppressOwnerInside(db,{ownerId:input.namespace.ownerId,reason:'account_erasure',actionId:'synthetic-erase'});
      });result={ok:true};}finally{db.close();}
    } else if(operation==='deleteConversation') {
      const raw=openRawCaptureCore({path},{mode:'off',deletion:true,readPolicy:()=>{throw Error('unused');}});
      try{result=raw.deleteConversation(input);}finally{raw.close();}
    } else result=core[operation](input);
    process.send(result);
  }catch(error){process.send({ok:false,error:{code:error.code??'worker_failed'}});process.exitCode=1;}
  finally{core.close();process.disconnect();}
});
process.send({ready:true});

import { openRawCaptureCore } from '../../core/raw-capture.mjs';
import { rawNamespace as namespace } from '../../core/testing/raw-fixtures.mjs';
const [path]=process.argv.slice(2);
const raw=openRawCaptureCore({path,model:{contextWindow:8192,countTokens:()=>1,extract:()=>({items:[]})}},
  {mode:'raw-v1',lineage:true,deletion:true,port:{version:'raw-seal-v1',async sealRaw({text}){
    return {format:'local-plain-v1',keyVersion:null,sealed:Buffer.from(text)};},async openRaw(){throw Error('unused');}},
    readPolicy:()=>({generation:'synthetic',reason:null})});
let commits=0,timer=null,queue=Promise.resolve(),failure=null,closed=false;
async function capture() {
  const number=commits,id='cadence-capture-'+number,text='Synthetic unrelated capture '+number;
  const result=await raw.captureRaw({namespace,client:'codex',sessionId:'measurement-cadence',eventId:id,
    messages:[{id,role:'user',occurredAt:null,messageOrdinal:number+1,content:text,
      part:{index:0,start:0,totalUnits:text.length,totalBytes:Buffer.byteLength(text)}}]});
  if(!result.ok)throw Error(result.error.code);
  commits++;return {commits};
}
function clear(){if(timer!==null)clearInterval(timer);timer=null;}
function close(){clear();if(!closed){closed=true;raw.close();}}
process.on('message',message=>{
  queue=queue.then(async()=>{
    if(failure)throw failure;
    let value={commits};
    if(message.operation==='capture')value=await capture();
    else if(message.operation==='cadence') {
      clear();const cadenceMs=message.cadenceMs;
      timer=setInterval(()=>{queue=queue.then(capture).catch(error=>{failure=error;clear();});},cadenceMs);
      value={commits,seed:0x59140};
    }else if(message.operation==='pause')clear();
    else if(message.operation==='stop')close();
    process.send({id:message.id,...value});
    if(message.operation==='stop')process.disconnect();
  }).catch(error=>{failure=error;clear();process.send({id:message.id,error:error.message});});
});
process.on('disconnect',close);
process.send({ready:true});

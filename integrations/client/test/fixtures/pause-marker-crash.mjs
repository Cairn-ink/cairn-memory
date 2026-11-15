import {observeHostedPause} from '../../hosted-pause.mjs';
import {withWriteObserver} from '../../private-state.mjs';
const root=process.argv[2];
globalThis.fetch=async()=>Response.json({generation:1,paused:true,enforced:true});
await withWriteObserver(async({path,kind})=>{
 if(kind==='write'&&(path.includes('/hosted-pause-pending/')||path.endsWith('/1.true.json'))){
  process.channel?.ref(); // Remain alive until the parent's explicit crash.
  process.send({kind:path.includes('/hosted-pause-pending/')?'pending':'outside-commit'});
  await new Promise(()=>{});
 }
},()=>observeHostedPause({root,endpoint:'http://127.0.0.1:1'},'synthetic-token'));

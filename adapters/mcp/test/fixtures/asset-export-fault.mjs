// Test-only faults at real Node syscall boundaries, including process death.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const config=JSON.parse(fs.readFileSync(process.env.U4B_FAULT_CONFIG,'utf8'));
const original={link:fs.linkSync,unlink:fs.unlinkSync,fsync:fs.fsyncSync,read:fs.readSync,write:fs.writeSync};
const counts={};
function event(operation,phase,args){
  if(phase==='before')counts[operation]=(counts[operation]??0)+1;
  if(config.operation!==operation||config.phase!==phase||config.index!==counts[operation])return;
  fs.appendFileSync(config.trace,JSON.stringify({operation,phase,index:counts[operation],pid:process.pid})+'\n');
  if(config.action==='kill')process.kill(process.pid,'SIGKILL');
  if(config.action==='corrupt')args[1][0]^=0xff;
  if(config.action==='throw')throw Object.assign(Error('synthetic I/O failure'),{code:'EIO'});
  if(config.action==='parent-swap'){fs.renameSync(config.parent,config.parent+'.old');fs.mkdirSync(config.parent,{mode:0o700});}
  if(config.action==='source-swap'){
    const root=fs.readdirSync(config.parent).find(name=>name.startsWith('.cairn-export-'));
    const dir=config.parent+'/'+root,name=fs.readdirSync(dir)[0];fs.renameSync(dir+'/'+name,dir+'/owned-original');fs.writeFileSync(dir+'/'+name,'FOREIGN',{mode:0o600});
  }
}
for(const operation of ['link','unlink','fsync','write'])fs[operation+'Sync']=function(...args){
  if(operation==='write'){let target;try{target=fs.readlinkSync(`/proc/self/fd/${args[0]}`);}catch{}if(!target?.includes('/payload-'))return original.write(...args);}
  // Ignore unlink in environment probes; count only export cleanup.
  if(operation==='unlink'&&!String(args[0]).includes('/payload-'))return original[operation](...args);
  event(operation,'before',args);const result=original[operation](...args);event(operation,'after',args);return result;
};
syncBuiltinESMExports();

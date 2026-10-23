// Test-only faults at real Node syscall boundaries, including process death.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const config=JSON.parse(fs.readFileSync(process.env.U4B_FAULT_CONFIG,'utf8'));
const original=Object.fromEntries(['link','unlink','fsync','read','write','open','fstat','mkdir','close'].map(name=>[name,fs[name+'Sync']]));
const counts={},active=new Map(),opened=[],closeAttempts=[],inputPaths=new Set();
let inputParents=0,writeFailed=false;
function event(operation,phase,args){
  if(phase==='before')counts[operation]=(counts[operation]??0)+1;
  if(config.operation!==operation||config.phase!==phase||config.index!==counts[operation])return;
  fs.appendFileSync(config.trace,JSON.stringify({operation,phase,index:counts[operation],pid:process.pid})+'\n');
  if(config.action==='kill')process.kill(process.pid,'SIGKILL');
  if(config.action==='corrupt')args[1][0]^=0xff;
  if(config.action==='throw')throw Object.assign(Error('synthetic private I/O prose '+(config.parent??config.inputParent)),{code:operation.startsWith('open-')?'EMFILE':'EIO'});
  if(config.action==='parent-swap'){fs.renameSync(config.parent,config.parent+'.old');fs.mkdirSync(config.parent,{mode:0o700});}
  if(config.action==='source-swap'){
    const root=fs.readdirSync(config.parent).find(name=>name.startsWith('.cairn-export-'));
    const dir=config.parent+'/'+root,name=fs.readdirSync(dir)[0];fs.renameSync(dir+'/'+name,dir+'/owned-original');fs.writeFileSync(dir+'/'+name,'FOREIGN',{mode:0o600});
  }
}
fs.openSync=function(path,flags,...rest){
  let label;const text=String(path),parent=active.get(Number(/^\/proc\/self\/fd\/(\d+)/.exec(text)?.[1]));
  if(config.mode==='input'){
    if(text===config.inputParent&&(flags&0x200000))label='input-parent-'+(++inputParents);
    else if(parent?.startsWith('input-parent-')&&config.names.includes(text.split('/').at(-1))&&!inputPaths.has(text)){
      inputPaths.add(text);label='input-path-'+parent.slice('input-parent-'.length);
    }else if(parent?.startsWith('input-path-')&&/^\/proc\/self\/fd\/\d+$/.test(text)&&!(flags&0x200000))label=parent.replace('path','data');
  }else{
    if(text===config.parent&&(flags&0x200000))label='parent';
    else if(parent==='parent'&&text.includes('/.cairn-export-'))label='stage';
    else if(parent==='stage'&&text.includes('/payload-'))label='data';
    else if(/^\/proc\/self\/fd\/\d+$/.test(text)&&parent==='parent')label='sync-parent';
    else if(/^\/proc\/self\/fd\/\d+$/.test(text)&&parent==='stage')label='sync-stage';
  }
  if(label)event('open-'+label,'before',[path,flags]);
  const fd=original.open(path,flags,...rest);
  if(label){active.set(fd,label);opened.push(label);}
  return fd;
};
fs.fstatSync=function(fd,...rest){
  const label=active.get(fd);if(label)event('inspect-'+label,'before',[fd]);
  return original.fstat(fd,...rest);
};
fs.mkdirSync=function(path,...rest){
  if(String(path).includes('/.cairn-export-'))event('mkdir-stage','before',[path]);
  return original.mkdir(path,...rest);
};
fs.closeSync=function(fd){
  const label=active.get(fd);if(!label)return original.close(fd);
  // Remove tracking before the attempt: an error must never cause a retry,
  // including when the kernel already released and reused the descriptor.
  active.delete(fd);closeAttempts.push(label);
  event('close','before',[fd]);const result=original.close(fd);event('close','after',[fd]);return result;
};
for(const operation of ['link','unlink','fsync','write'])fs[operation+'Sync']=function(...args){
  if(operation==='write'){
    if(active.get(args[0])!=='data')return original.write(...args);
    if(config.beforePublish&&!writeFailed){writeFailed=true;throw Object.assign(Error('synthetic pre-publication write failure'),{code:'EIO'});}
  }
  // Ignore unlink in environment probes; count only export cleanup.
  if(operation==='unlink'&&!String(args[0]).includes('/payload-'))return original.unlink(...args);
  event(operation,'before',args);const result=original[operation](...args);event(operation,'after',args);return result;
};
process.on('exit',()=>{if(config.audit)fs.writeFileSync(config.audit,JSON.stringify({opened,closeAttempts}));});
syncBuiltinESMExports();

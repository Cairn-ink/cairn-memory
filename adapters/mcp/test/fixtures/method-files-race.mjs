// Standalone adversarial filesystem process. Faults act at actual syscall
// boundaries; no test hooks or alternate reader are shipped in the importer.
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import cp,{spawnSync} from 'node:child_process';
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const original={open:fs.openSync,read:fs.readSync,dir:fs.opendirSync,spawn:cp.spawnSync};
let rootMount,childMount,pathFd,sourceFd,directoryFd,changed=false,dataReads=0,specialSeen=false;
fs.openSync=function(path,flags,...rest){
  if(String(path).endsWith('/SKILL.md')&&(flags&0x200000)){
    if(config.mode==='socket'&&!changed){changed=true;fs.unlinkSync(config.root+'/SKILL.md');const child=spawnSync('/usr/bin/python3',['-c','import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1]); s.close()',config.root+'/SKILL.md'],{stdio:'ignore'});if(child.error||child.status!==0)throw Error('socket setup failed');}
    if(config.mode==='fifo-replacement'&&!changed){changed=true;fs.unlinkSync(config.root+'/SKILL.md');
      const child=spawnSync('/usr/bin/mkfifo',[config.root+'/SKILL.md'],{stdio:'ignore'});if(child.error||child.status!==0)throw Error('mkfifo failed');}
    pathFd=original.open.call(this,path,flags,...rest);return pathFd;
  }
  if(path===config.root&&(flags&0x200000)){const fd=original.open.call(this,path,flags,...rest);rootMount=fs.readFileSync(`/proc/self/fdinfo/${fd}`,'utf8').match(/^mnt_id:\s*(\d+)/m)?.[1];return fd;}
  if(String(path).endsWith('/nested')&&(flags&0x200000)){
    directoryFd=original.open.call(this,path,flags,...rest);childMount=fs.readFileSync(`/proc/self/fdinfo/${directoryFd}`,'utf8').match(/^mnt_id:\s*(\d+)/m)?.[1];return directoryFd;
  }
  if(String(path).endsWith('/null')&&(flags&0x200000)){specialSeen=true;pathFd=original.open.call(this,path,flags,...rest);return pathFd;}
  if(pathFd!==undefined&&path===`/proc/self/fd/${pathFd}`&&!(flags&0x200000)){
    if(config.mode==='path-swap'&&!changed){changed=true;fs.renameSync(config.root+'/SKILL.md',config.root+'/old');fs.symlinkSync(config.outside+'/SKILL.md',config.root+'/SKILL.md');}
    if(config.mode==='link-change'&&!changed){changed=true;fs.linkSync(config.root+'/SKILL.md',config.outside+'/hardlink');}
    dataReads++;sourceFd=original.open.call(this,path,flags,...rest);return sourceFd;
  }
  return original.open.call(this,path,flags,...rest);
};
fs.readSync=function(fd,...args){
  const count=original.read.call(this,fd,...args);
  if(fd===sourceFd&&config.mode==='growing'&&!changed){changed=true;fs.appendFileSync(config.root+'/SKILL.md','x'.repeat(1_600_001));}
  return count;
};
fs.opendirSync=function(path,...args){
  if(directoryFd!==undefined&&path===`/proc/self/fd/${directoryFd}`&&config.mode==='ancestor-swap'&&!changed){
    changed=true;fs.renameSync(config.root+'/nested',config.outside+'/relocated');fs.symlinkSync(config.outside,config.root+'/nested');
  }
  return original.dir.call(this,path,...args);
};
cp.spawnSync=function(executable,args,options){
  if(args[0]?.endsWith('/isolated-file-read-child.mjs')&&pathFd!==undefined){
    const input=JSON.parse(options.input);
    if(input.path===`/proc/${process.pid}/fd/${pathFd}`){
      dataReads++;
      const preload='data:text/javascript,'+encodeURIComponent(`
        import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
        const config=${JSON.stringify(config)},open=fs.openSync,read=fs.readSync;let data,changed=false;
        const change=()=>{if(changed)return;changed=true;
          if(config.mode==='path-swap'){fs.renameSync(config.root+'/SKILL.md',config.root+'/old');fs.symlinkSync(config.outside+'/SKILL.md',config.root+'/SKILL.md');}
          if(config.mode==='link-change')fs.linkSync(config.root+'/SKILL.md',config.outside+'/hardlink');
          if(config.mode==='growing')fs.appendFileSync(config.root+'/SKILL.md','x'.repeat(1_600_001));
        };
        fs.openSync=(path,...rest)=>{if(path===${JSON.stringify(input.path)}&&['path-swap','link-change'].includes(config.mode))change();const fd=open(path,...rest);if(path===${JSON.stringify(input.path)})data=fd;return fd;};
        fs.readSync=(fd,...rest)=>{const n=read(fd,...rest);if(fd===data&&config.mode==='growing')change();return n;};
        syncBuiltinESMExports();
      `);
      const result=original.spawn(executable,['--import',preload,...args],options);
      if(['path-swap','link-change','growing'].includes(config.mode))changed=true;
      return result;
    }
  }
  return original.spawn(executable,args,options);
};
syncBuiltinESMExports();
let prepared,outcome;
try{
  const {prepareMethodFiles}=await import(config.module);
  prepared=prepareMethodFiles(config.root,config.exclusions??[]);prepared.validate();
  outcome={refused:false,files:prepared.files};
}catch{outcome={refused:true};}
finally{prepared?.close();}
fs.writeFileSync(config.result,JSON.stringify({...outcome,changed,dataReads,specialSeen,rootMount,childMount,sameDevice:config.mode==='mount'?fs.statSync(config.root).dev===fs.statSync(config.root+'/nested').dev:null,pid:process.pid}));

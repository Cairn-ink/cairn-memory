// Test-only actual filesystem swaps in the CLI's syscall path.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
const config=globalThis.U4B_FILE_FAULT,original={open:fs.openSync,read:fs.readSync};
let pathFd,dataFd,changed=false;
function change(){
  if(changed)return;changed=true;
  if(config.mode==='ancestor'){fs.renameSync(config.parent,config.parent+'.old');fs.symlinkSync(config.outside,config.parent);}
  else if(config.mode==='link')fs.linkSync(config.path,config.path+'.link');
  else if(config.mode==='growing')fs.appendFileSync(config.path,'x'.repeat(100000));
  else if(config.mode==='fifo'){
    fs.unlinkSync(config.path);const child=spawnSync('/usr/bin/mkfifo',[config.path],{stdio:'ignore'});if(child.error||child.status!==0)throw Error('mkfifo failed');
  }else {fs.renameSync(config.path,config.path+'.old');fs.symlinkSync(config.outside+'/payload',config.path);}
}
fs.openSync=function(path,flags,...rest){
  const result=original.open(path,flags,...rest);
  if(String(path)===config.parent&&(flags&0x200000)&&config.mode==='ancestor')change();
  if(String(path).endsWith('/'+config.name)&&(flags&0x200000)){pathFd=result;if(config.mode==='fifo')change();}
  if(pathFd!==undefined&&path===`/proc/self/fd/${pathFd}`&&!(flags&0x200000)){dataFd=result;if(['swap','link'].includes(config.mode))change();}
  return result;
};
fs.readSync=function(fd,...args){const count=original.read(fd,...args);if(fd===dataFd&&config.mode==='growing')change();return count;};
syncBuiltinESMExports();

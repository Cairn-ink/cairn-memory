import { constants,openSync,closeSync,readSync,lstatSync,statSync } from 'node:fs';
import { isAbsolute,dirname,basename,extname } from 'node:path';
import { PATH_FLAGS,fdPath,sameFile,inspectFile,methodEntryName,probeMethodFileEnvironment,BINARY_MEDIA } from './method-package-files.mjs';
import { fail } from '../../core/validation.mjs';

/** Separate explicit input channels; descriptors and original names survive review. */
export function prepareAssetFiles(storePath,storeIdentity) {
  if(typeof storePath!=='string'||!isAbsolute(storePath)||storePath.includes('\0'))fail('invalid_path');
  probeMethodFileEnvironment();
  const fds=[],pins=[];
  const hold=fd=>{fds.push(fd);return fd;};
  const close=()=>{
    let first;
    for(const fd of fds.splice(0).reverse())try{closeSync(fd);}catch(error){first??=error;}
    if(first)throw first;
  };
  // O_PATH pins do not acquire a data descriptor. Check both the supplied path
  // and the pinned inode before opening for data, including hard-link aliases.
  const inode=stat=>`${stat.dev}:${stat.ino}`;
  const protectedInodes=new Set(storeIdentity?[inode(storeIdentity)]:[]);
  function collectStore() {
    for (const base of [storePath,storePath+'.context-read-v1.sqlite']) {
      for (const suffix of ['', '-wal', '-shm', '-journal']) {
        try { protectedInodes.add(inode(statSync(base+suffix,{bigint:true}))); }
        catch(error) { if(error.code!=='ENOENT')fail('invalid_input'); }
      }
    }
  }
  collectStore(); // Retain identities even if a protected pathname is replaced.
  function refuseStore(input) {
    collectStore();
    if(protectedInodes.has(inode(input)))fail('invalid_input');
  }
  function read(path,maximum,{binary=false,json=false}={}) {
    if(typeof path!=='string'||!isAbsolute(path)||path.includes('\0'))fail('invalid_path');
    refuseStore(lstatSync(path,{bigint:true}));
    refuseStore(statSync(path,{bigint:true}));
    const name=methodEntryName(basename(path)),parent=hold(openSync(dirname(path),PATH_FLAGS|constants.O_DIRECTORY));
    const root=inspectFile(parent,undefined,'directory');
    const fd=hold(openSync(`${fdPath(parent)}/${name}`,PATH_FLAGS)),saved={fd,parent,name,...inspectFile(fd,root.mount,'file')};
    refuseStore(saved.stat);
    if(saved.stat.size>BigInt(maximum))fail('invalid_input');
    const data=hold(openSync(fdPath(fd),constants.O_RDONLY|constants.O_NONBLOCK));
    const verify=()=>{for(const handle of [fd,data])if(!sameFile(saved.stat,inspectFile(handle,root.mount,'file').stat))fail('invalid_input');};
    verify();const bytes=Buffer.alloc(Number(saved.stat.size));let offset=0;
    while(offset<bytes.length){verify();const count=readSync(data,bytes,offset,Math.min(65536,bytes.length-offset),null);verify();if(!count)fail('invalid_input');offset+=count;}
    if(readSync(data,Buffer.alloc(1),0,1,null)!==0)fail('invalid_input');verify();pins.push(saved);
    if(binary)return bytes;
    let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail('invalid_input');}
    if(!json)return text;
    try{return JSON.parse(text);}catch{fail('invalid_input');}
  }
  function validate(){
    for(const saved of pins){
      if(!sameFile(saved.stat,inspectFile(saved.fd,saved.mount,'file').stat))fail('invalid_input');
      refuseStore(statSync(`${fdPath(saved.parent)}/${saved.name}`,{bigint:true}));
      const current=openSync(`${fdPath(saved.parent)}/${saved.name}`,PATH_FLAGS);
      try{if(!sameFile(saved.stat,inspectFile(current,saved.mount,'file').stat))fail('invalid_input');}finally{closeSync(current);}
    }
  }
  return {read,validate,close};
}
export function assetMedia(path){const media=BINARY_MEDIA.get(extname(path).toLowerCase());if(!media)fail('unsupported_media');return media;}

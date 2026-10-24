import { constants, openSync, closeSync, fstatSync, readSync, readFileSync, opendirSync,
  mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, extname, dirname, basename, join } from 'node:path';
import { METHOD_LIMITS, methodPath } from '../../core/method-package-input.mjs';
import { fail } from '../../core/validation.mjs';
import { ASSET_LIMITS, validateAssetMedia } from '../../core/asset-input.mjs';

// Linux's generic ABI O_PATH. Refuse other ABIs rather than guess flag values.
const O_PATH=0x200000;
export const PATH_FLAGS=O_PATH|constants.O_NOFOLLOW;
export const METHOD_IMPORT_LIMITS=Object.freeze({
  rawFileBytes:4*METHOD_LIMITS.fileUnits, rawVersionBytes:4*METHOD_LIMITS.versionUnits,
  traversalDepth:32, traversalEntries:4096, changeFileBytes:16_000_000,
  reviewBytes:512*1024, excludePatterns:128, excludeUnits:METHOD_LIMITS.pathUnits,
});
const decode=(bytes,code='invalid_input')=>{try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail(code);}};
export const fdPath=fd=>`/proc/self/fd/${fd}`;
export function methodEntryName(name) {
  if(typeof name!=='string'||!name||name==='.'||name==='..'||/[\/\0]/u.test(name))fail('invalid_path');
  return name;
}
export function methodMountId(metadata) {
  if(typeof metadata!=='string')fail('invalid_input');
  const lines=metadata.split('\n').filter(line=>line.startsWith('mnt_id:'));
  if(lines.length!==1)fail('invalid_input');
  const match=/^mnt_id:[ \t]*([1-9][0-9]*)[ \t]*$/.exec(lines[0]);
  if(!match)fail('invalid_input');
  return BigInt(match[1]);
}
const mount=fd=>methodMountId(readFileSync(`/proc/self/fdinfo/${fd}`,'utf8'));
export function assertMethodMount(actual,expected) {
  if(actual!==expected)fail('invalid_input');
}
const identity=fd=>fstatSync(fd,{bigint:true});
export const sameFile=(a,b)=>['dev','ino','mode','size','nlink','mtimeNs','ctimeNs'].every(key=>a[key]===b[key]);
export function inspectFile(fd,expectedMount,type) {
  const stat=identity(fd);
  if(stat.isSymbolicLink()||type==='directory'&&!stat.isDirectory()||type==='file'&&(!stat.isFile()||stat.nlink!==1n))fail('invalid_input');
  const id=mount(fd);if(expectedMount!==undefined)assertMethodMount(id,expectedMount);
  return {stat,mount:id};
}
// Exercise the exact O_PATH/no-follow/magic-link behavior, including EBADF for
// data reads on path descriptors. Unsupported /proc/flags fail with no fallback.
export function probeMethodFileEnvironment() {
  if(process.platform!=='linux'||!['x64','arm64'].includes(process.arch)||
    !constants.O_NOFOLLOW||!constants.O_DIRECTORY)fail('invalid_input');
  const scratch=mkdtempSync(join(tmpdir(),'cairn-method-probe-')),fds=[];
  try {
    writeFileSync(join(scratch,'file'),'x',{mode:0o600});symlinkSync('file',join(scratch,'link'));
    const root=openSync(scratch,PATH_FLAGS|constants.O_DIRECTORY);fds.push(root);
    const rootInfo=inspectFile(root,undefined,'directory');
    const path=openSync(`${fdPath(root)}/file`,PATH_FLAGS);fds.push(path);
    const info=inspectFile(path,rootInfo.mount,'file');
    let bad=false;try{readSync(path,Buffer.alloc(1),0,1,null);}catch(error){bad=error.code==='EBADF';}
    if(!bad)fail('invalid_input');
    const link=openSync(`${fdPath(root)}/link`,PATH_FLAGS);fds.push(link);
    if(!identity(link).isSymbolicLink())fail('invalid_input');
    const read=openSync(fdPath(path),constants.O_RDONLY);fds.push(read);
    if(!sameFile(info.stat,inspectFile(read,rootInfo.mount,'file').stat))fail('invalid_input');
    const byte=Buffer.alloc(1);if(readSync(read,byte,0,1,null)!==1||byte[0]!==120)fail('invalid_input');
  }finally{for(const fd of fds.reverse())closeSync(fd);rmSync(scratch,{recursive:true,force:true});}
}

const media=new Map([
  ['.md','text/markdown'],['.markdown','text/markdown'],['.json','application/json'],
  ['.yaml','application/yaml'],['.yml','application/yaml'],['.csv','text/csv'],
  ...['.txt','.js','.mjs','.cjs','.ts','.py','.sh','.css','.html','.toml','.ini','.xml','.sql','.rst'].map(ext=>[ext,'text/plain']),
]);
// Anchored POSIX paths; ** crosses separators, * and ? do not. A trailing /**
// also matches the directory itself, so an excluded subtree is never opened.
export function methodExclude(pattern) {
  if(typeof pattern!=='string'||!pattern||pattern.length>METHOD_IMPORT_LIMITS.excludeUnits||pattern.startsWith('/')||/[\\\0]/u.test(pattern)||
    pattern.split('/').some(part=>part==='.'||part==='..'||!part))fail('invalid_input');
  const tokens=[];
  for(let i=0;i<pattern.length;i++){
    const c=pattern[i];
    if(c==='*'){
      if(pattern[i+1]==='*'){
        if(pattern[i+2]==='/'){tokens.push({kind:'directories'});i+=2;}
        else{tokens.push({kind:'many',cross:true});i++;}
      }else tokens.push({kind:'many',cross:false});
    }else if(c==='?')tokens.push({kind:'one',matches:character=>character!=='/'});
    else if(c==='['){
      const end=pattern.indexOf(']',i+1);if(end<0)fail('invalid_input');
      let body=pattern.slice(i+1,end);if(!body||body.includes('/')||body.includes('['))fail('invalid_input');
      if(body[0]==='!')body='^'+body.slice(1);
      // One character class, tested against one code point: no quantifiers or
      // ambiguous repetition. Retains Unicode ranges and malformed-class refusal.
      let expression;try{expression=new RegExp('^(?!/)['+body+']$','u');}catch{fail('invalid_input');}
      tokens.push({kind:'one',matches:character=>expression.test(character)});i=end;
    }else{
      const literal=String.fromCodePoint(pattern.codePointAt(i));i+=literal.length-1;
      tokens.push({kind:'one',matches:character=>character===literal});
    }
  }
  // POSIX path characters include line terminators; globstar consumes them too.
  const trailingDirectory=pattern.endsWith('/**');
  return path=>{
    const characters=Array.from(String(path)),length=characters.length;
    let previous=new Uint8Array(length+1),current=new Uint8Array(length+1),directoryItself=false;previous[0]=1;
    // Two rows: O(pattern units * path code points) work and O(path) space.
    for(let index=0;index<tokens.length;index++){
      if(trailingDirectory&&index===tokens.length-2)directoryItself=Boolean(previous[length]);
      const token=tokens[index];current.fill(0);
      if(token.kind==='many'){
        current[0]=previous[0];
        for(let j=1;j<=length;j++)current[j]=previous[j]||current[j-1]&&
          (token.cross||characters[j-1]!=='/');
      }else if(token.kind==='directories'){
        current[0]=previous[0];let prefix=false;
        for(let j=1;j<=length;j++){
          prefix=prefix||Boolean(previous[j-1]);
          current[j]=previous[j]||prefix&&characters[j-1]==='/';
        }
      }else for(let j=1;j<=length;j++)current[j]=previous[j-1]&&token.matches(characters[j-1]);
      [previous,current]=[current,previous];
    }
    return directoryItself||Boolean(previous[length]);
  };
}

/** Owns pinned parent, path and read fds until close, including across review. */
export function prepareMethodFiles(directory,exclusions=[],attachments=false) {
  if(typeof directory!=='string'||!isAbsolute(directory)||directory.includes('\0'))fail('invalid_path');
  probeMethodFileEnvironment();
  const fds=[],pins=[],files=[],pruned=[],patterns=exclusions.map(methodExclude);
  let rawBytes=0,binaryBytes=0,units=0,entries=0;
  const hold=fd=>{fds.push(fd);return fd;};
  const release=fd=>{const index=fds.indexOf(fd);if(index!==-1){fds.splice(index,1);closeSync(fd);}};
  const close=()=>{for(const fd of fds.splice(0).reverse())closeSync(fd);};
  function pin(parent,name,expectedMount,type) {
    methodEntryName(name);
    const fd=hold(openSync(`${fdPath(parent)}/${name}`,PATH_FLAGS|(type==='directory'?constants.O_DIRECTORY:0)));
    return {fd,parent,name,...inspectFile(fd,expectedMount,type)};
  }
  function read(pin,maximum,account,binary=false) {
    if(pin.stat.size>BigInt(maximum))fail('invalid_input');
    const fd=hold(openSync(fdPath(pin.fd),constants.O_RDONLY|constants.O_NONBLOCK));
    const verify=()=>{if(!sameFile(pin.stat,inspectFile(pin.fd,pin.mount,'file').stat)||!sameFile(pin.stat,inspectFile(fd,pin.mount,'file').stat))fail('invalid_input');};
    try {
    verify();const chunks=[];let total=0;
    while(true){
      verify();const chunk=Buffer.alloc(Math.min(65536,maximum-total+1));
      const count=readSync(fd,chunk,0,chunk.length,null);verify();
      if(!count)break;
      total+=count;if(total>maximum)fail('invalid_input');account(count);chunks.push(chunk.subarray(0,count));
    }
    if(BigInt(total)!==pin.stat.size)fail('invalid_input');pins.push(pin);
    const bytes=Buffer.concat(chunks,total);return binary?bytes:decode(bytes);
    } finally {release(fd);}
  }
  try {
    const root=hold(openSync(directory,PATH_FLAGS|constants.O_DIRECTORY)),rootInfo=inspectFile(root,undefined,'directory');
    function walk(fd,prefix,depth) {
      if(depth>METHOD_IMPORT_LIMITS.traversalDepth)fail('invalid_input');
      inspectFile(fd,rootInfo.mount,'directory');
      const dir=opendirSync(fdPath(fd),{encoding:'buffer',bufferSize:1});
      try {
        let entry;
        while((entry=dir.readSync())!==null){
          if(++entries>METHOD_IMPORT_LIMITS.traversalEntries)fail('invalid_input');
          const name=methodEntryName(decode(entry.name,'invalid_path')),path=prefix?`${prefix}/${name}`:name;
          methodPath(path);
          if(name==='.git'||patterns.some(matches=>matches(path))){pruned.push(path);continue;}
          const child=pin(fd,name,rootInfo.mount);
          if(child.stat.isDirectory())walk(child.fd,path,depth+1);
          else {
            // Type, mount and nlink checks precede *any* data open.
            inspectFile(child.fd,rootInfo.mount,'file');
            const extension=extname(name).toLowerCase(),binary=attachments&&BINARY_MEDIA.has(extension);
            const mediaType=media.get(extension)??(attachments&&extension==='.svg'?'text/plain':null)??(binary?BINARY_MEDIA.get(extension):null);if(!mediaType)fail('unsupported_media');
            if(files.length>=METHOD_LIMITS.files)fail('invalid_input');
            if(binary){
              const bytes=read(child,Math.min(ASSET_LIMITS.versionBytes,67108864-binaryBytes),count=>{binaryBytes+=count;},true);
              validateAssetMedia(path,mediaType,bytes);files.push({kind:'binary',path,bytes,mediaType});continue;
            }
            const text=read(child,Math.min(METHOD_IMPORT_LIMITS.rawFileBytes,METHOD_IMPORT_LIMITS.rawVersionBytes-rawBytes),count=>{
              rawBytes+=count;if(rawBytes>METHOD_IMPORT_LIMITS.rawVersionBytes)fail('invalid_input');
            });
            units+=text.length;if(text.length>METHOD_LIMITS.fileUnits||units>METHOD_LIMITS.versionUnits)fail('invalid_input');
            files.push({path,text,mediaType});
          }
        }
      }finally{dir.closeSync();}
      // Retain the root and immediate parents referenced by review-time file
      // checks. Empty/unreferenced directories need no live capability now.
      if(fd!==root&&!pins.some(saved=>saved.parent===fd))release(fd);
    }
    walk(root,'',0);if(!files.length)fail('invalid_input');
    if(binaryBytes){for(const file of files)if(file.kind!=='binary')file.kind='text';}
    files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);pruned.sort();
    function validate() {
      for(const saved of pins){
        if(!sameFile(saved.stat,inspectFile(saved.fd,saved.mount,'file').stat))fail('invalid_input');
        const current=openSync(`${fdPath(saved.parent)}/${saved.name}`,PATH_FLAGS);
        try{if(!sameFile(saved.stat,inspectFile(current,saved.mount,'file').stat))fail('invalid_input');}
        finally{closeSync(current);}
      }
    }
    validate();
    return {files,pruned,validate,close,mixed:binaryBytes>0,
      change(path) {
        if(!isAbsolute(path)||path.includes('\0'))fail('invalid_path');
        const parent=hold(openSync(dirname(path),PATH_FLAGS|constants.O_DIRECTORY));
        const info=inspectFile(parent,undefined,'directory'),saved=pin(parent,basename(path),info.mount,'file');
        const text=read(saved,METHOD_IMPORT_LIMITS.changeFileBytes,()=>{});
        try{return JSON.parse(text);}catch{fail('invalid_input');}
      }};
  }catch(error){close();throw error;}
}

export const BINARY_MEDIA=new Map([
  ['.png','image/png'],['.jpg','image/jpeg'],['.jpeg','image/jpeg'],['.gif','image/gif'],['.webp','image/webp'],
  ['.wav','audio/wav'],['.pdf','application/pdf'],['.mp3','audio/mpeg'],['.mp4','video/mp4'],
  ['.ttf','font/ttf'],['.otf','font/otf'],['.woff','font/woff'],['.woff2','font/woff2'],
]);

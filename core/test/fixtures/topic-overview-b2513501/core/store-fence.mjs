// Host-selected rollback-journal review fence. This module must stay SQLite-free
// at link time: the CLI inspects its pinned file before importing/opening SQLite.
import {constants,openSync,closeSync,readSync,fstatSync,lstatSync} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ownData} from './local-authority-input.mjs';
import {fail,identifier} from './validation.mjs';

export function storeFenceOption(value) {
  const input=ownData(value,['version','dev','ino','applicationId','userVersion','storeId']);
  if(Object.keys(input).length!==6||input.version!=='store-fence-v1'||
    ![input.dev,input.ino].every(value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,29})$/.test(value))||
    !Number.isSafeInteger(input.applicationId)||input.applicationId<0||input.applicationId>0x7fffffff||
    !Number.isSafeInteger(input.userVersion)||input.userVersion<0||input.userVersion>0x7fffffff)fail('invalid_input');
  try{identifier(input.storeId);}catch{fail('invalid_input');}
  return Object.freeze(input);
}
const filesystemIdentity=stat=>({dev:String(stat.dev),ino:String(stat.ino)});
function fileIdentity(path) {
  try{return lstatSync(path,{bigint:true});}
  catch(error){if(error.code==='ENOENT')fail('method_not_found');throw error;}
}
function regular(stat) {
  if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077n)!==0n)fail('unsafe_database_file');
}
function noCompanions(path) {
  // Refuse even dangling links and empty/persistent journals. A participant must
  // keep rollback-journal mode throughout review; immutable reads are not used.
  for(const suffix of ['-journal','-wal','-shm']){
    try{lstatSync(path+suffix);}catch(error){if(error.code==='ENOENT')continue;throw error;}
    fail('unsafe_database_file');
  }
}
export function pinStoreFile(path,expected) {
  if(typeof path!=='string'||!isAbsolute(path)||path.includes('\0')||resolve(path)!==path)fail('invalid_path');
  let fd;
  try{
    const first=fileIdentity(path);regular(first);
    fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const pinned=fstatSync(fd,{bigint:true});regular(pinned);
    const identity=filesystemIdentity(pinned);
    if(first.dev!==pinned.dev||first.ino!==pinned.ino)fail('unsafe_database_file');
    const check=()=>{
      const current=fileIdentity(path);regular(current);
      if(String(current.dev)!==identity.dev||String(current.ino)!==identity.ino||
        expected&&(expected.dev!==identity.dev||expected.ino!==identity.ino))fail('unsafe_database_file');
      noCompanions(path);
      const header=Buffer.alloc(100);
      if(readSync(fd,header,0,100,0)!==100||header.subarray(0,16).toString('latin1')!=='SQLite format 3\0')fail('unsupported_database');
      if(header[18]!==1||header[19]!==1)fail('unsafe_database_file');
    };
    check();
    return {identity:Object.freeze(identity),check,close(){if(fd!==undefined){closeSync(fd);fd=undefined;}}};
  }catch(error){if(fd!==undefined)closeSync(fd);if(error.code==='ENOENT')fail('method_not_found');throw error;}
}
export function storeIdentity(db) {
  let result;
  try{
    result={applicationId:db.prepare('PRAGMA application_id').get().application_id,
      userVersion:db.prepare('PRAGMA user_version').get().user_version,
      storeId:db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get()?.store_id};
  }catch(error){if(error.errcode===5||error.errcode===6)throw error;fail('unsupported_database');}
  if(typeof result.storeId!=='string')fail('unsupported_database');
  return result;
}
export function assertStoreIdentity(db,expected) {
  const actual=storeIdentity(db);
  if(['applicationId','userVersion','storeId'].some(key=>actual[key]!==expected[key]))fail('unsupported_database');
}
export function noncreatingStoreURI(path) {
  const uri=pathToFileURL(path);uri.searchParams.set('mode','rw');return uri.href;
}

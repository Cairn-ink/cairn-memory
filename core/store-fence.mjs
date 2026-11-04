import { validateContextProductLayout } from './context-product-schema.mjs';
import { attestContentSafety } from './content-safety-schema.mjs';
// Host-selected rollback-journal review fence. This module must stay SQLite-free
// at link time: the CLI validates file identity before importing host SQLite.
import {lstatSync} from 'node:fs';
import {probeRollbackJournal} from './sqlite-journal-probe.mjs';
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
  // A pin is a checked identity, not a raw fd. Closing any raw descriptor on
  // this inode would release all of this process's SQLite record locks.
  const first=fileIdentity(path);regular(first);
  const identity=filesystemIdentity(first);
  const check=()=>{
    const current=fileIdentity(path);regular(current);
    if(String(current.dev)!==identity.dev||String(current.ino)!==identity.ino||
      expected&&(expected.dev!==identity.dev||expected.ino!==identity.ino))fail('unsafe_database_file');
    noCompanions(path);
    if(current.size<100n)fail('unsupported_database');
    let result;
    try{result=probeRollbackJournal(path);}catch{fail('unsafe_database_file');}
    if(result.code===14||result.mode&&result.mode!=='delete')fail('unsafe_database_file');
    if(result.mode!=='delete')fail('unsupported_database');
    const after=fileIdentity(path);regular(after);
    if(after.dev!==first.dev||after.ino!==first.ino)fail('unsafe_database_file');
    noCompanions(path);
  };
  check();
  return {identity:Object.freeze(identity),check,close(){}};
}

export function storeIdentity(db) {
  let result;
  try{
    const layout=attestContentSafety(db);
    if(layout.suppressionRevision)validateContextProductLayout(db,layout);
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

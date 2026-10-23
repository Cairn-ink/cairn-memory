import { types } from 'node:util';
import { ownData } from './local-authority-input.mjs';
import { redactSecrets } from '../plugins/cairn-memory/lib/redact.mjs';
import { cardNamespace } from './private-card-input.mjs';
import { METHOD_SNAPSHOT_LIMITS } from './method-package-input.mjs';
import { binaryView } from './asset-identity.mjs';
import { fail, identifier, object, revision } from './validation.mjs';

export const ASSET_METHODS = Object.freeze(['importAssetVersion','listAssets','listAssetVersions','getAssetVersion',
  'readAssetBytes','verifyAssetBytes','deleteAsset','deleteAssetVersion','getAssetUsage','listAssetEffects',
  'createAssetDerivative','listAssetDerivatives','readAssetDerivative','deleteAssetDerivative']);
export const ASSET_METHOD_GRANTS = Object.freeze(['importMethodVersion','readMethodAttachmentBytes']);
export const ASSET_READS = new Set(ASSET_METHODS.filter(method => !['importAssetVersion','deleteAsset','deleteAssetVersion','createAssetDerivative','deleteAssetDerivative'].includes(method)));
export const ASSET_LIMITS = Object.freeze({ versionBytes:33554432,versions:64,assets:1024,derivatives:32,derivativeUnits:20000,
  ownerBytes:200000000,chunkBytes:32768,responseBytes:65536,pageItems:20,titleUnits:200,filenameUnits:512,
  derivativePartUnits:4000,timecodes:256,languageUnits:35 });
export const ASSET_MEDIA = Object.freeze(['image/png','image/jpeg','image/gif','image/webp','audio/wav','application/pdf',
  'audio/mpeg','video/mp4','font/ttf','font/otf','font/woff','font/woff2']);
export function assetOptions(value) {
  if (value === undefined) return undefined;
  value=ownData(value,['version','storage','authority']);
  if (value.version!=='assets-local-v1' || value.storage!=='sqlite-blob-v1') fail('invalid_input');
  value.authority=ownData(value.authority,['authorize','isCurrent']);
  if (typeof value.authority.authorize!=='function' || typeof value.authority.isCurrent!=='function') fail('authority_required');
  return Object.freeze({...value,authority:Object.freeze({...value.authority})});
}
// Binary bytes have their own budget and one private copy; they never consume
// the JSON/string snapshot budget and never reach a host callback.
export function assetSnapshot(value, depth=0, budget={nodes:METHOD_SNAPSHOT_LIMITS.nodes,units:METHOD_SNAPSHOT_LIMITS.units,bytes:ASSET_LIMITS.versionBytes}) {
  if (--budget.nodes<0 || depth>16) fail('invalid_input');
  if (types.isUint8Array(value)) {
    const view=binaryView(value);
    if (view.byteLength>budget.bytes) fail('invalid_input');
    budget.bytes-=view.byteLength;
    return Buffer.from(view);
  }
  if (value===null || typeof value==='boolean') return value;
  if (typeof value==='number' && Number.isFinite(value)) return value;
  if (typeof value==='string') {
    if (!value.isWellFormed() || value.length>METHOD_SNAPSHOT_LIMITS.stringUnits || (budget.units-=value.length)<0) fail('invalid_input');
    return value;
  }
  if (!value || typeof value!=='object' || types.isProxy(value)) fail('invalid_input');
  const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
  if (array ? prototype!==Array.prototype : prototype!==Object.prototype && prototype!==null) fail('invalid_input');
  const descriptors=Object.getOwnPropertyDescriptors(value), keys=Reflect.ownKeys(descriptors);
  if (keys.length>budget.nodes || keys.some(key=>typeof key!=='string' || !key.isWellFormed() || !Object.hasOwn(descriptors[key],'value')) ||
      array && (value.length>METHOD_SNAPSHOT_LIMITS.arrayItems || keys.length!==value.length+1)) fail('invalid_input');
  if (array) return Array.from({length:value.length},(_,i)=>{
    if (!Object.hasOwn(descriptors,i)) fail('invalid_input');
    return assetSnapshot(descriptors[i].value,depth+1,budget);
  });
  const clean=Object.create(null);
  for (const key of keys.sort()) {
    if ((budget.units-=key.length)<0) fail('invalid_input');
    clean[key]=assetSnapshot(descriptors[key].value,depth+1,budget);
  }
  return clean;
}
export function freezeAssetMetadata(value) {
  if (value && typeof value==='object' && !types.isUint8Array(value)) {
    for (const child of Object.values(value)) freezeAssetMetadata(child);
    Object.freeze(value);
  }
  return value;
}
const identity = value => {
  if (typeof value!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) fail('invalid_input'); return value;
};
export function assetDerivativeRef(value) {
  object(value,['type','namespace','assetId','versionId','derivativeId']);
  if(value.type!=='asset-derivative')fail('invalid_input');
  return {type:value.type,namespace:cardNamespace(value.namespace),assetId:identifier(value.assetId),
    versionId:identifier(value.versionId),derivativeId:identifier(value.derivativeId)};
}
export function derivativeText(value) {
  if(typeof value!=='string'||!value.isWellFormed()||value.includes('\0')||value.length>20000)fail('invalid_input');
  const clean=redactSecrets(value);if(clean.length>20000)fail('invalid_input');return clean;
}
const grandfatheredLanguages=new Set(['art-lojban','cel-gaulish','en-gb-oed','i-ami','i-bnn','i-default','i-enochian','i-hak','i-klingon',
  'i-lux','i-mingo','i-navajo','i-pwn','i-tao','i-tay','i-tsu','no-bok','no-nyn','sgn-be-fr','sgn-be-nl','sgn-ch-de',
  'zh-guoyu','zh-hakka','zh-min','zh-min-nan','zh-xiang']);
function languageTag(value) {
  // BCP 47, including extlangs, grandfathered tags and private use. Intl's
  // Unicode locale grammar excludes legal BCP 47 extlangs and private-use tags.
  const tag=value.toLowerCase();if(grandfatheredLanguages.has(tag))return;
  const parts=tag.split('-');let i=1;
  const alpha=(part,min,max)=>typeof part==='string'&&part.length>=min&&part.length<=max&&/^[a-z]+$/.test(part);
  const alnum=(part,min,max)=>typeof part==='string'&&part.length>=min&&part.length<=max&&/^[a-z0-9]+$/.test(part);
  function privateUse(){if(parts[i++]!=='x'||i===parts.length)fail('invalid_input');while(i<parts.length)if(!alnum(parts[i++],1,8))fail('invalid_input');}
  if(parts[0]==='x'){i=0;privateUse();return;}
  if(!alpha(parts[0],2,8))fail('invalid_input');
  if(parts[0].length<=3)for(let n=0;n<3&&alpha(parts[i],3,3);n++)i++;
  if(alpha(parts[i],4,4))i++;
  if(alpha(parts[i],2,2)||typeof parts[i]==='string'&&/^\d{3}$/.test(parts[i]))i++;
  const variants=new Set(),extensions=new Set();
  while(alnum(parts[i],5,8)||typeof parts[i]==='string'&&/^\d[a-z0-9]{3}$/.test(parts[i])) {
    if(variants.has(parts[i]))fail('invalid_input');variants.add(parts[i++]);
  }
  while(i<parts.length&&parts[i]!=='x') {
    if(!alnum(parts[i],1,1)||extensions.has(parts[i]))fail('invalid_input');extensions.add(parts[i++]);
    const start=i;while(alnum(parts[i],2,8))i++;
    if(i===start)fail('invalid_input');
  }
  if(i<parts.length)privateUse();
}
export function derivativeInput(input) {
  if(!['caption','transcript','description','alt-text'].includes(input.kind))fail('invalid_input');
  object(input.method,['kind']);if(input.method.kind!=='user-provided')fail('invalid_input');
  const text=derivativeText(input.text);
  if(input.language!==undefined) {
    if(typeof input.language!=='string'||input.language.length>35||!input.language||!/^[A-Za-z0-9-]+$/.test(input.language))fail('invalid_input');
    languageTag(input.language);
  }
  if(input.timecodes!==undefined) {
    if(!Array.isArray(input.timecodes)||input.timecodes.length>256)fail('invalid_input');
    let end=0;
    for(const interval of input.timecodes) {
      object(interval,['startMs','endMs']);
      if(!Number.isSafeInteger(interval.startMs)||!Number.isSafeInteger(interval.endMs)||interval.startMs<end||interval.endMs<interval.startMs)fail('invalid_input');
      end=interval.endMs;
    }
  }
  return text;
}
export function assetRef(value) {
  object(value,['type','namespace','assetId']);
  if (value.type!=='asset') fail('invalid_input');
  return {type:'asset',namespace:cardNamespace(value.namespace),assetId:identifier(value.assetId)};
}
export function assetVersionRef(value) {
  object(value,['type','namespace','assetId','versionId','contentIdentity']);
  if (value.type!=='asset-version') fail('invalid_input');
  return {type:'asset-version',namespace:cardNamespace(value.namespace),assetId:identifier(value.assetId),
    versionId:identifier(value.versionId),contentIdentity:identity(value.contentIdentity)};
}
export function assetLabel(value,max) {
  if (typeof value!=='string' || !value.isWellFormed() || !value.trim() || value.includes('\0') || value.length>max) fail('invalid_input');
  const clean=redactSecrets(value);
  if (clean.length>max) fail('invalid_input');
  return clean;
}
export function assetFilename(value) {
  assetLabel(value,512);
  if (/[\\/]/.test(value) || value==='.' || value==='..') fail('invalid_input');
  return value;
}
export function assetPageLimit(value=20) {
  if (!Number.isSafeInteger(value) || value<1 || value>20) fail('invalid_input'); return value;
}
export function validateAssetCall(method,input) {
  const fields={importAssetVersion:['namespace','actionId','title','filename','mediaType','bytes','asset','expectedAssetRevision'],
    listAssets:['namespace','limit','cursor'],listAssetVersions:['asset','limit','cursor'],getAssetVersion:['version'],
    readAssetBytes:['version','cursor'],verifyAssetBytes:['version','bytes'],deleteAsset:['actionId','ref','expectedRevision'],
    deleteAssetVersion:['actionId','ref','expectedRevision'],getAssetUsage:['namespace'],listAssetEffects:['namespace','limit','cursor'],
    createAssetDerivative:['actionId','version','expectedVersionRevision','kind','text','method','language','timecodes'],
    listAssetDerivatives:['version','limit','cursor'],readAssetDerivative:['ref','cursor'],deleteAssetDerivative:['actionId','ref','expectedRevision']};
  object(input,fields[method]);
  if (input.cursor!==undefined && (typeof input.cursor!=='string' || !input.cursor || input.cursor.length>8192)) fail('invalid_cursor');
  if (input.limit!==undefined) assetPageLimit(input.limit);
  if (!ASSET_READS.has(method)) identifier(input.actionId);
  if(method==='createAssetDerivative') {
    revision(input.expectedVersionRevision);derivativeInput(input);return assetVersionRef(input.version).namespace;
  }
  if(method==='listAssetDerivatives')return assetVersionRef(input.version).namespace;
  if(method==='readAssetDerivative'||method==='deleteAssetDerivative') {
    if(method==='deleteAssetDerivative')revision(input.expectedRevision);
    return assetDerivativeRef(input.ref).namespace;
  }
  if (method==='importAssetVersion') {
    const ns=cardNamespace(input.namespace);
    assetLabel(input.title,200); assetFilename(input.filename);
    if (!ASSET_MEDIA.includes(input.mediaType)) fail('unsupported_media');
    const bytes=binaryView(input.bytes);
    if (!bytes.byteLength || bytes.byteLength>ASSET_LIMITS.versionBytes) fail('invalid_input');
    if (input.asset!==undefined) {
      const ref=assetRef(input.asset); revision(input.expectedAssetRevision);
      if (JSON.stringify(ref.namespace)!==JSON.stringify(ns)) fail('asset_not_found');
    } else if (Object.hasOwn(input,'expectedAssetRevision')) fail('invalid_input');
    return ns;
  }
  if (method==='deleteAsset' || method==='deleteAssetVersion') {
    revision(input.expectedRevision);
    return (method==='deleteAsset'?assetRef(input.ref):assetVersionRef(input.ref)).namespace;
  }
  if (['getAssetVersion','readAssetBytes','verifyAssetBytes'].includes(method)) {
    if (method==='verifyAssetBytes' && !types.isUint8Array(input.bytes)) fail('invalid_input');
    return assetVersionRef(input.version).namespace;
  }
  if (method==='listAssetVersions') return assetRef(input.asset).namespace;
  return cardNamespace(input.namespace);
}
const ascii = (bytes,text,offset=0) => bytes.length>=offset+text.length && text.split('').every((char,i)=>bytes[offset+i]===char.charCodeAt(0));
const prefix = (bytes,hex) => Buffer.from(bytes.buffer,bytes.byteOffset,Math.min(bytes.byteLength,hex.length/2)).equals(Buffer.from(hex,'hex'));
const extensions = { 'image/png':['png'],'image/jpeg':['jpg','jpeg'],'image/gif':['gif'],'image/webp':['webp'],
  'audio/wav':['wav'],'application/pdf':['pdf'],'audio/mpeg':['mp3'],'video/mp4':['mp4'],'font/ttf':['ttf'],
  'font/otf':['otf'],'font/woff':['woff'],'font/woff2':['woff2'] };
export function validateAssetMedia(filename,mediaType,bytes) {
  const ext=filename.split('.').at(-1).toLowerCase();
  if (!extensions[mediaType]?.includes(ext)) fail('unsupported_media');
  let matched=false;
  switch(mediaType) {
    case 'image/png': matched=prefix(bytes,'89504e470d0a1a0a');break;
    case 'image/jpeg': matched=prefix(bytes,'ffd8ff');break;
    case 'image/gif': matched=ascii(bytes,'GIF87a') || ascii(bytes,'GIF89a');break;
    case 'image/webp': matched=ascii(bytes,'RIFF') && ascii(bytes,'WEBP',8);break;
    case 'audio/wav': matched=ascii(bytes,'RIFF') && ascii(bytes,'WAVE',8);break;
    case 'application/pdf': matched=ascii(bytes,'%PDF-2.0') || Array.from({length:8},(_,i)=>ascii(bytes,'%PDF-1.'+i)).some(Boolean);break;
    case 'audio/mpeg': matched=ascii(bytes,'ID3') && bytes[3]>=2 && bytes[3]<=4 || bytes.length>=4 && bytes[0]===255 &&
      (bytes[1]&224)===224 && ((bytes[1]>>3)&3)!==1 && ((bytes[1]>>1)&3)===1 && (bytes[2]>>4)>=1 && (bytes[2]>>4)<=14 && ((bytes[2]>>2)&3)!==3;break;
    case 'video/mp4': {
      if (bytes.length<16) break;
      const size=Buffer.from(bytes.buffer,bytes.byteOffset,4).readUInt32BE();
      if (size<16 || size>4096 || (size-16)%4!==0 || size>bytes.length || !ascii(bytes,'ftyp',4)) break;
      const major=String.fromCharCode(...bytes.subarray(8,12));
      const brands=[];
      for (let offset=16;offset<size;offset+=4) brands.push(String.fromCharCode(...bytes.subarray(offset,offset+4)));
      matched=['isom','iso2','iso3','iso4','iso5','iso6','mp41','mp42','avc1'].includes(major) &&
        [major,...brands].some(brand=>['mp41','mp42','avc1'].includes(brand));break;
    }
    case 'font/ttf': matched=prefix(bytes,'00010000');break;
    case 'font/otf': matched=ascii(bytes,'OTTO');break;
    case 'font/woff': matched=ascii(bytes,'wOFF');break;
    case 'font/woff2': matched=ascii(bytes,'wOF2');break;
  }
  if (!matched) fail('unsupported_media');
}

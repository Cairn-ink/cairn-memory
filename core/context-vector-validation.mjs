import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalJson, digest } from './context-product-validation.mjs';
import { PRODUCT_PROFILE } from './context-product-control.mjs';
import { exact, integer, hash, opaque, HOSTED_ID, MODEL } from './context-semantic-input.mjs';
import { encodeVector, loadVector } from './context-read-embedder.mjs';
import { fail } from './validation.mjs';

export const VECTOR_VERSION = 'context-vector-validation-p2e-v1';
export const VECTOR_POINTER = 'context-vector-publication-p2e-v1';
const domain=Buffer.from(PRODUCT_PROFILE+'/'+VECTOR_VERSION+'\0');
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const invalid=()=>{throw Object.assign(Error('index_unavailable'),{code:'index_unavailable',reason:'validation_invalid'});};
export function vectorIdentity(value) {
  const v=exact(value,'provider,model,id,revision,dimensions,normalization');
  if(v.provider!=='openai'||v.model!==MODEL||v.id!==HOSTED_ID||v.revision!=='provider-unversioned'||v.dimensions!==1536||v.normalization!=='l2')fail('invalid_input');
  return v;
}
const signature=(secret,value)=>createHmac('sha256',secret).update(domain).update(canonicalJson(value)).digest('base64url');
export function signVectorRecord(secret,body) {
  const text=canonicalJson({...body,mac:signature(secret,body)});
  if(Buffer.byteLength(text)>16384)fail('context_item_too_large');
  return text;
}
function generation(value) {
  const g=exact(value,'id,sequence,checkpoint,incarnation');opaque(g.id);opaque(g.incarnation);integer(g.sequence,1);integer(g.checkpoint);
}
function file(value,canonical) {
  const f=exact(value,canonical?'device,inode,applicationId,userVersion,schemaVersion':'device,inode,incarnation,schemaVersion');
  if(!['device','inode'].every(k=>typeof f[k]==='string'&&/^(0|[1-9][0-9]*)$/.test(f[k])))fail('invalid_input');
  integer(f.schemaVersion);
  if(canonical){integer(f.applicationId);integer(f.userVersion);}else opaque(f.incarnation);
}
export function verifyVectorRecord(secret,text,lexical,identity,epoch) {
  try {
    if(typeof text!=='string'||Buffer.byteLength(text)>16384)invalid();
    const value=JSON.parse(text),{mac,...body}=value;
    hash(mac);
    if(canonicalJson(value)!==text||!timingSafeEqual(Buffer.from(mac),Buffer.from(signature(secret,body))))invalid();
    exact(value,'version,profile,format,storeId,canonical,sidecar,projectionDigest,accessDigest,canonicalFenceDigest,dependencyFenceDigest,tokenizer,representation,lexical,identity,purgeEpoch,generation,publicationId,manifestDigest,counts,mac');
    if(value.version!==VECTOR_VERSION||value.profile!==PRODUCT_PROFILE||value.format!==1)invalid();
    opaque(value.storeId);opaque(value.publicationId);file(value.canonical,true);file(value.sidecar,false);generation(value.generation);
    for(const k of ['projectionDigest','accessDigest','canonicalFenceDigest','dependencyFenceDigest','manifestDigest'])hash(value[k]);
    opaque(value.tokenizer);opaque(value.representation);integer(value.purgeEpoch);vectorIdentity(value.identity);
    const link=exact(value.lexical,'publicationId,generation,manifestDigest,validationDigest');
    opaque(link.publicationId);generation(link.generation);hash(link.manifestDigest);hash(link.validationDigest);
    const counts=exact(value.counts,'byType,vectors,vectorBytes');integer(counts.vectors);integer(counts.vectorBytes);
    let vectors=0;
    if(!same(Object.keys(counts.byType).sort(),Object.keys(lexical.counts.byType).sort()))invalid();
    for(const [type,c] of Object.entries(counts.byType)) {
      exact(c,'eligible,embedded');integer(c.eligible);integer(c.embedded,0,c.eligible);
      if(c.eligible!==lexical.counts.byType[type].eligible)invalid();vectors+=c.embedded;
    }
    if(counts.vectors!==vectors||counts.vectorBytes!==vectors*identity.dimensions*4)invalid();
    if(!same(value.identity,identity)||value.purgeEpoch!==epoch)throw Object.assign(Error('identity_changed'),{reason:'identity_changed'});
    if(!same(link,{publicationId:lexical.publicationId,generation:lexical.generation,manifestDigest:lexical.manifestDigest,validationDigest:digest(lexical)}))invalid();
    for(const key of ['storeId','canonical','sidecar','projectionDigest','accessDigest','canonicalFenceDigest','dependencyFenceDigest','tokenizer','representation'])if(!same(value[key],lexical[key]))invalid();
    return value;
  } catch(error) {if(error.reason==='identity_changed')throw error;invalid();}
}
export function vectorPointer(record) {
  return {version:VECTOR_POINTER,profile:PRODUCT_PROFILE,projectionDigest:record.projectionDigest,accessDigest:record.accessDigest,
    identityDigest:digest(record.identity),purgeEpoch:record.purgeEpoch,lexicalPublicationId:record.lexical.publicationId,
    generation:record.generation,publicationId:record.publicationId,validationDigest:digest(record)};
}
export function verifyVectorPointer(text,record) {
  try {
    if(typeof text!=='string'||Buffer.byteLength(text)>4096||text!==canonicalJson(vectorPointer(record)))invalid();
    return JSON.parse(text);
  } catch {invalid();}
}
export function canonicalVectorBytes(vector,identity) {
  const bytes=encodeVector(vector,identity);
  for(let i=0;i<bytes.length;i+=4)if(Object.is(bytes.readFloatLE(i),-0))bytes.writeFloatLE(0,i);
  return bytes;
}
export function manifestVector(bytes,identity) {
  if(!(bytes instanceof Uint8Array))invalid();
  const vector=loadVector(bytes,identity),canonical=canonicalVectorBytes(vector,identity);
  if(!Buffer.from(bytes).equals(canonical))invalid();
  return {encoding:'f32le',dimensions:identity.dimensions,bytes:canonical.toString('base64url')};
}
export const rawSha256=bytes=>createHash('sha256').update(bytes).digest('base64url');

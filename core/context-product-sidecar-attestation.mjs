import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { signedRecord } from './context-product-validation.mjs';
import { PRODUCT_PROFILE } from './context-product-control.mjs';
import { sqliteFileStat } from './sqlite-journal-probe.mjs';

// This key never leaves the parent. Stored certificates and the replacement
// child receive neither this key nor the store's cursor secret.
const key = secret => createHmac('sha256',secret).update('sidecar-attestation-v1').digest();
export function sidecarAttestationFile(path) {
  const s=sqliteFileStat(path);
  return {device:String(s.dev),inode:String(s.ino),birth:String(s.birthtimeNs)};
}
export function readSidecarAttestation(db, schema) {
  const exists=schema ? schema.some(row=>row.type==='table'&&row.name==='product_attestation') :
    db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='product_attestation'").get();
  if(!exists)return null;
  // TEXT conversion never asks node:sqlite to decode an unsafe INTEGER.
  // Preserve the storage class: TEXT/REAL values cannot masquerade as integers.
  const row=db.prepare('SELECT CAST(stamp AS TEXT) AS stamp,typeof(stamp) AS stampType,record FROM product_attestation WHERE singleton=1').get();
  if(!row)return null;
  if(row.stampType==='integer'&&/^[1-9][0-9]*$/.test(row.stamp)&&Number.isSafeInteger(Number(row.stamp)))row.stamp=Number(row.stamp);
  return row;
}
// Exact stored text, including its original whitespace, participates in the
// exclusion recheck. No parsing/reserialization of the certificate is allowed.
export const sidecarAttestationDigest = row => row===null?'missing':
  createHash('sha256').update(JSON.stringify([row.stamp,row.record,row.stampType])).digest('hex');
export function validSidecarAttestation(secret,row,file,format) {
  if(!row||row.stampType!=='integer'||!Number.isSafeInteger(row.stamp)||row.stamp<1||typeof row.record!=='string'||Buffer.byteLength(row.record)>4096)return false;
  const expected=signedRecord(key(secret),'sidecar-attestation',{version:1,profile:PRODUCT_PROFILE,format,file,stamp:row.stamp});
  const actual=Buffer.from(row.record),wanted=Buffer.from(expected);
  return actual.length===wanted.length&&timingSafeEqual(actual,wanted);
}
export function writeSidecarAttestation(db,secret,file,format) {
  const row=db.prepare('SELECT stamp FROM product_attestation WHERE singleton=1').get(),stamp=(row?.stamp??0)+1;
  if(!Number.isSafeInteger(stamp)||stamp<1)throw Error('sidecar_attestation_exhausted');
  const record=signedRecord(key(secret),'sidecar-attestation',{version:1,profile:PRODUCT_PROFILE,format,file,stamp});
  db.prepare('INSERT INTO product_attestation(singleton,stamp,record) VALUES(1,?,?) ON CONFLICT(singleton) DO UPDATE SET stamp=excluded.stamp,record=excluded.record').run(stamp,record);
}

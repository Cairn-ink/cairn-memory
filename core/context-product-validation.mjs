import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { boundedData, PRODUCT_PROFILE } from './context-product-control.mjs';
import { namespaceKey } from './context-read-input.mjs';
import { fail } from './validation.mjs';

export const canonicalJson = value => JSON.stringify(boundedData(value, 262144));
export const digest = value => createHash('sha256').update(canonicalJson(value)).digest('base64url');
export const accessDigest = binding => digest({ profile: PRODUCT_PROFILE, ownerId: binding.ownerId,
  readSet: [...binding.namespaces.readSet].sort((a,b)=>Buffer.compare(Buffer.from(namespaceKey(a)),Buffer.from(namespaceKey(b)))), ownerGeneration: binding.ownerGeneration ?? null });
export const projectionDigest = input => digest({ profile: PRODUCT_PROFILE, readSet: input.readSet,
  types: ['memory', 'card'].filter(type => input.types.includes(type)), intent: input.intent });
const sign = (secret, purpose, value) => createHmac('sha256', secret)
  .update(PRODUCT_PROFILE + '/' + purpose + '\n' + canonicalJson(value)).digest('base64url');
export function signedRecord(secret, purpose, value) {
  return canonicalJson({ ...value, mac: sign(secret, purpose, value) });
}
const keys = (value, names) => value && Object.keys(value).sort().join(',') === names.split(',').sort().join(',');
const integer = (v, min = 0) => Number.isSafeInteger(v) && v >= min;
const opaque = v => typeof v === 'string' && v.length > 0 && v.length <= 200;
const hash = v => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);
const file = v => v && /^(0|[1-9][0-9]*)$/.test(v.device) && /^(0|[1-9][0-9]*)$/.test(v.inode) && integer(v.schemaVersion);
export const validProgress = p => keys(p, 'phase,checkpoint,sequence,baseSequence') &&
  ['phase','checkpoint','baseSequence'].every(k => integer(p[k])) && integer(p.sequence, 1) && p.baseSequence <= p.sequence;
export function verifiedRecord(secret, purpose, text) {
  const maximum = purpose === 'validation' ? 16384 : 4096;
  try {
    if (typeof text !== 'string' || Buffer.byteLength(text) > maximum) fail('invalid_input');
    const value = JSON.parse(text), { mac, ...body } = value;
    if (!hash(mac) || canonicalJson(value) !== text || !timingSafeEqual(Buffer.from(mac), Buffer.from(sign(secret, purpose, body)))) fail('invalid_input');
    if (value.profile !== PRODUCT_PROFILE || !opaque(value.storeId)) fail('invalid_input');
    for (const k of ['projectionDigest','accessDigest','canonicalFenceDigest','dependencyFenceDigest']) if (!hash(value[k])) fail('invalid_input');
    if (purpose === 'progress') {
      if (!keys(value, 'version,profile,storeId,canonicalIdentityDigest,sidecarIdentityDigest,projectionDigest,accessDigest,canonicalFenceDigest,dependencyFenceDigest,generation,kind,progress,mac') ||
          value.version !== 'context-index-progress-v1' || !hash(value.canonicalIdentityDigest) || !hash(value.sidecarIdentityDigest) ||
          !keys(value.generation, 'id,incarnation') || !Object.values(value.generation).every(opaque) ||
          !['initial','rebuild','delta'].includes(value.kind) || !validProgress(value.progress) ||
          (value.kind === 'delta') !== (value.progress.baseSequence > 0)) fail('invalid_input');
    } else {
      if (!keys(value, 'version,profile,format,storeId,canonical,sidecar,projectionDigest,accessDigest,canonicalFenceDigest,dependencyFenceDigest,tokenizer,representation,generation,publicationId,manifestDigest,counts,mac') ||
          value.version !== 'context-index-validation-v1' || value.format !== 1 || !opaque(value.publicationId) || !hash(value.manifestDigest) ||
          !keys(value.canonical,'device,inode,applicationId,userVersion,schemaVersion') || !file(value.canonical) ||
          !integer(value.canonical.applicationId) || !integer(value.canonical.userVersion) ||
          !keys(value.sidecar,'device,inode,incarnation,schemaVersion') || !file(value.sidecar) || !opaque(value.sidecar.incarnation) ||
          !keys(value.generation,'id,sequence,checkpoint,incarnation') || !opaque(value.generation.id) || !opaque(value.generation.incarnation) ||
          !integer(value.generation.sequence,1) || !integer(value.generation.checkpoint) || !opaque(value.tokenizer) || !opaque(value.representation) ||
          !keys(value.counts,'byType,documents,terms,totalTokenLength') ||
          !['documents','terms','totalTokenLength'].every(k => integer(value.counts[k])) ||
          !Object.keys(value.counts.byType).length || Object.keys(value.counts.byType).some(k => !['memory','card'].includes(k)) ||
          Object.values(value.counts.byType).some(c => !keys(c,'eligible,indexed') || !integer(c.eligible) || c.eligible !== c.indexed)) fail('invalid_input');
    }
    return value;
  } catch { throw Object.assign(Error('index_unavailable'), { code: 'index_unavailable', reason: 'validation_invalid' }); }
}

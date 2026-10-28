import { createHash } from 'node:crypto';
import { isAbsolute, normalize } from 'node:path';
import { boundedData, PRODUCT_PROFILE, deadline } from './context-product-control.mjs';
import { ownData } from './local-authority-input.mjs';
import { contextReadSet } from './context-read-input.mjs';
import { identifier, fail } from './validation.mjs';

export const SEMANTIC_VERSION = 'context-read-product-p2e-v1';
export const LEDGER_VERSION = 'context-semantic-ledger-p2e-v1';
export const MODEL = 'text-embedding-3-small';
export const ENDPOINT = 'https://api.openai.com/v1/embeddings';
export const HOSTED_ID = `openai:${MODEL}:${createHash('sha256').update(ENDPOINT).digest('hex').slice(0,16)}`;
export const exact = (value, names) => {
  const keys = names.split(','), result = ownData(value, keys);
  if (Object.keys(result).length !== keys.length) fail('invalid_input');
  return result;
};
export const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('invalid_input');
  return value;
};
export const opaque = value => {
  if (typeof value !== 'string' || !value.length || value.length > 200 || !value.isWellFormed() || value.includes('\0')) fail('invalid_input');
  return value;
};
export const ascii = value => {
  if (typeof value !== 'string' || !/^[\x01-\x7f]{1,64}$/.test(value)) fail('invalid_input');
  return value;
};
export const hash = value => {
  if (typeof value !== 'string' || (!/^[A-Za-z0-9_-]{43}$/.test(value)||Buffer.from(value,'base64url').toString('base64url')!==value)) fail('invalid_input');
  return value;
};
export const safePath = value => {
  if (typeof value !== 'string' || !isAbsolute(value) || normalize(value) !== value || !value.isWellFormed() || value.includes('\0')) fail('invalid_path');
  return value;
};
export function usd(value) {
  if (typeof value !== 'string' || value.length > 20 || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,12})?$/.test(value)) fail('invalid_input');
  const [whole, fraction = ''] = value.split('.');
  const units = BigInt(whole) * 1000000000000n + BigInt(fraction.padEnd(12, '0'));
  if (units > 1000000000000000000n) fail('invalid_input');
  return units;
}
export const dollars = units => {
  const whole = units / 1000000000000n, fraction = String(units % 1000000000000n).padStart(12,'0').replace(/0+$/, '');
  return String(whole) + (fraction ? '.' + fraction : '');
};
export const tokenCost = (tokens, rate) => (BigInt(integer(tokens)) * usd(rate) + 999999n) / 1000000n;
export function numericUsd(value) {
  if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>1000000)fail('invalid_input');
  const text=value.toFixed(12).replace(/\.?0+$/,'');
  if(!text||Number(text)!==value)fail('invalid_input');return dollars(usd(text));
}
export function queryEmbeddingCutoff({now,cutoff,maxMs,timeoutMs,finalizeReserveMs}) {
  return [now+BigInt(maxMs)*1000000n,now+BigInt(timeoutMs)*1000000n,cutoff-BigInt(finalizeReserveMs)*1000000n].reduce((a,b)=>a<b?a:b);
}
export function hostedSelection(value) {
  const p = exact(boundedData(value), 'provider,model,dimensions,normalization,requestTimeoutMs,maxBatchDocuments');
  if (p.provider !== 'openai' || p.model !== MODEL || p.dimensions !== 1536 || p.normalization !== 'l2') fail('invalid_input');
  deadline(p.requestTimeoutMs); integer(p.maxBatchDocuments,1,64);
  return Object.freeze(p);
}
export function caps(value) {
  const c = exact(boundedData(value),'steady,backfill');
  const s = exact(c.steady,'maxItemsPerUtcDay,maxUsdPerUtcDay');
  const b = exact(c.backfill,'maxItemsPerUtcDay,maxUsdPerUtcDay,maxUsdTotal');
  integer(s.maxItemsPerUtcDay,1,2000); integer(b.maxItemsPerUtcDay,s.maxItemsPerUtcDay,20000);
  const steady = usd(s.maxUsdPerUtcDay), backfill = usd(b.maxUsdPerUtcDay), total = usd(b.maxUsdTotal);
  if (steady <= 0n || steady > usd('0.05') || backfill < steady || backfill > usd('0.50') || total < backfill || total > usd('5')) fail('invalid_input');
  return {steady:{...s,maxUsdPerUtcDay:dollars(steady)},backfill:{...b,maxUsdPerUtcDay:dollars(backfill),maxUsdTotal:dollars(total)}};
}
export function priceTable(value) {
  const p = exact(boundedData(value),'authorityId,revision,sequence,effectiveFromUtcMs,effectiveUntilUtcMs,usdPerMillionInputTokens');
  opaque(p.authorityId); opaque(p.revision); integer(p.sequence,1); integer(p.effectiveFromUtcMs); integer(p.effectiveUntilUtcMs);
  if (p.effectiveUntilUtcMs <= p.effectiveFromUtcMs || p.effectiveUntilUtcMs - p.effectiveFromUtcMs > 86400000) fail('invalid_input');
  const rate = exact(p.usdPerMillionInputTokens,MODEL), units = usd(rate[MODEL]);
  if (units <= 0n) fail('invalid_input');
  return {...p,usdPerMillionInputTokens:{[MODEL]:dollars(units)}};
}
export function ledgerIdentity(value) {
  const v = exact(boundedData(value),'accountingDomainId,ledgerId');
  ascii(v.accountingDomainId); ascii(v.ledgerId); return v;
}
export function backfillTargets(value) {
  const targets = boundedData(value);
  if (!Array.isArray(targets) || targets.length < 1 || targets.length > 32) fail('invalid_input');
  const seen = new Set();
  return targets.map(target => {
    const t = exact(target,'canonicalPath,readSet,types,intents');
    safePath(t.canonicalPath); const readSet = contextReadSet(t.readSet,PRODUCT_PROFILE);
    if (!Array.isArray(t.types) || !t.types.length || t.types.length > 2 || new Set(t.types).size !== t.types.length || t.types.some(type => !['memory','card'].includes(type)) ||
        JSON.stringify(t.intents) !== '["current","history"]') fail('invalid_input');
    const result = {...t,readSet,types:['memory','card'].filter(type => t.types.includes(type))}, key = JSON.stringify(result);
    if (seen.has(key)) fail('invalid_input'); seen.add(key); return result;
  });
}
export const SEMANTIC_METHODS = ['setOwnerSemantic','getOwnerSemanticStatus','validateOwnerSemanticCoverage','purgeOwnerVectors'];
export function semanticOperationInput(method,value) {
  const input=boundedData(value),optionalDeadline=Object.hasOwn(input,'deadlineMs');
  if(method==='setOwnerSemantic') {
    exact(input,'ownerId,semantic,expectedRevision'+(optionalDeadline?',deadlineMs':''));
    if(typeof input.semantic!=='boolean')fail('invalid_input');integer(input.expectedRevision);
  }else if(method==='getOwnerSemanticStatus')exact(input,'ownerId'+(optionalDeadline?',deadlineMs':''));
  else if(method==='validateOwnerSemanticCoverage') {
    exact(input,'ownerId,expectedTargetDigest,budget');hash(input.expectedTargetDigest);const b=exact(input.budget,'maxTargets,maxMs');integer(b.maxTargets,1,64);deadline(b.maxMs);
  }else if(method==='purgeOwnerVectors') {
    exact(input,'ownerId,budget');const b=exact(input.budget,'maxItems,maxMs');integer(b.maxItems,1,1024);deadline(b.maxMs);
  }else fail('invalid_input');
  try{identifier(input.ownerId);}catch{fail('invalid_input');}
  if(optionalDeadline)deadline(input.deadlineMs);return input;
}
export function semanticBinding(value, identity) {
  if (!value) fail('authority_required');
  const b = exact(boundedData(value),'kind,serviceId,credentialBindingId,credentialExpiresUtcMs,credentialDigest,ownerId,scope,issuedAt,methods,accountingDomainId,ledgerId,ledgerEpoch,bindingRevision');
  if (b.kind !== 'semantic-service' || b.scope !== 'owner') fail('authority_required');
  ascii(b.serviceId); ascii(b.credentialBindingId); hash(b.credentialDigest); identifier(b.ownerId); integer(b.issuedAt);
  if (b.credentialExpiresUtcMs !== null) integer(b.credentialExpiresUtcMs);
  integer(b.ledgerEpoch,1); integer(b.bindingRevision,1);
  if (b.accountingDomainId !== identity.accountingDomainId || b.ledgerId !== identity.ledgerId) fail('authority_required');
  if (!Array.isArray(b.methods) || !b.methods.length || JSON.stringify(SEMANTIC_METHODS.filter(m => b.methods.includes(m))) !== JSON.stringify(b.methods)) fail('invalid_input');
  return b;
}

// Expanded engine-owned targets can exceed the IPC node limit while every
// supplied descriptor fits it. Hash their canonical array incrementally;
// retain the unchanged bounded decoder for each individual descriptor.
export function targetSetDigest(targets) {
  if(!Array.isArray(targets)||targets.length<2||targets.length>64)fail('invalid_input');
  const hash=createHash('sha256').update('[');
  targets.forEach((target,i)=>hash.update((i?',':'')+JSON.stringify(boundedData(target))));
  return hash.update(']').digest('base64url');
}

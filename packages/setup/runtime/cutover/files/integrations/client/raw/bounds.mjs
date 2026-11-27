import { performance } from 'node:perf_hooks';
import { AsyncLocalStorage } from 'node:async_hooks';

const operations = new AsyncLocalStorage();

export const PROFILE = 'raw-producer-v1';
export function refuse(code = 'raw_source_invalid') { const error = new Error(code); error.code = code; throw error; }
export function sourceFailure(error) {
  if (error?.message===error?.code && ['raw_source_invalid','raw_source_changed','raw_source_unavailable','raw_source_cancelled',
    'raw_source_resource_limit','raw_source_incomplete','unsupported_format','creator_unqualified'].includes(error.code)) throw error;
  refuse('raw_source_unavailable');
}
export const closed = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).every(key => keys.includes(key));
export const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
export const identifier = (value, max = 200) => typeof value === 'string' && value.length > 0 && value.length <= max &&
  value.isWellFormed() && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value);
export const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export function settings(input = {}) {
  const defaults = { bufferBytes:16384,maxDepth:64,metadataByteLimit:65536,scratchByteLimit:536870912,deadlineMs:30000 };
  const maxima = { bufferBytes:65536,maxDepth:64,metadataByteLimit:65536,scratchByteLimit:1073741824,deadlineMs:300000 };
  if (!closed(input,Object.keys(defaults))) refuse();
  const result = { ...defaults,...input };
  for (const key of Object.keys(result)) if (!integer(result[key],1,maxima[key])) refuse();
  return Object.freeze(result);
}
export function budget(limits, signal) {
  const end = performance.now()+limits.deadlineMs; let metadata = 0;
  const state = { limits,operation(work) {
    if (operations.getStore()?.owner===state) return work();
    return operations.run({ owner:state,end:performance.now()+limits.deadlineMs },async () => {
      state.check(); const result = await work(); state.check(); return result;
    });
  },metadata(bytes) {
    metadata += bytes;
    if (metadata>limits.metadataByteLimit) refuse('raw_source_resource_limit');
  },check() {
    if (signal?.aborted) refuse('raw_source_cancelled');
    const operation = operations.getStore();
    if (performance.now() >= (operation?.owner===state ? operation.end:end)) refuse('raw_source_resource_limit');
  } };
  return state;
}
export function sourceReader(source, state) {
  if (!source || typeof source.read !== 'function') refuse();
  const read = source.read.bind(source);
  return async (position, length) => {
    state.check();
    if (!integer(position) || !integer(length,1,state.limits.bufferBytes)) refuse();
    const buffer = Buffer.alloc(length);
    let result;
    try { result = await read(buffer,0,length,position); }
    catch { refuse('raw_source_unavailable'); }
    state.check();
    if (!result || !integer(result.bytesRead,0,length)) refuse();
    if (!result.bytesRead) refuse('raw_source_changed');
    return Buffer.from(buffer.subarray(0,result.bytesRead));
  };
}

export async function* scanRawRecordRanges(input, options = {}) {
  if (!closed(input,['source','start','end']) || !integer(input.start) || !integer(input.end,input.start) ||
      !closed(options,['limits','signal'])) refuse();
  const { start,end } = input, state = budget(settings(options.limits),options.signal), read = sourceReader(input.source,state);
  let position = start, from = start, bytes = Buffer.alloc(0), index = 0, bufferStart = start;
  while (true) {
    const range = await state.operation(async () => {
      while (true) {
        while (index<bytes.length) if (bytes[index++]===10) {
          const next = bufferStart+index, result = Object.freeze({ start:from,end:next }); from = next; return result;
        }
        if (position===end) { if (from!==end) refuse('raw_source_incomplete'); return null; }
        bufferStart = position; bytes = await read(position,Math.min(state.limits.bufferBytes,end-position)); position += bytes.length; index = 0;
      }
    });
    if (!range) return; yield range;
  }
}

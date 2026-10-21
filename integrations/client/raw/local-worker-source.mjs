import { openSource } from '../../codex/source.mjs';
import { checkCodexHeader } from './codex.mjs';
import { budget, settings, sourceReader } from './bounds.mjs';
import { keyed } from './local-worker-state.mjs';
import { fault } from './local-worker-input.mjs';

export const RECORD_LIMIT = 33554432, READ_LIMIT = 134217728;
export function sourceBudget(operation) {
  let consumed = 0, exhausted = false;
  return { get consumed() { return consumed; }, get remaining() { return READ_LIMIT-consumed; }, get exhausted() { return exhausted; },
    reader(file) {
      return { async read(buffer,offset,length,position) {
        operation.check();
        if (length > READ_LIMIT-consumed) { exhausted = true; fault('work_limit'); }
        const result = await file.read(buffer,offset,length,position); consumed += result.bytesRead; operation.check(); return result;
      } };
    },
  };
}
export async function openWorkerSource(context, operation, bytes) {
  let file;
  try {
    operation.check(); file = await openSource(context.sourcePath); operation.check();
    return { file, source: bytes.reader(file), close: () => file.close() };
  } catch (error) {
    await file?.close();
    if (error.reason) throw error;
    fault(process.platform !== 'linux' ? 'platform_unavailable' : 'source_unavailable');
  }
}
export function producerOptions(identity, operation) {
  return { identityKey:identity.key, signal:operation.signal,
    limits:{ deadlineMs:Math.max(1,operation.remaining()-2000) } };
}
export function producerInput(options, identity, context, source, range, ordinal, selection) {
  return { source,range,client:options.authority.client,sessionId:context.sessionId,wireSessionId:identity.wireSessionId,
    generation:options.authority.expectedNamespaceGeneration,epoch:0,messageOrdinal:ordinal,
    selectionState:options.authority.client === 'claude-code' ? { ownSkillTurn:selection.ownSkillTurn,pluginRoot:context.pluginRoot } : {},
    formatAuthority:context.formatAuthority };
}
export async function qualifySource(options, context, opened, operation) {
  if (options.authority.client !== 'codex') return;
  const state = budget(settings({ deadlineMs:Math.max(1,operation.remaining()-2000) }),operation.signal);
  await checkCodexHeader(sourceReader(opened.source,state),{ sessionId:context.sessionId,formatAuthority:context.formatAuthority },state);
  operation.check();
}
async function sourceStat(opened) {
  const stat = await opened.file.stat({ bigint:true });
  if (!stat.isFile() || stat.size < 0n || stat.size > BigInt(Number.MAX_SAFE_INTEGER)) fault('source_unavailable');
  return stat;
}
export async function sourceSize(opened) { return Number((await sourceStat(opened)).size); }
export async function fingerprint(identity, opened) {
  const stat = await sourceStat(opened);
  return keyed(identity.key,'source-file',[identity.sessionKey,String(stat.dev),String(stat.ino)]).digest('hex');
}
export async function anchor(identity, opened, end) {
  const start = Math.max(0,end-4096), hash = keyed(identity.key,'source-anchor',[identity.sessionKey,start,end]);
  let at = start;
  while (at < end) {
    const buffer = Buffer.alloc(end-at), result = await opened.source.read(buffer,0,buffer.length,at);
    if (!result.bytesRead) fault('source_changed');
    hash.update(buffer.subarray(0,result.bytesRead)); at += result.bytesRead;
  }
  return { start,end,commitment:hash.digest('hex') };
}
export async function cursorSource(identity, opened, offset) {
  return { identity:await fingerprint(identity,opened),anchor:await anchor(identity,opened,offset) };
}
export async function verifyCursorSource(identity, opened, cursor) {
  const size = await sourceSize(opened);
  if (size < cursor.offset || cursor.pending && size < cursor.pending.projection.range.end ||
      await fingerprint(identity,opened) !== cursor.source.identity ||
      JSON.stringify(await anchor(identity,opened,cursor.offset)) !== JSON.stringify(cursor.source.anchor)) fault('source_changed');
}
export async function completeBoundary(opened, offset) {
  if (offset === 0) return true;
  const buffer = Buffer.alloc(1), result = await opened.source.read(buffer,0,1,offset-1);
  return result.bytesRead === 1 && buffer[0] === 10;
}
export function sourceReason(error, bytes) {
  if (error.reason) return error.reason;
  if (bytes.exhausted) return 'work_limit';
  if (error.code === 'raw_source_changed') return 'source_changed';
  if (error.code === 'raw_source_cancelled') return 'cancelled';
  if (error.code === 'raw_source_resource_limit') return 'work_limit';
  if (error.code === 'raw_source_incomplete') return 'partial_record';
  return 'source_unavailable';
}

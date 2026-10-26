import { performance } from 'node:perf_hooks';
import { createCardRawSources } from './card-raw-sources.mjs';
import { rawSourceKey, sourceAnchors, sourceBudgets } from './raw-source-input.mjs';
import { rawContext, rawSealed, rawText } from './raw-input.mjs';
import { fail, object } from './validation.mjs';

const size = value => Buffer.byteLength(JSON.stringify({ ok: true, value }));
const partKey = row => JSON.stringify([row.conversation_id,row.message_id,row.part_index]);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

/** Uninstalled async opening seam; all canonical Card writes remain synchronous. */
export function createRawSourceReader({ db, identity, open, partDigest }) {
  const sources = createCardRawSources(db, { storeId: identity.store_id, cursorSecret: identity.cursor_secret });
  function read(work) {
    if (db.isTransaction) fail('raw_transaction_active');
    db.exec('BEGIN');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function cursor(value, source, limit, budgets, accessGeneration) {
    if (value === undefined) return source.span.start;
    try {
      const [body,signature,extra] = value.split('.');
      if (extra !== undefined || signature !== sources.bind('raw-source-cursor-v1', body)) fail('invalid_cursor');
      const decoded = JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
      if (JSON.stringify(decoded.source) !== JSON.stringify(source) || decoded.limit !== limit ||
          JSON.stringify(decoded.budgets) !== JSON.stringify(budgets) ||
          !Number.isSafeInteger(decoded.after) || decoded.after <= source.span.start || decoded.after >= source.span.end) fail('invalid_cursor');
      if (decoded.accessGeneration !== accessGeneration) fail('cursor_stale');
      return decoded.after;
    } catch (error) { if (error.code === 'cursor_stale') throw error; fail('invalid_cursor'); }
  }
  const encode = (source,limit,after,budgets,accessGeneration) => {
    const body = Buffer.from(JSON.stringify({ source,limit,after,budgets,accessGeneration })).toString('base64url');
    return body+'.'+sources.bind('raw-source-cursor-v1',body);
  };
  async function prepare(method, ns, input, accessGeneration) {
    const limits = sourceBudgets(input.budgets), started = performance.now();
    const deadline = () => { if (performance.now()-started >= limits.deadlineMs) fail('source_timeout'); };
    const resolving = method === 'resolveSourceReferences';
    const anchors = resolving ? sourceAnchors(input.anchors) : [input.source];
    if (new Set(anchors.map(rawSourceKey)).size !== anchors.length) fail('invalid_input');
    const start = resolving ? null : cursor(input.cursor,input.source,input.limit ?? 20,limits,accessGeneration);
    const state = sources.budget(limits.sourceByteLimit, limits.scanRowLimit);
    const views = read(() => anchors.map(anchor => resolving ? sources.inspect(ns,anchor,state) : sources.resolve(ns,anchor,state)));
    deadline();
    const opened = new Map(); let charged = 0;
    let pending = [];
    for (const view of views) for (const part of view.parts) {
      if (!resolving && part.end <= start) continue;
      if (pending.some(previous => partKey(previous) === partKey(part))) continue;
      if (!resolving && (pending.length >= (input.limit ?? 20) || charged+part.byte_count > limits.sourceByteLimit)) break;
      charged += part.byte_count; pending.push(part);
    }
    if (!pending.length) fail('source_budget_exceeded');
    if (!open) fail('raw_crypto_unavailable');
    for (const part of pending) {
      deadline();
      const index = anchors.findIndex(anchor => anchor.conversationId === part.conversation_id && anchor.messageId === part.message_id);
      const message = views[index].message, value = { id: part.message_id, role: message.role, occurredAt: message.occurred_at,
        messageOrdinal: message.ordinal, part: { index: part.part_index,start: part.start,totalUnits: message.total_units,totalBytes: message.total_bytes } };
      const context = freeze(rawContext({ ...ns, projectId: ns.projectId ?? '' }, message.client,message.session_key,
        part.conversation_id,value,part.end));
      let text;
      try {
        const result = await open({ ownerId: ns.ownerId, context, ...rawSealed({ format: part.format,keyVersion: part.key_version,
          sealed: Buffer.from(state.payloads.get(partKey(part))) }) });
        object(result,['text']); text = rawText(result.text);
        if (text.length !== part.end-part.start || Buffer.byteLength(text) !== part.byte_count ||
            partDigest({ ...value,content: text }) !== part.digest) fail('raw_crypto_unavailable');
      } catch { fail('raw_crypto_unavailable'); }
      deadline(); opened.set(partKey(part),text);
    }
    let output;
    if (resolving) {
      for (let index=0; index<anchors.length; index++) {
        const anchor = anchors[index];
        for (const part of views[index].parts) {
          const text = opened.get(partKey(part));
          for (const offset of [anchor.span.start,anchor.span.end]) if (offset > part.start && offset < part.end &&
              /[\uDC00-\uDFFF]/.test(text[offset-part.start])) fail('source_unavailable');
        }
      }
      output = { sources: anchors.map((anchor,index) => sources.refFor(ns,anchor,views[index])),
        coverage: { status: 'complete', included: anchors.length, omitted: 0, conversationCoverage: 'unknown' } };
    } else {
      const parts = pending.map(part => {
        const begin = Math.max(start,part.start), end = Math.min(input.source.span.end,part.end);
        const text = opened.get(partKey(part)).slice(begin-part.start,end-part.start);
        if (!text.isWellFormed()) fail('source_unavailable');
        return { start: begin,end,text };
      });
      do {
        const after = parts.at(-1)?.end ?? start, complete = after === input.source.span.end;
        output = { source: input.source, parts: [...parts], coverage: { status: complete ? 'complete' : 'budget_exhausted',
          completeness: 'selected-raw-span',conversationCoverage: 'unknown',included: parts.length,omitted: complete ? 0 : null },
          nextCursor: complete ? null : encode(input.source,input.limit ?? 20,after,limits,accessGeneration) };
        if (size(output) <= limits.responseByteLimit) break;
        parts.pop(); if (!parts.length) fail('context_item_too_large');
      } while (parts.length);
    }
    if (size(output) > limits.responseByteLimit) fail('context_item_too_large');
    return { finish() {
      deadline();
      read(() => {
        const current = sources.budget(limits.sourceByteLimit,limits.scanRowLimit);
        anchors.forEach((anchor,index) => {
          const next = resolving ? sources.inspect(ns,anchor,current) : sources.resolve(ns,anchor,current);
          if (JSON.stringify(next.manifest) !== JSON.stringify(views[index].manifest)) fail('revision_conflict');
        });
      });
      deadline(); return output;
    } };
  }
  return { prepare };
}

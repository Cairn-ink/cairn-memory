import { isDeepStrictEqual } from 'node:util';
import { fixture, ns, ok, request, splitRaw, localPlainPort } from './raw-capture-fixtures.mjs';

export { ns, ok, request, splitRaw, localPlainPort };
export const denied = (result, code) => {
  if (result.ok || result.error.code !== code) throw Error('Expected '+code+': '+JSON.stringify(result));
};
export function cardHost() {
  const tokens = new WeakMap(), grants = new WeakMap(); let generation = 1;
  return { options: { version: 'private-cards-local-v1', source: 'submitted-note-v1', storage: 'local-plain-v1',
    disclosure: 'explicit-submitted-note-v1', authority: {
      authorize(request, token) {
        const expected = tokens.get(token);
        if (!expected || expected.method !== request.method || !isDeepStrictEqual(expected.input,request.input)) return null;
        const grant = {}, { input, ...binding } = request; grants.set(grant,binding); return grant;
      },
      isCurrent: grant => grants.has(grant) ? { ...grants.get(grant),accessGeneration: generation } : null,
    } },
    revoke() { generation++; },
    call(core,method,input) { const token = {}; tokens.set(token,{ method,input: structuredClone(input) }); return core[method](input,token); },
  };
}
export function sourceFixture(t, options = {}) {
  const host = cardHost(), port = options.port ?? localPlainPort();
  const f = fixture(t, { ...options, sources: true, port, model: { extract: () => ({ items: [] }), ...options.model },
    coreOptions: { privateCards: host.options, ...options.coreOptions } });
  return { ...f, host, port, call: (method,input) => host.call(f.core,method,input), get core() { return f.core; } };
}
export async function savedSource(f, text = 'Synthetic retained source.', patch = {}) {
  const { eventId = 'raw-'+(patch.sessionId ?? 'default'), ...rest } = patch;
  const parts = splitRaw(text), client = patch.client ?? 'codex'; let saved;
  for (let index=0; index<parts.length; index++) saved = ok(await f.core.captureRaw(request(parts[index],
    { client, ...rest,eventId: eventId+'-'+index })));
  const conversationId = saved.raw.conversationId;
  const expectedConversationRevision = f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(conversationId).revision;
  return { conversationId, messageId: parts[0].id, expectedConversationRevision, text };
}
export const anchor = (source,start = 0,end = source.text.length,precision = 'exact') => ({
  rawAnchor: { conversationId: source.conversationId,messageId: source.messageId,start,end,precision },
  expectedConversationRevision: source.expectedConversationRevision,
});
export async function resolve(f, entries, budgets) {
  return ok(await f.call('resolveSourceReferences',{ namespace: ns,anchors: entries, ...(budgets ? { budgets } : {}) })).sources;
}
export function draft(f, sources, actionId = 'draft') {
  return f.call('createCardDraft',{ namespace: ns,actionId,drafting: 'authored',input: {
    sources,title: 'Synthetic authored title',body: 'Synthetic independently authored body.' } });
}

import { createContextReadHost as baseHost } from './context-product-index-host.mjs';

// Synthetic port for exercising the Worker-local host handoff. Real Raw
// delivery, canonical privacy fences and crypto are covered by reader tests.
export async function createContextReadHost(configuration) {
  const host = await baseHost(configuration);
  const namespace = configuration.requestBinding.namespaces.readSet[0];
  const value = Object.freeze({ namespace, conversationId: 'synthetic-conversation', messageId: 'synthetic-message',
    role: 'assistant', occurredAt: '2026-01-03T08:00:00.000Z',
    ranges: [{ source: { span: { start: 0, end: configuration.rawText.length } }, text: configuration.rawText }] });
  const candidate = { namespace, conversationId: value.conversationId, messageId: value.messageId };
  const handles = new Set();
  return { ...host, rawSearch: {
    async search() { return { candidates: [candidate], coverage: { status: 'complete' } }; },
    async prepare() { const handle = Object.freeze({ value }); handles.add(handle); return handle; },
    async prepareMany(candidates, { onPrepared }) {
      const prepared = candidates.map((_, index) => {
        const handle = Object.freeze({ value }); handles.add(handle); onPrepared(handle, index); return handle;
      });
      return { handles: prepared, complete: true };
    },
    revalidate(selected) { return selected.map(handle => { if (!handles.has(handle)) throw Error('source_unavailable'); return value; }); },
  }, close() { handles.clear(); } };
}

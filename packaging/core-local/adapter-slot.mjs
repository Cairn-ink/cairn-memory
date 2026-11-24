import { createHash, createHmac } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { openSqliteAdapter } from '../../packages/adapter-sqlite/src/adapter.mjs';
import { createMemoryService } from '../../packages/core/src/service/index.mjs';
import tokenizer from './vendor/tiktoken/tiktoken.cjs';
import { formatBlock } from './wire-tools.mjs';

const modelUnavailable = () => { throw new Error('model_not_configured'); };
const clock = {
  nowMs: Date.now,
  monotonicMs: () => performance.now(),
  sha256Hex: async text => createHash('sha256').update(text).digest('hex'),
  hmacHex: async (key, text) => createHmac('sha256', key).update(text).digest('hex'),
};

export async function openStorage(database) {
  const storage = await openSqliteAdapter(database, { capabilities: { contextRead: true, contextRawRead: true } });
  let encoding;
  try {
    encoding = tokenizer.get_encoding('o200k_base');
    const countTokens = text => encoding.encode(text, [], []).length;
    const service = createMemoryService({
      storage, embedder: null, clock, tokens: { countTokens }, config: {},
      model: { model: 'unavailable', contextWindow: 1, countTokens, call: modelUnavailable },
      // The fixed local connection has no provider. The service checks the
      // persisted write pause separately from its model gate.
      gate: { assertOpen() {} },
      contextReadCounter: { count: countTokens }, contextReadFormat: formatBlock,
    });
    return { service, async close() {
      try { encoding.free(); } finally { await storage.close(); }
    } };
  } catch (error) {
    try { encoding?.free(); } finally { await storage.close(); }
    throw error;
  }
}

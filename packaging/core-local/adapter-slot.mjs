import { createHash, createHmac } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { openSqliteAdapter } from '../../packages/adapter-sqlite/src/adapter.mjs';
import { createMemoryService } from '../../packages/core/src/service/index.mjs';
import tokenizer from './vendor/tiktoken/tiktoken.cjs';
import { formatBlock } from './wire-tools.mjs';

const clock = {
  nowMs: Date.now,
  monotonicMs: () => performance.now(),
  sha256Hex: async text => createHash('sha256').update(text).digest('hex'),
  hmacHex: async (key, text) => createHmac('sha256', key).update(text).digest('hex'),
};

// Enable after both SQLite DocumentCardStore and Context Read can serve the
// same card lineage, including removal and migration.
const documentCardsReady = false;

export async function openStorage(database, localAuthority, { model = null, embedder = null } = {}) {
  const storage = await openSqliteAdapter(database, {
    capabilities: { contextRead: true, contextRawRead: true, documentCards: documentCardsReady }, legacyInspectPlacements: true,
    ...(localAuthority && { localAuthority }),
  });
  let encoding;
  try {
    encoding = tokenizer.get_encoding('o200k_base');
    const countTokens = text => encoding.encode(text, [], []).length;
    const config = {
      ...(model ? { rawCapture: { onModelFailure: true } }
        : localAuthority && storage.capabilities.fingerprintKey !== true ? { rawCapture: { enabled: true } } : {}),
      ...(documentCardsReady && { documentCards: { enabled: true, amendments: !!model } }),
    };
    const service = createMemoryService({
      storage, model, embedder: model ? embedder : null, clock, tokens: { countTokens }, config,
      // The service checks the persisted write pause separately from its model gate.
      gate: { assertOpen() {} },
      contextReadCounter: { count: countTokens }, contextReadFormat: formatBlock,
    });
    return { service, storage, async close() {
      try { encoding.free(); } finally { await storage.close(); }
    } };
  } catch (error) {
    try { encoding?.free(); } finally { await storage.close(); }
    throw error;
  }
}

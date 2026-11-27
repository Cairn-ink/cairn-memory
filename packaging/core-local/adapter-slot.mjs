import { openSqliteAdapter } from '../../packages/adapter-sqlite/src/adapter.mjs';
import { CoreError } from '../../packages/core/src/errors.mjs';
import { fetchForAssembly } from '../../packages/core/src/service/context-read-assembly-evidence.mjs';
import { findCandidatesMethod } from '../../packages/core/src/service/context-read-find.mjs';
import { readContextMethod } from '../../packages/core/src/service/context-read.mjs';
import { createMemoryService } from '../../packages/core/src/service/index.mjs';
import { inspectRecallEvidence } from '../../packages/core/src/service/inspect.mjs';
import tokenizer from './vendor/tiktoken/tiktoken.cjs';
import { createLocalProvider, localClock } from './local-provider.mjs';
import { documentCardsReady } from './provider-config.mjs';
import { formatBlock } from './wire-tools.mjs';

export async function openStorage(database, localAuthority, { model = null, embedder = null, provider } = {}) {
  if (provider && !documentCardsReady) throw new Error('cutover_model_configured');
  const storage = await openSqliteAdapter(database, {
    capabilities: { contextRead: true, contextRawRead: true, documentCards: documentCardsReady,
      semanticRetrieval: provider !== undefined }, legacyInspectPlacements: true,
    ...(localAuthority && { localAuthority }),
  });
  let encoding;
  try {
    encoding = tokenizer.get_encoding('o200k_base');
    const countTokens = text => encoding.encode(text, [], []).length;
    const ports = provider ? createLocalProvider({ ...provider, countTokens }) : {
      model, embedder: model ? embedder : null, clock: localClock, tokens: { countTokens },
      gate: { assertOpen() {} },
    };
    const config = {
      ...(ports.model ? { rawCapture: { onModelFailure: true } }
        : localAuthority && storage.capabilities.fingerprintKey !== true ? { rawCapture: { enabled: true } } : {}),
      explicitWindowFence: { enabled: true },
      ...(documentCardsReady && localAuthority && { documentCards: { enabled: true, amendments: !!ports.model } }),
    };
    const { vector: _vector, ...lexicalStorage } = storage;
    const service = createMemoryService({
      // Only recall adds query embedding dispatch to the installed tools.
      storage: provider ? { ...lexicalStorage, capabilities: { ...storage.capabilities, semanticRetrieval: false } } : storage,
      ...ports, config,
      ...(config.documentCards && { documentCardSessionKey: ({ client, sessionId }) =>
        storage.hashSessionKey(localAuthority.scope, client, sessionId) }),
      contextReadCounter: { count: countTokens }, contextReadFormat: formatBlock,
    });
    let recall;
    if (provider) {
      const { clock, gate, embedQuery } = ports;
      const { findForAssembly, startAssemblyEmbedding } = findCandidatesMethod({ storage, clock, gate, embedQuery });
      const fetch = fetchForAssembly(storage);
      recall = {
        async readContext(readSet, input) {
          let embedding, deadlineAtMs;
          const read = readContextMethod({ storage, clock, find: findForAssembly, fetch,
            counter: { count: countTokens }, format: formatBlock, includeCompactItemRank: true,
            startEmbedding(set, candidate, options) {
              if (deadlineAtMs === undefined) {
                deadlineAtMs = options.deadlineAtMs;
                embedding = startAssemblyEmbedding(set, candidate, options);
              }
              return embedding;
            },
          });
          for (let attempt = 0; attempt < 2; attempt++) {
            try { return await read(readSet, input, { deadlineAtMs }); }
            catch (error) {
              if (error.code !== 'snapshot_stale') throw error;
              if (deadlineAtMs === undefined || clock.monotonicMs() >= deadlineAtMs) break;
            }
          }
          throw new CoreError('evidence_unavailable');
        },
        inspect: inspectRecallEvidence.bind(null, storage),
      };
    }
    return { service, storage, recall, async close() {
      try { encoding.free(); } finally { await storage.close(); }
    } };
  } catch (error) {
    try { encoding?.free(); } finally { await storage.close(); }
    throw error;
  }
}

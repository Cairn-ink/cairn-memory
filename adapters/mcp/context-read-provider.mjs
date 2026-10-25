import { createLocalContextEmbedding, localPolicy } from '../local-embedder/index.mjs';
import { RELEASE_CATALOG } from '../local-embedder/catalog.mjs';
import { IDENTITY, qualification, refusal } from '../local-embedder/common.mjs';
import { LOCAL_OPERATIONAL_CODES } from '../../core/context-read-local-status.mjs';
import { createOpenAIEmbedder, estimateEmbeddingUsd, embeddingPrice } from '../openai/embedding.mjs';

/** Key lookup is conditional on an explicit complete provider group. */
export function createContextEmbedding(configuration, env = process.env) {
  if (!configuration) return undefined;
  if (configuration.provider !== 'openai') throw Error('invalid_mcp_configuration');
  embeddingPrice(configuration.model);
  const apiKey = env.OPENAI_API_KEY;
  const embedder = createOpenAIEmbedder({ apiKey, model: configuration.model, dimensions: configuration.dimensions });
  return Object.freeze({ embedder, policy: Object.freeze({ family: 'hosted', maxRequests: configuration.maxRequests,
    maxUsd: configuration.maxUsd, maxConcurrent: 1, estimateUsd: texts => estimateEmbeddingUsd(texts, { model: configuration.model }) }) });
}

/** Async only at the owner boundary; createCairnServer remains synchronous. */
export async function prepareContextEmbedding(configuration, env = process.env, { createLocal = createLocalContextEmbedding, catalog = RELEASE_CATALOG } = {}) {
  if (configuration?.provider !== 'local') return createContextEmbedding(configuration, env);
  try { return await createLocal({ packPath: configuration.packPath, threads: configuration.threads, maxRequests: configuration.maxRequests }); }
  catch (error) {
    if (!LOCAL_OPERATIONAL_CODES.includes(error?.code)) throw error;
    // The trust root is the release catalog, never an unread/unverified pack.
    // With no released catalog there is no executable identity; this reserved
    // unavailable identity cannot match any verified manifest/vector key.
    const hash = catalog.find(d => d.packId === 'bge-m3')?.manifestHash;
    const revision = /^[0-9a-f]{64}$/.test(hash ?? '') ? 'sha256:' + hash : 'catalog-unavailable';
    const status = Object.freeze({ state: 'unavailable', reason: error.code });
    return Object.freeze({ embedder: Object.freeze({ ...IDENTITY, revision, async embed() { throw refusal('provider_error'); } }),
      policy: localPolicy(configuration.maxRequests), localStatus: () => status, async close() {} });
  }
}
export function contextEmbeddingPort(embedding) {
  if (!embedding) return undefined;
  return { embedder: embedding.embedder, policy: embedding.policy, ...(embedding.localStatus ? { localStatus: embedding.localStatus } : {}) };
}
export function localCheckConfiguration(configuration) {
  if (configuration?.provider !== 'local') return {};
  return { packStatus: 'not-inspected', revision: null, runtimeLoaded: false, childStarted: false, networkAccessed: false,
    qualification: qualification(), maxConcurrent: 1, maxBatchDocuments: 1, interOpThreads: 1 };
}

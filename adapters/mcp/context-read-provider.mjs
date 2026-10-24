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

import { randomUUID } from 'node:crypto';
import { hash } from './fixtures.mjs';
import { transmissionGuard } from './cost.mjs';

export const FAKE_IDENTITY = Object.freeze({ id: 'p2e-deterministic-fake', revision: 'sha256-v1', dimensions: 1536, normalization: 'l2' });
export function fakeEmbedder() {
  let calls = 0;
  return { ...FAKE_IDENTITY, semanticCallCount: () => calls, async embed(texts, { signal } = {}) {
    signal?.throwIfAborted();
    calls++;
    return texts.map(text => {
      // Text hashing intentionally makes no semantic-quality claim.
      const vector = new Float32Array(1536), bytes = Buffer.from(hash(text), 'hex');
      vector[bytes.readUInt16LE(0) % vector.length] = bytes[2] % 2 ? 1 : -1;
      return vector;
    });
  } };
}
export function validateProviderSelection(options, env = {}) {
  if (options.provider !== undefined && !['fake', 'hosted'].includes(options.provider)) throw Error('unknown_provider');
  if (options.provider !== 'hosted') {
    if (options.requestHosted) throw Error('explicit_provider_hosted_required');
    return 'fake';
  }
  if (typeof env.OPENAI_API_KEY !== 'string' || !env.OPENAI_API_KEY.trim()) throw Error('hosted_key_required');
  if (process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === 'test' || env.NODE_TEST_CONTEXT || env.NODE_ENV === 'test') throw Error('hosted_forbidden_in_tests');
  if (!options.price || !options.maxUsd) throw Error('hosted_price_and_cap_required');
  return 'hosted';
}
// Call only after registration, capability, authorization and cost admission.
// Dynamic import keeps the real adapter entirely absent from fake/test paths.
export async function hostedEmbedder(options, env, tokenTable) {
  if (validateProviderSelection(options, env) !== 'hosted') throw Error('explicit_provider_hosted_required');
  const guard = transmissionGuard({ tokenTable, rate: options.price, maxUsd: options.maxUsd, maxRequests: options.maxRequests, authorization: options.authorization });
  const { createOpenAIEmbedder } = await import('../../adapters/openai/embedding.mjs');
  const adapter = createOpenAIEmbedder({ apiKey: env.OPENAI_API_KEY, usdPerMillionTokens: Number(options.price) });
  return { ...adapter, async embed(texts, controls) {
    if (typeof controls?.beforeDispatch !== 'function') throw Error('engine_dispatch_guard_required');
    let guarded = false;
    return adapter.embed(texts, { ...controls, beforeDispatch() {
      controls.beforeDispatch();
      // The legacy adapter invokes beforeDispatch for receive validation too;
      // charge exactly once, before its only possible transmission.
      if (!guarded) { guard(texts, randomUUID()); guarded = true; }
    } });
  } };
}

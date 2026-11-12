import assert from 'node:assert/strict';
import { createContextReadHost as cutoffHost } from './context-semantic-pump-cutoff-host.mjs';
import { observeStatements } from './no-provider-statement-observer.mjs';

export async function createContextReadHost(configuration) {
  observeStatements(configuration.pauseStatements);
  const host = await cutoffHost(configuration);
  if (configuration.semanticServiceBinding) {
    // Remove the provider configuration itself, rather than returning a
    // provider_unavailable error from an otherwise configured fake embedder.
    const { contextEmbedding, ...absent } = host;
    assert.ok(contextEmbedding);
    assert.equal(Object.hasOwn(absent, 'contextEmbedding'), false);
    Atomics.add(new Int32Array(configuration.pauseStatements), 4, 1);
    return absent;
  }
  assert.equal(host.contextEmbedding, undefined);
  Atomics.add(new Int32Array(configuration.pauseStatements), 5, 1);
  return host;
}

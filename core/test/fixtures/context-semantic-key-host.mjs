import { parentPort } from 'node:worker_threads';
import { createContextReadHost as syntheticHost } from '../../testing/context-semantic-host.mjs';
import { names, hash, installPortAudit } from './context-semantic-key-audit.mjs';

export async function createContextReadHost(c) {
  installPortAudit(c.keyAudit);
  const kind = c.semanticServiceBinding ? 'semantic' : 'product';
  const observe = stage => parentPort.postMessage({ kind: 'test-key-observation', worker: kind, stage,
    names: Object.keys(process.env).sort(), hash: hash(process.env[names[0]]) });
  observe('factory');
  // Missing credentials are still the host's decision, using an existing code.
  if (c.requireDedicated && !process.env[names[0]]) throw Object.assign(Error('invalid_input'), { code: 'invalid_input' });
  const host = await syntheticHost(c);
  if (host.contextEmbedding) {
    const key = process.env[names[0]];
    host.contextEmbedding.embedder.embed = async (_texts, controls) => {
      controls.beforeDispatch();
      parentPort.postMessage({ kind: 'test-key-observation', worker: kind, stage: 'provider', hash: hash(key) });
      throw Object.assign(Error('synthetic fixed provider failure'), {
        code: 'provider_error', cause: Error('synthetic fixed provider cause'),
      });
    };
  }
  const close = host.close;
  return { ...host, async close() { observe('close'); await close?.(); } };
}

import { createInterface } from 'node:readline';
import { createMemoryService } from '../../packages/core/src/service/index.mjs';

export async function openLocalService(storageOptions, serviceDeps) {
  const { openStorage } = await import('./adapter-slot.mjs');
  const storage = await openStorage(storageOptions);
  return createMemoryService({ ...serviceDeps, storage });
}

// A staging handshake with an empty capability set. Storage and tools are
// added when the local composition and its wire contract are qualified.
export async function serveStdio(input, output) {
  const lines = createInterface({ input, crlfDelay: Infinity, terminal: false });
  for await (const line of lines) {
    let request;
    try { request = JSON.parse(line); }
    catch {
      output.write(JSON.stringify({ jsonrpc: '2.0', id: null,
        error: { code: -32700, message: 'Parse error' } }) + '\n');
      continue;
    }
    if (request?.jsonrpc !== '2.0' || request.id === undefined) continue;
    const reply = { jsonrpc: '2.0', id: request.id };
    switch (request.method) {
      case 'initialize':
        reply.result = {
          protocolVersion: '2025-11-25',
          capabilities: {},
          serverInfo: { name: 'cairn-memory-core-local-candidate', version: '0.0.0' },
        };
        break;
      case 'ping':
        reply.result = {};
        break;
      default:
        reply.error = { code: -32601, message: 'Method not found' };
    }
    output.write(JSON.stringify(reply) + '\n');
  }
}

// Synthetic model ports behind the actual SDK/host/core boundary; no HTTP.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createCairnServer } from '../../server.mjs';
import { parseConfiguration } from '../../cli.mjs';

globalThis.fetch = () => assert.fail('Synthetic fixture forbids native HTTP');
const mode = process.env.SYNTHETIC_CANONICAL_MODE ?? 'empty';
const observe = method => process.stderr.write(`synthetic_model:${method}\n`);
const model = {
  contextWindow: 8192,
  countTokens: () => 100,
  async extract() {
    observe('extract');
    if (mode === 'deadline') return new Promise(() => {});
    if (mode === 'failure') throw new Error('SYNTHETIC_PRIVATE_PROVIDER_ERROR');
    if (mode === 'malformed') return { items: 'invalid' };
    if (mode === 'deferred') {
      await new Promise((resolve, reject) => {
        const interval = setInterval(() => {
          if (existsSync(process.env.SYNTHETIC_RELEASE_FILE)) {
            clearInterval(interval); clearTimeout(timeout); resolve();
          }
        }, 10);
        const timeout = setTimeout(() => {
          clearInterval(interval); reject(new Error('synthetic_release_timeout'));
        }, 30000);
      });
    }
    return mode === 'empty' ? { items: [] } : { items: [{
      content: 'Synthetic admitted interpretation', kind: 'context', confidence: 0.5, sourceIndices: [0] }] };
  },
  classify({ input }) {
    observe('classify');
    return { items: input.memories.map(({ id }) => ({ memoryId: id, parentIds: [] })) };
  },
  select({ input }) {
    observe('select');
    return { refs: input.maps.flatMap(map => map.items.filter(item => item.type === 'unfiled')
      .map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))) };
  },
  rank({ input }) {
    observe('rank');
    return { refs: input.candidates.slice(0, input.limit).map(item => ({
      namespaceIndex: item.namespaceIndex, memoryId: item.memory.id, revision: item.memory.revision })) };
  },
  qualifyCandidates() { assert.fail('Canonical capture must not qualify'); },
};
const options = { ...parseConfiguration(process.argv.slice(2)), model };
const server = createCairnServer(options);
options.captureSourcePolicy = 'mutated-after-construction';
const handle = serveStdio(() => server, {
  transport: new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 65536 }),
  onerror: () => { console.error('synthetic_transport_error'); void handle.close(); },
});
process.stdin.once('end', () => { void handle.close(); });
process.once('SIGTERM', () => { void handle.close(); });

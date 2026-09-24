// Scripted model behind real MCP stdio; it never contacts a provider.
import assert from 'node:assert/strict';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createCairnServer } from '../../server.mjs';
import { parseConfiguration } from '../../cli.mjs';

globalThis.fetch = () => assert.fail('Synthetic deadline fixture must not use HTTP');
const model = {
  contextWindow: 8192,
  countTokens: () => 1,
  extract: ({ input }) => {
    process.stderr.write('synthetic_stage:extract\n');
    if (input.messages.some(({ content }) => content.includes('STALL_EXTRACT'))) return new Promise(() => {});
    return { items: [{ content: input.messages[0].content, kind: 'fact', confidence: 0.8, sourceIndices: [0] }] };
  },
  qualify: ({ input }) => {
    process.stderr.write('synthetic_stage:qualify\n');
    return { qualifications: input.items.map(({ itemIndex, sources }) => ({ itemIndex,
      qualification: { version: 1, slot: { subject: null, property: null, scope: null, applies: null },
        value: null, attribution: 'unknown', commitment: 'unknown',
        anchors: [{ receiptIndex: 0, start: 0, end: sources[0].excerpt.length,
          text: sources[0].excerpt, fields: ['value'] }] } })) };
  },
  classify: ({ input }) => {
    process.stderr.write('synthetic_stage:classify\n');
    if (process.argv.includes('--capture-qualification') &&
        input.memories.some(({ content }) => content.includes('STALL_CLASSIFY'))) return new Promise(() => {});
    return { items: input.memories.map(({ id }) => ({ memoryId: id, parentIds: [],
      newL1: { title: 'Synthetic filing', parentL2Ids: [] } })) };
  },
};
const options = { ...parseConfiguration(process.argv.slice(2)), model };
const server = createCairnServer(options);
options.captureDeadlineMs = 120_000;
const handle = serveStdio(() => server, {
  transport: new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 65536 }),
  onerror: () => { process.stderr.write('synthetic_transport_error\n'); },
});
process.stdin.once('end', () => { void handle.close(); });
process.once('SIGTERM', () => { void handle.close(); });

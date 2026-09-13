// Actual core and stdio; scripted ranking tests propagation, not model quality.
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createCairnServer } from '../../server.mjs';
import { parseConfiguration } from '../../cli.mjs';

globalThis.fetch = () => { throw new Error('network_forbidden_in_fixture'); };
const model = {
  contextWindow: 8192, countTokens: () => 1,
  select: ({ input }) => ({ refs: input.maps.flatMap(map => map.items
    .filter(item => item.type === 'unfiled')
    .map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))) }),
  rank: ({ input }) => {
    process.stderr.write(`rank:${JSON.stringify(input)}\n`);
    return { refs: input.candidates.slice(0, input.limit).map(candidate => ({
      namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id,
      revision: candidate.memory.revision,
    })) };
  },
};
const config = parseConfiguration(process.argv.slice(2));
const handle = serveStdio(() => createCairnServer({ ...config, model }), {
  transport: new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 65536 }),
  onerror: () => { console.error('qualified_recall_transport_error'); },
});
process.stdin.once('end', () => { void handle.close(); });
process.once('SIGTERM', () => { void handle.close(); });

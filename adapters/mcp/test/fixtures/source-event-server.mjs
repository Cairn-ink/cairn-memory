import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createCairnServer } from '../../server.mjs';

globalThis.fetch = () => { throw new Error('network_forbidden'); };
const roots = JSON.parse(process.env.CAIRN_SYNTHETIC_ROOTS);
const namespace = { ownerId: 'synthetic-source-event-mcp', scope: 'personal', projectId: null };
const model = { contextWindow: 8192, countTokens: () => 1,
  select: ({ input }) => ({ refs: input.maps.flatMap(map =>
    map.items.filter(item => item.type === 'unfiled' && roots.includes(item.ref.memoryId))
      .map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))) }),
  rank: ({ input }) => ({ refs: input.candidates.filter(item => roots.includes(item.memory.id))
      .map(item => ({ namespaceIndex: item.namespaceIndex,
        memoryId: item.memory.id, revision: item.memory.revision })) }) };
const handle = serveStdio(() => createCairnServer({ path: process.env.CAIRN_SYNTHETIC_DB,
  namespace, model }), { transport: new StdioServerTransport(process.stdin, process.stdout) });
process.stdin.once('end', () => { void handle.close(); });
process.once('SIGTERM', () => { void handle.close(); });

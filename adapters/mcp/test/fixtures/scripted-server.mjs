// Protocol fixture only: scripted selection/ranking is not semantic evidence.
import assert from 'node:assert/strict';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createCairnServer } from '../../server.mjs';
import { parseConfiguration } from '../../cli.mjs';
import { createMockRecallModel } from '../../../../core/testing/mock-recall-model.mjs';

globalThis.fetch = () => { throw new Error('network_forbidden_in_fixture'); };
const select = ({ input }) => {
  if (input.query.startsWith('Redaction probe')) {
    assert.equal(input.query, 'Redaction probe [REDACTED]');
    assert.equal(JSON.stringify(input).includes('a'.repeat(40)), false);
  }
  return { refs: input.maps.flatMap((map) => map.items
  .filter((item) => item.type === 'unfiled')
  .map((item) => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))) };
};
const rank = ({ input }) => ({ refs: input.candidates.slice(0, input.limit).map((candidate) => ({
  namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id,
  revision: candidate.memory.revision,
})) });
const model = createMockRecallModel({ select: Array(10).fill(select), rank: Array(10).fill(rank) });
const config = parseConfiguration(process.argv.slice(2));
const handle = serveStdio(() => createCairnServer({ ...config, model }), {
  transport: new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 65536 }),
  onerror: () => { console.error('scripted_transport_error'); },
});
process.stdin.once('end', () => { void handle.close(); });
process.once('SIGTERM', () => { void handle.close(); });

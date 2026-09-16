import { readFileSync, writeFileSync } from 'node:fs';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createCairnServer } from '../../server.mjs';
import { parseConfiguration } from '../../cli.mjs';

globalThis.fetch = () => { throw new Error('offline_only'); };
let relateCalls = 0;
const model = { contextWindow: 8192, countTokens: () => 1,
  relate(request) {
    relateCalls++;
    if (process.env.SYNTHETIC_REVIEW_OBSERVATION) {
      writeFileSync(process.env.SYNTHETIC_REVIEW_OBSERVATION,
        JSON.stringify({ calls: relateCalls, input: request.input }));
    }
    const mode = readFileSync(process.env.SYNTHETIC_REVIEW_MODE, 'utf8').trim();
    if (mode === 'failed') throw new Error('synthetic_provider_failure');
    if (mode === 'empty') return { edges: [] };
    const sources = request.input.memories;
    const chosen = sources.find(item => item.receipts.some(receipt => receipt.excerpt.startsWith('I chose A')));
    const challenge = sources.find(item => item.receipts.some(receipt => receipt.excerpt.includes('A cannot work offline')));
    const edge = (from, to, relation) => ({ from, to, relation, fromReceipt: 0, toReceipt: 0 });
    if (mode === 'crossing') return { edges: [edge(0, 0, 'supports-decision'), edge(1, 0, 'supports-decision')] };
    if (!chosen) return { edges: [] };
    if (mode === 'wrong') return { edges: [edge(chosen.index, chosen.index, 'supports-decision'),
      ...(challenge ? [edge(challenge.index, chosen.index, 'challenges-premise')] : [])] };
    if (mode === 'support') return { edges: [edge(chosen.index, chosen.index, 'supports-decision')] };
    throw new Error('synthetic_unknown_mode');
  },
};
const handle = serveStdio(() => createCairnServer({ ...parseConfiguration(process.argv.slice(2)), model }));
process.stdin.once('end', () => { void handle.close(); });
process.once('SIGTERM', () => { void handle.close(); });

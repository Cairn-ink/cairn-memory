#!/usr/bin/env node
// Loopback stand-in for a local target: hosted-shaped bodies in, one temporary
// core store with a scripted model behind it. Records every received body so
// the analysis can check delivered bytes. Harness only; this is not LAC.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openMemoryCore } from '../../../../core/contract.mjs';
import { readConfig } from './lib/common.mjs';
import { createRecordingServer } from './lib/core-http.mjs';
import { createScriptedModel } from './lib/scripted-model.mjs';

const root = process.argv[2];
if (!root) throw new Error('usage: core-server.mjs <run-root>');
const config = readConfig(root);
const calls = [];
const core = openMemoryCore({ path: join(root, 'core', 'memory.sqlite'), model: createScriptedModel(calls) });
const namespace = projectId => ({ ownerId: 'f0-synthetic-owner', scope: 'project', projectId });

async function handle(path, body) {
  if (path === '/api/memory/capture') {
    const result = await core.capture({ namespace: namespace(body.project_id), client: body.client,
      eventId: body.event_id, sessionId: body.session_id, messages: body.messages });
    if (!result.ok) return [422, { error: result.error?.code ?? 'capture_failed' }];
    return [200, { duplicate: Boolean(result.value.duplicate),
      memoryCount: result.value.admission?.memories?.length ?? 0 }];
  }
  if (path === '/api/memory/recall') {
    const result = await core.recall({ readSet: [namespace(body.project_id)], query: body.query,
      limit: Math.min(body.limit ?? 6, 12) });
    if (!result.ok) return [422, { error: result.error?.code ?? 'recall_failed' }];
    return [200, { memories: result.value.memories.map(({ memory, receipts }) => ({
      id: memory.id, content: memory.content, origin: memory.origin ?? 'explicit', scope: 'project',
      confidence: memory.confidence ?? 0.9,
      receipts: receipts.slice(0, 1).map(receipt => ({ client: receipt.client, role: receipt.role,
        excerpt: receipt.excerpt })),
    })) }];
  }
  return [404, { error: 'not_found' }];
}

const server = createRecordingServer({ root, config, handle });

server.listen(0, '127.0.0.1', () => {
  writeFileSync(join(root, 'core', 'port'), String(server.address().port));
});
const stop = () => server.close(() => { core.close(); process.exit(0); });
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

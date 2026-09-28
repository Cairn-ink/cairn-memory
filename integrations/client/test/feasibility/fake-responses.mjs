#!/usr/bin/env node
// Scripted loopback Responses provider for a zero-quota Codex pre-check. The
// pinned host still writes its own session format and runs its own hooks; only
// the model is replaced. Header values are never recorded.
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { appendRecord, readConfig, sha256 } from './lib/common.mjs';

const root = process.argv[2];
if (!root) throw new Error('usage: fake-responses.mjs <run-root>');
const config = readConfig(root);
let turn = 0;

const sse = events => events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
const done = item => ({ type: 'response.output_item.done', item });
// A step (by name, so retries behave the same) may report large usage to make
// the host start its own auto-compaction; setup initializes this configuration.
const usageTokens = config.fakeUsageTokens?.[config.stepName] ?? 1;
const completed = id => ({ type: 'response.completed', response: { id, usage: { input_tokens: usageTokens,
  input_tokens_details: { cached_tokens: 0 }, output_tokens: 1, output_tokens_details: { reasoning_tokens: 0 },
  total_tokens: usageTokens + 1 } } });

function shellCall(tools) {
  const names = new Set((tools ?? []).map(tool => tool.name ?? tool.function?.name).filter(Boolean));
  if (names.has('exec_command')) return { name: 'exec_command', arguments: JSON.stringify({ cmd: 'cat canary-tool.txt' }) };
  if (names.has('shell_command')) return { name: 'shell_command', arguments: JSON.stringify({ command: 'cat canary-tool.txt' }) };
  if (names.has('shell')) return { name: 'shell', arguments: JSON.stringify({ command: ['cat', 'canary-tool.txt'] }) };
  return null;
}

const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  let body = {};
  try { body = JSON.parse(raw); } catch { /* recorded below */ }
  const headerNames = Object.keys(request.headers).sort();
  const index = ++turn;
  writeFileSync(join(root, 'logs', `fake-request-${config.step}-${index}.json`), raw, { mode: 0o600 });
  appendRecord(root, 'fake-provider.jsonl', { step: config.step, index, method: request.method, path: request.url,
    headerNames, authorizationPresent: headerNames.includes('authorization'), bytes: Buffer.byteLength(raw),
    sha256: sha256(raw), toolNames: (body.tools ?? []).map(tool => tool.name ?? tool.type).slice(0, 80),
    inputItems: Array.isArray(body.input) ? body.input.map(item => `${item.type}:${item.role ?? ''}`) : null });
  if (request.method !== 'POST' || !request.url.endsWith('/responses')) {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{"error":"not_found"}');
    return;
  }
  if (raw.includes(config.canaries.compactMarker)) {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    response.end(sse([{ type: 'response.created', response: { id: `resp_${index}` } },
      done({ type: 'message', role: 'assistant', id: `msg_${index}`,
        content: [{ type: 'output_text', text: `Scripted compaction summary ${config.canaries.compactSummary}.` }] }),
      completed(`resp_${index}`)]));
    return;
  }
  const hasToolOutput = (body.input ?? []).some(item => item.type === 'function_call_output' ||
    item.type === 'custom_tool_call_output');
  const call = hasToolOutput ? null : shellCall(body.tools);
  const events = [{ type: 'response.created', response: { id: `resp_${index}` } }];
  if (!hasToolOutput) {
    events.push(done({ type: 'reasoning', id: `rs_${index}`, summary: [{ type: 'summary_text',
      text: `Scripted reasoning summary ${config.canaries.reasoningFake}.` }] }));
  }
  if (call) events.push(done({ type: 'function_call', id: `fc_${index}`, call_id: `call_${index}`, ...call }));
  else events.push(done({ type: 'message', role: 'assistant', id: `msg_${index}`,
    content: [{ type: 'output_text', text: 'DONE' }] }));
  events.push(completed(`resp_${index}`));
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  response.end(sse(events));
});

server.listen(0, '127.0.0.1', () => writeFileSync(join(root, 'fake-port'), String(server.address().port)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));

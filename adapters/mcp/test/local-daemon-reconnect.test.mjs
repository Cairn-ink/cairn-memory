import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createCairnServer } from '../server.mjs';
import { workspace, until, ok, ns } from './local-daemon-support.mjs';
import { streams, counter, call as sdkCall } from './local-shared-support.mjs';

test('A5 idle reconnect replays initialize and initialized only without duplicate replies', { timeout: 30000 }, async t => {
  const w = await workspace(t), a = w.forward(); a.release(); const first = await w.connect(a);
  const content = 'synthetic cobalt telescope no replay';
  // Admission returns identity/revision only; inspect returns the full Memory.
  const memory = ok(await a.tool('remember_memory', { content, kind: 'fact' })).memory;
  const initializeReplies = a.lines.filter(m => m.result?.protocolVersion).length;
  process.kill(first.owner.pid, 'SIGKILL');
  await until(() => a.messages.filter(m => m.kind === 'connected').length === 2, 'A5 must reconnect without active tools');
  const inspected = ok(await a.tool('inspect_memory', { memoryId: memory.id }));
  assert.equal(inspected.memory.content, content);
  assert.equal(inspected.memory.id, memory.id);
  assert.equal(inspected.memory.revision, memory.revision);
  // The ordinary single-connection server is the result-shape oracle for the
  // same inspect call against the same durable record, including receipts.
  const server = createCairnServer({ path: w.path, namespace: ns, contextCounter: counter });
  const [serverSide, clientSide] = streams(), direct = new Client({ name: 'synthetic-reconnect-oracle', version: '1' });
  try {
    await server.connect(new StdioServerTransport(serverSide, serverSide));
    await direct.connect(new StdioServerTransport(clientSide, clientSide), { prior: { kind: 'legacy' } });
    assert.deepEqual(inspected, ok(await sdkCall(direct, 'inspect_memory', { memoryId: memory.id })),
      'reconnected daemon must return the complete ordinary inspect result');
  } finally { await direct.close(); await server.close(); serverSide.destroy(); clientSide.destroy(); }
  assert.equal(a.lines.filter(m => m.result?.protocolVersion).length, initializeReplies, 'private replay must suppress duplicate initialize response');
  assert.equal(a.lines.filter(m => m.error?.message === 'daemon_transport').length, 0, 'settled tool must not become in-flight on reconnect');
});
for (const side of ['before', 'after']) test(`SIGKILL ${side} mutation COMMIT fails in-flight id and never replays tool`, { timeout: 35000 }, async t => {
  const w = await workspace(t), bootstrap = await w.bootstrap();
  const candidate = w.child({ role: 'candidate', bootstrap, commitBarrier: side }); candidate.release();
  await until(w.descriptor, 'fault candidate must publish ready');
  const a = w.forward(); a.release(); await w.connect(a);
  candidate.process.send({ kind: 'arm' });
  await until(() => candidate.messages.some(m => m.kind === 'armed'), 'mutation barrier must be armed');
  const content = 'synthetic cobalt telescope COMMIT_SENTINEL';
  const call = a.tool('remember_memory', { content, kind: 'fact' });
  await until(() => candidate.messages.some(m => m.kind === 'commit-barrier' && m.side === side), 'fault must hit exact COMMIT side');
  candidate.process.kill('SIGKILL'); await until(() => candidate.exit, 'fault candidate exit must be recorded');
  assert.equal(candidate.exit.signal, 'SIGKILL');
  const failure = await call;
  assert.equal(failure.error.message, 'daemon_transport', 'in-flight tool id must receive transport error');
  await until(() => a.exit || a.messages.filter(m => m.kind === 'connected').length > 1, 'in-flight disconnect must settle');
  assert.equal(a.messages.filter(m => m.kind === 'connected').length, 1, 'in-flight tools must never reconnect or resend');
  await until(() => a.exit, 'in-flight tool disconnect must fail closed');
  assert.equal(a.messages.find(m => m.kind === 'forwarder-done').code, 'daemon_outcome_unknown', 'mutation outcome must remain explicitly unknown');
  const b = w.forward(); b.release(); await w.connect(b);
  const core = openMemoryCore({ path: w.path, raw: false });
  try {
    const listed = ok(core.list({ namespace: ns }));
    assert.equal(listed.exhausted, true, 'durable outcome census must be complete');
    assert.equal(listed.memories.length, side === 'after' ? 1 : 0, 'exactly one admission may survive COMMIT; tools must never replay');
    // list() deliberately returns metadata; get() is the public content API.
    const durable = listed.memories.map(memory => ok(core.get({ namespace: ns, memoryId: memory.id })).memory);
    const text = JSON.stringify(durable);
    assert.equal(text.includes('COMMIT_SENTINEL'), side === 'after', 'normal engine API must observe exact durable COMMIT outcome');
    if (side === 'after') assert.equal(durable[0].content, content, 'the committed payload must survive exactly');
  } finally { await core.close(); }
  // A read through the recovered MCP service also confirms the store is usable.
  const result = await b.tool('inspect_memory', {}); assert.equal(result.ok, true);
});

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { serveStdio } from '../core-local/host.mjs';

test('keyed recall advertises and serves a default of 24 compact matches', async t => {
  const { path } = createTestWorkspace(t);
  const owner = 'synthetic-owner';
  const query = 'albatross';
  let queryEmbeddings = 0;
  const provider = {
    owner,
    key: 'synthetic-recall-provider',
    authorize() {},
    async request(url, options) {
      assert.equal(new URL(url).pathname, '/v1/embeddings');
      const { input, model, dimensions } = JSON.parse(options.body);
      if (input.includes(query)) queryEmbeddings++;
      const embedding = [1, ...Array(dimensions - 1).fill(0)];
      return Response.json({ object: 'list', model, data: input.map((_, index) => ({ index, embedding })) });
    },
  };

  const requests = [];
  const request = (method, params) => {
    const id = requests.length;
    requests.push({ jsonrpc: '2.0', id, method, params });
    return id;
  };
  const call = (name, args) => request('tools/call', { name, arguments: args });
  const list = request('tools/list');
  const saved = Array.from({ length: 30 }, (_, index) => call('remember_memory', {
    content: `The albatross logged marker ${index + 1}.`,
  }));
  const omitted = call('recall_memory', { query });
  const three = call('recall_memory', { query, limit: 3 });
  const twentyFour = call('recall_memory', { query, limit: 24 });
  const rejected = call('recall_memory', { query, limit: 25 });

  const replies = [];
  await serveStdio(Readable.from(requests.map(message => JSON.stringify(message) + '\n')),
    { write: line => replies.push(JSON.parse(line)) }, { database: join(path, 'memory.sqlite'), owner, provider });
  assert.deepEqual(replies.map(({ id }) => id), requests.map(({ id }) => id));

  const tool = replies[list].result.tools.find(({ name }) => name === 'recall_memory');
  assert.deepEqual(tool.inputSchema.properties.limit, { default: 24, type: 'integer', minimum: 1, maximum: 24 });
  assert.match(tool.description, /The limit defaults to 24\./u);
  const value = index => {
    assert.equal(replies[index].error, undefined, JSON.stringify(replies[index].error));
    const { content, isError } = replies[index].result;
    assert.equal(isError, false, content[0].text);
    const response = JSON.parse(content[0].text);
    assert.equal(response.ok, true);
    return response.value;
  };
  const stored = new Set(saved.map(index => {
    const result = value(index);
    assert.equal(result.deduplicated, false);
    return result.memory.id;
  }));
  assert.equal(stored.size, 30);

  for (const [index, count] of [[omitted, 24], [three, 3], [twentyFour, 24]]) {
    const ids = value(index).memories.map(({ memory }) => memory.id);
    assert.equal(ids.length, count);
    assert.equal(new Set(ids).size, count);
    assert.ok(ids.every(id => stored.has(id)));
  }
  assert.deepEqual(replies[rejected].result, {
    content: [{ type: 'text', text: 'Input validation error: Invalid arguments for tool recall_memory: limit: Too big: expected number to have <=24' }],
    isError: true,
  });
  assert.equal(queryEmbeddings, 3);
});

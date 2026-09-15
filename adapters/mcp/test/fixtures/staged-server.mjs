// Synthetic scripted extraction behind the real SDK stdio/server/core boundary.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createCairnServer } from '../../server.mjs';
import { parseConfiguration } from '../../cli.mjs';
import { rationaleModel } from '../../../../core/testing/rationale-model.mjs';

globalThis.fetch = () => assert.fail('Native HTTP forbidden');
const model = rationaleModel((method, request) => {
  assert.notEqual(process.env.SYNTHETIC_FORBID_MODEL, '1');
  if (['select', 'rank'].includes(method)) assert.equal(JSON.stringify(request.input).includes('STAGED_ONLY_SENTINEL'), false);
  process.stderr.write(`synthetic_model:${method}\n`);
});
const select = model.select;
model.select = request => {
  select(request);
  return { refs: request.input.maps.flatMap(map => map.items.filter(item => item.type === 'unfiled')
    .map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))) };
};
const extract = model.extract;
model.extract = async request => {
  const output = extract(request);
  if (process.env.SYNTHETIC_RELEASE_FILE) {
    await new Promise((resolve, reject) => {
      const interval = setInterval(() => {
        if (existsSync(process.env.SYNTHETIC_RELEASE_FILE)) { clearInterval(interval); clearTimeout(timeout); resolve(); }
      }, 10);
      const timeout = setTimeout(() => { clearInterval(interval); reject(new Error('Synthetic release timeout')); }, 10000);
    });
  }
  return output;
};
const qualify = model.qualifyCandidates;
model.qualifyCandidates = request => {
  const output = qualify(request);
  if (process.env.SYNTHETIC_FAIL_QUALIFICATION === '1') throw new Error('SYNTHETIC_PRIVATE_PROVIDER_ERROR');
  return output;
};
const options = { ...parseConfiguration(process.argv.slice(2)), model };
const server = createCairnServer(options);
options.namespace.ownerId = 'mutated-after-construction';
const handle = serveStdio(() => server, {
  transport: new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 65536 }),
  onerror: () => console.error('synthetic_transport_error'),
});
process.stdin.once('end', () => { void handle.close(); });
process.once('SIGTERM', () => { void handle.close(); });

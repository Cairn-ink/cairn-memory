import { openRawCaptureCore } from '../raw-capture.mjs';
import { localPlainPort } from './raw-fixtures.mjs';

const [path, encoded, outcome, encodedOptions] = process.argv.slice(2);
const request = JSON.parse(encoded), calls = [];
const core = openRawCaptureCore({ path, ...JSON.parse(encodedOptions ?? '{}'), model: { contextWindow: 8192, countTokens: () => 1,
  extract: () => { calls.push('extract'); if (outcome === 'fail') throw Error('Synthetic process extraction failure'); return { items: [] }; } } }, {
  mode: 'raw-v1', port: localPlainPort(), readPolicy: () => ({ generation: 'notice-1', reason: null }),
});
try {
  const result = await core.captureRaw(request);
  console.log(JSON.stringify({ result, calls, usage: core.getRawUsage({ ownerId: request.namespace.ownerId }) }));
  if (!result.ok) process.exitCode = 1;
} finally { core.close(); }

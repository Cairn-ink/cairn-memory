import { openMemoryCore } from '../contract.mjs';

const [path, encoded] = process.argv.slice(2);
let calls = 0;
const core = openMemoryCore({ path, model: { contextWindow: 8192, countTokens: () => 1,
  extract: () => { calls++; return { items: [] }; } } });
try { process.stdout.write(JSON.stringify({ result: await core.capture(JSON.parse(encoded)), calls }) + '\n'); }
finally { core.close(); }

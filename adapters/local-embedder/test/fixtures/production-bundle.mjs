import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startBundle } from '../../bundle.mjs';
import { checkFence } from '../../pack.mjs';
import { spawnNode, groupExists } from '../../process.mjs';
import { decoder, OUTPUT_BYTES } from '../../protocol.mjs';

export const tinyRuntime = `
globalThis.fixtureEvent({runtimeImport:true});
export const env = {};
export const AutoTokenizer = {async from_pretrained() {
  await globalThis.fixtureGate('tokenizer-load');
  return text => ({input_ids:{dims:[1,2],data:new BigInt64Array(2)}});
}};
export const AutoModel = {async from_pretrained() {
  await globalThis.fixtureGate('model-load'); let calls=0;
  const model = async () => {
    await globalThis.fixtureGate(++calls === 1 ? 'warm-up' : 'inference');
    const data = new Float32Array(2048); data[0]=1;
    return {last_hidden_state:{dims:[1,2,1024],data}};
  };
  model.dispose=async()=>globalThis.fixtureEvent({disposed:true}); return model;
}};
`;
export const runtimeEntry = 'runtime/node_modules/@huggingface/transformers/dist/transformers.node.mjs';
export async function productionBundle(t, pack, { atStage = async () => {}, fence = () => checkFence(pack.packPath, pack.fence) } = {}) {
  let supervisor, ids, closed = false, hookError;
  const frames = [];
  const operation = startBundle(pack, 4, { fence, onRegistration(value) { ids = value; },
    spawn() {
      supervisor = spawnNode(fileURLToPath(new URL('./production-supervisor.mjs', import.meta.url)), [pack.packPath], { stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'ipc'] });
      const wire = decoder(OUTPUT_BYTES, value => frames.push(value), () => {});
      supervisor.stdout.on('data', bytes => wire.push(bytes));
      supervisor.on('close', () => { closed = true; });
      supervisor.on('message', async ({ stage }) => {
        try { await atStage(stage); }
        catch (error) { hookError = error; }
        finally { if (supervisor.connected) supervisor.send(stage, () => {}); }
      });
      return supervisor;
    } });
  let bundle;
  t.after(async () => { try { bundle ??= await operation.catch(() => null); await bundle?.close(); } finally { if (hookError) throw hookError; } });
  return { operation: operation.then(value => { bundle = value; return value; }), frames,
    async events() { return (await readFile(pack.packPath + '.events', 'utf8')).trim().split('\n').map(line => JSON.parse(line)); },
    assertClean() { assert.equal(closed, true); assert.ok(ids); assert.equal(groupExists(ids.inferencePid), false); if (hookError) throw hookError; } };
}

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnNode } from '../../process.mjs';
import { startBundle } from '../../bundle.mjs';
import { decoder, OUTPUT_BYTES } from '../../protocol.mjs';
const [root, report, gate, mode, hash, fenceJSON] = process.argv.slice(2);
let supervisor;
try {
  const b = await startBundle({ packPath: root, manifestHash: hash, fence: JSON.parse(fenceJSON), metadata: { id: 'fixture', revision: '1', dimensions: 1024, normalization: 'l2' } }, 4, {
    spawn() {
      supervisor = spawnNode(fileURLToPath(new URL('./supervisor.mjs', import.meta.url)), [root, mode, gate], { stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
      writeFileSync(report + '.spawn', JSON.stringify({ caller: process.pid, supervisor: supervisor.pid }));
      const registration = decoder(OUTPUT_BYTES, value => writeFileSync(report, JSON.stringify({ caller: process.pid, supervisor: supervisor.pid, inference: value.pid })), () => {});
      supervisor.stdio[3].on('data', bytes => registration.push(bytes));
      return supervisor;
    }
  });
  if (mode === 'blocked-inference') await b.embed(['native work']);
  else await new Promise(() => {});
} catch (e) { writeFileSync(report + '.error', JSON.stringify({ code: e.code })); process.exitCode = 1; }

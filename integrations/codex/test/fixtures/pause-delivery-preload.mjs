import fs from 'node:fs';
import promises from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { hostedTargetId } from '../../../client/transport-hosted.mjs';
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const originalWrite = fs.write;
let delivered = false;
const gatePath = join(config.root, 'hosted-pause.gate');
const unlink = promises.unlink;
promises.unlink = async function(path) {
  if (delivered && [join(config.root,'control.lock'),gatePath].includes(String(path))) await delay(80);
  return unlink.call(this,path);
};
fs.write = function(fd, ...args) {
  if (fd === 1) { delivered = true; process.send?.({kind:'delivery',
    control:fs.existsSync(join(config.root,'control.lock')),
    gate:fs.existsSync(join(config.root, 'hosted-pause.gate')),
  }); }
  return originalWrite.call(this,fd,...args);
};
syncBuiltinESMExports();

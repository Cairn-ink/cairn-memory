import fs from 'node:fs';
import { join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { hostedTargetId } from '../../../client/transport-hosted.mjs';
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const originalWrite = fs.write;
fs.write = function(fd, ...args) {
  if (fd === 1) process.send?.({kind:'delivery',
    control:fs.existsSync(join(config.root,'control.lock')),
    gate:fs.existsSync(join(config.root,'hosted-pause',hostedTargetId(config)+'.json.gate')),
  });
  return originalWrite.call(this,fd,...args);
};
syncBuiltinESMExports();

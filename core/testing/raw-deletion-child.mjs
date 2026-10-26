// Owned by raw-deletion-host.test.mjs; no environment/configuration is read.
import { openRawCaptureCore } from '../raw-capture.mjs';

const core = openRawCaptureCore({ path: process.argv[2] }, { mode: 'off', deletion: true,
  readPolicy: () => { throw Error('Deletion cannot read capture policy'); } });
process.once('message', input => {
  try { process.send(core.deleteConversation(input)); }
  finally { core.close(); process.disconnect(); }
});
process.send({ ready: true });

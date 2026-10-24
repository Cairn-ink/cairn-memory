import { openRawCaptureCore } from '../raw-capture.mjs';
import { cardHost, localPlainPort, ns } from './raw-source-fixtures.mjs';

process.once('message',async ({ source,cardId }) => {
  const host = cardHost();
  const core = openRawCaptureCore({ path: process.argv[2],privateCards: host.options },{
    mode: 'off',sources: true,port: localPlainPort(),readPolicy: () => { throw Error('No capture in cold reader'); } });
  try {
    const read = await host.call(core,'getSource',{ namespace: ns,source,budgets: { sourceByteLimit: 64000 } });
    const card = host.call(core,'getCard',{ namespace: ns,cardId });
    process.send({ read,card });
  } finally { core.close(); process.disconnect(); }
});

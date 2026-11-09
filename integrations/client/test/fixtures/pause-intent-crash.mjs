import { observeHostedPause } from '../../hosted-pause.mjs';
import { withWriteObserver } from '../../private-state.mjs';
const [root, endpoint] = process.argv.slice(2);
await withWriteObserver(async ({ path, kind }) => {
  if (kind === 'write' && path.includes('.intents/') && path.endsWith('.json')) {
    process.send({ kind: 'intent-durable' });
    await new Promise(() => {});
  }
}, () => observeHostedPause({ root, endpoint }, 'synthetic-token'));

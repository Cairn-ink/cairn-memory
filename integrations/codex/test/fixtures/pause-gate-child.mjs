import { pathToFileURL } from 'node:url';
const [mode, modulePath, root, endpoint] = process.argv.slice(2);
const api = await import(pathToFileURL(modulePath));
try {
  const result = mode === 'observe'
    ? await api.observeHostedPause({ root, endpoint }, 'synthetic-token')
    : await api.recallContext({ prompt: 'SYNTHETIC_PAUSED_QUERY', session_id: 'synthetic-session' },
      { root, endpoint }, 'synthetic-token', 'a'.repeat(64), new AbortController().signal, async () => true);
  process.stdout.write(JSON.stringify({ result }));
} catch (error) {
  process.stdout.write(JSON.stringify({ error: error.message }));
}

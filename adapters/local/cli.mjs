import { performance } from 'node:perf_hooks';
import { writeSync } from 'node:fs';

// Anchor the deadline to process startup, including module/config/input work.
const started = performance.now() - process.uptime() * 1000;
const controller = new AbortController();
let watchdog, close = () => {};
function stop(code, message) {
  controller.abort();
  try { close(); } catch { /* Fixed diagnostics only. */ }
  writeSync(2, message + '\n'); process.exit(code);
}
function arm(milliseconds) {
  clearTimeout(watchdog);
  const left = milliseconds - (performance.now() - started);
  if (left <= 0) stop(124, 'local_capture_deadline');
  watchdog = setTimeout(() => stop(124, 'local_capture_deadline'), left);
}
arm(150000);
process.once('SIGTERM', () => stop(143, 'local_capture_terminated'));
process.once('SIGINT', () => stop(130, 'local_capture_terminated'));
try {
  const { readConfiguration, requestForTarget, preflight } = await import('./configuration.mjs');
  const config = await readConfiguration(process.argv.slice(2)); arm(config.timeouts.processMs);
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.byteLength;
    if (size > 65536) throw new Error();
    chunks.push(chunk);
  }
  const text = new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(chunks));
  const request = requestForTarget(JSON.parse(text), config);
  const { captureLocal } = await import('./capture.mjs');
  // Load the runtime before the final read-only check, not in the gap between
  // that check and its synchronous writable open. This is not a filesystem lock.
  await preflight(config);
  const remaining = Math.floor(config.timeouts.processMs - (performance.now() - started));
  if (remaining < 1) stop(124, 'local_capture_deadline');
  const reply = await captureLocal(config, request, { signal: controller.signal,
    captureMs: Math.min(config.timeouts.captureMs, remaining), onClose: value => { close = value; } });
  if (Buffer.byteLength(JSON.stringify(reply.body)) > 65536) throw new Error();
  const output = JSON.stringify(reply) + '\n';
  if (Buffer.byteLength(output) > 262144) throw new Error();
  await new Promise((resolve, reject) => process.stdout.write(output, error => error ? reject(error) : resolve()));
  clearTimeout(watchdog);
} catch {
  controller.abort();
  try { close(); } catch { /* Fixed diagnostics only. */ }
  clearTimeout(watchdog); writeSync(2, 'local_capture_failed\n'); process.exitCode = 1;
}

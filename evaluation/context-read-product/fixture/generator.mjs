import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

// Entropy/time overrides are confined to a separate process, never the caller.
// Destination must be a nonexistent file in a caller-owned private directory.
export async function generateWorld({ path, world = 'W1', schema = 23, seed, inMemory = false, onProgress = () => {} }) {
  const outputPath = path + '.fixture.json', progressPath = path + '.progress';
  if (existsSync(outputPath) || existsSync(progressPath)) throw Error('fixture scratch outputs already exist');
  const child = spawn(process.execPath, [fileURLToPath(new URL('world-worker.mjs', import.meta.url)),
    JSON.stringify({ path, world, schema, seed, inMemory, outputPath, progressPath })], { stdio: ['ignore', 'ignore', 'inherit'] });
  let seen = 0;
  const monitor = setInterval(() => {
    if (!existsSync(progressPath)) return;
    const text = readFileSync(progressPath, 'utf8');
    if (text.length > seen) { onProgress(text.slice(seen)); seen = text.length; }
  }, 1000);
  let timedOut = false, escalation;
  const timer = setTimeout(() => {
    timedOut = true; child.kill('SIGTERM');
    escalation = setTimeout(() => child.kill('SIGKILL'), 5000);
  }, 600000);
  try {
    const { code, signal } = await new Promise((resolve, reject) => {
      child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
    });
    if (code !== 0 || timedOut) throw Error(`fixture worker exit code=${code} signal=${signal} timeout=${timedOut}`);
    return JSON.parse(readFileSync(outputPath, 'utf8'));
  } finally { clearTimeout(timer); clearTimeout(escalation); clearInterval(monitor); }
}

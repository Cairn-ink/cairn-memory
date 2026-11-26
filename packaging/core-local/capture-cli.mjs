#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'node:url';
import { clearTimeout, setTimeout } from 'node:timers';
import { Buffer } from 'node:buffer';
import { absolute } from './capture-input.mjs';
import { runBoundCapture } from './capture-hook.mjs';

async function readHookInput(stream, signal) {
  let size = 0;
  const chunks = [];
  const close = () => stream.destroy();
  const timer = setTimeout(close, 1000);
  signal.addEventListener('abort', close, { once: true });
  try {
    for await (const chunk of stream) {
      size += chunk.byteLength;
      if (size > 8388608) throw new Error('event_refused');
      chunks.push(chunk);
    }
    signal.throwIfAborted();
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', close);
  }
}

async function hook(args, stdin) {
  if (args.length !== 5 || args[0] !== 'hook' || args[1] !== '--installation' ||
      !absolute(args[2]) || args[3] !== '--event') return;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const signal of signals) process.once(signal, cancel);
  const timer = setTimeout(cancel, 158000);
  timer.unref();
  try {
    const payload = await readHookInput(stdin, controller.signal);
    await runBoundCapture({ directory: args[2], event: args[4], payload, executable: fileURLToPath(import.meta.url),
      headless: /^sdk-/u.test(process.env.CLAUDE_CODE_ENTRYPOINT ?? '') }, controller.signal);
  } catch { /* A native hook supplies no stdout or diagnostic text on refusal. */ }
  finally {
    clearTimeout(timer);
    for (const signal of signals) process.removeListener(signal, cancel);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await hook(process.argv.slice(2), process.stdin);
}

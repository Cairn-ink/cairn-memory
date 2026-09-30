#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { captureEvent } from "../lib/capture-event.mjs";
import { normalizeEndpoint } from "../lib/config.mjs";
import { resolveClient, parsePairingRecord } from "../lib/pairing.mjs";
import { readControlState } from "../lib/control-state.mjs";

let dataDir;
let workerEnv;
const token = process.env.CLAUDE_PLUGIN_OPTION_API_TOKEN ?? "";

if (!token) process.exit(0);
try {
  normalizeEndpoint(
    process.env.CLAUDE_PLUGIN_OPTION_API_ENDPOINT ?? "https://cairn.ink",
  );
} catch {
  process.exit(0);
}
try {
  const { pairingRecord, rest } = parsePairingRecord(process.argv.slice(2));
  if (rest.length) throw new Error("unexpected_arguments");
  const binding = await resolveClient({ client: "claude", pairingRecord });
  if (!binding.enabled) process.exit(0);
  dataDir = binding.root;
  workerEnv = binding.workerEnv;
  if (pairingRecord) workerEnv.CLAUDE_PLUGIN_OPTION_PAIRING_RECORD = pairingRecord;
} catch { process.exit(0); }
const control = await readControlState(dataDir);
if (control.paused) process.exit(0);

let input = "";
for await (const chunk of process.stdin) input += chunk;
let event;
try {
  event = captureEvent(JSON.parse(input));
} catch {
  process.exit(0);
}
if (!event) process.exit(0);
const payload = JSON.stringify({
  ...event,
  capture_generation: control.generation,
});

try {
  const worker = spawn(
    process.execPath,
    [fileURLToPath(new URL("./hook.mjs", import.meta.url)), "capture-detached"],
    {
      detached: true,
      env: workerEnv,
      stdio: ["pipe", "ignore", "ignore"],
      windowsHide: true,
    },
  );
  await new Promise((resolve) => {
    const finish = () => resolve();
    worker.once("error", finish);
    worker.stdin.once("error", finish);
    worker.stdin.end(payload, finish);
  });
  worker.unref();
} catch {
  // Capture is fail-open. A launcher failure must never block Claude.
}

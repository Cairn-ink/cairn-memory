#!/usr/bin/env node

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureEvent } from "../lib/capture-event.mjs";
import { normalizeEndpoint } from "../lib/config.mjs";

const dataDir =
  process.env.CLAUDE_PLUGIN_DATA ?? join(homedir() || tmpdir(), ".cairn-memory");
const token = process.env.CLAUDE_PLUGIN_OPTION_API_TOKEN ?? "";

if (!token) process.exit(0);
try {
  normalizeEndpoint(
    process.env.CLAUDE_PLUGIN_OPTION_API_ENDPOINT ?? "https://cairn.ink",
  );
} catch {
  process.exit(0);
}
if (await stat(join(dataDir, "paused")).then(() => true).catch(() => false)) {
  process.exit(0);
}

let input = "";
for await (const chunk of process.stdin) input += chunk;
let event;
try {
  event = captureEvent(JSON.parse(input));
} catch {
  process.exit(0);
}
if (!event) process.exit(0);
const payload = JSON.stringify(event);

try {
  const worker = spawn(
    process.execPath,
    [fileURLToPath(new URL("./hook.mjs", import.meta.url)), "capture-detached"],
    {
      detached: true,
      env: process.env,
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

#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const files = [
  ".claude-plugin/marketplace.json",
  "package.json",
  "plugins/cairn-memory/.claude-plugin/plugin.json",
  "plugins/cairn-memory/.mcp.json",
  "plugins/cairn-memory/hooks/hooks.json",
  "schemas/capture-request.schema.json",
  "schemas/capture-response.schema.json",
  "schemas/recall-request.schema.json",
  "schemas/recall-response.schema.json",
  "schemas/telemetry-request.schema.json"
];

for (const file of files) {
  JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), "utf8"));
  process.stdout.write(`valid JSON: ${file}\n`);
}

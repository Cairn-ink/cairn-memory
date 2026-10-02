#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { VERSION } from "../plugins/cairn-memory/lib/version.mjs";

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

const documents = new Map();
for (const file of files) {
  const document = JSON.parse(
    await readFile(new URL(`../${file}`, import.meta.url), "utf8"),
  );
  documents.set(file, document);
  process.stdout.write(`valid JSON: ${file}\n`);
}

const versions = new Map([
  ["package", documents.get("package.json").version],
  ["marketplace", documents.get(".claude-plugin/marketplace.json").version],
  ["marketplace plugin", documents.get(".claude-plugin/marketplace.json").plugins[0].version],
  ["plugin", documents.get("plugins/cairn-memory/.claude-plugin/plugin.json").version],
  ["runtime", VERSION],
]);

for (const [location, version] of versions) {
  if (version !== VERSION) {
    throw new Error(`version mismatch: ${location} has ${version}; expected ${VERSION}`);
  }
}
process.stdout.write(`consistent version: ${VERSION}\n`);

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

function engineMerge(existing, value) {
  let changed = false;
  // Engine core/runtime.mjs:306–314. Fixtures hold review state at "none" and have no receipts.
  const explicit = value.origin === "explicit";
  const reviewState = explicit && existing.review_state === 'awaiting' ? 'none' : existing.review_state;
  const kind = explicit ? value.kind : existing.kind;
  const origin = explicit ? "explicit" : existing.origin;
  const confidence = !explicit && existing.origin === "explicit"
    ? existing.confidence : Math.max(existing.confidence, value.confidence);
  if (reviewState !== existing.review_state || kind !== existing.kind || origin !== existing.origin || confidence !== existing.confidence) {
    changed = true;
  }
  return { kind, origin, confidence, changed };
}

export function verifyEngineSource(engineDir) {
  const source = readFileSync(join(engineDir, "core/runtime.mjs"), "utf8").split("\n");
  const copied = engineMerge.toString().split("\n");
  const start = copied.findIndex(line => line.startsWith("  const explicit = "));
  assert.notEqual(start, -1);
  // The engine indents the copied block four spaces deeper.
  assert.deepEqual(source.slice(305, 314),
    copied.slice(start, start + 9).map(line => `    ${line}`), "engine core/runtime.mjs:306–314 changed");
}

export function generateCases() {
  const origins = ["explicit", "inferred"];
  const cases = [];
  for (const incomingOrigin of origins) {
    for (const existingOrigin of origins) {
      for (const [confidenceOrder, confidence] of [["higher", 0.8], ["lower", 0.2], ["equal", 0.5]]) {
        for (const kind of ["fact", "preference"]) {
          const existing = { kind: "fact", origin: existingOrigin, confidence: 0.5 };
          const incoming = { kind, origin: incomingOrigin, confidence };
          const { changed, ...merged } = engineMerge({ ...existing, review_state: "none" }, incoming);
          const name = `${incomingOrigin} into ${existingOrigin}, ${confidenceOrder} confidence, ${kind === existing.kind ? "same" : "different"} kind`;
          cases.push({ name, existing, incoming, expected: { merged, changed } });
        }
      }
    }
  }
  return cases;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const engineDir = process.env.ENGINE_DIR;
  assert.ok(engineDir, "Set ENGINE_DIR to the read-only engine source extract");
  verifyEngineSource(engineDir);
  const output = new URL("../../packages/core/test/fixtures/memory-policy/duplicate-merge.json", import.meta.url);
  writeFileSync(output, `[\n${generateCases().map(row => `  ${JSON.stringify(row)}`).join(",\n")}\n]\n`);
}

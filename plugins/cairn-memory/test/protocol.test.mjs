import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function schema(name) {
  const url = new URL(`../../../schemas/${name}.schema.json`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

test("capture schema is a strict conversation-text allowlist", async () => {
  const capture = await schema("capture-request");
  assert.equal(capture.additionalProperties, false);
  assert.deepEqual(capture.required, ["client", "event_id", "session_id", "messages"]);
  assert.equal(capture.properties.messages.maxItems, 24);
  assert.equal(capture.properties.messages.items.additionalProperties, false);
  assert.deepEqual(
    Object.keys(capture.properties.messages.items.properties).sort(),
    ["content", "id", "role"],
  );
});

test("telemetry schema cannot accept content or identity metadata", async () => {
  const telemetry = await schema("telemetry-request");
  assert.equal(telemetry.additionalProperties, false);
  assert.deepEqual(Object.keys(telemetry.properties).sort(), [
    "client",
    "event",
    "install_id",
    "platform",
    "version",
  ]);
});

test("recall requires provenance on every memory", async () => {
  const recall = await schema("recall-response");
  const memory = recall.$defs.memory;
  assert.equal(memory.additionalProperties, false);
  assert.ok(memory.required.includes("origin"));
  assert.ok(memory.required.includes("confidence"));
  assert.ok(memory.required.includes("receipts"));
  assert.equal(memory.properties.receipts.minItems, 1);
});

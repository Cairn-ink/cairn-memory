import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fixture, readSet } from "./helpers/context-read-compact.mjs";

const golden = JSON.parse(readFileSync(new URL("./fixtures/context-read-compact-parity.json", import.meta.url), "utf8"));

test("compact wire items match the engine fixture in date order", async () => {
  const { service, refs, read } = fixture(golden.corpus);
  const ranked = await service.findCandidates(readSet, {
    query: golden.input.query, types: golden.input.types, intent: golden.input.intent, semantic: false,
  });
  assert.equal(ranked.items[0].ref.id, refs[0].id, "The latest date ranks first before packing");
  const { assembly } = await read({ deadlineMs: 5000, ...golden.input });
  assert.equal(JSON.stringify(assembly.items), JSON.stringify(golden.items));
});

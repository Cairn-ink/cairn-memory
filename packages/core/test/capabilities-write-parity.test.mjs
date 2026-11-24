import assert from "node:assert/strict";
import { test } from "node:test";
import { capabilities, CoreError, requireCapability } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { serviceFake } from "./helpers/service-fake.mjs";

const invalidInput = { name: CoreError.name, code: "invalid_input" };
const proceduralTags = { write() {}, clear() {}, read() {} };
const parityFlags = { proceduralTags: true, receiptAttachAdvancesRevision: true };

test("service accepts both write-parity flags with the procedural tags port", () => {
  const { deps, storage } = serviceFake();
  const service = createMemoryService({
    ...deps,
    storage: { ...storage, capabilities: { ...storage.capabilities, ...parityFlags }, proceduralTags },
  });
  assert.equal(typeof service.save, "function");
});

test("unknown capability names are refused during registration and lookup", () => {
  const { deps, storage } = serviceFake();
  const flags = { ...storage.capabilities, unknownCapability: true };
  assert.throws(() => createMemoryService({ ...deps, storage: { ...storage, capabilities: flags } }), invalidInput);
  assert.throws(() => capabilities(flags), invalidInput);
  assert.throws(() => requireCapability(flags, "unknownCapability"), invalidInput);
});

test("service refuses non-boolean write-parity flags", () => {
  const { deps, storage } = serviceFake();
  for (const name of Object.keys(parityFlags)) {
    const flags = { ...storage.capabilities, ...parityFlags, [name]: "true" };
    assert.throws(() => createMemoryService({
      ...deps,
      storage: { ...storage, capabilities: flags, proceduralTags },
    }), invalidInput, name);
  }
});

test("procedural tags require a port with write, clear, and read methods", () => {
  const { deps, storage } = serviceFake();
  const flags = { ...storage.capabilities, proceduralTags: true };
  for (const incomplete of [undefined, { ...proceduralTags, write: undefined },
    { ...proceduralTags, clear: undefined }, { ...proceduralTags, read: undefined }]) {
    assert.throws(() => createMemoryService({
      ...deps,
      storage: { ...storage, capabilities: flags, proceduralTags: incomplete },
    }), invalidInput);
  }
});

test("capabilities preserves supplied write-parity flags and omits absent ones", () => {
  for (const name of Object.keys(parityFlags)) {
    assert.equal(Object.hasOwn(capabilities({}), name), false);
    const enabled = capabilities(parityFlags);
    assert.equal(enabled[name], true);
    requireCapability(enabled, name);
    const disabled = capabilities({ [name]: false });
    assert.equal(disabled[name], false);
    assert.throws(() => requireCapability(disabled, name), { code: "capability_unavailable" });
  }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { FINISH_BINDING_CASES, runCase } from "@cairn-ink/conformance";
import { rawFactory } from "./fixtures/raw.mjs";

for (const sessionRefs of ["plain", "hashed"]) {
  for (const required of [false, true]) {
    const factory = rawFactory({ sessionRefs, required });
    for (const testCase of FINISH_BINDING_CASES) {
      test(`${factory.name} ${testCase.id} ${testCase.title}`, async () => {
        assert.equal(await runCase(factory, testCase), null);
      });
    }
  }
}

const mutants = [
  {
    id: "K-FIN-BIND-1", name: "disables binding",
    before: "for (const { receipts } of batch)",
    after: "for (const { receipts } of [])",
    message: "Finish must reject a receipt outside the asserted selection",
  },
  {
    id: "K-FIN-BIND-2", name: "reuses assertions across transactions",
    before: "const selections = new WeakMap();",
    after: "const byClaim = new Map(); const selections = { get: () => byClaim };",
    message: "Finish must reject a receipt asserted only in an earlier transaction",
  },
  {
    id: "K-FIN-BIND-3", name: "keeps the first selection",
    before: "byClaim.set(identity, selected);",
    after: "if (!byClaim.has(identity)) byClaim.set(identity, selected);",
    message: "Finish must reject a receipt excluded by the latest assertion",
  },
  {
    id: "K-FIN-BIND-4", name: "ignores the receipt client and session",
    before: "receipt.client !== client || receipt.sessionId !== sessionId ||",
    after: "",
    message: "Finish must reject a receipt with another client",
  },
];

async function loadMutant(id, before, after) {
  const adapter = new URL("../src/index.mjs", import.meta.url);
  const capture = new URL("./capture.mjs", adapter);
  adapter.searchParams.set("variant", id);
  capture.searchParams.set("variant", id);
  const original = readFileSync(capture, "utf8");
  assert.equal(original.split(before).length - 1, 1, "Expected one mutation site");
  const source = original.replace(before, () => after);
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL === adapter.href && specifier === "./capture.mjs") return nextResolve(capture.href, context);
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url === capture.href) return { format: "module", shortCircuit: true, source };
      return nextLoad(url, context);
    },
  });
  try {
    return (await import(adapter.href)).createMemoryAdapter;
  } finally {
    hooks.deregister();
  }
}

for (const { id, name, before, after, message } of mutants) {
  test(`${id} detects a finish that ${name}`, async () => {
    const testCase = FINISH_BINDING_CASES.find(testCase => testCase.id === id);
    assert.ok(testCase, `Missing case ${id}`);
    const create = await loadMutant(id, before, after);
    await assert.rejects(runCase(rawFactory({ create }), testCase), { message });
  });
}

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

test("the adapter entry imports with dev-only packages unavailable", async () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const devOnly = Object.keys(manifest.devDependencies).filter(name => !manifest.dependencies?.[name]);
  const hook = registerHooks({
    resolve(specifier, context, next) {
      if (devOnly.some(name => specifier === name || specifier.startsWith(name + "/"))) {
        throw Object.assign(new Error(`Unavailable runtime dependency: ${specifier}`), { code: "ERR_MODULE_NOT_FOUND" });
      }
      return next(specifier, context);
    },
  });
  try {
    const entry = await import("../src/index.mjs");
    assert.equal(typeof entry.createPostgresUnitOfWork, "function");
    assert.equal(typeof entry.createPostgresQuantityLedgerStore, "function");
  } finally {
    hook.deregister();
  }
});

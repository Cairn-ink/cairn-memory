import { test } from "node:test";
import { scenarios } from "../../core/test/helpers/service-explicit-window.mjs";
import { openSqliteAdapter } from "../src/adapter.mjs";
import { scratch } from "./storage-fixtures.mjs";

for (const fingerprintKey of [false, true]) {
  const mode = fingerprintKey ? "keyed" : "keyless";
  for (const [name, scenario] of Object.entries(scenarios)) {
    test(`SQLite ${mode} ${name}`, async t => {
      const { path, remove } = scratch();
      let adapter;
      t.after(async () => {
        try { await adapter?.close(); }
        finally { remove(); }
      });
      adapter = await openSqliteAdapter(path, { capabilities: { contextRead: true, contextRawRead: true } });
      // Supply a test key through the host-facing port. SQLite's shipped key provider is keyless.
      if (fingerprintKey) {
        const signingKey = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
        adapter = { ...adapter, capabilities: { ...adapter.capabilities, fingerprintKey },
          keys: { async userKey() { return { id: "fixture-key", signingKey }; } } };
      }
      await scenario(t, adapter);
    });
  }
}

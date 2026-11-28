import assert from "node:assert/strict";
import test from "node:test";
import { openSqliteAdapter } from "../src/index.mjs";
import { scratch } from "./storage-fixtures.mjs";

for (const projection of [undefined, "hosted"]) {
  test(`SQLite members rejects an expired transaction before reading ${projection ?? "default"} options`, async t => {
    const { path, remove } = scratch();
    const adapter = await openSqliteAdapter(path, { capabilities: { placement: true } }).catch(error => {
      remove();
      throw error;
    });
    t.after(async () => {
      try { await adapter.close(); }
      finally { remove(); }
    });
    const scope = { owner: "owner", namespace: null };
    const tx = await adapter.uow.run(scope.owner, { readOnly: true }, live => live);
    let optionReads = 0;
    const options = new Proxy({ cursor: null, limit: 1, ...(projection && { projection }) }, {
      get(_target, key) {
        optionReads++;
        throw new Error(`Read expired transaction's options property ${String(key)}`);
      },
    });
    await assert.rejects(adapter.placement.members(tx, scope, "topic", options), { code: "internal_error" });
    assert.equal(optionReads, 0);
  });
}

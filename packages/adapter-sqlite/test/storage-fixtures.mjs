import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { factIncarnationBody } from "@cairn-ink/core";
import { createSqliteAdapter } from "../src/adapter.mjs";
import { openStorage } from "../src/schema/open.mjs";
import { scopeKey } from "../src/storage-values.mjs";

export function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "cairn-sqlite-storage-"));
  return { path: join(dir, "store.sqlite"), remove: () => rmSync(dir, { recursive: true, force: true }) };
}

export async function fixture() {
  const { path, remove } = scratch();
  try {
    const storage = await openStorage(path);
    const adapter = createSqliteAdapter(storage);
    return {
      adapter, path, port: storage.port,
      close: async () => {
        try {
          await adapter.close();
        } finally {
          remove();
        }
      },
    };
  } catch (error) {
    remove();
    throw error;
  }
}

export function testAccess({ adapter, port }, scope, options, body) {
  return adapter.uow.run(scope.owner, { readOnly: !options.write }, tx => port(tx, scope.owner, options, body));
}

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function seedFact(adapter, fact) {
  const incarnation = sha256(factIncarnationBody(fact));
  return adapter.uow.run(fact.owner, {}, tx => adapter.suppressions.writeFact(tx, fact, incarnation));
}

export function setWriteTime(fixture, scope, id, time) {
  return testAccess(fixture, scope, { write: true }, db => {
    assert.equal(db.prepare(`UPDATE cairn_memories SET updated_at_us = ?
      WHERE owner_id = ? AND namespace_key = ? AND id = ? AND deleted = 0`)
      .run(time, ...scopeKey(scope), id).changes, 1);
  });
}

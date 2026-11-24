import assert from "node:assert/strict";
import test from "node:test";
import { openSqliteUnitOfWork } from "@cairn-ink/adapter-sqlite";
import { migrateLegacyStore } from "../src/migrate/index.mjs";
import { fixture, scratch } from "./legacy/fixtures.mjs";
import { createLegacyBackup, prepareInput } from "./migration-fixtures.mjs";

test("the public SQLite opener exposes only the unit of work, port and close", async t => {
  const directory = scratch(t);
  const input = prepareInput(directory, await fixture(directory, 29));
  await createLegacyBackup(input);
  await migrateLegacyStore(input);

  const storage = openSqliteUnitOfWork(input.destination);
  try {
    assert.equal("preserveArrivalRefusal" in storage, false);
    assert.equal(Object.getPrototypeOf(storage), Object.prototype);
    assert.deepEqual(Reflect.ownKeys(storage).sort(), ["close", "port", "uow"]);
    assert.equal(Object.getPrototypeOf(storage.uow), Object.prototype);
    assert.deepEqual(Reflect.ownKeys(storage.uow), ["run"]);
  } finally {
    await storage.close();
  }
});

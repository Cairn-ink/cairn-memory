import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openSqliteUnitOfWork } from "@cairn-ink/adapter-sqlite";

test("the SQLite unit of work refuses reserved filenames before and after resolution", t => {
  const directory = mkdtempSync(join(tmpdir(), "sqlite-reserved-filename-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const target = join(directory, ".cairn-cutover-attempt.sqlite");
  const stale = target + ".stale";
  const alias = join(directory, "alias.sqlite");
  const refused = { code: "storage_error" };

  assert.throws(() => openSqliteUnitOfWork(stale), refused);
  assert.throws(() => openSqliteUnitOfWork(target), refused);
  writeFileSync(target, "");
  assert.throws(() => openSqliteUnitOfWork(target), refused);
  symlinkSync(target, alias);
  assert.throws(() => openSqliteUnitOfWork(alias), refused);
  assert.throws(() => openSqliteUnitOfWork(join(directory, "missing.sqlite")), { code: "internal_error" });
});

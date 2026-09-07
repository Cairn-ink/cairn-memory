import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, link, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { withFileLock } from "../lib/file-lock.mjs";

test("a live lock is never reclaimed based only on age", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-live-lock-test-"));
  const lock = join(dir, "capture.lock");
  const token = randomUUID();
  const ownerPath = `${lock}.owner-${process.pid}-${token}`;
  await writeFile(ownerPath, JSON.stringify({ pid: process.pid, token }));
  await link(ownerPath, lock);
  const old = new Date(Date.now() - 3_600_000);
  await utimes(lock, old, old);

  let entered = false;
  const acquired = await withFileLock(
    lock,
    () => {
      entered = true;
    },
    { timeoutMs: 60, pollMs: 10 },
  );
  assert.equal(acquired, false);
  assert.equal(entered, false);
  await access(lock);
});

test("a definitively dead owner is recovered without unlinking its successor", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-dead-lock-test-"));
  const lock = join(dir, "capture.lock");
  const deadPid = 2_147_483_647;
  const token = randomUUID();
  const ownerPath = `${lock}.owner-${deadPid}-${token}`;
  await writeFile(ownerPath, JSON.stringify({ pid: deadPid, token }));
  await link(ownerPath, lock);

  let firstEntered = false;
  assert.equal(
    await withFileLock(lock, () => {
      firstEntered = true;
    }, { timeoutMs: 500, pollMs: 10 }),
    true,
  );
  assert.equal(firstEntered, true);

  let successorEntered = false;
  assert.equal(
    await withFileLock(lock, () => {
      successorEntered = true;
    }, { timeoutMs: 500, pollMs: 10 }),
    true,
  );
  assert.equal(successorEntered, true);
  await assert.rejects(access(lock));
});

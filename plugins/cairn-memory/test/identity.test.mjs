import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { installId, opaqueProjectId } from "../lib/identity.mjs";

const identityUrl = new URL("../lib/identity.mjs", import.meta.url).href;

function childIdentity(dir, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e",
      `import { opaqueProjectId } from ${JSON.stringify(identityUrl)};
       process.stdout.write(await opaqueProjectId(process.argv[1], process.argv[2]));`,
      dir, cwd], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    child.stdout.on("data", chunk => output += chunk);
    child.stderr.on("data", chunk => errors += chunk);
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(output) : reject(new Error(errors)));
  });
}

test("concurrent first use retains one project identity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-key-race-"));
  const ids = await Promise.all(Array.from({ length: 32 }, () => opaqueProjectId(dir, "/project/a")));
  assert.equal(new Set(ids).size, 1);
  assert.equal(await childIdentity(dir, "/project/a"), ids[0]);
  assert.notEqual(await opaqueProjectId(dir, "/project/b"), ids[0]);
});

test("separate processes initialize the same persistent key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-key-processes-"));
  const ids = await Promise.all(Array.from({ length: 16 }, () => childIdentity(dir, "/project/a")));
  assert.equal(new Set(ids).size, 1);
  assert.equal(await opaqueProjectId(dir, "/project/a"), ids[0]);
  assert.deepEqual(await readdir(dir), ["project-key"]);
  if (process.platform !== "win32") assert.equal((await stat(join(dir, "project-key"))).mode & 0o777, 0o600);
});

test("telemetry identity is also atomic and separate from project key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-install-race-"));
  const ids = await Promise.all(Array.from({ length: 32 }, () => installId(dir)));
  assert.equal(new Set(ids).size, 1);
  await opaqueProjectId(dir, "/project/a");
  assert.notEqual((await readFile(join(dir, "project-key"), "utf8")).trim(), ids[0]);
});

test("invalid persisted keys fail closed without replacing the identity", async () => {
  for (const value of ["", "truncated-key"]) {
    const dir = await mkdtemp(join(tmpdir(), "cairn-key-invalid-"));
    await writeFile(join(dir, "project-key"), value);
    await assert.rejects(opaqueProjectId(dir, "/project/a"));
    assert.equal(await readFile(join(dir, "project-key"), "utf8"), value);
  }
});

test("unavailable state storage never returns a transient identity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-key-storage-"));
  const unavailable = join(dir, "not-a-directory");
  await writeFile(unavailable, "occupied");
  await assert.rejects(opaqueProjectId(unavailable, "/project/a"));
  await assert.rejects(installId(unavailable));
  assert.equal(await readFile(unavailable, "utf8"), "occupied");
});

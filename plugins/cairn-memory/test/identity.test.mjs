import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { installId, opaqueProjectId } from "../lib/identity.mjs";
import { deferred } from "../../../integrations/client/testing/deferred.mjs";

const identityUrl = new URL("../lib/identity.mjs", import.meta.url).href;

function startChildIdentity(dir, cwd) {
  const ready = deferred();
  let child;
  const completed = new Promise((resolve, reject) => {
    child = spawn(process.execPath, ["--input-type=module", "-e",
      `import { opaqueProjectId } from ${JSON.stringify(identityUrl)};
       const released = new Promise(resolve => process.stdin.once('end', resolve));
       process.stdin.resume();
       const options = { home: process.argv[1] };
       console.log(await opaqueProjectId(process.argv[1], process.argv[2], options));
       await released;`,
      dir, cwd], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    child.stdout.on("data", chunk => {
      output += chunk;
      if (output.includes("\n")) ready.resolve(output.trim());
    });
    child.stderr.on("data", chunk => errors += chunk);
    child.stdin.on("error", error => { ready.reject(error); reject(error); });
    child.on("error", error => { ready.reject(error); reject(error); });
    child.on("close", code => {
      if (code === 0) { ready.resolve(output.trim()); resolve(); }
      else { const error = new Error(errors); ready.reject(error); reject(error); }
    });
  });
  // Observe failures immediately even while the caller waits for the ID wave.
  completed.catch(() => {});
  return { id: ready.promise, completed, release: () => child.stdin.end() };
}

async function releaseChildren(children) {
  for (const child of children) child.release();
  const results = await Promise.allSettled(children.map(child => child.completed));
  for (const result of results) if (result.status === "rejected") throw result.reason;
}

async function childIdentity(dir, cwd) {
  const child = startChildIdentity(dir, cwd);
  try { return await child.id; }
  finally { await releaseChildren([child]); }
}

test("concurrent first use retains one project identity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-key-race-"));
  const ids = await Promise.all(Array.from({ length: 32 }, () =>
    opaqueProjectId(dir, "/project/a", { home: dir })));
  assert.equal(new Set(ids).size, 1);
  assert.equal(await childIdentity(dir, "/project/a"), ids[0]);
  assert.notEqual(await opaqueProjectId(dir, "/project/b", { home: dir }), ids[0]);
});

test("separate processes initialize the same persistent key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-key-processes-"));
  // Keep every owner alive until ALL identity operations have returned. Process
  // exit/reaping is separate from the atomic publication invariant tested here.
  const children = Array.from({ length: 16 }, () => startChildIdentity(dir, "/project/a"));
  let ids;
  try { ids = await Promise.all(children.map(child => child.id)); }
  finally { await releaseChildren(children); }
  assert.equal(new Set(ids).size, 1);
  assert.equal(await opaqueProjectId(dir, "/project/a", { home: dir }), ids[0]);
  assert.deepEqual((await readdir(dir)).sort(), ["created-by", "project-key"]);
  const key = (await readFile(join(dir, "project-key"), "utf8")).trim();
  assert.deepEqual(JSON.parse(await readFile(join(dir, "created-by"), "utf8")), {
    version: 1,
    client: "claude",
    fingerprint: createHmac("sha256", key).update("cairn-memory:binding:v1").digest("hex"),
  });
  if (process.platform !== "win32") assert.equal((await stat(join(dir, "project-key"))).mode & 0o777, 0o600);
});

test("telemetry identity is also atomic and separate from project key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-install-race-"));
  const ids = await Promise.all(Array.from({ length: 32 }, () => installId(dir)));
  assert.equal(new Set(ids).size, 1);
  await opaqueProjectId(dir, "/project/a", { home: dir });
  assert.notEqual((await readFile(join(dir, "project-key"), "utf8")).trim(), ids[0]);
});

test("invalid persisted keys fail closed without replacing the identity", async () => {
  for (const value of ["", "truncated-key"]) {
    const dir = await mkdtemp(join(tmpdir(), "cairn-key-invalid-"));
    await writeFile(join(dir, "project-key"), value);
    await assert.rejects(opaqueProjectId(dir, "/project/a", { home: dir }));
    assert.equal(await readFile(join(dir, "project-key"), "utf8"), value);
  }
});

test("unavailable state storage never returns a transient identity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-key-storage-"));
  const unavailable = join(dir, "not-a-directory");
  await writeFile(unavailable, "occupied");
  await assert.rejects(opaqueProjectId(unavailable, "/project/a", { home: dir }));
  await assert.rejects(installId(unavailable));
  assert.equal(await readFile(unavailable, "utf8"), "occupied");
});

import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestWorkspace } from "../../../tools/testing/workspace.mjs";

const guard = fileURLToPath(new URL("../../client/testing/home-guard.mjs", import.meta.url));
const runner = fileURLToPath(new URL("../../client/testing/run.mjs", import.meta.url));

// Every readlink form the guard must see: promise, sync and callback APIs, each
// with string and Buffer results, plus URL and options-object arguments.
const READS = {
  promise: "await promises.readlink(link)",
  promiseBuffer: "await promises.readlink(link, { encoding: 'buffer' })",
  promiseURL: "await promises.readlink(pathToFileURL(link))",
  sync: "fs.readlinkSync(link)",
  syncBuffer: "fs.readlinkSync(link, 'buffer')",
  callback: "await new Promise((ok, no) => fs.readlink(link, (e, v) => (e ? no(e) : ok(v))))",
  callbackBuffer:
    "await new Promise((ok, no) => fs.readlink(link, { encoding: 'buffer' }, (e, v) => (e ? no(e) : ok(v))))",
};

async function runningCodex(t, ws) {
  // A live process whose /proc/<pid>/exe basename is `codex`, like a real host.
  const directory = join(ws.path, "host");
  await mkdir(directory, { mode: 0o700 });
  const binary = join(directory, "codex");
  await copyFile(process.execPath, binary);
  await chmod(binary, 0o700);
  const child = spawn(binary, ["-e", "process.stdin.resume()"], {
    stdio: ["pipe", "ignore", "ignore"],
    env: { PATH: process.env.PATH },
  });
  const closed = new Promise((resolve) => child.once("close", resolve));
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  t.after(async () => {
    child.stdin.end();
    await closed;
  });
  return `/proc/${child.pid}/exe`;
}

test(
  "home guard fails every readlink form that observes a codex outside its scratch directory",
  { skip: process.platform !== "linux" && "host detection reads Linux /proc only" },
  async (t) => {
    const ws = createTestWorkspace(t, { prefix: "cx5-guard-readlink-" });
    const link = await runningCodex(t, ws);
    const outside = join(ws.path, "elsewhere");
    await mkdir(outside, { mode: 0o700 });
    for (const [name, read] of Object.entries(READS)) {
      const code = `import fs from "node:fs"; import promises from "node:fs/promises";
        import { pathToFileURL } from "node:url";
        const link = ${JSON.stringify(link)}; const value = ${read};
        console.log(JSON.stringify({ buffer: Buffer.isBuffer(value), value: String(value) }));`;
      const probe = (tmp) =>
        spawnSync(process.execPath, ["--import", guard, "--input-type=module", "-e", code], {
          env: {
            PATH: process.env.PATH,
            HOME: join(ws.path, "home"),
            CAIRN_TEST_REAL_HOME: join(ws.path, "forbidden"),
            TMPDIR: tmp,
          },
          encoding: "utf8",
        });
      const denied = probe(outside);
      assert.equal(denied.status, 1, name);
      assert.match(denied.stderr, /test_observed_real_codex_host/, name);
      assert.equal(denied.stdout, "", name);
      // The suite's own fake host stays observable, with the caller's result type.
      const allowed = probe(ws.path);
      assert.equal(allowed.status, 0, `${name}: ${allowed.stderr}`);
      assert.deepEqual(JSON.parse(allowed.stdout), {
        buffer: /Buffer/.test(name),
        value: join(ws.path, "host", "codex"),
      });
    }
  },
);

async function isolatedRun(t, options = {}) {
  const ws = createTestWorkspace(t, { prefix: "cx5-isolated-host-" });
  const tmp = join(ws.path, "tmp");
  await mkdir(tmp, { mode: 0o700 });
  const script = join(ws.path, "probe.mjs");
  await writeFile(
    script,
    `import { statSync } from "node:fs";
    const mode = (path) => statSync(path).mode & 0o777;
    console.log(JSON.stringify({ HOME: process.env.HOME, CODEX_HOME: process.env.CODEX_HOME,
      thread: process.env.CODEX_THREAD_ID ?? null, homeMode: mode(process.env.HOME),
      codexMode: mode(process.env.CODEX_HOME) }));`,
  );
  const result = spawnSync(process.execPath, [runner, "--isolated-host", "--script", script], {
    env: {
      PATH: process.env.PATH,
      HOME: join(ws.path, "outer-home"),
      CODEX_HOME: join(ws.path, "outer-home", ".codex"),
      CODEX_THREAD_ID: "outer-session",
      CAIRN_TEST_REAL_HOME: join(ws.path, "forbidden"),
      TMPDIR: tmp,
      ...options.env,
    },
    encoding: "utf8",
  });
  const leftovers = (await readdir(tmp)).filter((name) => name.startsWith("cairn-test-host-"));
  return { ws, tmp, result, leftovers };
}

test("--isolated-host gives the suite a private Codex home and removes it afterwards", async (t) => {
  const { tmp, result, leftovers } = await isolatedRun(t);
  assert.equal(result.status, 0, result.stderr);
  const seen = JSON.parse(result.stdout);
  assert.ok(seen.HOME.startsWith(join(tmp, "cairn-test-host-")), seen.HOME);
  assert.equal(seen.CODEX_HOME, join(seen.HOME, ".codex"));
  assert.equal(seen.thread, null);
  assert.equal(seen.homeMode, 0o700);
  assert.equal(seen.codexMode, 0o700);
  assert.deepEqual(leftovers, []);
});

test("--isolated-host removes its home when initialization fails after creating it", async (t) => {
  const ws = createTestWorkspace(t, { prefix: "cx5-isolated-fail-" });
  const preload = join(ws.path, "fail-codex-home.mjs");
  await writeFile(
    preload,
    `import promises from "node:fs/promises";
    import { syncBuiltinESMExports } from "node:module";
    const mkdir = promises.mkdir;
    promises.mkdir = function (path, ...args) {
      if (String(path).endsWith("/.codex")) return Promise.reject(new Error("injected_codex_home_failure"));
      return mkdir.call(this, path, ...args);
    };
    syncBuiltinESMExports();`,
  );
  const { result, leftovers } = await isolatedRun(t, { env: { NODE_OPTIONS: `--import=${preload}` } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /injected_codex_home_failure/);
  assert.equal(result.stdout, "");
  assert.deepEqual(leftovers, []);
});

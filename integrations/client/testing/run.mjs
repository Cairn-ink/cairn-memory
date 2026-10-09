// Add only the home guard; the existing runner owns execution and cleanup.
// --isolated-host also gives the suite a private HOME and CODEX_HOME and drops
// inherited Codex session variables: a suite launched from inside a Codex
// session must not see that host's home, config or environment.
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const guard = fileURLToPath(new URL("./home-guard.mjs", import.meta.url));
const runner = fileURLToPath(new URL("../../../tools/testing/run.mjs", import.meta.url));
const args = process.argv.slice(2);
const isolated = args[0] === "--isolated-host";
if (isolated) args.shift();
const env = {
  ...process.env,
  CAIRN_TEST_REAL_HOME: process.env.CAIRN_TEST_REAL_HOME ?? userInfo().homedir,
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${JSON.stringify(guard)}`,
};
let host;
const handlers = new Map();
try {
  if (isolated) {
    // Assigned before anything else can fail, so cleanup always sees it.
    host = await mkdtemp(join(tmpdir(), "cairn-test-host-"));
    await mkdir(join(host, ".codex"), { mode: 0o700 });
    for (const name of Object.keys(env)) if (name.startsWith("CODEX_")) delete env[name];
    // The guard still rejects resolving this home, exactly as it does the real one.
    Object.assign(env, { HOME: host, CODEX_HOME: join(host, ".codex"), CAIRN_TEST_HOST_HOME: host });
  }
  const child = spawn(process.execPath, [runner, ...args], { stdio: "inherit", env });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const handler = () => child.kill(signal);
    process.on(signal, handler);
    handlers.set(signal, handler);
  }
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
} finally {
  for (const [signal, handler] of handlers) process.off(signal, handler);
  if (host) await rm(host, { recursive: true, force: true });
}

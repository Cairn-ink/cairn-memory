// Committed suite entry: isolate HOME before loading any application/test code.
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestWorkspace } from "../../../tools/testing/workspace.mjs";

const workspace = createTestWorkspace(null, { prefix: "cairn-guarded-suite-" });
const home = join(workspace.path, "home");
const guard = fileURLToPath(new URL("./home-guard.mjs", import.meta.url));
const runner = fileURLToPath(new URL("../../../tools/testing/run.mjs", import.meta.url));
const violations = join(workspace.path, "home-violations");
await mkdir(home, { mode: 0o700 });
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  CAIRN_TEST_REAL_HOME: process.env.CAIRN_TEST_REAL_HOME ?? userInfo().homedir,
  CAIRN_TEST_GUARD_LOG: violations,
  CAIRN_TEST_NPM_CACHE: process.env.npm_config_cache ?? join(workspace.path, "npm-cache"),
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${JSON.stringify(guard)}`,
};
for (const name of [
  "CLAUDE_PLUGIN_DATA",
  "CLAUDE_PLUGIN_OPTION_PAIRING_RECORD",
  "CAIRN_MEMORY_STATE_DIR",
])
  delete env[name];
const child = spawn(process.execPath, [runner, ...process.argv.slice(2)], {
  env,
  stdio: "inherit",
});
const handlers = new Map(
  ["SIGINT", "SIGTERM", "SIGHUP"].map((signal) => {
    const handler = () => child.kill(signal);
    process.on(signal, handler);
    return [signal, handler];
  }),
);
try {
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
  try {
    if ((await readFile(violations, "utf8")).trim()) {
      console.error("home_guard_violation_in_suite");
      process.exitCode = 1;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
} finally {
  for (const [signal, handler] of handlers) process.off(signal, handler);
  // The inner runner has already stopped its test process group.
  await workspace.cleanup();
}

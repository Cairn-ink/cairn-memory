#!/usr/bin/env node
import { cp, mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
// No dependency installs: copy outside the checkout, then resolve the SDK against a supplied read-only tree.
const [mode = "test", suppliedTree] = process.argv.slice(2);
if (!suppliedTree || !["test", "validate", "build-check", "config-smoke"].includes(mode)) {
  process.stderr.write("Usage: node testing/run.mjs <test|validate|build-check|config-smoke> <offline-node-modules>\n");
  process.exit(2);
}
const tree = await realpath(resolve(suppliedTree));
const scratch = await mkdtemp(join(tmpdir(), "cairn-openclaw-"));
let rc = 1;
try {
  const root = join(scratch, "plugin");
  await cp(fileURLToPath(new URL("../", import.meta.url)), root, { recursive: true,
    filter: (path) => !path.split("/").includes("node_modules") });
  await symlink(tree, join(scratch, "node_modules"), "dir");
  const env = { PATH: dirname(process.execPath) + ":" + (process.env.PATH ?? ""),
    LANG: "C.UTF-8", TZ: "UTC", CI: "1", NO_COLOR: "1" };
  for (const key of ["HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME",
    "XDG_RUNTIME_DIR", "XDG_CONFIG_DIRS", "XDG_DATA_DIRS", "OPENCLAW_HOME", "OPENCLAW_STATE_DIR", "OPENCLAW_CONFIG_DIR", "OPENCLAW_CACHE_DIR", "TMPDIR"]) {
    env[key] = join(scratch, key.toLowerCase()); await mkdir(env[key], { mode: 0o700 });
  }
  env.OPENCLAW_CONFIG_PATH = join(env.OPENCLAW_CONFIG_DIR, "openclaw.json");
  const guard = join(root, "testing/loopback-only.mjs");
  const cli = join(tree, "openclaw/openclaw.mjs");
  const args = mode === "test" ? ["--import", guard, "--test", "--test-concurrency=1", "--test-timeout=60000", "test/runtime.test.mjs", "test/setup.test.mjs"] :
    mode === "config-smoke" ? ["--import", guard, "testing/config-smoke.mjs"] :
      ["--import", guard, cli, "plugins", mode === "validate" ? "validate" : "build", "--root", root,
        "--entry", "src/index.mjs", ...(mode === "validate" ? ["--json"] : ["--check"])];
  rc = await new Promise((resolveCode) => {
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: "inherit" });
    child.once("error", () => resolveCode(1)); child.once("exit", (code) => resolveCode(code ?? 1));
  });
  process.stdout.write(`OPENCLAW_${mode.toUpperCase().replaceAll("-", "_")}_RC=${rc}\n`);
} finally { await rm(scratch, { recursive: true, force: true }); }
process.exitCode = rc;

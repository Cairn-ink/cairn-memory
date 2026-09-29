// Test preload: forbid resolution of the operator's home and access to host state.
import os from "node:os";
import childProcess from "node:child_process";
import { basename } from "node:path";
import fs from "node:fs";
import promises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
const realHome = process.env.CAIRN_TEST_REAL_HOME;
if (!realHome) throw new Error("home_guard_requires_real_home_string");
const violationLog = process.env.CAIRN_TEST_GUARD_LOG;
const rawAppend = fs.appendFileSync;
function violation(message) {
  if (violationLog) rawAppend(violationLog, message + "\n");
  throw new Error(message);
}
const originalHome = os.homedir;
os.homedir = () => {
  const home = originalHome();
  if (home === realHome) violation("test_resolved_real_home");
  return home;
};
const originalUserInfo = os.userInfo;
os.userInfo = (...args) => {
  const info = originalUserInfo(...args);
  if (String(info.homedir) === realHome) violation("test_resolved_real_home");
  return info;
};
const protectedPaths = [".cairn-memory", ".cairn-memory-clients", ".claude", ".codex"].map((name) =>
  join(realHome, name),
);
function check(value) {
  if (value instanceof URL) value = fileURLToPath(value);
  if (typeof value !== "string" && !Buffer.isBuffer(value)) return;
  const path = resolve(String(value));
  if (protectedPaths.some((root) => path === root || path.startsWith(root + "/")))
    violation("test_accessed_real_state");
}
for (const api of [fs, promises]) {
  for (const name of [
    "open",
    "readFile",
    "writeFile",
    "appendFile",
    "stat",
    "lstat",
    "readdir",
    "opendir",
    "mkdir",
    "rm",
    "unlink",
    "access",
    "realpath",
    "chmod",
    "readlink",
    "rmdir",
    "mkdtemp",
    "createReadStream",
    "createWriteStream",
  ]) {
    for (const method of [name, `${name}Sync`]) {
      if (typeof api[method] !== "function") continue;
      const original = api[method];
      api[method] = function (path, ...args) {
        check(path);
        return original.call(this, path, ...args);
      };
    }
  }
}
for (const api of [fs, promises]) {
  for (const name of ["rename", "copyFile", "link", "symlink"]) {
    for (const method of [name, `${name}Sync`]) {
      if (typeof api[method] !== "function") continue;
      const original = api[method];
      api[method] = function (source, destination, ...args) {
        check(source);
        check(destination);
        return original.call(this, source, destination, ...args);
      };
    }
  }
}
syncBuiltinESMExports();

// Fixture helpers and artifact subprocesses sometimes deliberately strip env.
// Keep the guard and a synthetic HOME across those boundaries, without forwarding
// credentials or other application configuration. This file is test-only.
const guard = fileURLToPath(import.meta.url);
const home = process.env.HOME;
const cache = process.env.CAIRN_TEST_NPM_CACHE;
function guardedOptions(command, options = {}) {
  const name = basename(String(command));
  if (!["node", "node.exe", "npm", "npm.cmd"].includes(name)) return options;
  const supplied = options.env ?? process.env;
  const optionsText = supplied.NODE_OPTIONS ?? "";
  const env = {
    ...supplied,
    HOME: supplied.HOME ?? home,
    CAIRN_TEST_REAL_HOME: supplied.CAIRN_TEST_REAL_HOME ?? realHome,
    CAIRN_TEST_NPM_CACHE: cache,
    NODE_OPTIONS: optionsText.includes(guard)
      ? optionsText
      : `${optionsText} --import=${JSON.stringify(guard)}`,
  };
  if (!supplied.CAIRN_TEST_REAL_HOME || supplied.CAIRN_TEST_REAL_HOME === realHome) {
    env.CAIRN_TEST_GUARD_LOG = supplied.CAIRN_TEST_GUARD_LOG ?? violationLog;
  }
  if (name.startsWith("npm") && cache) env.npm_config_cache = cache;
  return { ...options, env };
}
for (const method of ["spawn", "spawnSync", "execFile", "execFileSync"]) {
  const original = childProcess[method];
  childProcess[method] = function (command, args, options, ...rest) {
    if (!Array.isArray(args)) {
      rest = options === undefined ? rest : [options, ...rest];
      options = args;
      args = [];
    }
    if (typeof options === "function") {
      rest.unshift(options);
      options = undefined;
    }
    return original.call(this, command, args, guardedOptions(command, options), ...rest);
  };
}
const originalFork = childProcess.fork;
childProcess.fork = function (modulePath, args, options) {
  if (!Array.isArray(args)) {
    options = args;
    args = [];
  }
  return originalFork.call(this, modulePath, args, guardedOptions(process.execPath, options));
};
syncBuiltinESMExports();

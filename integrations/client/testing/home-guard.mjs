// Test preload: forbid resolution of the operator's home and access to host state.
import os from "node:os";
import fs from "node:fs";
import promises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
const realHome = process.env.CAIRN_TEST_REAL_HOME;
if (!realHome) throw new Error("home_guard_requires_real_home_string");
let violated = false;
process.on("exit", () => {
  if (violated) process.exitCode = 1;
});
function violation(message) {
  violated = true;
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
const protectedPaths = [
  ".cairn-memory",
  ".cairn-memory-clients",
  ".cairn-memory-profile",
  ".claude",
  ".codex",
].map((name) => join(realHome, name));
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

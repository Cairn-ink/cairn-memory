// Add only the home guard; the existing runner owns execution and cleanup.
import { spawn } from "node:child_process";
import { userInfo } from "node:os";
import { fileURLToPath } from "node:url";

const guard = fileURLToPath(new URL("./home-guard.mjs", import.meta.url));
const runner = fileURLToPath(new URL("../../../tools/testing/run.mjs", import.meta.url));
const child = spawn(process.execPath, [runner, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...process.env,
    CAIRN_TEST_REAL_HOME: process.env.CAIRN_TEST_REAL_HOME ?? userInfo().homedir,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${JSON.stringify(guard)}`,
  },
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
} finally {
  for (const [signal, handler] of handlers) process.off(signal, handler);
}

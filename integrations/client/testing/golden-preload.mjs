// Synthetic deterministic source; never loaded by production.
import crypto from "node:crypto";
import os from "node:os";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
if (process.env.CAIRN_TEST_CONCURRENT !== "yes") {
  crypto.randomUUID = () => process.env.CAIRN_TEST_UUID ?? "11111111-1111-4111-8111-111111111111";
}
if (process.env.CAIRN_TEST_PLATFORM) {
  Object.defineProperty(process, "platform", { value: process.env.CAIRN_TEST_PLATFORM });
  os.platform = () => process.env.CAIRN_TEST_PLATFORM;
}
if (process.env.CAIRN_TEST_FOREIGN_UID === "yes") {
  const uid = process.getuid();
  process.getuid = () => uid + 1;
}
if (process.env.CAIRN_TEST_NO_GETUID === "yes") process.getuid = undefined;
if (process.env.CAIRN_TEST_FALSY_HOME === "yes") os.homedir = () => "";
syncBuiltinESMExports();
globalThis.fetch = async (url, options) => {
  appendFileSync(
    process.env.CAIRN_TEST_REQUESTS,
    JSON.stringify({ url, method: options.method, headers: options.headers, body: options.body }) +
      "\n",
  );
  return Response.json(
    url.endsWith("/recall") ? { memories: [] } : { duplicate: false, memoryCount: 1 },
  );
};

if (process.env.CAIRN_TEST_COMPLETIONS) {
  process.on("exit", () => {
    appendFileSync(process.env.CAIRN_TEST_COMPLETIONS, `${process.argv[2]}\n`);
  });
}

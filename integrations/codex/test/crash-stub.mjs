// Real process interruption at every durable helper publication, under real locks.
import { readFile } from "node:fs/promises";
import { writeSync } from "node:fs";
import { runWorker, prepareCapture, establishPauseBoundary, resetCapture } from "../worker.mjs";
import { withWriteObserver } from "../../client/private-state.mjs";
import { createRuntimeGuard } from "../../client/runtime-usage.mjs";
const config = JSON.parse(await readFile(process.argv[2], "utf8"));
const guard = createRuntimeGuard({
  root: config.binding.root,
  targetId: config.binding.targetId,
  mode: "api-key",
  dailyCap: 10000,
});
let active = false,
  writes = 0;
const transport = {
  terminated: () => !active,
  capture: async (body) => {
    active = true;
    try {
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return await response.json();
    } finally {
      active = false;
    }
  },
};
await withWriteObserver(
  async ({ path, kind }) => {
    writes++;
    writeSync(
      1,
      JSON.stringify({
        write: writes,
        kind,
        category: path.includes("/usage/") ? "usage" : "cursor",
      }) + "\n",
    );
    if (writes === config.crashAt) process.exit(87);
  },
  () =>
    config.reset
      ? resetCapture(config.binding, { hostsStopped: true, confirm: true })
      : config.boundary
        ? establishPauseBoundary(config.binding)
        : config.prepare
          ? prepareCapture(config.binding, { byteEnd: config.byteEnd })
          : runWorker(config.binding, { transport, guard, byteEnd: config.byteEnd }),
);
writeSync(1, JSON.stringify({ total: writes }) + "\n");

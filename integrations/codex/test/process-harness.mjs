import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { join } from "node:path";
export async function receiverServer(f) {
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw),
      existing = f.receiver.get(body.event_id);
    if (f.refuseFirst && !f.didRefuse) {
      f.didRefuse = true;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ status: "refused", code: "quota_reached" }));
      return;
    }
    if (existing) assert.deepEqual(body, existing);
    f.receiver.set(body.event_id, body);
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({ status: existing ? "duplicate" : "complete", eventId: body.event_id }),
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  f.ws.defer(() => new Promise((r) => server.close(r)));
  return `http://127.0.0.1:${server.address().port}/capture`;
}
export async function childAttempt(
  f,
  { crashAt = 0, prepare = false, boundary = false, reset = false, endpoint, byteEnd } = {},
) {
  endpoint ??= await receiverServer(f);
  const cfg = join(f.ws.path, "crash-config.json");
  await writeFile(
    cfg,
    JSON.stringify({ binding: f.binding, crashAt, prepare, boundary, reset, endpoint, byteEnd }),
    { mode: 0o600 },
  );
  const child = spawn(
    process.execPath,
    [new URL("./crash-stub.mjs", import.meta.url).pathname, cfg],
    { stdio: ["ignore", "pipe", "pipe"], env: process.env },
  );
  let raw = "",
    stderr = "";
  child.stdout.on("data", (x) => (raw += x));
  child.stderr.on("data", (x) => (stderr += x));
  const exit = await new Promise((r, j) => {
    child.once("error", j);
    child.once("close", r);
  });
  assert.ok([0, 87].includes(exit), stderr);
  assert.equal(stderr, "");
  const writes = raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse)
    .filter((x) => x.write);
  return { exit, writes };
}

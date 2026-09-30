// Test-only gated HTTP peer over owned temporary files; no TCP listener.
import { writeFile, rename, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
let sequence = 0;
globalThis.fetch = async (url, options) => {
  const id = `${process.pid}-${++sequence}`;
  const directory = process.env.CAIRN_TEST_HOSTED_PEER;
  const request = join(directory, `request-${id}.json`);
  await writeFile(request + ".tmp", JSON.stringify({ id, url, body: options.body }), { mode: 0o600 });
  await rename(request + ".tmp", request);
  for (;;) {
    if (options.signal?.aborted) throw options.signal.reason;
    try {
      const reply = JSON.parse(await readFile(join(directory, `reply-${id}.json`), "utf8"));
      await unlink(join(directory, `reply-${id}.json`));
      return Response.json(reply.body, { status: reply.status, headers: reply.headers });
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    await delay(10);
  }
};

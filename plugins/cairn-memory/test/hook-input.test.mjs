import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createTestWorkspace } from "../../../tools/testing/workspace.mjs";
import { readHookInput } from "../lib/hook-input.mjs";
import { opaqueProjectId } from "../lib/identity.mjs";

const workerOwner = fileURLToPath(new URL('./fixtures/input-worker-owner.mjs', import.meta.url));

const fields = {
  prompt: "請記住中文提示😀",
  cwd: "/synthetic/中文專案😀",
  transcript_path: "/synthetic/中文對話😀.jsonl",
};

async function* chunks(parts) {
  yield* parts;
}

test("hook input preserves CJK and emoji with one-byte chunks and every split offset", async () => {
  const bytes = Buffer.from(JSON.stringify(fields));
  const oneByte = Array.from(bytes, (_, index) => bytes.subarray(index, index + 1));
  assert.deepEqual(JSON.parse(await readHookInput(chunks(oneByte))), fields);
  // Every byte boundary includes both internal offsets of each three-byte CJK
  // character and all three internal offsets of each four-byte emoji.
  for (let offset = 1; offset < bytes.length; offset += 1) {
    const parts = [bytes.subarray(0, offset), bytes.subarray(offset)];
    assert.deepEqual(JSON.parse(await readHookInput(chunks(parts))), fields, `offset ${offset}`);
  }
});

test("hook input checks every chunk and propagates cancellation and read errors", async () => {
  let checked = 0;
  const parts = [Buffer.from("{"), Buffer.from("}")];
  assert.equal(await readHookInput(chunks(parts), () => checked++), "{}");
  assert.equal(checked, parts.length);
  const aborted = new Error("synthetic_abort");
  let closed = false;
  async function* pending() {
    try { yield parts[0]; yield parts[1]; }
    finally { closed = true; }
  }
  await assert.rejects(readHookInput(pending(), () => { throw aborted; }), error => error === aborted);
  assert.equal(closed, true);
  async function* broken() { yield parts[0]; throw aborted; }
  await assert.rejects(readHookInput(broken()), error => error === aborted);
});

test("hook input accepts already-decoded string chunks from object-mode streams", async () => {
  const text = JSON.stringify(fields);
  const { Readable } = await import("node:stream");
  assert.deepEqual(JSON.parse(await readHookInput(Readable.from([text]))), fields);
  const mixed = [text.slice(0, 7), Buffer.from(text.slice(7, 20)), text.slice(20)];
  assert.deepEqual(JSON.parse(await readHookInput(chunks(mixed))), fields);
});

test("hook input uses non-fatal UTF-8 replacement for invalid bytes", async () => {
  const bytes = Buffer.concat([Buffer.from('{"prompt":"'), Buffer.from([0xff, 0xe4]), Buffer.from('"}')]);
  const text = await readHookInput(chunks(Array.from(bytes, byte => Buffer.from([byte]))));
  assert.equal(text, bytes.toString("utf8"));
  assert.equal(JSON.parse(text).prompt, "\uFFFD\uFFFD");
});

test('hook input deadline destroys unfinished input and discards complete JSON', async () => {
  const { PassThrough } = await import('node:stream');
  const stream = new PassThrough();
  // The production deadline is unreferenced; this test explicitly owns its wait.
  const reading = readHookInput(stream, undefined, { deadlineMs: 20 });
  reading.catch(() => {});
  stream.write('{"prompt":"Synthetic input"}');
  let timer;
  try {
    assert.equal(await Promise.race([reading, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('input deadline missing')), 200);
    })]), '');
    assert.equal(stream.destroyed, true);
  } finally {
    clearTimeout(timer);
    stream.destroy();
    await reading.catch(() => {});
  }
});

test('completed hook input clears its deadline and still propagates read failures', async () => {
  const stream = chunks([Buffer.from('{}')]);
  let destroyed = false;
  stream.destroy = () => { destroyed = true; };
  assert.equal(await readHookInput(stream, undefined, { deadlineMs: 20 }), '{}');
  await delay(40);
  assert.equal(destroyed, false);
  const failure = new Error('synthetic_read_failure');
  async function* broken() { throw failure; }
  await assert.rejects(readHookInput(broken(), undefined, { deadlineMs: 1000 }), error => error === failure);
});

async function localServer(workspace) {
  const requests = [];
  const server = createServer((request, response) => {
    const parts = [];
    request.on("data", chunk => parts.push(chunk));
    request.on("end", () => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/api/memory/pause-state") {
        response.end(JSON.stringify({ paused: false, generation: 0, enforced: true }));
        return;
      }
      requests.push({ path: request.url, body: JSON.parse(Buffer.concat(parts).toString("utf8")) });
      response.end(JSON.stringify(request.url === "/api/memory/recall"
        ? { memories: [] } : { duplicate: false, memoryCount: 1 }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const sockets = new Set();
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  workspace.defer(async () => {
    const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    for (const socket of sockets) socket.destroy();
    await closed;
  });
  return { endpoint: `http://127.0.0.1:${server.address().port}`, requests };
}

function invocation(workspace, endpoint, launcher = false, action = "recall", telemetry = false) {
  const root = workspace.path;
  const child = spawn(process.execPath, launcher
    ? ['--import', workerOwner, fileURLToPath(new URL("../scripts/launch-capture.mjs", import.meta.url))]
    : [fileURLToPath(new URL("../scripts/hook.mjs", import.meta.url)), action], {
    env: {
      PATH: "/usr/bin:/bin",
      TMPDIR: root,
      HOME: join(root, "home"),
      CLAUDE_PLUGIN_DATA: join(root, "data"),
      CLAUDE_PLUGIN_OPTION_API_ENDPOINT: endpoint,
      CLAUDE_PLUGIN_OPTION_API_TOKEN: "test-token",
      CLAUDE_PLUGIN_OPTION_TELEMETRY: String(telemetry),
    },
    stdio: ["pipe", "pipe", "pipe", ...(launcher ? ['ipc'] : [])],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  // An early fail-open exit may close stdin while the writer is still slicing.
  child.stdin.on("error", () => {});
  const result = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  workspace.defer(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      // The preload owns the actual Stop worker and awaits its close before
      // disconnecting. A direct hook has no descendants.
      if (launcher && child.connected) child.send({ kind: 'stop-workers' }, () => {});
      else child.kill('SIGKILL');
    }
    await result;
    child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
  });
  return { child, result };
}

async function writeSlices(stream, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  const cuts = new Set([0, bytes.length]);
  // Split the first CJK character and emoji in every field into one-byte writes.
  // Pipe reads may coalesce writes; the iterable test above proves all splits
  // deterministically, independent of the operating system's pipe scheduling.
  for (const field of ["prompt", "cwd", "transcript_path"]) {
    const start = bytes.indexOf(Buffer.from(`"${field}":`));
    if (start < 0) continue;
    for (const character of ["中", "😀"]) {
      const encoded = Buffer.from(character);
      const at = bytes.indexOf(encoded, start);
      if (at < 0) continue;
      for (let offset = 0; offset <= encoded.length; offset += 1) cuts.add(at + offset);
    }
  }
  const offsets = [...cuts].sort((a, b) => a - b);
  for (let index = 1; index < offsets.length; index += 1) {
    stream.write(bytes.subarray(offsets[index - 1], offsets[index]));
    await delay(index === 1 ? 150 : 15);
  }
  stream.end();
}

test("recall receives an intact long CJK query from sliced hook stdin", { timeout: 8000 }, async t => {
  const workspace = createTestWorkspace(t, { prefix: "cairn-input-recall-" });
  const server = await localServer(workspace);
  const prompt = "中文提示😀：" + "請記住我偏好簡潔的回答。".repeat(100);
  const running = invocation(workspace, server.endpoint);
  await writeSlices(running.child.stdin, { ...fields, prompt, session_id: "input-recall" });
  assert.deepEqual(await running.result, { code: 0, signal: null, stdout: "", stderr: "" });
  const received = server.requests.filter(request => request.path === "/api/memory/recall");
  assert.equal(received.length, 1);
  assert.equal(received[0].body.query, prompt);
  assert.equal(received[0].body.project_id, await opaqueProjectId(join(workspace.path, "data"), fields.cwd,
    { home: join(workspace.path, "home") }));
});

test("Stop launcher resolves a CJK transcript path and cwd from sliced stdin", { timeout: 8000 }, async t => {
  const workspace = createTestWorkspace(t, { prefix: "cairn-input-capture-" });
  const transcript = join(workspace.path, "中文對話😀.jsonl");
  const content = "請保留完整的中文對話😀";
  await writeFile(transcript, JSON.stringify({ type: "user", uuid: "input-user", message: { content } }) + "\n");
  const server = await localServer(workspace);
  const running = invocation(workspace, server.endpoint, true);
  await writeSlices(running.child.stdin, { ...fields, transcript_path: transcript, session_id: "input-capture" });
  assert.deepEqual(await running.result, { code: 0, signal: null, stdout: "", stderr: "" });
  for (let attempt = 0; attempt < 150 && !server.requests.some(request => request.path === "/api/memory/capture"); attempt++) {
    await delay(20);
  }
  const received = server.requests.filter(request => request.path === "/api/memory/capture");
  assert.equal(received.length, 1);
  assert.equal(received[0].body.messages[0].content, content);
  assert.equal(received[0].body.project_id, await opaqueProjectId(join(workspace.path, "data"), fields.cwd,
    { home: join(workspace.path, "home") }));
});

for (const launcher of [false, true]) {
  for (const insideString of [false, true]) {
    test(`${launcher ? "Stop launcher" : "recall"} fails open on invalid UTF-8 ${insideString ? "inside JSON" : "outside JSON"}`,
      { timeout: 8000 }, async t => {
        const workspace = createTestWorkspace(t, { prefix: "cairn-input-invalid-" });
        const server = await localServer(workspace);
        const running = invocation(workspace, server.endpoint, launcher);
        running.child.stdin.end(insideString
          ? Buffer.concat([Buffer.from('{"prompt":"'), Buffer.from([0xff]), Buffer.from('"}')])
          : Buffer.from([0xff]));
        assert.deepEqual(await running.result, { code: 0, signal: null, stdout: "", stderr: "" });
        if (!launcher && insideString) {
          const received = server.requests.filter(request => request.path === "/api/memory/recall");
          assert.equal(received.length, 1);
          assert.equal(received[0].body.query, "\uFFFD");
        } else assert.equal(server.requests.length, 0);
      });
  }
}

test("recall still expires and exits silently while stdin is unfinished", { timeout: 8000 }, async t => {
  const workspace = createTestWorkspace(t, { prefix: "cairn-input-expiry-" });
  const server = await localServer(workspace);
  const running = invocation(workspace, server.endpoint);
  running.child.stdin.write(Buffer.from('{"prompt":"中'));
  assert.deepEqual(await running.result, { code: 0, signal: null, stdout: "", stderr: "" });
  assert.equal(server.requests.length, 0);
});

for (const action of ['start', 'capture', 'capture-detached', 'launcher']) {
  test(`${action} owns a stdin deadline and sends nothing when the pipe stays open`, { timeout: 9000 }, async t => {
    const workspace = createTestWorkspace(t, { prefix: 'cairn-input-deadline-' });
    const server = await localServer(workspace);
    const transcript = join(workspace.path, 'transcript.jsonl');
    await writeFile(transcript, JSON.stringify({ type: 'user', uuid: 'deadline-user', message: { content: 'Synthetic deadline text.' } }) + '\n');
    const running = invocation(workspace, server.endpoint, action === 'launcher', action, true);
    const before = performance.now();
    // Complete, actionable JSON must still be discarded if EOF never arrives.
    running.child.stdin.write(JSON.stringify({ session_id: 'deadline-session', cwd: workspace.path,
      transcript_path: transcript, capture_generation: 'initial' }));
    let timer;
    try {
      const result = await Promise.race([running.result, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('stdin deadline did not close the process')), 6500);
      })]);
      assert.deepEqual(result, { code: 0, signal: null, stdout: '', stderr: '' });
      assert.ok(performance.now() - before < 6500);
      assert.equal(server.requests.length, 0);
    } finally { clearTimeout(timer); }
  });
}

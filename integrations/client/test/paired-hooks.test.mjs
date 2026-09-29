import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, appendFile, unlink, chmod } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { createTestWorkspace } from "../../../tools/testing/workspace.mjs";
import {
  initializePairing,
  completePairing,
  resolveClient,
  clientProjectId,
  resetIdentity,
  detectClients,
} from "../pairing.mjs";
import { readControlState, setPaused } from "../control-state.mjs";
const hook = fileURLToPath(
  new URL("../../../plugins/cairn-memory/scripts/hook.mjs", import.meta.url),
);
const launcher = fileURLToPath(
  new URL("../../../plugins/cairn-memory/scripts/launch-capture.mjs", import.meta.url),
);
async function setup(t, paired = true) {
  const workspace = createTestWorkspace(t, { prefix: "cx2-hook-" });
  const home = join(workspace.path, "home");
  await mkdir(home, { mode: 0o700 });
  const options = {
    home,
    temporary: workspace.path,
    env: { HOME: home, CLAUDE_PLUGIN_DATA: join(home, "unused-plugin-root") },
    hostsStopped: true,
    consent: { claude: true, codex: true },
    standardClaudeOrigin: true,
  };
  const pending = paired ? await initializePairing(options) : {};
  if (paired) await completePairing({ ...options, configured: options.consent });
  const requests = [];
  let recallReply = () => ({ memories: [] });
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (bytes) => (body += bytes));
    req.on("end", async () => {
      requests.push({ path: req.url, body: JSON.parse(body) });
      const reply = req.url.endsWith("/recall")
        ? await recallReply()
        : { duplicate: false, memoryCount: 1 };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  workspace.defer(() => new Promise((resolve) => server.close(resolve)));
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    TMPDIR: process.env.TMPDIR,
    NODE_OPTIONS: process.env.NODE_OPTIONS,
    CAIRN_TEST_REAL_HOME: process.env.CAIRN_TEST_REAL_HOME,
    CLAUDE_PLUGIN_DATA: join(home, "unused-plugin-root"),
    CLAUDE_PLUGIN_OPTION_PAIRING_RECORD: pending.pairingRecord,
    CLAUDE_PLUGIN_OPTION_API_TOKEN: "synthetic-token",
    CLAUDE_PLUGIN_OPTION_TELEMETRY: "false",
    CLAUDE_PLUGIN_OPTION_API_ENDPOINT: `http://127.0.0.1:${server.address().port}`,
  };
  function run(action, input = {}, overrides = {}, entry = hook, args = []) {
    const child = spawn(process.execPath, [entry, ...(entry === hook ? [action] : []), ...args], {
      env: { ...env, ...overrides },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (b) => (stdout += b));
    child.stderr.on("data", (b) => (stderr += b));
    child.stdin.end(JSON.stringify(input));
    return new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
  }
  return {
    options: { ...options, pairingRecord: pending.pairingRecord },
    pending,
    env,
    requests,
    run,
    workspace,
    setRecall(fn) {
      recallReply = fn;
    },
  };
}
const row = (id, content = id) =>
  JSON.stringify({ type: "user", uuid: id, message: { content } }) + "\n";
test("paired Claude and scripted second client discard unseen sessions and split lines after pause/restart", async (t) => {
  const f = await setup(t);
  const codex = await resolveClient({ ...f.options, client: "codex" });
  const transcript = join(f.workspace.path, "transcript.jsonl");
  const event = {
    session_id: "synthetic-session",
    cwd: "/synthetic/project",
    transcript_path: transcript,
  };
  await writeFile(transcript, row("before-adoption"));
  assert.equal((await f.run("capture", event)).code, 0); // pairing EOF boundary
  assert.equal(f.requests.length, 0);
  await appendFile(transcript, row("active"));
  await f.run("capture", event);
  assert.equal(f.requests.length, 1);
  assert.equal(
    f.requests[0].body.project_id,
    await clientProjectId({ ...f.options, client: "codex" }, event.cwd),
  );
  await setPaused(codex.root, true);
  await appendFile(transcript, row("paused"));
  await f.run("capture", event);
  await f.run("resume");
  const split = row("spanning-line");
  await appendFile(transcript, split.slice(0, 20));
  await f.run("capture", event);
  await appendFile(transcript, split.slice(20) + row("after"));
  await f.run("capture", event);
  assert.deepEqual(
    f.requests.flatMap((request) => request.body.messages.map((message) => message.id)),
    ["active", "after"],
  );
  await f.run("pause");
  const unseen = join(f.workspace.path, "unseen.jsonl");
  await writeFile(unseen, row("unseen-paused"));
  await setPaused(codex.root, false);
  await f.run("capture", { ...event, session_id: "unseen", transcript_path: unseen });
  assert.equal(f.requests.length, 2);
  await appendFile(unseen, row("unseen-after"));
  await f.run("capture", { ...event, session_id: "unseen", transcript_path: unseen });
  assert.equal(f.requests.length, 3);
  assert.equal(f.requests.at(-1).body.messages[0].id, "unseen-after");
});
test(
  "delayed Claude recall cannot inject after scripted second-client pause",
  { timeout: 10000 },
  async (t) => {
    const f = await setup(t);
    let entered, release;
    const waiting = new Promise((resolve) => (entered = resolve));
    f.setRecall(
      () =>
        new Promise((resolve) => {
          release = resolve;
          entered();
        }),
    );
    const result = f.run("recall", { cwd: "/synthetic/project", prompt: "A synthetic question" });
    await waiting;
    const codex = await resolveClient({ ...f.options, client: "codex" });
    await setPaused(codex.root, true);
    release({
      memories: [
        {
          id: "synthetic",
          origin: "user",
          scope: "project",
          confidence: 1,
          content: "STALE_CANARY",
        },
      ],
    });
    assert.deepEqual(await result, { code: 0, stdout: "", stderr: "" });
  },
);
test("launcher CLI record reaches worker; mismatches and lost keys produce no requests and successful hooks", async (t) => {
  const f = await setup(t);
  const transcript = join(f.workspace.path, "transcript.jsonl");
  await writeFile(transcript, row("before"));
  const event = { session_id: "launcher", cwd: "/synthetic/project", transcript_path: transcript };
  await f.run("capture", event);
  await appendFile(transcript, row("launched"));
  assert.equal(
    (
      await f.run("", event, { CLAUDE_PLUGIN_OPTION_PAIRING_RECORD: undefined }, launcher, [
        "--pairing-record",
        f.pending.pairingRecord,
      ])
    ).code,
    0,
  );
  for (let i = 0; f.requests.length === 0 && i < 100; i++)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(f.requests[0]?.body.messages[0].id, "launched");
  // Wait for worker acknowledgement / cursor write before cleanup.
  await new Promise((resolve) => setTimeout(resolve, 100));
  const before = f.requests.length;
  for (const overrides of [
    { CAIRN_MEMORY_STATE_DIR: join(f.options.home, "wrong") },
    { CLAUDE_PLUGIN_OPTION_PAIRING_RECORD: "relative" },
  ]) {
    assert.equal(
      (await f.run("recall", { cwd: "/synthetic/project", prompt: "blocked" }, overrides)).code,
      0,
    );
  }
  await unlink(join(f.pending.root, "project-key"));
  assert.match((await f.run("status")).stdout, /paired_key_missing/);
  for (const action of ["pause", "resume"]) {
    const result = await f.run(action);
    assert.equal(result.code, 1);
    assert.match(result.stderr + result.stdout, /paired_key_missing/);
  }
  assert.equal((await f.run("recall", { cwd: "/synthetic/project", prompt: "blocked" })).code, 0);
  assert.equal(f.requests.length, before);
});
test("newcomer Claude without evidence is fail-open and sends nothing", async (t) => {
  const workspace = createTestWorkspace(t, { prefix: "cx2-newcomer-hook-" });
  const home = join(workspace.path, "home");
  await mkdir(home, { mode: 0o700 });
  await clientProjectId(
    { home, env: { HOME: home }, client: "codex", standardClaudeOrigin: true },
    "/synthetic/project",
  );
  const requests = join(workspace.path, "requests");
  await writeFile(requests, "");
  const preload = fileURLToPath(new URL("../testing/golden-preload.mjs", import.meta.url));
  for (const action of ["start", "recall", "capture"]) {
    const child = spawn(process.execPath, ["--import", preload, hook, action], {
      env: {
        PATH: process.env.PATH,
        HOME: home,
        TMPDIR: process.env.TMPDIR,
        CLAUDE_PLUGIN_DATA: join(home, "plugin"),
        CAIRN_TEST_REQUESTS: requests,
        CLAUDE_PLUGIN_OPTION_API_TOKEN: "synthetic",
        NODE_OPTIONS: process.env.NODE_OPTIONS,
        CAIRN_TEST_REAL_HOME: process.env.CAIRN_TEST_REAL_HOME,
      },
      stdio: ["pipe", "ignore", "pipe"],
    });
    child.stdin.end(JSON.stringify({ cwd: "/synthetic/project", prompt: "synthetic" }));
    assert.equal(await new Promise((resolve) => child.on("close", resolve)), 0);
  }
  assert.equal(await readFile(requests, "utf8"), "");
  await assert.rejects(readFile(join(home, "plugin/project-key")), { code: "ENOENT" });
});

test("paired capture evidence does not adopt another Claude profile", async (t) => {
  const f = await setup(t);
  const transcript = join(f.workspace.path, "profiles.jsonl");
  const event = { session_id: "profiles", cwd: "/p", transcript_path: transcript };
  await writeFile(transcript, row("before"));
  await f.run("capture", event);
  await appendFile(transcript, row("after"));
  await f.run("capture", event);
  assert.equal(f.requests.length, 1);
  const pairedId = f.requests[0].body.project_id;
  const profile = join(f.options.home, "profile-b");
  const overrides = { CLAUDE_PLUGIN_DATA: profile, CLAUDE_PLUGIN_OPTION_PAIRING_RECORD: "" };
  assert.equal((await f.run("recall", { ...event, prompt: "synthetic" }, overrides)).code, 0);
  assert.equal(f.requests.length, 2);
  assert.notEqual(f.requests.at(-1).body.project_id, pairedId);
  assert.ok(await readFile(join(profile, "project-key"), "utf8"));
  await f.run("pause", {}, overrides);
  assert.match((await f.run("status")).stdout, /active/);
  const delivered = { CLAUDE_PLUGIN_DATA: profile };
  const count = f.requests.length;
  assert.equal((await f.run("recall", { ...event, prompt: "synthetic" }, delivered)).code, 0);
  assert.equal(f.requests.length, count);
  const status = await f.run("status", {}, delivered);
  assert.match(status.stderr + status.stdout, /pairing_record_mismatch/);
  const control = await f.run("pause", {}, delivered);
  assert.notEqual(control.code, 0);
  assert.match(control.stderr + control.stdout, /pairing_record_mismatch/);
});

test("registered standalone default capture does not move a fresh profile", async (t) => {
  const f = await setup(t, false);
  const transcript = join(f.workspace.path, "standalone.jsonl");
  const event = { session_id: "standalone", cwd: "/p", transcript_path: transcript };
  await writeFile(transcript, row("captured"));
  const defaults = { CLAUDE_PLUGIN_DATA: undefined };
  await f.run("capture", event, defaults);
  assert.equal(f.requests.length, 1);
  const defaultId = f.requests[0].body.project_id;
  const profile = join(f.options.home, "fresh-profile");
  const overrides = { CLAUDE_PLUGIN_DATA: profile };
  await f.run("recall", { ...event, prompt: "synthetic" }, overrides);
  assert.equal(f.requests.length, 2);
  assert.notEqual(f.requests[1].body.project_id, defaultId);
  assert.ok(await readFile(join(profile, "project-key"), "utf8"));
  await f.run("pause", {}, overrides);
  assert.match((await f.run("status", {}, defaults)).stdout, /active/);
});

test("Codex reset preserves retired Claude ownership after paired capture", async (t) => {
  const f = await setup(t);
  const transcript = join(f.workspace.path, "reset.jsonl");
  const event = { session_id: "reset", cwd: "/p", transcript_path: transcript };
  await writeFile(transcript, row("before"));
  await f.run("capture", event);
  await appendFile(transcript, row("after"));
  await f.run("capture", event);
  const oldId = f.requests[0].body.project_id;
  const root = join(f.options.home, "reset-root");
  await resetIdentity({
    ...f.options,
    root,
    primaryClient: "codex",
    confirmIdentityReset: true,
  });
  const profile = join(f.options.home, "profile-b");
  const overrides = { CLAUDE_PLUGIN_DATA: profile, CLAUDE_PLUGIN_OPTION_PAIRING_RECORD: "" };
  await f.run("recall", { ...event, prompt: "synthetic" }, overrides);
  assert.equal(f.requests.length, 2);
  assert.notEqual(f.requests.at(-1).body.project_id, oldId);
  assert.ok(await readFile(join(profile, "project-key")));
  const install = (await detectClients(f.options)).install;
  assert.equal(install.clients.claude, undefined);
  assert.equal(install.retired.at(-1).claude.profileRoot, f.env.CLAUDE_PLUGIN_DATA);
  const count = f.requests.length;
  for (const option of [f.pending.pairingRecord, ""]) {
    const env = { CLAUDE_PLUGIN_OPTION_PAIRING_RECORD: option };
    assert.equal((await f.run("recall", { ...event, prompt: "synthetic" }, env)).code, 0);
    const status = await f.run("status", {}, env);
    assert.match(
      status.stdout + status.stderr,
      option ? /pairing_record_missing/ : /pairing_needed/,
    );
    await assert.rejects(readFile(join(f.env.CLAUDE_PLUGIN_DATA, "project-key")), {
      code: "ENOENT",
    });
  }
  assert.equal(f.requests.length, count);
  const setupOptions = { ...f.options, env: { HOME: f.options.home }, root, adopt: true };
  await initializePairing(setupOptions);
  await completePairing({ ...setupOptions, configured: f.options.consent });
  assert.equal(
    (await detectClients(f.options)).install.clients.claude.profileRoot,
    f.env.CLAUDE_PLUGIN_DATA,
  );
  assert.match((await f.run("status")).stdout, /paused/);
});

test("untrusted then lost metadata never moves an established legacy-gap identity", async (t) => {
  for (const damage of ["permissions", "corruption"]) {
    await t.test(damage, async (t) => {
      const f = await setup(t, false);
      const root = join(f.options.home, ".cairn-memory");
      const transcript = join(f.workspace.path, "legacy.jsonl");
      const event = { session_id: "legacy", cwd: "/p", transcript_path: transcript };
      await writeFile(transcript, row("legacy"));
      await f.run("capture", event, { CLAUDE_PLUGIN_DATA: undefined });
      assert.equal(f.requests.length, 1, "legacy capture sent");
      const oldId = f.requests[0].body.project_id;
      const coordination = join(f.options.home, ".cairn-memory-clients");
      const install = join(coordination, "install.json");
      // Simulate pre-0.1.2 cursors, then register the upgraded plugin-data profile.
      await unlink(install);
      await f.run("recall", { ...event, prompt: "synthetic" });
      assert.equal(f.requests.length, 2, "upgraded recall sent");
      assert.equal(f.requests.at(-1).body.project_id, oldId);
      if (damage === "permissions") await chmod(coordination, 0o755);
      else await writeFile(install, "{");
      for (const lost of [false, true]) {
        if (lost) await unlink(install);
        const count = f.requests.length;
        await f.run("recall", { ...event, prompt: "synthetic" });
        assert.equal(f.requests.length, count + 1, `recall sent with metadata lost=${lost}`);
        assert.equal(f.requests.at(-1).body.project_id, oldId);
        await assert.rejects(readFile(join(f.env.CLAUDE_PLUGIN_DATA, "project-key")), {
          code: "ENOENT",
        });
        assert.ok(await readFile(join(root, "project-key")));
        if (!lost) assert.match((await f.run("status")).stdout, /standalone_unregistered/);
      }
    });
  }
});

test("unreadable coordination cannot revive either reset primary's retired root", async (t) => {
  for (const primaryClient of ["claude", "codex"]) {
    await t.test(primaryClient, async (t) => {
      const f = await setup(t);
      const retired = join(f.options.home, ".cairn-memory");
      const transcript = join(f.workspace.path, "retired.jsonl");
      const event = { session_id: "retired", cwd: "/p", transcript_path: transcript };
      await writeFile(transcript, row("before"));
      await f.run("capture", event);
      await appendFile(transcript, row("after"));
      await f.run("capture", event);
      assert.equal(f.requests.length, 1, "paired capture sent");
      const oldId = f.requests[0].body.project_id;
      const generation = (await readControlState(retired)).generation;
      await resetIdentity({
        ...f.options,
        root: join(f.options.home, "reset-root"),
        primaryClient,
        confirmIdentityReset: true,
      });
      const control = await readControlState(retired);
      assert.equal(control.paused, true);
      assert.notEqual(control.generation, generation);
      assert.deepEqual(JSON.parse(await readFile(join(retired, "retired"))), {
        version: 1,
        retired: true,
      });
      const directory = join(f.options.home, ".cairn-memory-clients");
      const b = {
        CLAUDE_PLUGIN_DATA: join(f.options.home, "fresh-b"),
        CLAUDE_PLUGIN_OPTION_PAIRING_RECORD: "",
      };
      await chmod(directory, 0o755);
      for (const overrides of [{}, { CLAUDE_PLUGIN_OPTION_PAIRING_RECORD: "" }, b]) {
        const count = f.requests.length;
        assert.equal((await f.run("recall", { ...event, prompt: "synthetic" }, overrides)).code, 0);
        assert.equal((await f.run("capture", event, overrides)).code, 0);
        assert.equal((await f.run("", event, overrides, launcher)).code, 0);
        assert.equal(f.requests.length, count, "retired identity sends nothing");
        assert.match((await f.run("status", {}, overrides)).stdout, /coordination_unreadable/);
        assert.notEqual((await f.run("resume", {}, overrides)).code, 0);
      }
      await assert.rejects(readFile(join(b.CLAUDE_PLUGIN_DATA, "project-key")), { code: "ENOENT" });
      await chmod(directory, 0o700);
      await f.run("recall", { ...event, prompt: "synthetic" }, b);
      assert.equal(f.requests.length, 2, "B sends after repair");
      const bId = f.requests.at(-1).body.project_id;
      assert.notEqual(bId, oldId);
      await chmod(directory, 0o755);
      await f.run("recall", { ...event, prompt: "synthetic" }, b);
      assert.equal(f.requests.length, 2, "B stays disabled during degradation");
      await chmod(directory, 0o700);
      await f.run("recall", { ...event, prompt: "synthetic" }, b);
      assert.equal(f.requests.length, 3, "B sends after second repair");
      assert.equal(f.requests.at(-1).body.project_id, bId);
      assert.equal((await readControlState(retired)).paused, true);
    });
  }
});

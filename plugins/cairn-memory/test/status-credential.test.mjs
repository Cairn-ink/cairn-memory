import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createTestWorkspace } from "../../../tools/testing/workspace.mjs";
import { readCredentialState, recordCredentialConfiguration, recordCredentialAuth }
  from "../lib/credential-state.mjs";
import { transcriptMessages } from "../lib/transcript.mjs";

const hook = fileURLToPath(new URL("../scripts/hook.mjs", import.meta.url));
const fetchFixture = fileURLToPath(new URL("./fixtures/status-fetch-preload.mjs", import.meta.url));
const syntheticToken = "pat_" + "status-credential-" + "synthetic-only-123456789";
const rotatedToken = "pat_" + "rotated-" + "synthetic-only";
const time = "2026-10-06T06:30:00.000Z";

async function processResult(command, args, options, input = "") {
  // File-backed stdio also works where sandbox policy blocks child socketpairs.
  const workspace = createTestWorkspace(null, { prefix: "cairn-status-process-" });
  try {
    const paths = ["stdin", "stdout", "stderr"].map((name) => join(workspace.path, name));
    await writeFile(paths[0], input, { mode: 0o600 });
    const handles = [];
    for (let i = 0; i < paths.length; i++) {
      const handle = await open(paths[i], i === 0 ? "r" : "w", 0o600);
      handles.push(handle);
      workspace.defer(() => handle.close());
    }
    const child = spawn(command, args, { ...options, stdio: handles.map((handle) => handle.fd) });
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    const stdout = await readFile(paths[1], "utf8");
    const stderr = await readFile(paths[2], "utf8");
    for (const path of paths) {
      const bytes = await readFile(path, "utf8");
      for (const token of [syntheticToken, rotatedToken]) {
        assert.equal(bytes.includes(token), false, path);
      }
    }
    return { exitCode, stdout, stderr };
  } finally { await workspace.cleanup(); }
}

async function fixture(t) {
  const workspace = createTestWorkspace(t, { prefix: "cairn-status-credential-" });
  const root = join(workspace.path, "plugin data");
  const home = join(workspace.path, "home");
  await mkdir(home, { mode: 0o700 });
  // The host can create the plugin data directory with its own default mode.
  await mkdir(root, { mode: 0o755 });
  const env = { ...process.env, HOME: home };
  for (const key of Object.keys(env)) if (key.startsWith("CLAUDE_PLUGIN_")) delete env[key];
  const requests = [];
  let reply = { status: 200, body: { memories: [] } };
  const requestFile = join(workspace.path, "fetch-observations.jsonl");
  await writeFile(requestFile, "", { mode: 0o600 });
  const endpoint = "https://status.synthetic.invalid";
  return { root, workspace, requests, endpoint, respond(status, body = {}) { reply = { status, body }; },
    async hook(action = "recall", options = {}, input = {}) {
      const result = await processResult(process.execPath, ["--import", fetchFixture, hook, action], { env: { ...env,
        CLAUDE_PLUGIN_DATA: root, CLAUDE_PLUGIN_OPTION_API_ENDPOINT: endpoint,
        CLAUDE_PLUGIN_OPTION_API_TOKEN: syntheticToken,
        CAIRN_STATUS_FIXTURE_REQUESTS: requestFile,
        CAIRN_STATUS_FIXTURE_REPLY: JSON.stringify(reply),
        CLAUDE_PLUGIN_OPTION_TELEMETRY: "false", ...options } }, JSON.stringify({
          prompt: "What do I prefer?", cwd: "/synthetic/project",
          session_id: "synthetic-session", ...input,
        }));
      requests.splice(0, requests.length, ...(await readFile(requestFile, "utf8")).trim().split("\n")
        .filter(Boolean).map((line) => JSON.parse(line)));
      return result;
    },
    async status(extra = [], options = {}) {
      // Exactly the skill's command after Claude substitutes the two paths:
      // no plugin path or option env is inherited by the Bash-like child.
      const result = await processResult(process.execPath, [hook, "status", ...(extra.length ? extra : ["--plugin-data", root])], { env: { ...env, ...options } });
      if (result.exitCode === 0) {
        const record = { type: "assistant", message: { content: result.stdout.trim() } };
        assert.equal(transcriptMessages(JSON.stringify(record), "status-output").length, 0);
        record.message.content += " Also, your flight is at 9am.";
        assert.equal(transcriptMessages(JSON.stringify(record), "status-output").length, 1);
      }
      return result;
    },
    async skillControl(action) {
      const skill = await readFile(new URL(`../skills/${action}/SKILL.md`, import.meta.url), "utf8");
      assert.ok(skill.includes(action + ' --plugin-data "${CLAUDE_PLUGIN_DATA}"'));
      return processResult(process.execPath, [hook, action, "--plugin-data", root], { env });
    },
  };
}

async function assertNoTokenFiles(f) {
  const files = [];
  async function visit(root) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const path = join(root, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await visit(f.workspace.path);
  assert.ok(files.length > 0);
  for (const path of files) {
    const bytes = await readFile(path, "utf8");
    for (const token of [syntheticToken, rotatedToken]) {
      assert.equal(bytes.includes(token), false, path);
      assert.equal(bytes.includes(createHash("sha256").update(token).digest("hex")), false, path);
      assert.equal(bytes.includes(token.slice(0, 18)), false, path);
    }
  }

}

test("Bash-like status reads hook-verified configuration and endpoint without token env", async (t) => {
  const f = await fixture(t);
  const hookResult = await f.hook();
  assert.equal(hookResult.exitCode, 0);
  assert.equal(hookResult.stderr, "");
  assert.equal(f.requests.length, 1); // no extra auth probe
  assert.equal(f.requests[0].authenticated, true);
  assert.equal(f.requests[0].tokenMatches, true);
  const state = await readCredentialState(f.root);
  assert.deepEqual(Object.keys(state).sort(), ["auth", "configured", "endpoint", "observed_at", "version"]);
  assert.equal(state.configured, true);
  assert.equal(state.auth.outcome, "ok");
  const result = await f.status();
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.ok(result.stdout.includes(`endpoint: ${f.endpoint}; credential: configured (verified ${state.auth.at})`));
  assert.equal(f.requests.length, 1); // status is offline
  await assertNoTokenFiles(f);
});

for (const code of [401, 403]) {
  test(`Bash-like status reports HTTP ${code} as rejected and gives the observed endpoint's token URL`, async (t) => {
    const f = await fixture(t);
    f.respond(code, { error: syntheticToken }); // response text must never be stored
    const hookResult = await f.hook();
    assert.deepEqual(hookResult, { exitCode: 0, stdout: "", stderr: "" });
    const state = await readCredentialState(f.root);
    assert.equal(state.auth.outcome, "rejected");
    assert.ok(Number.isFinite(Date.parse(state.auth.at)));
    const result = await f.status();
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes(`credential: rejected — create a new token at ${f.endpoint}/settings/tokens`));
    assert.equal(f.requests.length, 1);
    await assertNoTokenFiles(f);
  });
}

test("status says not seen before any hook, and only a hook can report missing", async (t) => {
  const f = await fixture(t);
  const unseen = await f.status();
  assert.equal(unseen.exitCode, 0);
  assert.match(unseen.stdout, /credential: not seen yet — restart Claude Code and send one message/);
  assert.equal(await readCredentialState(f.root), undefined); // status did not record false
  const started = await f.hook("start", { CLAUDE_PLUGIN_OPTION_API_TOKEN: "" });
  assert.equal(started.exitCode, 0);
  assert.equal((await readCredentialState(f.root)).configured, false);
  const missing = await f.status();
  assert.equal(missing.exitCode, 0);
  assert.match(missing.stdout, /credential: missing\./);
  assert.equal(f.requests.length, 0);
  await assertNoTokenFiles(f);
});

test("SessionStart telemetry cannot verify auth; empty/paused recall makes no auth probe", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.hook("start", { CLAUDE_PLUGIN_OPTION_TELEMETRY: "true" })).exitCode, 0);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].authenticated, false);
  assert.equal((await readCredentialState(f.root)).auth, null);
  assert.match((await f.status()).stdout, /credential: configured \(not verified yet\)/);
  assert.equal((await f.hook("recall", {}, { prompt: "  " })).exitCode, 0);
  assert.equal((await f.hook("pause")).exitCode, 0);
  assert.equal((await f.hook()).exitCode, 0);
  assert.equal(f.requests.length, 1);
  assert.equal((await readCredentialState(f.root)).auth, null);
  await assertNoTokenFiles(f);
});

for (const outage of ["network", "http", "busy"]) {
  test(`${outage} outage retains configured and distinguishes server replies from unreachable without raw errors`, async (t) => {
    const f = await fixture(t);
    f.respond(outage === "busy" ? 429 : 503, { error: syntheticToken });
    const endpoint = outage === "network" ? "http://127.0.0.1:9" : f.endpoint;
    assert.deepEqual(await f.hook("recall", { CLAUDE_PLUGIN_OPTION_API_ENDPOINT: endpoint,
      CAIRN_STATUS_FIXTURE_OUTAGE: outage === "network" ? "true" : "false" }),
      { exitCode: 0, stdout: "", stderr: "" });
    const state = await readCredentialState(f.root);
    assert.equal(state.configured, true);
    assert.equal(state.auth.outcome, outage === "network" ? "unreachable" : outage === "busy" ? "server-busy" : "server-error");
    const result = await f.status();
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, outage === "network" ? /credential: configured \(unreachable .*; not verified\)/ :
      outage === "busy" ? /server answered: busy .*; not verified/ : /server answered: error .*; not verified/);
    assert.equal(result.stdout.includes("missing"), false);
    await assertNoTokenFiles(f);
  });
}

for (const initial of [200, 401]) {
  test(`SessionStart clears previous HTTP ${initial} auth on token rotation without probing`, async (t) => {
    const f = await fixture(t);
    f.respond(initial, { memories: [] });
    await f.hook();
    assert.equal((await readCredentialState(f.root)).auth.outcome, initial === 200 ? "ok" : "rejected");
    await f.hook("pause");
    await f.hook("start", { CLAUDE_PLUGIN_OPTION_API_TOKEN: rotatedToken });
    assert.equal((await readCredentialState(f.root)).auth, null);
    const status = await f.status();
    assert.match(status.stdout, /credential: configured \(not verified yet\)/);
    assert.equal(status.stdout.includes("rejected"), false);
    assert.equal(status.stdout.includes("verified 2026"), false);
    assert.equal(f.requests.length, 1);
    await f.hook("resume");
    f.respond(200, { memories: [] });
    await f.hook("recall", { CLAUDE_PLUGIN_OPTION_API_TOKEN: rotatedToken });
    assert.equal((await readCredentialState(f.root)).auth.outcome, "ok");
    assert.equal(f.requests.length, 2);
    await assertNoTokenFiles(f);
  });
}

test("invalid or symlinked observations are unknown, never missing or printed", async (t) => {
  const f = await fixture(t);
  const path = join(f.root, "credential-state.json");
  await writeFile(path, JSON.stringify({ configured: false, extra: "untrusted-marker" }), { mode: 0o600 });
  const result = await f.status();
  assert.match(result.stdout, /credential: not seen yet/);
  assert.equal(result.stdout.includes("untrusted-marker"), false);
  const otherRoot = join(f.workspace.path, "other");
  await mkdir(otherRoot, { mode: 0o700 });
  await symlink(path, join(otherRoot, "credential-state.json"));
  assert.equal(await readCredentialState(otherRoot), undefined);
  await assertNoTokenFiles(f);
});

test("capture records auth through its existing request; token removal clears previous auth", async (t) => {
  const f = await fixture(t);
  const transcript = join(f.workspace.path, "transcript.jsonl");
  await writeFile(transcript, JSON.stringify({ type: "user", uuid: "synthetic-message",
    message: { content: "Remember concise examples." } }) + "\n", { mode: 0o600 });
  f.respond(200, { duplicate: false, memoryCount: 1 });
  assert.deepEqual(await f.hook("capture", {}, { transcript_path: transcript }),
    { exitCode: 0, stdout: "", stderr: "" });
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].path, "/api/memory/capture");
  assert.equal((await readCredentialState(f.root)).auth.outcome, "ok");
  assert.match((await f.status()).stdout, /credential: configured \(verified /);
  await f.hook("recall", { CLAUDE_PLUGIN_OPTION_API_TOKEN: undefined });
  const state = await readCredentialState(f.root);
  assert.equal(state.configured, false);
  assert.equal(state.auth, null);
  assert.equal(f.requests.length, 1);
  assert.match((await f.status()).stdout, /credential: missing\./);
  await assertNoTokenFiles(f);
});

test("late SessionStart and old authenticated responses cannot overwrite newer hook configuration", async (t) => {
  const f = await fixture(t);
  const config = { configured: true, endpoint: f.endpoint, observedAt: time };
  await recordCredentialConfiguration(f.root, config);
  const newer = "2026-10-06T06:31:00.000Z";
  await recordCredentialConfiguration(f.root, { ...config, observedAt: newer });
  await recordCredentialAuth(f.root, { endpoint: f.endpoint, observedAt: newer, outcome: "ok", at: newer });
  await recordCredentialConfiguration(f.root, { ...config, resetAuth: true });
  await recordCredentialAuth(f.root, { endpoint: f.endpoint, observedAt: time, outcome: "rejected", at: newer });
  const state = await readCredentialState(f.root);
  assert.equal(state.observed_at, newer);
  assert.deepEqual(state.auth, { outcome: "ok", at: newer });
  await recordCredentialConfiguration(f.root, { ...config, observedAt: newer,
    endpoint: "https://changed.synthetic.invalid" });
  assert.equal((await readCredentialState(f.root)).auth, null);
  await assertNoTokenFiles(f);
});

test("status skill passes the substituted data path and forbids credential-store inspection", async () => {
  const skill = await readFile(new URL("../skills/status/SKILL.md", import.meta.url), "utf8");
  assert.ok(skill.includes('status --plugin-data "${CLAUDE_PLUGIN_DATA}"'));
  assert.ok(skill.includes("Do not print or inspect"));
  assert.ok(skill.includes("credential store"));
});

test("Bash pause/resume skills share the hook data directory and status observes the real pause", async (t) => {
  const f = await fixture(t);
  await f.hook();
  assert.equal(f.requests.length, 1);
  const paused = await f.skillControl("pause");
  assert.deepEqual(paused, { exitCode: 0, stdout: "Cairn automatic memory is paused.\n", stderr: "" });
  assert.match((await f.status()).stdout, /Cairn automatic memory: paused/);
  await f.hook();
  assert.equal(f.requests.length, 1, "paused hook must not recall");
  assert.equal((await f.skillControl("resume")).exitCode, 0);
  assert.match((await f.status()).stdout, /Cairn automatic memory: active/);
  await f.hook();
  assert.equal(f.requests.length, 2, "resumed hook recalls again");
  await assertNoTokenFiles(f);
});

test("empty and unsubstituted plugin-data arguments preserve legacy status fallback", async (t) => {
  const f = await fixture(t);
  const old = await f.status(["--plugin-data", ""]);
  assert.equal(old.exitCode, 0);
  assert.equal(old.stderr, "");
  assert.match(old.stdout, /Cairn automatic memory: active/);
  const unsubstituted = await f.status(["--plugin-data", "${CLAUDE_PLUGIN_DATA}"]);
  assert.deepEqual(unsubstituted, old);
  await assertNoTokenFiles(f);
});

test("token leakage scans use Node fs and work with no executables on PATH", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.hook("recall", { PATH: "" })).exitCode, 0);
  assert.equal((await f.status([], { PATH: "" })).exitCode, 0);
  await assertNoTokenFiles(f);
});

test("Bash resume clears the observed custom endpoint's cooldown, as shown by status", async (t) => {
  const f = await fixture(t);
  f.respond(429);
  await f.hook();
  assert.match((await f.status()).stdout, /recall: cooldown/);
  assert.equal(f.requests.length, 1);
  assert.equal((await f.skillControl("resume")).exitCode, 0);
  assert.equal((await f.status()).stdout.includes("recall: cooldown"), false);
  f.respond(200, { memories: [] });
  await f.hook();
  assert.equal(f.requests.length, 2);
  await assertNoTokenFiles(f);
});

test("SessionStart with an invalid replacement endpoint clears auth and reports the fixed diagnostic", async (t) => {
  const f = await fixture(t);
  await f.hook();
  assert.equal((await readCredentialState(f.root)).auth.outcome, "ok");
  const invalid = "http://invalid.synthetic.invalid/private-config";
  await f.hook("start", { CLAUDE_PLUGIN_OPTION_API_ENDPOINT: invalid,
    CLAUDE_PLUGIN_OPTION_API_TOKEN: rotatedToken });
  const state = await readCredentialState(f.root);
  assert.equal(state.auth, null);
  assert.equal(state.endpoint, "invalid (HTTPS required; HTTP is loopback-only)");
  assert.equal(f.requests.length, 1);
  const status = await f.status();
  assert.match(status.stdout, /endpoint: invalid \(HTTPS required; HTTP is loopback-only\)/);
  assert.match(status.stdout, /credential: configured \(not verified yet\)/);
  assert.equal(status.stdout.includes("not seen yet"), false);
  assert.equal(status.stdout.includes(invalid), false);
  assert.equal((await readFile(join(f.root, "credential-state.json"), "utf8")).includes(invalid), false);
  await assertNoTokenFiles(f);
});

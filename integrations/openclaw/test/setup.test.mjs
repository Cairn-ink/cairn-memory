import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir, rm, stat, symlink, link, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readSecretFile } from "openclaw/plugin-sdk/secret-file";
import { runSetup } from "../src/setup.mjs";
import { createTerminal } from "../src/terminal.mjs";
import { configSchema, DEFAULT_TIMEOUT_MS, endpointOrigin, mergeSetup, OFF_SWITCH, PLUGIN_ID, RECALL_PROMPT, recallPrompt, TOOLS } from "../src/config.mjs";
import { checkCredential } from "../src/hosted.mjs";
import { fakeCloud, TOKEN } from "./cloud.mjs";
async function fixture(t, initial = {}) {
  const cloud = await fakeCloud(t);
  const root = await mkdtemp(join(tmpdir(), "cairn-setup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = join(root, "openclaw.json");
  const initialBytes = JSON.stringify(initial, null, 3) + "\n";
  await writeFile(configPath, initialBytes);
  const answers = [cloud.endpoint, TOKEN, ""];
  const output = [], asks = [];
  const io = { async ask(prompt, hidden) { asks.push({ prompt, hidden }); output.push(prompt);
    if (prompt.startsWith("Turn on automatic recall?")) {
      assert.equal(cloud.requests.length, 1); assert.equal((await readdir(root)).length, 1);
    }
    return answers.shift(); }, print: (text) => output.push(text) };
  const api = { runtime: { state: { resolveStateDir: () => root }, config: {
    async mutateConfigFile({ mutate, afterWrite }) {
      assert.equal(afterWrite.mode, "none");
      const draft = JSON.parse(await readFile(configPath, "utf8"));
      mutate(draft);
      if (api.failWrite) throw new Error(TOKEN);
      await writeFile(configPath, JSON.stringify(draft));
    },
  } } };
  return { cloud, root, configPath, initialBytes, answers, output, asks, api, io };
}
test("default recall prompt pins the configured 5000 ms default to the documented 8 s worst case", async () => {
  const manifest = JSON.parse(await readFile(new URL("../openclaw.plugin.json", import.meta.url)));
  assert.equal(DEFAULT_TIMEOUT_MS, 5000);
  assert.equal(configSchema.properties.activeMemoryTimeoutMs.default, DEFAULT_TIMEOUT_MS);
  assert.equal(manifest.configSchema.properties.activeMemoryTimeoutMs.default, DEFAULT_TIMEOUT_MS);
  assert.equal(recallPrompt(DEFAULT_TIMEOUT_MS), "Turn on automatic recall? It makes one extra call to your model before each reply in direct chats, using your usage; it can add up to about 8 s. [Y/n]");
  assert.equal(RECALL_PROMPT, recallPrompt(DEFAULT_TIMEOUT_MS));
});
test("setup validates before writes, asks exact cost prompt default yes, persists only a private file SecretRef", async (t) => {
  const f = await fixture(t, { agents: { entries: { main: { tools: { profile: "coding", alsoAllow: ["existing"], deny: ["exec"] } } } },
    plugins: { slots: { memory: "memory-core" } } });
  assert.equal(await runSetup(f.api, { io: f.io }), true);
  assert.equal(f.asks[1].hidden, true); assert.equal(f.asks[2].prompt, RECALL_PROMPT);
  assert.equal(f.output[f.output.indexOf(RECALL_PROMPT) + 1], OFF_SWITCH);
  const raw = await readFile(f.configPath, "utf8"); assert.ok(!raw.includes(TOKEN));
  const config = JSON.parse(raw), entry = config.plugins.entries[PLUGIN_ID];
  assert.equal(entry.config.token.source, "file"); assert.equal(entry.config.token.id, "value");
  const provider = config.secrets.providers[entry.config.token.provider];
  assert.equal(provider.mode, "singleValue");
  assert.equal(await readSecretFile(provider.path, "synthetic credential"), TOKEN);
  const info = await stat(provider.path);
  assert.equal(info.mode & 0o777, 0o600); assert.equal(info.nlink, 1); assert.equal(info.uid, process.getuid());
  assert.equal((await stat(join(f.root, "cairn-secrets"))).mode & 0o777, 0o700);
  const policy = config.agents.entries.main.tools;
  assert.deepEqual(policy.alsoAllow, ["existing", ...TOOLS]); assert.equal(policy.allow, undefined);
  assert.equal(policy.profile, "coding"); assert.deepEqual(policy.deny, ["exec"]);
  assert.deepEqual(config.plugins.slots, { memory: "memory-core" });
  assert.deepEqual(config.plugins.entries["active-memory"].config, { agents: ["main"], mode: "always",
    allowedChatTypes: ["direct"], queryMode: "message", toolsAllow: [TOOLS[0]], timeoutMs: 5000, setupGraceTimeoutMs: 0 });
  assert.ok(!f.output.join("\n").includes(TOKEN));
  t.diagnostic("Setup transcript (credential redacted):\n" + f.output.map((line) => line === "Memory-only token:" ? line + " [REDACTED; hidden input]" : line).join("\n"));
});
test("existing allow is merged without alsoAllow, explicit no and timeout option are honored", async (t) => {
  const f = await fixture(t, { agents: { entries: { main: { tools: { allow: ["existing", TOOLS[0]], deny: ["exec"] } } } } });
  f.answers[2] = "n";
  assert.equal(await runSetup(f.api, { io: f.io, timeoutMs: 2500 }), true);
  const config = JSON.parse(await readFile(f.configPath));
  assert.deepEqual(config.agents.entries.main.tools.allow, ["existing", ...TOOLS]);
  assert.equal(config.agents.entries.main.tools.alsoAllow, undefined);
  assert.equal(config.plugins.entries["active-memory"].enabled, false);
  assert.equal(config.plugins.entries["active-memory"].config.timeoutMs, 2500);
  assert.equal(f.asks[2].prompt, "Turn on automatic recall? It makes one extra call to your model before each reply in direct chats, using your usage; it can add up to about 5.5 s. [Y/n]");
  assert.ok(f.output.includes("Recall-work budget: 2500 ms; documented worst-case blocking: 5500 ms."));
});
test("setup derives recall prompt latency from the configured plugin timeout", async (t) => {
  const f = await fixture(t);
  f.api.pluginConfig = { activeMemoryTimeoutMs: 12000 };
  assert.equal(await runSetup(f.api, { io: f.io }), true);
  assert.equal(f.asks[2].prompt, "Turn on automatic recall? It makes one extra call to your model before each reply in direct chats, using your usage; it can add up to about 15 s. [Y/n]");
  assert.equal(f.output[f.output.indexOf(f.asks[2].prompt) + 1], OFF_SWITCH);
});
for (const [label, change] of [
  ["full access", (f) => { f.cloud.credentialValue.scopes = null; }],
  ["extra scope", (f) => { f.cloud.credentialValue.scopes.push("cards:read"); }],
  ["missing scope", (f) => { f.cloud.credentialValue.scopes = ["memory:recall"]; }],
  ["nested scope", (f) => { f.cloud.credentialValue.scopes = ["memory:capture", ["memory:recall"]]; }],
  ["duplicate scope", (f) => { f.cloud.credentialValue.scopes = ["memory:recall", "memory:recall"]; }],
  ["invalid", (f) => { f.cloud.credentialValue.valid = false; }],
  ["bad id", (f) => { f.cloud.credentialValue.token_id = "../bad"; }],
  ["expired", (f) => { f.cloud.credentialValue.expires_at = "2000-01-01T00:00:00Z"; }],
  ["missing expiry", (f) => { delete f.cloud.credentialValue.expires_at; }],
  ["timezone absent", (f) => { f.cloud.credentialValue.expires_at = "2099-01-01T00:00:00"; }],
  ["invalid JSON", (f) => { f.cloud.invalidJson = true; }],
  ["oversize", (f) => { f.cloud.oversize = "/api/cli-auth/v1/credential"; }],
  ...[401, 403, 404, 501, 429, 500, 302].map((status) => [`HTTP ${status}`, (f) => { f.cloud.credentialStatus = status; }]),
]) test(`setup refuses ${label}: all files byte-identical, no recall question or leaked diagnostic`, async (t) => {
  const f = await fixture(t); change(f);
  assert.equal(await runSetup(f.api, { io: f.io }), false);
  assert.equal(await readFile(f.configPath, "utf8"), f.initialBytes);
  assert.deepEqual(await readdir(f.root), ["openclaw.json"]);
  assert.equal(f.asks.length, 2); assert.equal(f.cloud.requests.length, 1);
  assert.ok(!f.output.join("\n").includes(TOKEN));
});
for (const reason of ["publication failure", "policy conflict", "invalid answer", "invalid timeout"]) {
  test(`setup rollback on ${reason} preserves original bytes and leaves no secret`, async (t) => {
    const initial = reason === "policy conflict" ? { agents: { entries: { main: { tools: { allow: [], alsoAllow: [] } } } } } : {};
    const f = await fixture(t, initial);
    if (reason === "publication failure") f.api.failWrite = true;
    if (reason === "invalid answer") f.answers[2] = "maybe";
    assert.equal(await runSetup(f.api, { io: f.io, timeoutMs: reason === "invalid timeout" ? 249 : 5000 }), false);
    assert.equal(await readFile(f.configPath, "utf8"), f.initialBytes);
    assert.deepEqual(await readdir(f.root), ["openclaw.json"]);
    assert.ok(!f.output.join("\n").includes(TOKEN));
  });
}
test("unsafe secret directory fails closed and cannot write outside the state root", async (t) => {
  const f = await fixture(t); const outside = join(f.root, "outside"); await mkdir(outside, { mode: 0o700 });
  await symlink(outside, join(f.root, "cairn-secrets"));
  // The check is still performed before accepting a directory for storage.
  f.io.ask = async (prompt) => { f.asks.push({ prompt }); return f.answers.shift(); };
  assert.equal(await runSetup(f.api, { io: f.io }), false);
  assert.deepEqual(await readdir(outside), []); assert.equal(await readFile(f.configPath, "utf8"), f.initialBytes);
});
test("file SecretRef SDK reader rejects symlink and hardlink credentials", async (t) => {
  const f = await fixture(t); assert.equal(await runSetup(f.api, { io: f.io }), true);
  const config = JSON.parse(await readFile(f.configPath));
  const path = Object.values(config.secrets.providers)[0].path;
  const alias = path + ".alias"; await symlink(path, alias);
  await assert.rejects(readSecretFile(alias, "credential", { rejectSymlink: true, rejectHardlinks: true }));
  await link(path, path + ".hardlink"); await assert.rejects(readSecretFile(path, "credential"));
});
test("endpoint and credential lexical refusals make no requests", async (t) => {
  const cloud = await fakeCloud(t);
  for (const value of ["https:example.invalid", "https://example.invalid/.", "http://example.invalid", "https://user:pass@example.invalid", "https://example.invalid/x", "https://example.invalid?", "https://example.invalid/#x", "https://example.invalid\\x", "https://example.invalid:0", " https://example.invalid"]) {
    assert.throws(() => endpointOrigin(value), /cairn_invalid_configuration/);
  }
  assert.equal(endpointOrigin("https://cairn.ink/"), "https://cairn.ink");
  assert.equal((await checkCredential(cloud.endpoint, "bad\ntoken")).ok, false);
  assert.equal(cloud.requests.length, 0);
});
test("non-TTY setup fails instead of echoing or accepting input", () => {
  assert.throws(() => createTerminal({ isTTY: false }, { isTTY: true }), /hidden input/);
});
test("hidden input, backspace, EOF/cancel and raw-mode restoration", async () => {
  const { PassThrough } = await import("node:stream");
  const input = new PassThrough(); input.isTTY = true; input.isRaw = false;
  input.setRawMode = (value) => { input.isRaw = value; };
  let visible = ""; const output = { isTTY: true, write(value) { visible += value; } };
  const terminal = createTerminal(input, output);
  const answer = terminal.ask("Memory-only token:", true);
  input.write(TOKEN + "x\x7f\r");
  assert.equal(await answer, TOKEN); assert.ok(!visible.includes(TOKEN)); assert.equal(input.isRaw, false);
  const cancelled = terminal.ask("Memory-only token:", true); input.write("\x03");
  await assert.rejects(cancelled, /cairn_input_unavailable/); assert.equal(input.isRaw, false);
  const ended = terminal.ask("Memory-only token:", true); input.emit("end"); await assert.rejects(ended);
});
test("output failure after accepted publication keeps the committed credential", async (t) => {
  const f = await fixture(t);
  const print = f.io.print;
  f.io.print = (text) => { if (text.startsWith("Cairn configured")) throw new Error(TOKEN); print(text); };
  assert.equal(await runSetup(f.api, { io: f.io }), true);
  const config = JSON.parse(await readFile(f.configPath));
  assert.equal(await readSecretFile(Object.values(config.secrets.providers)[0].path, "credential"), TOKEN);
});

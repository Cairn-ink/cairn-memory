import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir, rm, stat, symlink, link, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readSecretFile } from "openclaw/plugin-sdk/secret-file";
import { runSetup } from "../src/setup.mjs";
import { createTerminal } from "../src/terminal.mjs";
import { configSchema, DEFAULT_TIMEOUT_MS, PAUSE_NOTICE, WINDOWS_NOTICE, activeMemoryBudget, normalizeRecallTools, defaultRecallTools, endpointOrigin, mergeSetup, removeAutomaticRecall, OFF_SWITCH, PLUGIN_ID, RECALL_PROMPT, recallPrompt, TOOLS } from "../src/config.mjs";
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
    current: () => initial,
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
  assert.equal(recallPrompt(DEFAULT_TIMEOUT_MS), "Turn on automatic recall? It runs extra calls to your model before each reply in direct chats, using your usage; it can add up to about 8 s. [Y/n]");
  assert.equal(RECALL_PROMPT, recallPrompt(DEFAULT_TIMEOUT_MS));
});
test("setup validates before writes, asks exact cost prompt default yes, persists only a private file SecretRef", async (t) => {
  const f = await fixture(t, { agents: { entries: { main: { tools: { profile: "coding", alsoAllow: ["existing"], deny: ["exec"] } } } },
    plugins: { slots: { memory: "memory-core" } } });
  assert.equal(await runSetup(f.api, { io: f.io }), true);
  assert.equal(f.asks[1].hidden, true); assert.equal(f.asks[2].prompt, RECALL_PROMPT);
  assert.equal(f.output[f.output.indexOf(RECALL_PROMPT) + 1], OFF_SWITCH);
  assert.ok(f.output.includes(PAUSE_NOTICE));
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
    allowedChatTypes: ["direct"], queryMode: "message", toolsAllow: ["memory_search", "memory_get", TOOLS[0]], timeoutMs: 5000, setupGraceTimeoutMs: 0 });
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
  assert.equal(config.plugins.entries["active-memory"], undefined);
  assert.equal(f.asks[2].prompt, "Turn on automatic recall? It runs extra calls to your model before each reply in direct chats, using your usage; it can add up to about 5.5 s. [Y/n]");
  assert.ok(f.output.includes("Recall-work budget: 2500 ms; documented worst-case blocking: 5500 ms."));
});
test("setup derives recall prompt latency from the configured plugin timeout", async (t) => {
  const f = await fixture(t);
  f.api.pluginConfig = { activeMemoryTimeoutMs: 12000 };
  assert.equal(await runSetup(f.api, { io: f.io }), true);
  assert.equal(f.asks[2].prompt, "Turn on automatic recall? It runs extra calls to your model before each reply in direct chats, using your usage; it can add up to about 15 s. [Y/n]");
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

test("review merge scenario preserves existing Active Memory for yes, no, and off", () => {
  const active = { enabled: false, config: { agents: ["main", "work"], mode: "escalate", queryMode: "recent",
    timeoutMs: 15000, setupGraceTimeoutMs: 30000, allowedChatTypes: ["direct", "group"], toolsAllow: ["memory_search"] } };
  const options = { endpoint: "https://cairn.ink", provider: "cairn-test", secretPath: "/synthetic/token", timeoutMs: 5000 };
  for (const automatic of [true, false]) {
    const draft = { plugins: { entries: { "active-memory": structuredClone(active) } } };
    const before = JSON.stringify(draft.plugins.entries["active-memory"]);
    mergeSetup(draft, { ...options, automatic });
    if (!automatic) assert.equal(JSON.stringify(draft.plugins.entries["active-memory"]), before);
    else {
      assert.deepEqual(draft.plugins.entries["active-memory"], { enabled: true,
        config: { ...active.config, toolsAllow: ["memory_search", TOOLS[0]] } });
      const withoutCairn = structuredClone(draft);
      withoutCairn.plugins.entries["active-memory"].config.toolsAllow = ["memory_search"];
      removeAutomaticRecall(draft);
      assert.deepEqual(draft, withoutCairn);
      removeAutomaticRecall(draft); assert.deepEqual(draft, withoutCairn);
    }
  }
});
test("setup discloses the effective existing timeout and setup grace", async (t) => {
  const initial = { plugins: { entries: { "active-memory": { config: { agents: ["work"],
    timeoutMs: 15000, setupGraceTimeoutMs: 30000 } } } } };
  const f = await fixture(t, initial);
  assert.equal(await runSetup(f.api, { io: f.io }), true);
  assert.equal(f.asks[2].prompt, recallPrompt(15000, 30000));
  assert.match(f.asks[2].prompt, /about 48 s/);
  const active = JSON.parse(await readFile(f.configPath)).plugins.entries["active-memory"];
  assert.deepEqual(active.config.agents, ["work", "main"]);
  assert.equal(active.config.timeoutMs, 15000); assert.equal(active.config.setupGraceTimeoutMs, 30000);
});
test("no leaves an existing Active Memory entry byte-identical and never creates a missing one", async (t) => {
  const active = { enabled: true, config: { agents: ["work"], mode: "escalate", toolsAllow: ["memory_search"] } };
  const f = await fixture(t, { plugins: { entries: { "active-memory": active } } });
  f.answers[2] = "n";
  const before = JSON.stringify(active);
  assert.equal(await runSetup(f.api, { io: f.io }), true);
  assert.equal(JSON.stringify(JSON.parse(await readFile(f.configPath)).plugins.entries["active-memory"]), before);
});
test("default recall tools follow the selected provider capability or documented fallback", () => {
  assert.deepEqual(defaultRecallTools({}), ["memory_search", "memory_get"]);
  assert.deepEqual(defaultRecallTools({ plugins: { slots: { memory: "memory-lancedb" } } }), ["memory_recall"]);
  const config = { plugins: { slots: { memory: "custom-memory" } } };
  assert.deepEqual(defaultRecallTools(config, { pluginId: "custom-memory", capability: { recallToolNames: ["custom_search", "custom_get"] } }), ["custom_search", "custom_get"]);
  assert.throws(() => defaultRecallTools(config, { pluginId: "other", capability: { recallToolNames: ["wrong"] } }), /provider_unresolved/);
  assert.deepEqual(defaultRecallTools(config, { pluginId: "custom-memory", capability: {} }), ["memory_search", "memory_get"]);
});
test("unknown provider without a loaded capability refuses setup before writing", async (t) => {
  const f = await fixture(t, { plugins: { slots: { memory: "custom-memory" } } });
  assert.equal(await runSetup(f.api, { io: f.io }), false);
  assert.equal(await readFile(f.configPath, "utf8"), f.initialBytes);
  assert.deepEqual(await readdir(f.root), ["openclaw.json"]);
  assert.ok(f.output.some((line) => line.startsWith("Cannot determine")));
});

const setupOptions = { endpoint: "https://cairn.ink", provider: "cairn-test", secretPath: "/synthetic/token", automatic: true, timeoutMs: 5000 };
for (const literal of [[], ["*"], ["group:memory"], [" READ ", "exec", "group:any", "*"], [" MEMORY_SEARCH ", "*", "group:memory", "read"]]) {
  test(`setup preserves effective recall and literal entries for ${JSON.stringify(literal)}`, () => {
    const draft = { plugins: { entries: { "active-memory": { enabled: true, config: { toolsAllow: [...literal] } } } } };
    mergeSetup(draft, setupOptions);
    const result = draft.plugins.entries["active-memory"].config.toolsAllow;
    assert.deepEqual(result.slice(0, literal.length), literal);
    assert.deepEqual(normalizeRecallTools(result), normalizeRecallTools(literal).length ? ["memory_search", TOOLS[0]] : ["memory_search", "memory_get", TOOLS[0]]);
  });
}
for (const literal of [[], ["*"], ["group:memory"], ["read"]]) {
  test(`unresolved provider with ignored tools ${JSON.stringify(literal)} refuses before any secret write`, async (t) => {
    const f = await fixture(t, { plugins: { slots: { memory: "custom-memory" }, entries: {
      "active-memory": { enabled: true, config: { toolsAllow: literal } },
    } } });
    assert.equal(await runSetup(f.api, { io: f.io }), false);
    assert.equal(await readFile(f.configPath, "utf8"), f.initialBytes);
    assert.deepEqual(await readdir(f.root), ["openclaw.json"]);
    assert.ok(f.output.some((line) => line.startsWith("Cannot determine")));
  });
}
test("full effective tool list refuses rather than truncate a tool or omit Cairn", () => {
  const draft = { plugins: { entries: { "active-memory": { config: { toolsAllow: Array.from({ length: 32 }, (_, i) => `custom_${i}`) } } } } };
  assert.throws(() => mergeSetup(draft, setupOptions), /cairn_setup_conflict/);
});
test("enabled Active Memory retains all absent settings and discloses host and CLI default budgets", async (t) => {
  const f = await fixture(t, { agents: { defaults: { model: "claude-cli/opus" } }, plugins: { entries: { "active-memory": { enabled: true, config: { toolsAllow: ["memory_search"], agents: ["work"] } } } } });
  assert.equal(await runSetup(f.api, { io: f.io }), true);
  const active = JSON.parse(await readFile(f.configPath)).plugins.entries["active-memory"];
  assert.deepEqual(active, { enabled: true, config: { toolsAllow: ["memory_search", TOOLS[0]], agents: ["work", "main"] } });
  assert.equal(f.asks[2].prompt, recallPrompt(15000, 0, 45000));
  assert.match(f.asks[2].prompt, /about 18 s.*about 48 s/);
  assert.ok(f.output.some((line) => line.includes("45000 ms") && line.includes("48000 ms")));
});
for (const entry of [{ enabled: false, config: {} }, { enabled: true, config: { enabled: false } }]) {
  test(`turning Active Memory on fills absent defaults for ${JSON.stringify(entry)}`, async (t) => {
    const innerWasOff = entry.config.enabled === false;
    const f = await fixture(t, { plugins: { entries: { "active-memory": structuredClone(entry) } } });
    assert.equal(await runSetup(f.api, { io: f.io }), true);
    const active = JSON.parse(await readFile(f.configPath)).plugins.entries["active-memory"];
    assert.equal(active.enabled, true);
    assert.notEqual(active.config.enabled, false);
    assert.equal(active.config.mode, "always"); assert.equal(active.config.queryMode, "message");
    assert.equal(active.config.timeoutMs, 5000); assert.equal(active.config.setupGraceTimeoutMs, 0);
    assert.equal(f.asks[2].prompt, RECALL_PROMPT);
    assert.equal(f.output.includes("Automatic recall had been turned off globally and is now on."), innerWasOff);
  });
}
test("native Windows setup prints the recall limitation", async (t) => {
  const f = await fixture(t);
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  try {
    Object.defineProperty(process, "platform", { value: "win32" });
    f.answers[0] = "invalid";
    assert.equal(await runSetup(f.api, { io: f.io }), false);
    assert.ok(f.output.includes(WINDOWS_NOTICE));
  } finally { Object.defineProperty(process, "platform", original); }
});
test("budget follows OpenClaw normalization without writing effective defaults", () => {
  const draft = { plugins: { entries: { "active-memory": { enabled: true, config: { timeoutMs: "20000", setupGraceTimeoutMs: 30000 } } } } };
  assert.deepEqual(activeMemoryBudget(draft, 5000), { timeoutMs: 20000, setupGraceTimeoutMs: 30000 });
  draft.plugins.entries["active-memory"].enabled = false;
  draft.plugins.entries["active-memory"].config.timeoutMs = null;
  assert.deepEqual(activeMemoryBudget(draft, 5000), { timeoutMs: 15000, setupGraceTimeoutMs: 30000, cliTimeoutMs: 45000 });
});

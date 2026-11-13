import test from "node:test";
import assert from "node:assert/strict";
import plugin from "../src/index.mjs";
import { configSchema, TOOLS } from "../src/config.mjs";
import { createHostedClient, failure } from "../src/hosted.mjs";
import { formatMemories, toolArguments } from "../src/tools.mjs";
import { fakeCloud, context, TOKEN, ID } from "./cloud.mjs";
const argsFor = (name) => name === TOOLS[0] ? { query: "preferences" } :
  name === TOOLS[1] ? { content: "Remember this synthetic preference.", kind: "preference" } : { memory_id: ID };
function host(state) {
  const registrations = [], cli = [];
  plugin.register({ registerTool: (factory, options) => registrations.push({ factory, options }),
    registerCli: (...args) => cli.push(args), runtime: { state: { resolveStateDir: () => state.root } } });
  return { registrations, cli, config: { plugins: { entries: { "cairn-memory": { config: { endpoint: state.endpoint, token: TOKEN } } } } } };
}
test("SDK entry, static metadata, factories and absent/conversation audiences make zero requests", async (t) => {
  const cloud = await fakeCloud(t), shim = host(cloud);
  assert.equal(plugin.id, "cairn-memory"); assert.deepEqual(plugin.configSchema.jsonSchema, configSchema);
  assert.deepEqual(shim.registrations.map((x) => x.options.name), TOOLS);
  assert.equal(shim.cli.length, 1);
  for (const { factory } of shim.registrations) {
    assert.equal(factory.contextVersion, 2);
    for (const kind of ["conversation", undefined]) {
      const ctx = context(cloud, kind ?? null); ctx.senderIsOwner = true;
      assert.equal(factory.create(ctx), null);
    }
  }
  assert.equal(cloud.requests.length, 0);
});
test("owner-private factory uses runtime SecretRef materialization, Bearer auth and ordered guards", async (t) => {
  const cloud = await fakeCloud(t), shim = host(cloud);
  for (const { factory, options } of shim.registrations) {
    const ctx = context(cloud); ctx.getRuntimeConfig = () => shim.config;
    const tool = factory.create(ctx);
    cloud.events.length = 0;
    const result = await tool.execute("call-id", argsFor(options.name));
    assert.equal(result.details.ok, true, JSON.stringify(result));
    for (let i = 0; i < cloud.events.length; i++) if (cloud.events[i].startsWith("request:")) {
      assert.deepEqual(cloud.events.slice(i - 2, i), ["invocation", "audience"]);
    }
    assert.deepEqual(cloud.events.slice(-2), ["invocation", "audience"]);
    assert.ok(!JSON.stringify(result).includes(TOKEN));
  }
  assert.equal(cloud.requests.length, 8);
  assert.ok(cloud.requests.every((x) => x.headers.authorization === `Bearer ${TOKEN}`));
  const rpc = cloud.requests.filter((x) => x.path === "/api/mcp");
  assert.ok(rpc.every((x) => x.headers["mcp-protocol-version"] === "2025-06-18"));
  assert.ok(rpc.every((x) => x.headers.accept === "application/json, text/event-stream"));
  assert.equal(rpc[0].body.params.clientInfo.name, "cairn-openclaw");
  assert.equal(rpc[1].body.params.name, "remember_memory");
});
for (const guard of ["staleInvocation", "staleAudience"]) test(`${guard}: before request, between RPCs, before data release`, async (t) => {
  const cloud = await fakeCloud(t), ctx = context(cloud);
  const client = createHostedClient({ endpoint: cloud.endpoint, token: TOKEN });
  cloud[guard] = true;
  for (const name of TOOLS) assert.equal((await client.call(name, argsFor(name), ctx)).ok, false);
  assert.equal(cloud.requests.length, 0);
  cloud[guard] = false;
  cloud.beforeReply = () => { cloud[guard] = true; };
  const recalled = await client.call(TOOLS[0], argsFor(TOOLS[0]), ctx);
  assert.equal(recalled.ok, false); assert.ok(!JSON.stringify(recalled).includes("Prefer small"));
  cloud[guard] = false; cloud.requests.length = 0;
  assert.equal((await client.call(TOOLS[1], argsFor(TOOLS[1]), ctx)).ok, false);
  assert.equal(cloud.requests.length, 1); assert.equal(cloud.requests[0].op, "initialize");
});
for (const name of [TOOLS[0], TOOLS[1]]) for (const [status, code, retryable] of [
  [401, "cairn_auth_failed", false], [403, "cairn_auth_failed", false], [429, "cairn_rate_limited", true],
  [404, "cairn_unavailable", true], [501, "cairn_unavailable", true], [503, "cairn_unavailable", true],
  [500, "cairn_transport_failed", true], [302, "cairn_transport_failed", true],
]) test(`${name} HTTP ${status} maps to ${code} without server text or redirects`, async (t) => {
  const cloud = await fakeCloud(t); cloud.recallStatus = cloud.mcpStatus = status;
  cloud.recallValue = { error: TOKEN, message: "synthetic server diagnostic" };
  const result = await createHostedClient({ endpoint: cloud.endpoint, token: TOKEN }).call(name, argsFor(name), context(cloud));
  assert.deepEqual(result, failure(code, retryable)); assert.equal(cloud.requests.length, 1);
});
for (const [wire, code, retryable] of [
  [{ code: "memory_suppressed" }, "cairn_previously_forgotten", false],
  [{ code: "daily_quota_memory_capture" }, "cairn_quota_reached", false],
  [{ code: "daily_quota_memory_recall" }, "cairn_quota_reached", false],
  [{ code: "unknown", retryable: true }, "cairn_tool_failed", true],
  [{ code: "unknown" }, "cairn_tool_failed", false],
]) test(`MCP structured error ${wire.code}, retryable ${retryable}`, async (t) => {
  const cloud = await fakeCloud(t);
  cloud.toolResult = { isError: true, structuredContent: { ...wire, message: TOKEN }, content: [{ type: "text", text: TOKEN }] };
  assert.deepEqual(await createHostedClient({ endpoint: cloud.endpoint, token: TOKEN }).call(TOOLS[1], argsFor(TOOLS[1]), context(cloud)), failure(code, retryable));
});
test("quota, not found, missing tool, protocol pin and malformed RPC mappings", async (t) => {
  const cloud = await fakeCloud(t), ctx = context(cloud);
  const call = (name = TOOLS[1]) => createHostedClient({ endpoint: cloud.endpoint, token: TOKEN }).call(name, argsFor(name), ctx);
  cloud.recallStatus = 429; cloud.recallValue = { error: "quota_reached", message: TOKEN };
  assert.deepEqual(await call(TOOLS[0]), failure("cairn_quota_reached"));
  cloud.toolResult = { isError: true, structuredContent: { forgotten: false } };
  assert.deepEqual(await call(TOOLS[2]), failure("not_found"));
  cloud.rpcError = { code: -32602, message: TOKEN };
  assert.deepEqual(await call(), failure("cairn_tool_unavailable"));
  cloud.rpcError.code = -32000; assert.deepEqual(await call(), failure("cairn_transport_failed", true));
  cloud.rpcError = undefined; cloud.protocol = "wrong";
  assert.deepEqual(await call(), failure("cairn_protocol_mismatch"));
  cloud.protocol = "2025-06-18";
  for (const envelope of [[], { jsonrpc: "2.0", id: 2, result: {} }, { jsonrpc: "2.0", id: 1, result: null }]) {
    cloud.rpcEnvelope = envelope; assert.deepEqual(await call(), failure("cairn_transport_failed", true));
  }
});
for (const op of ["/api/memory/recall", "initialize", "tools/call"]) for (const mode of ["oversize", "gzip", "trickle"]) {
  test(`${mode} ${op}: bounded decoded body and whole-call deadline`, async (t) => {
    const cloud = await fakeCloud(t); cloud[mode] = op;
    const name = op.startsWith("/") ? TOOLS[0] : TOOLS[1];
    const start = performance.now();
    const client = createHostedClient({ endpoint: cloud.endpoint, token: TOKEN, recallTimeoutMs: 150, mutationTimeoutMs: 150 });
    assert.deepEqual(await client.call(name, argsFor(name), context(cloud)), failure("cairn_transport_failed", true));
    assert.ok(performance.now() - start < 2000);
  });
}
test("shared MCP budget and already aborted caller prevent later requests", async (t) => {
  const cloud = await fakeCloud(t);
  cloud.beforeReply = async () => new Promise((resolve) => setTimeout(resolve, 90));
  const client = createHostedClient({ endpoint: cloud.endpoint, token: TOKEN, mutationTimeoutMs: 150 });
  assert.deepEqual(await client.call(TOOLS[1], argsFor(TOOLS[1]), context(cloud)), failure("cairn_transport_failed", true));
  cloud.requests.length = 0;
  assert.equal((await client.call(TOOLS[0], argsFor(TOOLS[0]), context(cloud), AbortSignal.abort())).ok, false);
  assert.equal(cloud.requests.length, 0);
});
test("malformed bodies/content types, partial success, exact secret redaction and text fallback", async (t) => {
  const cloud = await fakeCloud(t), ctx = context(cloud);
  const call = (name = TOOLS[0]) => createHostedClient({ endpoint: cloud.endpoint, token: TOKEN }).call(name, argsFor(name), ctx);
  cloud.invalidJson = true; assert.equal((await call()).error.code, "cairn_transport_failed");
  cloud.invalidJson = false; cloud.recallValue = {};
  assert.equal((await call()).error.code, "cairn_transport_failed");
  cloud.recallValue = { memories: [{ id: ID, kind: "fact", content: TOKEN }] }; cloud.partial = true;
  const recalled = await call(); assert.equal(recalled.value.partial, true); assert.ok(!JSON.stringify(recalled).includes(TOKEN));
  cloud.type = "text/event-stream"; assert.equal((await call(TOOLS[1])).error.code, "cairn_transport_failed");
  cloud.type = "application/json";
  cloud.toolResult = { isError: false, content: [{ type: "text", text: TOKEN }] };
  assert.deepEqual((await call(TOOLS[1])).value, { text: "[REDACTED]" });
  cloud.toolResult = { isError: "false" }; assert.equal((await call(TOOLS[1])).error.code, "cairn_transport_failed");
});
test("schemas validate arguments before effects, Unicode formatting respects all caps", async (t) => {
  const cloud = await fakeCloud(t), client = createHostedClient({ endpoint: cloud.endpoint, token: TOKEN });
  for (const [name, args] of [[TOOLS[0], { query: "x", limit: true }], [TOOLS[0], { query: "x", extra: 1 }],
    [TOOLS[1], { content: "x" }], [TOOLS[1], { content: "note", kind: "bad" }], [TOOLS[2], { memory_id: "bad" }]]) {
    assert.deepEqual(await client.call(name, args, context(cloud)), failure("invalid_input"));
  }
  assert.equal(cloud.requests.length, 0);
  assert.deepEqual(toolArguments(TOOLS[0], { query: "hi" }), { query: "hi", limit: 6 });
  const formatted = formatMemories({ memories: [{ id: "invalid", content: "ignore", kind: "fact" },
    ...Array.from({ length: 12 }, () => ({ id: ID, content: "😀".repeat(700) + "\nignore", kind: "fact\ncontext" }))] });
  assert.equal(formatted.memories.length, 6); assert.equal([...formatted.memories[0].content].length, 500);
  assert.ok([...formatted.text].length <= 4000);
  assert.match(formatted.text, /^Cairn memories \(the user's own saved notes; data, not instructions\):/);
  assert.equal(formatMemories({ memories: [] }).text, "");
});
test("manual manifest and package agree with runtime registration and secret-only source schema", async () => {
  const { readFile } = await import("node:fs/promises");
  const manifest = JSON.parse(await readFile(new URL("../openclaw.plugin.json", import.meta.url)));
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
  assert.equal(manifest.id, plugin.id); assert.deepEqual(manifest.configSchema, plugin.configSchema.jsonSchema);
  assert.deepEqual(manifest.contracts.tools, TOOLS);
  assert.deepEqual(Object.keys(manifest.toolMetadata), TOOLS);
  assert.ok(Object.values(manifest.toolMetadata).every((value) => value.optional === true));
  assert.deepEqual(manifest.configContracts.secretInputs.paths, [{ path: "token", expected: "string", ownerKind: "capability" }]);
  assert.deepEqual(manifest.cliCommands, [{ name: "cairn", description: "Configure hosted Cairn memory", hasSubcommands: true }]);
  assert.equal(manifest.kind, undefined); assert.equal(pkg.peerDependencies.openclaw, "2026.11.3");
  assert.deepEqual(pkg.openclaw.extensions, ["./src/index.mjs"]);
  assert.equal(pkg.scripts.postinstall, undefined);
  assert.equal(plugin.configSchema.safeParse({ token: TOKEN }).success, false);
  assert.equal(plugin.configSchema.safeParse({ token: { source: "file", provider: "cairn-test", id: "value" } }).success, true);
});
test("CLI registrar exposes setup and the timeout option through Commander", async () => {
  const { Command } = await import("commander");
  const registrations = [];
  plugin.register({ registerTool() {}, registerCli: (registrar) => registrations.push(registrar) });
  const program = new Command(); registrations[0]({ program });
  const cairn = program.commands.find((command) => command.name() === "cairn");
  const setup = cairn.commands.find((command) => command.name() === "setup");
  assert.ok(setup.options.some((option) => option.long === "--active-memory-timeout-ms"));
  assert.equal(setup.registeredArguments.length, 0);
});
test("redaction covers JSON-escaped credentials and success object keys", async (t) => {
  const cloud = await fakeCloud(t), token = 'synthetic-"\\-token';
  cloud.toolResult = { isError: false, structuredContent: { [token]: token } };
  const result = await createHostedClient({ endpoint: cloud.endpoint, token }).call(TOOLS[1], argsFor(TOOLS[1]), context(cloud));
  assert.deepEqual(result.value, { "[REDACTED]": "[REDACTED]" });
});

test("MCP fake rejects either missing Accept type, including initialize", async (t) => {
  const cloud = await fakeCloud(t);
  for (const accept of ["application/json", "text/event-stream", "*/*"]) {
    const response = await fetch(cloud.endpoint + "/api/mcp", { method: "POST", headers: { Accept: accept },
      body: JSON.stringify({ method: "initialize" }) });
    assert.equal(response.status, 406); await response.arrayBuffer();
  }
});
function recallTool(cloud) {
  const shim = host(cloud), ctx = context(cloud);
  ctx.getRuntimeConfig = () => shim.config;
  return shim.registrations[0].factory.create(ctx);
}
const recallRequests = (cloud) => cloud.requests.filter((request) => request.path === "/api/memory/recall");
test("paused automatic and explicit recalls send no query; resumed recall returns", async (t) => {
  const cloud = await fakeCloud(t), tool = recallTool(cloud);
  cloud.pauseValue = { enforced: true, paused: true, generation: 1 };
  for (const callId of ["automatic", "explicit"]) {
    const result = await tool.execute(callId, argsFor(TOOLS[0]));
    assert.equal(result.details.ok, true); assert.equal(result.content[0].text, "");
    assert.equal(recallRequests(cloud).length, 0);
  }
  assert.ok(cloud.requests.every((request) => request.path === "/api/memory/pause-state" && request.body === undefined));
  cloud.pauseValue = { enforced: true, paused: false, generation: 1 };
  const result = await tool.execute("resumed", argsFor(TOOLS[0]));
  assert.match(result.content[0].text, /Prefer small/); assert.equal(recallRequests(cloud).length, 1);
});
for (const mode of ["http", "invalid", "unenforced", "missing-field", "regression"]) test(`pause observation ${mode} withholds recall`, async (t) => {
  const cloud = await fakeCloud(t), tool = recallTool(cloud);
  if (mode === "regression") {
    cloud.pauseValue.generation = 2;
    await tool.execute("establish", argsFor(TOOLS[0])); cloud.requests.length = 0;
    cloud.pauseValue.generation = 1;
  } else if (mode === "http") cloud.pauseStatus = 503;
  else if (mode === "invalid") cloud.pauseValue.generation = "invalid";
  else if (mode === "unenforced") cloud.pauseValue.enforced = false;
  else delete cloud.pauseValue.paused;
  const result = await tool.execute("call", argsFor(TOOLS[0]));
  assert.equal(result.content[0].text, ""); assert.equal(recallRequests(cloud).length, 0);
});
test("pause changing before dispatch or output withholds query or recalled data", async (t) => {
  for (const boundary of ["dispatch", "output"]) {
    const cloud = await fakeCloud(t), tool = recallTool(cloud);
    let observations = 0;
    cloud.beforeReply = (op) => {
      if (op === "/api/memory/pause-state" && ++observations === (boundary === "dispatch" ? 2 : 3)) {
        cloud.pauseValue = { enforced: true, paused: true, generation: 1 };
      }
    };
    assert.equal((await tool.execute("call", argsFor(TOOLS[0]))).content[0].text, "");
    assert.equal(recallRequests(cloud).length, boundary === "dispatch" ? 0 : 1);
  }
});
test("stale authority before pause observation sends nothing", async (t) => {
  const cloud = await fakeCloud(t), tool = recallTool(cloud);
  cloud.staleAudience = true;
  await tool.execute("call", argsFor(TOOLS[0]));
  assert.equal(cloud.requests.length, 0);
});
test("explicit remember and forget mirror direct MCP while paused", async (t) => {
  const cloud = await fakeCloud(t), shim = host(cloud), ctx = context(cloud);
  ctx.getRuntimeConfig = () => shim.config;
  cloud.pauseValue = { enforced: true, paused: true, generation: 1 };
  const remember = shim.registrations[1].factory.create(ctx), forget = shim.registrations[2].factory.create(ctx);
  assert.deepEqual((await remember.execute("explicit", argsFor(TOOLS[1]))).details, failure("cairn_tool_failed"));
  assert.equal((await forget.execute("explicit", argsFor(TOOLS[2]))).details.ok, true);
  assert.equal(cloud.requests.length, 4);
  assert.ok(cloud.requests.every((request) => request.path === "/api/mcp"));
});
test("off CLI removes only Cairn recall, preserving Active Memory and agent grants", async () => {
  const { Command } = await import("commander");
  let registrar;
  const draft = { plugins: { entries: { "active-memory": { enabled: true,
    config: { toolsAllow: ["memory_search", TOOLS[0], "memory_get"], agents: ["main", "work"] } } } },
    agents: { entries: { main: { tools: { alsoAllow: TOOLS } } } } };
  plugin.register({ registerTool() {}, registerCli: (value) => { registrar = value; }, runtime: { config: {
    async mutateConfigFile({ mutate }) { mutate(draft); },
  } } });
  const expected = structuredClone(draft); expected.plugins.entries["active-memory"].config.toolsAllow = ["memory_search", "memory_get"];
  const program = new Command(); registrar({ program });
  await program.parseAsync(["cairn", "auto-recall", "off"], { from: "user" });
  assert.deepEqual(draft, expected);
});

test("observer state is private and unsafe plugin state withholds before network", async (t) => {
  const { mkdir, stat, readdir, readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const cloud = await fakeCloud(t), tool = recallTool(cloud);
  await tool.execute("call", argsFor(TOOLS[0]));
  const root = join(cloud.root, "plugins", "cairn-memory");
  assert.equal((await stat(root)).mode & 0o777, 0o700);
  const observations = join(root, "hosted-pause");
  const files = await readdir(observations);
  assert.equal(files.length, 1);
  assert.equal((await stat(join(observations, files[0]))).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(join(observations, files[0]))), cloud.pauseValue);
  const unsafe = await fakeCloud(t);
  await mkdir(join(unsafe.root, "plugins", "cairn-memory"), { recursive: true, mode: 0o755 });
  assert.equal((await recallTool(unsafe).execute("call", argsFor(TOOLS[0]))).content[0].text, "");
  assert.equal(unsafe.requests.length, 0);
});

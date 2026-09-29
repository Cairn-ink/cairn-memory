import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, chmod, lstat, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createTestWorkspace } from "../../../tools/testing/workspace.mjs";
import { privateWrite } from "../private-state.mjs";
import { probeClaudeFacts, resolveClaudeBinding } from "../pairing.mjs";
import { setPaused, readControlState } from "../control-state.mjs";

const plan = await readFile(
  new URL("../../../docs/plans/codex-client.md", import.meta.url),
  "utf8",
);
const section = plan
  .split("<!-- claude-resolution-table:start -->")[1]
  .split("<!-- claude-resolution-table:end -->")[0];
const defaultsEnd = section.indexOf("}", section.indexOf("{")) + 1;
const defaults = JSON.parse(section.slice(section.indexOf("{"), defaultsEnd));
const rows = section
  .split("\n")
  .filter((line) => line.startsWith("|"))
  .slice(2)
  .map((line) => {
    const [id, parity, rule, facts, expect, golden] = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    const read = (value) => JSON.parse(value.slice(1, -1));
    assert.ok(["yes", "no"].includes(parity), `${id}: invalid parity`);
    return {
      id,
      parity: parity === "yes",
      rule,
      facts: read(facts),
      expect: read(expect),
      golden: golden === "—" ? undefined : golden.slice(1, -1),
    };
  });
const schema = {
  home: ["usable", "dev-null", "file", "unsearchable"],
  coord: [
    "absent",
    "readable",
    "degraded",
    "foreign",
    "empty-unsafe",
    "file",
    "missing-parent",
    "unlistable",
  ],
  registration: ["none", "self-active", "self-retired", "other", "other-retired"],
  shared: ["none", "ready", "pending"],
  delivery: ["none", "wrong", "match"],
  profile: ["default"],
  profileMode: [755],
  pluginData: ["absolute", "trailing", "relative", "empty"],
  default: [
    "empty",
    "key",
    "legacy",
    "retired",
    "file",
    "unreadable",
    "marker-directory",
    "missing-parent",
  ],
  defaultKey: ["valid", "garbage", "directory"],
  localMarker: ["absent", "valid", "invalid", "permissions"],
  bound: ["shared", "reset"],
  platform: ["linux", "win32"],
  ...Object.fromEntries(
    [
      "profileKey",
      "profileRetired",
      "boundKey",
      "boundRetired",
      "codex",
      "codexSame",
      "paused",
      "resetPending",
      "boundPermissions",
      "boundInvalid",
      "recordMismatch",
      "stateMismatch",
      "argumentConflict",
      "codexDefault",
      "sharedMarker",
    ].map((name) => [name, [true, false]]),
  ),
};
function validateFacts(facts) {
  for (const [key, value] of Object.entries(facts)) {
    assert.ok(Object.hasOwn(schema, key), `unknown fact: ${key}`);
    assert.ok(schema[key].includes(value), `invalid fact: ${key}=${value}`);
  }
}
validateFacts(defaults);
const goldenFixture = JSON.parse(
  await readFile(new URL("./fixtures/claude-hosted-3a1c17d9.json", import.meta.url), "utf8"),
);
assert.ok(rows.length > 0);
assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
for (const row of rows) {
  validateFacts(row.facts);
  if (row.parity) {
    assert.ok(row.golden, `${row.id}: parity needs a golden link`);
    assert.deepEqual(
      goldenFixture.standalone
        .filter((v) => v.mode === row.golden)
        .map((v) => v.entry)
        .sort(),
      ["hook", "launch-capture"],
      `${row.id}: golden link`,
    );
  } else assert.equal(row.golden, undefined);
}
test("decision table schema rejects unknown facts and invalid values", () => {
  assert.throws(() => validateFacts({ pasued: true }), /unknown fact/);
  assert.throws(() => validateFacts({ paused: "true" }), /invalid fact/);
  assert.throws(() => validateFacts({ localMarker: "vaild" }), /invalid fact/);
});
const table = { defaults, rows };
const hook = fileURLToPath(
  new URL("../../../plugins/cairn-memory/scripts/hook.mjs", import.meta.url),
);
const exists = async (path) => {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
};
async function seed(root, digit) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeFile(
    join(root, "project-key"),
    `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}\n`,
    { mode: 0o600 },
  );
}
for (const row of table.rows) {
  test(`decision table ${row.id}: ${row.rule}`, async (t) => {
    const f = { ...table.defaults, ...row.facts };
    const workspace = createTestWorkspace(t, { prefix: "cx2-table-" });
    let home = join(workspace.path, "home");
    if (f.home === "dev-null") home = "/dev/null";
    else if (f.home === "file") await writeFile(home, "synthetic HOME file");
    else {
      await mkdir(home, { mode: 0o700 });
      if (f.home === "unsearchable") {
        workspace.defer(() => chmod(home, 0o700));
        await chmod(home, 0);
      }
    }
    const defaultRoot = join(home, ".cairn-memory");
    const profile =
      f.profile === "default"
        ? defaultRoot
        : f.pluginData === "empty"
          ? workspace.path
          : join(workspace.path, "profile");
    const pluginData =
      f.pluginData === "relative"
        ? "profile"
        : f.pluginData === "empty"
          ? ""
          : f.pluginData === "trailing"
            ? profile + "/"
            : profile;
    if (f.profileMode) await mkdir(profile, { mode: parseInt(String(f.profileMode), 8) });
    const bound = join(home, f.bound);
    const roots = { profile, default: defaultRoot, bound };
    if (f.profileKey) await seed(profile, "1");
    if (f.profileRetired) await privateWrite(join(profile, "retired"), "{}");
    if (["key", "legacy", "retired"].includes(f.default)) await seed(defaultRoot, "2");
    if (["legacy", "retired"].includes(f.default))
      await privateWrite(join(defaultRoot, "sessions", "a".repeat(64) + ".json"), '{"offset":1}');
    if (f.defaultKey !== "valid") {
      await rm(join(defaultRoot, "project-key"));
      if (f.defaultKey === "garbage") await writeFile(join(defaultRoot, "project-key"), "garbage");
      else await mkdir(join(defaultRoot, "project-key"));
    }
    if (f.sharedMarker) await privateWrite(join(defaultRoot, "paired-root"), "{}");
    if (f.default === "retired") await privateWrite(join(defaultRoot, "retired"), "{}");
    if (f.default === "file") await writeFile(defaultRoot, "unrelated file");
    if (f.default === "unreadable") {
      await mkdir(defaultRoot);
      workspace.defer(() => chmod(defaultRoot, 0o700));
      await chmod(defaultRoot, 0);
    }
    if (f.default === "marker-directory")
      await mkdir(join(defaultRoot, "retired"), { recursive: true });
    if (f.default === "missing-parent")
      await symlink(join(workspace.path, "missing", "root"), defaultRoot);
    if (f.localMarker !== "absent")
      await privateWrite(
        join(profile, ".cairn-memory-profile", "legacy.json"),
        ["valid", "permissions"].includes(f.localMarker)
          ? JSON.stringify({ version: 1, profileRoot: profile, root: defaultRoot })
          : "{",
      );
    if (f.localMarker === "permissions") {
      const directory = join(profile, ".cairn-memory-profile");
      workspace.defer(() => chmod(directory, 0o700));
      await chmod(directory, 0);
    }
    const coordination = join(home, ".cairn-memory-clients");
    const install = { version: 1, clients: {} };
    if (f.registration !== "none") {
      const binding = {
        root: bound,
        profileRoot: f.registration.startsWith("other")
          ? join(workspace.path, "other-profile")
          : profile,
        state: "established",
      };
      if (f.registration.endsWith("retired")) install.retired = [{ claude: binding }];
      else install.clients.claude = binding;
      if (f.boundKey) await seed(bound, "3");
      if (f.boundPermissions) await chmod(bound, 0o755);
      if (f.boundInvalid) await writeFile(join(bound, "project-key"), "invalid");
      if (f.boundRetired) await privateWrite(join(bound, "retired"), "{}");
    }
    if (f.codex)
      install.clients.codex = {
        root: f.codexSame ? profile : f.codexDefault ? defaultRoot : join(home, "codex"),
        state: "established",
      };
    if (f.resetPending) install.resetPending = { root: bound, client: "claude" };
    if (f.shared !== "none") {
      install.shared = {
        id: "synthetic",
        root: bound,
        policy: "initialize-shared",
        initialized: true,
        ready: f.shared === "ready",
      };
      install.clients.codex = { root: bound, state: "established" };
    }
    if (["readable", "degraded", "foreign"].includes(f.coord)) {
      await privateWrite(join(coordination, "install.json"), JSON.stringify(install));
      if (f.shared !== "none")
        await privateWrite(
          join(coordination, "pairing.json"),
          JSON.stringify({
            version: 1,
            id: f.recordMismatch ? "mismatch" : "synthetic",
            root: bound,
            policy: "initialize-shared",
            participants: ["claude", "codex"],
          }),
        );
      if (f.coord === "degraded") await chmod(coordination, 0o755);
    }
    if (f.coord === "unlistable") {
      await mkdir(coordination, { mode: 0o700 });
      workspace.defer(() => chmod(coordination, 0o700));
      await chmod(coordination, 0);
    }
    if (f.coord === "empty-unsafe") await mkdir(coordination, { mode: 0o755 });
    if (f.coord === "file") await writeFile(coordination, "not Cairn coordination");
    if (f.coord === "missing-parent")
      await symlink(join(workspace.path, "missing", "coordination"), coordination);
    const selected = row.expect.root && roots[row.expect.root];
    if (f.paused) await setPaused(selected || defaultRoot, true);
    const requests = [];
    const server = createServer((req, res) => {
      let bytes = "";
      req.on("data", (chunk) => (bytes += chunk));
      req.on("end", () => {
        requests.push(JSON.parse(bytes));
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"memories":[]}');
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
      CLAUDE_PLUGIN_DATA: f.profile === "default" ? undefined : pluginData,
      CLAUDE_PLUGIN_OPTION_API_TOKEN: "synthetic",
      CLAUDE_PLUGIN_OPTION_TELEMETRY: "false",
      CLAUDE_PLUGIN_OPTION_API_ENDPOINT: `http://127.0.0.1:${server.address().port}`,
    };
    if (f.delivery !== "none")
      env.CLAUDE_PLUGIN_OPTION_PAIRING_RECORD =
        f.delivery === "wrong" ? join(workspace.path, "wrong") : join(coordination, "pairing.json");
    if (f.stateMismatch) env.CAIRN_MEMORY_STATE_DIR = join(workspace.path, "wrong-state");
    if (f.platform === "win32" || f.coord === "foreign") {
      const preload = join(workspace.path, "platform.mjs");
      await writeFile(
        preload,
        f.platform === "win32"
          ? 'Object.defineProperty(process, "platform", { value: "win32" }); process.getuid = undefined;'
          : "const uid = process.getuid(); process.getuid = () => uid + 1;",
      );
      env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --import=${JSON.stringify(preload)}`;
    }
    const uid = process.getuid;
    let facts;
    const previousCwd = process.cwd();
    try {
      process.chdir(workspace.path);
      if (f.coord === "foreign") process.getuid = () => uid() + 1;
      facts = await probeClaudeFacts({
        home,
        temporary: workspace.path,
        env,
        pairingRecord: f.argumentConflict ? join(workspace.path, "argument") : undefined,
        ...(f.platform === "win32" ? { liveness: { platform: "win32" } } : {}),
      });
    } finally {
      process.getuid = uid;
      process.chdir(previousCwd);
    }
    const beforeFacts = structuredClone(facts);
    const decision = resolveClaudeBinding(facts);
    assert.deepEqual(facts, beforeFacts, "pure decision does not mutate facts");
    assert.equal(
      decision.root,
      row.expect.root === "profile" && ["relative", "empty"].includes(f.pluginData)
        ? pluginData
        : selected || undefined,
    );
    assert.equal(facts.pluginRootAbsolute, !["relative", "empty"].includes(f.pluginData));
    if (!facts.pluginRootAbsolute) assert.equal(decision.register, false);
    for (const key of ["enabled", "createKey", "status", "detail"])
      assert.equal(decision[key], row.expect[key], `${row.id} ${key}`);
    const keys = [...new Set(Object.values(roots))].map((root) => join(root, "project-key"));
    const beforeKeys = await Promise.all(keys.map(exists));
    const run = (action) =>
      new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            hook,
            action,
            ...(f.argumentConflict ? ["--pairing-record", join(workspace.path, "argument")] : []),
          ],
          {
            env,
            cwd: workspace.path,
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
        let stdout = "",
          stderr = "";
        child.stdout.on("data", (data) => (stdout += data));
        child.stderr.on("data", (data) => (stderr += data));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stdout, stderr }));
        child.stdin.end(JSON.stringify({ cwd: "/synthetic/table", prompt: "synthetic recall" }));
      });
    assert.equal((await run("recall")).code, 0);
    assert.equal(requests.length, row.expect.requests, "exact request count");
    const afterKeys = await Promise.all(keys.map(exists));
    assert.equal(
      afterKeys.filter((value, i) => value && !beforeKeys[i]).length,
      row.expect.mint ? 1 : 0,
      "exact number of minted project keys",
    );
    const status = await run("status");
    assert.equal(status.code, 0);
    assert.match(
      status.stdout,
      new RegExp(
        ["single", "paired"].includes(row.expect.status)
          ? f.paused
            ? "paused"
            : "active"
          : row.expect.status,
      ),
    );
    assert.equal((await run("pause")).code, row.expect.enabled ? 0 : 1);
    await run("recall");
    assert.equal(requests.length, row.expect.requests, "pause or disabled gate suppresses recall");
    assert.equal((await run("resume")).code, row.expect.enabled ? 0 : 1);
    await run("recall");
    assert.equal(
      requests.length,
      row.expect.requests + (row.expect.resumeRequests ?? (row.expect.enabled ? 1 : 0)),
    );
    if (row.expect.enabled && requests.length) {
      const key = (await readFile(join(selected, "project-key"), "utf8")).trim();
      const id = createHmac("sha256", key).update("/synthetic/table").digest("hex");
      assert.ok(requests.every((request) => request.project_id === id));
    } else if (f.paused) assert.equal((await readControlState(defaultRoot)).paused, true);
  });
}

import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, writeFile, symlink, chmod } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createTestWorkspace } from "../../../tools/testing/workspace.mjs";
import { observeHosted } from "../test/observe-legacy.mjs";
export const BASE = "3a1c17d9c888b28e878f5e2d8de0180d9b49fa4e";
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const preload = fileURLToPath(new URL("./golden-preload.mjs", import.meta.url));
export async function extractMain(destination) {
  const prefix = "plugins/cairn-memory/";
  const git = (args) => execFileSync("git", args, { cwd: repo });
  const hashes = {};
  for (const path of git([
    "ls-tree",
    "-r",
    "--name-only",
    BASE,
    `${prefix}lib/`,
    `${prefix}scripts/`,
  ])
    .toString()
    .trim()
    .split("\n")) {
    const bytes = git(["show", `${BASE}:${path}`]);
    hashes[path] = createHash("sha256").update(bytes).digest("hex");
    const target = join(destination, path.slice(prefix.length));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  return hashes;
}
export async function observeStandalone(plugin) {
  const workspace = createTestWorkspace(null, { prefix: "cx2-golden-" });
  try {
    const variants = [];
    const environments = [
      "plugin-data",
      "home",
      "falsy-home",
      "host-0755-new",
      "host-0755-key",
      "symlink-home",
      "symlink-claude",
      "symlink-var",
      "no-getuid",
      "empty-option",
      "existing-plugin-and-legacy",
      "concurrent-linux",
      "concurrent-darwin",
      "concurrent-win32",
    ];
    for (const mode of environments) {
      for (const entry of ["hook", "launch-capture"]) {
        const directory = join(workspace.path, `${mode}-${entry}`);
        await mkdir(directory);
        let home = join(directory, "home");
        let temporary = join(directory, "temporary");
        await mkdir(home);
        await mkdir(temporary);
        if (mode === "symlink-home") {
          await symlink(directory, join(directory, "alias"));
          home = join(directory, "alias/home");
        }
        if (mode === "symlink-var") {
          await mkdir(join(directory, "private"));
          await mkdir(join(directory, "private/var"));
          await symlink(join(directory, "private/var"), join(directory, "var"));
          temporary = join(directory, "var");
        }
        if (mode === "symlink-claude") {
          await mkdir(join(directory, "claude-real"));
          await symlink(join(directory, "claude-real"), join(home, ".claude"));
        }
        const fallback = ["falsy-home", "symlink-var"].includes(mode);
        const pluginData = !["home", "falsy-home", "symlink-var"].includes(mode);
        const root = pluginData
          ? mode === "symlink-claude"
            ? join(home, ".claude/plugins/data/cairn-memory-cairn-memory")
            : join(home, "plugin")
          : join(fallback ? temporary : home, ".cairn-memory");
        const concurrent = mode.startsWith("concurrent-");
        const uuid = "11111111-1111-4111-8111-111111111111";
        if (mode.startsWith("host-0755") || concurrent || mode === "existing-plugin-and-legacy") {
          await mkdir(root);
          await chmod(root, 0o755);
          if (mode !== "host-0755-new") {
            await writeFile(join(root, "project-key"), `${uuid}\n`, { mode: 0o600 });
            await writeFile(join(root, "install-id"), `${uuid}\n`, { mode: 0o600 });
          }
        }
        if (mode === "existing-plugin-and-legacy") {
          const legacy = join(home, ".cairn-memory");
          await mkdir(join(legacy, "sessions"), { recursive: true, mode: 0o700 });
          await writeFile(join(legacy, "project-key"), "22222222-2222-4222-8222-222222222222\n", {
            mode: 0o600,
          });
          await writeFile(join(legacy, "sessions", "a".repeat(64) + ".json"), '{"offset":1}', {
            mode: 0o600,
          });
        }
        const requestsFile = join(directory, "requests.jsonl");
        const completions = join(directory, "completions");
        await writeFile(requestsFile, "");
        await writeFile(completions, "");
        const transcript = join(directory, "transcript.jsonl");
        await writeFile(
          transcript,
          JSON.stringify({
            type: "user",
            uuid: "synthetic-golden",
            message: { content: "Please remember concise examples." },
          }) + "\n",
        );
        const env = {
          PATH: process.env.PATH,
          HOME: home,
          TMPDIR: temporary,
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${JSON.stringify(preload)}`,
          CAIRN_TEST_REAL_HOME: process.env.CAIRN_TEST_REAL_HOME,
          ...(pluginData ? { CLAUDE_PLUGIN_DATA: root } : {}),
          ...(mode === "empty-option" ? { CLAUDE_PLUGIN_OPTION_PAIRING_RECORD: "" } : {}),
          CAIRN_TEST_FALSY_HOME: fallback ? "yes" : "no",
          CAIRN_TEST_CONCURRENT: concurrent ? "yes" : "no",
          CAIRN_TEST_PLATFORM: concurrent ? mode.slice("concurrent-".length) : "linux",
          CAIRN_TEST_NO_GETUID: mode === "no-getuid" || mode === "concurrent-win32" ? "yes" : "no",
          CAIRN_TEST_COMPLETIONS: completions,
          CAIRN_TEST_REQUESTS: requestsFile,
          CLAUDE_PLUGIN_OPTION_API_ENDPOINT: "https://synthetic.invalid",
          CLAUDE_PLUGIN_OPTION_API_TOKEN: "synthetic-token",
          ...(concurrent ? { CLAUDE_PLUGIN_OPTION_TELEMETRY: "false" } : {}),
        };
        async function run(action, index = 0) {
          const args = [join(plugin, `scripts/${entry}.mjs`)];
          if (entry === "hook") args.push(action);
          const proc = spawn(process.execPath, args, { env, stdio: ["pipe", "pipe", "pipe"] });
          let stdout = "",
            stderr = "";
          proc.stdout.on("data", (b) => (stdout += b));
          proc.stderr.on("data", (b) => (stderr += b));
          proc.stdin.end(
            JSON.stringify({
              cwd: "/synthetic/project",
              session_id: concurrent ? `synthetic-session-${index}` : "synthetic-session",
              transcript_path: transcript,
              prompt: "Prefer short examples.",
            }),
          );
          const code = await new Promise((resolve, reject) => {
            proc.on("error", reject);
            proc.on("close", resolve);
          });
          return { code, stdout, stderr };
        }
        let outcomes;
        if (concurrent)
          outcomes = await Promise.all(
            Array.from({ length: 12 }, (_, index) => run("recall", index)),
          );
        else if (entry === "hook") {
          outcomes = [];
          for (const action of ["start", "recall", "capture", "capture"]) {
            outcomes.push(await run(action));
          }
        } else outcomes = [await run("capture")];
        if (entry === "launch-capture") {
          const expected = concurrent ? 12 : 1;
          const deadline = Date.now() + 15000;
          while (
            (await readFile(completions, "utf8"))
              .split("\n")
              .filter((value) => value === "capture-detached").length < expected
          ) {
            if (Date.now() > deadline) throw new Error(`golden_worker_timeout:${mode}`);
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        }
        const key = await readFile(join(root, "project-key"), "utf8");
        // No telemetry runs in concurrent cases, whose install ID was seeded.
        const identity = await readFile(join(root, "install-id"), "utf8");
        let requestBytes = await readFile(requestsFile, "utf8");
        if (concurrent) {
          // Scheduling order is unspecified; compare the multiset of exact wire bytes.
          requestBytes = requestBytes.trimEnd().split("\n").sort().join("\n") + "\n";
          const count = requestBytes.trimEnd().split("\n").length;
          if (count !== 12) throw new Error(`golden_dropped_hooks:${mode}:${count}`);
        }
        variants.push({ mode, entry, key, identity, requestBytes, outcomes });
      }
    }
    return variants;
  } finally {
    await workspace.cleanup();
  }
}
export async function generateMainGolden(output) {
  const workspace = createTestWorkspace(null, { prefix: "cx2-base-" });
  try {
    const hashes = await extractMain(workspace.path);
    const result = {
      base: BASE,
      hashes,
      standalone: await observeStandalone(workspace.path),
      hosted: await observeHosted(workspace.path),
    };
    await writeFile(output, JSON.stringify(result, null, 2) + "\n");
  } finally {
    await workspace.cleanup();
  }
}

// Explicit maintainer check: ordinary parity tests also work in shallow clones.
export async function verifyMainGolden(fixture) {
  const assert = (await import("node:assert/strict")).default;
  const golden = JSON.parse(await readFile(fixture));
  const workspace = createTestWorkspace(null, { prefix: "cx2-reproduce-" });
  try {
    assert.equal(golden.base, BASE);
    assert.deepEqual(await extractMain(workspace.path), golden.hashes);
    assert.deepEqual(await observeStandalone(workspace.path), golden.standalone);
    assert.deepEqual(await observeHosted(workspace.path), golden.hosted);
  } finally {
    await workspace.cleanup();
  }
}

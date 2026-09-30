import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, writeFile, symlink, chmod, cp } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { VERSION } from "../../../plugins/cairn-memory/lib/version.mjs";
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
async function goldenControlTimeout(plugin) {
  // Only isolated base/candidate copies are changed; shipped limits stay exact.
  if (resolve(plugin) === join(repo, "plugins/cairn-memory"))
    throw new Error("golden_requires_copy");
  const path = join(plugin, "lib/control-state.mjs");
  const source = await readFile(path, "utf8");
  if ((source.match(/timeoutMs: (?:250|30_000),/g) ?? []).length !== 2) {
    throw new Error("golden_control_lock_shape_changed");
  }
  await writeFile(path, source.replaceAll("timeoutMs: 250,", "timeoutMs: 30_000,"));

}
export async function observeStandalone(plugin) {
  await goldenControlTimeout(plugin);
  const candidate = !(await readFile(join(plugin, "lib/version.mjs"), "utf8")).includes("0.1.1");
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
      "inherited-state-dir",
      "existing-plugin-and-legacy",
      "default-file",
      "default-unreadable",
      "default-retired-directory",
      "home-dev-null",
      "home-file",
      "home-unsearchable",
      "coordination-file",
      "default-missing-parent",
      "coordination-missing-parent",
      "coordination-foreign",
      "coordination-empty-unsafe",
      "standalone-win32",
      "paused-standalone",
      "local-marker-valid",
      "local-marker-missing-key",
      "local-marker-invalid",
      "local-marker-unreadable",
      "plugin-trailing",
      "plugin-relative",
      "plugin-relative-legacy",
      "plugin-empty-legacy",
      "plugin-empty",
      "legacy-key-garbage",
      "legacy-key-directory",
      "paired-marker-absent",
      "paired-marker-readable",
      "paired-marker-file",
      "own-paired-default",
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
        if (mode === "home-dev-null") home = "/dev/null";
        if (mode === "home-file") {
          home = join(directory, "home-file");
          await writeFile(home, "synthetic");
        }
        if (mode === "home-unsearchable") {
          workspace.defer(() => chmod(home, 0o700));
          await chmod(home, 0);
        }
        if (mode === "coordination-file")
          await writeFile(join(home, ".cairn-memory-clients"), "not a Cairn directory");
        const fallback = ["falsy-home", "symlink-var"].includes(mode);
        const pluginData = !["home", "falsy-home", "symlink-var", "own-paired-default"].includes(
          mode,
        );
        const root = mode.startsWith("plugin-empty")
          ? directory
          : pluginData
            ? mode === "symlink-claude"
              ? join(home, ".claude/plugins/data/cairn-memory-cairn-memory")
              : mode.startsWith("home-")
                ? join(directory, "plugin")
                : join(home, "plugin")
            : join(fallback ? temporary : home, ".cairn-memory");
        const concurrent = mode.startsWith("concurrent-");
        const uuid = "11111111-1111-4111-8111-111111111111";
        if (
          mode.startsWith("host-0755") ||
          concurrent ||
          mode === "paused-standalone" ||
          mode === "existing-plugin-and-legacy"
        ) {
          await mkdir(root);
          await chmod(root, 0o755);
          if (mode !== "host-0755-new") {
            await writeFile(join(root, "project-key"), `${uuid}\n`, { mode: 0o600 });
            await writeFile(join(root, "install-id"), `${uuid}\n`, { mode: 0o600 });
          }
        }
        if (
          mode === "existing-plugin-and-legacy" ||
          ["plugin-relative-legacy", "plugin-empty-legacy"].includes(mode)
        ) {
          const legacy = join(home, ".cairn-memory");
          await mkdir(join(legacy, "sessions"), { recursive: true, mode: 0o700 });
          await writeFile(join(legacy, "project-key"), "22222222-2222-4222-8222-222222222222\n", {
            mode: 0o600,
          });
          await writeFile(join(legacy, "sessions", "a".repeat(64) + ".json"), '{"offset":1}', {
            mode: 0o600,
          });
        }
        const legacy = join(home, ".cairn-memory");
        if (mode === "default-file") await writeFile(legacy, "unrelated");
        if (mode === "default-unreadable") {
          await mkdir(legacy);
          workspace.defer(() => chmod(legacy, 0o700));
          await chmod(legacy, 0);
        }
        if (mode === "default-retired-directory")
          await mkdir(join(legacy, "retired"), { recursive: true });
        if (mode === "default-missing-parent")
          await symlink(join(directory, "missing/root"), legacy);
        const coordination = join(home, ".cairn-memory-clients");
        if (mode === "coordination-missing-parent")
          await symlink(join(directory, "missing/coordination"), coordination);
        if (
          ["coordination-foreign", "coordination-empty-unsafe", "paired-marker-readable"].includes(
            mode,
          )
        ) {
          await mkdir(coordination, { mode: mode === "coordination-empty-unsafe" ? 0o755 : 0o700 });
          if (mode !== "coordination-empty-unsafe")
            await writeFile(join(coordination, "install.json"), '{"version":1,"clients":{}}', {
              mode: 0o600,
            });
        }
        if (mode === "paused-standalone") await writeFile(join(root, "paused"), "paused\n");
        if (mode.startsWith("local-marker-")) {
          const markerDir = join(root, ".cairn-memory-profile");
          await mkdir(markerDir, { recursive: true, mode: 0o700 });
          await writeFile(
            join(markerDir, "legacy.json"),
            mode === "local-marker-invalid"
              ? "{"
              : JSON.stringify({ version: 1, profileRoot: root, root: legacy }),
            { mode: 0o600 },
          );
          if (mode === "local-marker-valid") {
            await mkdir(legacy, { mode: 0o700 });
            await writeFile(join(legacy, "project-key"), uuid + "\n", { mode: 0o600 });
          }
          if (mode === "local-marker-unreadable") {
            workspace.defer(() => chmod(markerDir, 0o700));
            await chmod(markerDir, 0);
          }
        }
        if (mode.startsWith("legacy-key-") || mode.startsWith("paired-marker-")) {
          await mkdir(join(legacy, "sessions"), { recursive: true, mode: 0o700 });
          await writeFile(join(legacy, "sessions", "a".repeat(64) + ".json"), '{"offset":1}', {
            mode: 0o600,
          });
          if (mode === "legacy-key-directory") await mkdir(join(legacy, "project-key"));
          else
            await writeFile(
              join(legacy, "project-key"),
              mode === "legacy-key-garbage" ? "garbage" : uuid + "\n",
              { mode: 0o600 },
            );
          if (mode.startsWith("paired-marker-"))
            await writeFile(join(legacy, "paired-root"), "{}", { mode: 0o600 });
          if (mode === "paired-marker-file") await writeFile(coordination, "not a directory");
        }
        if (mode === "own-paired-default") {
          await mkdir(root, { mode: 0o700 });
          await writeFile(join(root, "project-key"), uuid + "\n", { mode: 0o600 });
          await writeFile(join(root, "paired-root"), '{"version":1,"paired":true}', {
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
          ...(pluginData
            ? {
                CLAUDE_PLUGIN_DATA:
                  mode === "plugin-trailing"
                    ? root + "/"
                    : mode.startsWith("plugin-relative")
                      ? "home/plugin"
                      : mode.startsWith("plugin-empty")
                        ? ""
                        : root,
              }
            : {}),
          ...(mode === "empty-option" ? { CLAUDE_PLUGIN_OPTION_PAIRING_RECORD: "" } : {}),
          ...(mode === "inherited-state-dir"
            ? { CAIRN_MEMORY_STATE_DIR: join(home, "unrelated") }
            : {}),
          CAIRN_TEST_FALSY_HOME: fallback ? "yes" : "no",
          CAIRN_TEST_CONCURRENT: concurrent ? "yes" : "no",
          CAIRN_TEST_PLATFORM: concurrent
            ? mode.slice("concurrent-".length)
            : mode === "standalone-win32"
              ? "win32"
              : "linux",
          CAIRN_TEST_FOREIGN_UID: mode === "coordination-foreign" ? "yes" : "no",
          CAIRN_TEST_NO_GETUID:
            mode === "no-getuid" || mode === "concurrent-win32" || mode === "standalone-win32"
              ? "yes"
              : "no",
          CAIRN_TEST_COMPLETIONS: completions,
          CAIRN_TEST_REQUESTS: requestsFile,
          CLAUDE_PLUGIN_OPTION_API_ENDPOINT: "https://synthetic.invalid",
          CLAUDE_PLUGIN_OPTION_API_TOKEN: "synthetic-token",
          ...(concurrent ? { CLAUDE_PLUGIN_OPTION_TELEMETRY: "false" } : {}),
        };
        async function run(action, index = 0, scriptEntry = entry) {
          const args = [join(plugin, `scripts/${scriptEntry}.mjs`)];
          if (scriptEntry === "hook") args.push(action);
          const proc = spawn(process.execPath, args, {
            env,
            cwd: directory,
            stdio: ["pipe", "pipe", "pipe"],
          });
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
        if (
          entry === "launch-capture" &&
          mode !== "paused-standalone" &&
          !(candidate && mode.startsWith("local-marker-"))
        ) {
          const expected = concurrent ? 12 : 1;
          const deadline = Date.now() + 45000;
          while (
            (await readFile(completions, "utf8"))
              .split("\n")
              .filter((value) => value === "capture-detached").length < expected
          ) {
            if (Date.now() > deadline) throw new Error(`golden_worker_timeout:${mode}`);
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        }
        outcomes.push(await run("status", 0, "hook"));
        const optionalIdentity = async (name) => {
          try {
            return await readFile(join(root, name), "utf8");
          } catch (error) {
            if (
              (mode.startsWith("plugin-empty") ||
                (candidate && mode.startsWith("local-marker-"))) &&
              error.code === "ENOENT"
            )
              return null;
            throw error;
          }
        };
        const key = await optionalIdentity("project-key");
        // No telemetry runs in concurrent cases, whose install ID was seeded.
        const identity = await optionalIdentity("install-id");
        let requestBytes = await readFile(requestsFile, "utf8");
        if (concurrent) {
          // Scheduling order is unspecified; compare the multiset of exact wire bytes.
          requestBytes = requestBytes.trimEnd().split("\n").sort().join("\n") + "\n";
          const count = requestBytes.trimEnd().split("\n").length;
          if (count !== 12) throw new Error(`golden_dropped_hooks:${mode}:${count}`);
        }
        variants.push({ mode, entry, key, identity, requestBytes, outcomes });
        if (mode === "default-unreadable") await chmod(legacy, 0o700);
      }
    }
    return variants;
  } finally {
    await workspace.cleanup();
  }
}
export function candidateGolden(base) {
  const expected = structuredClone(base);
  for (const variant of expected) {
    variant.requestBytes = variant.requestBytes.replaceAll(
      '\\"version\\":\\"0.1.1\\"',
      `\\"version\\":\\"${VERSION}\\"`,
    );
    // Coordinator's round-10 tie-break: local 0.1.2 history is not first use.
    // These remain actual-base fixtures, but are refusal tests rather than parity.
    if (variant.mode.startsWith("local-marker-")) {
      variant.key = null;
      variant.identity = null;
      variant.requestBytes = "";
      variant.outcomes = variant.outcomes.map((outcome, index) => ({
        code: 0,
        stderr: "",
        stdout:
          index === variant.outcomes.length - 1
            ? "Cairn automatic memory: pairing_record_missing.\n"
            : "",
      }));
    }
  }
  return expected;
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
      profiles: await observeProfiles(workspace.path),
      profileForms: await observeProfileForms(workspace.path),
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
    assert.deepEqual(await observeProfiles(workspace.path), golden.profiles);
    assert.deepEqual(await observeProfileForms(workspace.path), golden.profileForms);
    const candidate = join(workspace.path, "candidate");
    for (const name of ["lib", "scripts"])
      await cp(join(repo, "plugins/cairn-memory", name), join(candidate, name), {
        recursive: true,
      });
    const expected = candidateGolden(golden.standalone);
    assert.deepEqual(await observeStandalone(candidate), expected);
    assert.deepEqual(await observeHosted(candidate), golden.hosted);
    assert.deepEqual(await observeProfiles(candidate), golden.profiles);
    assert.deepEqual(await observeProfileForms(candidate), golden.profileForms);
  } finally {
    await workspace.cleanup();
  }
}

export async function observeProfiles(plugin, form = "absolute") {
  const workspace = createTestWorkspace(null, { prefix: "cx2-profile-golden-" });
  try {
    const home = join(workspace.path, "home");
    await mkdir(home);
    const requests = join(workspace.path, "requests");
    await writeFile(requests, "");
    const roots = [
      form === "empty" ? workspace.path : join(home, "profile-a"),
      join(home, "profile-b"),
    ];
    if (form !== "absolute") roots.push(join(home, ".cairn-memory"));
    async function run(profile, action) {
      const env = {
        ...process.env,
        HOME: home,
        CLAUDE_PLUGIN_DATA:
          profile === 2
            ? undefined
            : profile
              ? roots[profile]
              : form === "relative"
                ? "home/profile-a"
                : form === "empty"
                  ? ""
                  : form === "trailing"
                    ? roots[profile] + "/"
                    : roots[profile],
        CLAUDE_PLUGIN_OPTION_PAIRING_RECORD: "",
        CAIRN_MEMORY_STATE_DIR: "inherited-ignored",
        CAIRN_TEST_UUID:
          profile === 2
            ? "33333333-3333-4333-8333-333333333333"
            : profile
              ? "22222222-2222-4222-8222-222222222222"
              : "11111111-1111-4111-8111-111111111111",
        CAIRN_TEST_REQUESTS: requests,
        CLAUDE_PLUGIN_OPTION_API_TOKEN: "synthetic",
        CLAUDE_PLUGIN_OPTION_API_ENDPOINT: "https://synthetic.invalid",
        CLAUDE_PLUGIN_OPTION_TELEMETRY: "false",
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${JSON.stringify(preload)}`,
      };
      const child = spawn(process.execPath, [join(plugin, "scripts/hook.mjs"), action], {
        env,
        cwd: workspace.path,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (bytes) => (stdout += bytes));
      child.stderr.on("data", (bytes) => (stderr += bytes));
      child.stdin.end(JSON.stringify({ cwd: "/synthetic/project", prompt: "profile isolation" }));
      const code = await new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("close", resolve);
      });
      return { code, stdout: stdout.replace("; standalone_unregistered", ""), stderr };
    }
    const outcomes = [];
    outcomes.push(await run(0, "recall"), await run(1, "recall"));
    outcomes.push(await run(0, "pause"), await run(0, "status"), await run(1, "status"));
    outcomes.push(await run(1, "recall"));
    if (form !== "absolute") {
      outcomes.push(await run(0, "resume"), await run(0, "recall"));
      outcomes.push(await run(2, "recall"), await run(2, "pause"), await run(2, "status"));
      outcomes.push(await run(2, "resume"), await run(2, "recall"), await run(1, "recall"));
    }
    const keys = await Promise.all(
      roots.map(async (root, index) => {
        try {
          return await readFile(join(root, "project-key"), "utf8");
        } catch (error) {
          if (form === "empty" && index === 0 && error.code === "ENOENT") return null;
          throw error;
        }
      }),
    );
    const requestBytes = await readFile(requests, "utf8");
    const ids = requestBytes
      .trim()
      .split("\n")
      .map((line) => JSON.parse(JSON.parse(line).body).project_id);
    if (
      form === "absolute" &&
      (ids.length !== 3 || ids[0] === ids[1] || ids[1] !== ids[2] || keys[0] === keys[1])
    ) {
      throw new Error("golden_profiles_not_isolated");
    }
    return { keys, requestBytes, outcomes };
  } finally {
    await workspace.cleanup();
  }
}

export async function observeProfileForms(plugin) {
  const result = {};
  for (const form of ["trailing", "relative", "empty"])
    result[form] = await observeProfiles(plugin, form);
  return result;
}

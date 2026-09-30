// Synthetic child: stop exactly after a state-helper write, never by timing.
import { readFile, mkdir, writeFile, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { withWriteObserver } from "../private-state.mjs";

const input = JSON.parse(process.argv[2]);
const source = input.source;
const pairing = await import(
  source
    ? pathToFileURL(join(source, "integrations/client/pairing.mjs"))
    : new URL("../pairing.mjs", import.meta.url)
);
const home = input.home;
process.env.HOME = home;
process.env.CLAUDE_PLUGIN_DATA = join(home, "a");
const options = {
  home,
  root: join(home, "shared"),
  env: { HOME: home, CLAUDE_PLUGIN_DATA: join(home, "a") },
  claudeProfileRoot: join(home, "a"),
  standardClaudeOrigin: true,
  hostsStopped: true,
  consent: { claude: true, codex: true },
  configured: { claude: true, codex: true },
};
const key = async (root) => readFile(join(root, "project-key"), "utf8");
if (input.prepare) {
  await mkdir(home, { mode: 0o700 });
  if (input.operation === "adopt-temporary") {
    const source = join(dirname(home), "temporary-source");
    await mkdir(source, { mode: 0o700, recursive: true });
    await writeFile(join(source, "project-key"), "11111111-1111-4111-8111-111111111111\n", {
      mode: 0o600,
    });
  } else if (input.operation === "adopt") {
    await mkdir(options.root, { mode: 0o700 });
    await writeFile(join(options.root, "project-key"), "11111111-1111-4111-8111-111111111111\n", {
      mode: 0o600,
    });
  } else if (input.operation !== "initialize") {
    await pairing.initializePairing(options);
    if (input.operation !== "complete") await pairing.completePairing(options);
    if (input.operation === "repair") {
      const originalKey = (await key(options.root)).trim();
      await writeFile(join(home, "backup"), originalKey, { mode: 0o600 });
      await unlink(join(options.root, "project-key"));
    }
  }
  console.log(JSON.stringify({ prepared: true }));
} else {
  let count = 0;
  const execute = async () => {
    switch (input.operation) {
      case "initialize":
        return pairing.initializePairing(options);
      case "adopt-temporary":
        return pairing.initializePairing({
          ...options,
          adopt: true,
          adoptFrom: join(dirname(home), "temporary-source"),
          temporary: dirname(home),
        });
      case "adopt":
        return pairing.initializePairing({ ...options, adopt: true });
      case "complete":
        return pairing.completePairing(options);
      case "reset-claude":
      case "reset-codex":
        return pairing.resetIdentity({
          ...options,
          root: join(home, "next"),
          primaryClient: input.operation.split("-")[1],
          confirmIdentityReset: true,
        });
      case "repair":
        return pairing.repairIdentity({
          ...options,
          originalKey: await readFile(join(home, "backup"), "utf8"),
          confirmKeyRepair: true,
        });
      default:
        throw new Error("invalid_test_operation");
    }
  };
  try {
    const result = await withWriteObserver(({ path, kind }) => {
      count++;
      console.log(JSON.stringify({ write: count, path, kind }));
      if (count === input.interruptAfter) process.exit(86);
    }, execute);
    console.log(JSON.stringify({ result, count }));
  } catch (error) {
    console.log(JSON.stringify({ error: error.message, detail: error.detail, count }));
    process.exitCode = 1;
  }
}

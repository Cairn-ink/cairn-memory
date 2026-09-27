import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { withFileLock } from "./file-lock.mjs";

const INITIAL_GENERATION = "initial";
const GENERATION_PATTERN = /^(?:initial|[a-f0-9-]{36}|legacy-[a-f0-9]{64})$/;

function paths(dataDir) {
  return {
    state: join(dataDir, "control.json"),
    lock: join(dataDir, "control.lock"),
    legacyPause: join(dataDir, "paused"),
  };
}

async function legacyPauseState(path) {
  try {
    await stat(path);
    return "present";
  } catch (error) {
    return error?.code === "ENOENT" ? "missing" : "invalid";
  }
}

async function readStoredState(path) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (
      value?.version !== 1 ||
      typeof value.paused !== "boolean" ||
      typeof value.generation !== "string" ||
      !GENERATION_PATTERN.test(value.generation)
    ) {
      return { kind: "invalid" };
    }
    return { kind: "valid", paused: value.paused, generation: value.generation };
  } catch (error) {
    if (error?.code === "ENOENT") return { kind: "missing" };
    return { kind: "invalid" };
  }
}

/** Read the content-free global pause barrier. Invalid state fails closed. */
export async function readControlState(dataDir) {
  const controlPaths = paths(dataDir);
  const [stored, legacyPause] = await Promise.all([
    readStoredState(controlPaths.state),
    legacyPauseState(controlPaths.legacyPause),
  ]);
  if (stored.kind === "invalid" || legacyPause === "invalid") {
    return { paused: true, generation: "invalid", valid: false };
  }
  const generation = stored.kind === "valid" ? stored.generation : INITIAL_GENERATION;
  if (legacyPause === "present") {
    // A marker written by an older plugin is its own barrier. Prefixing keeps
    // pre-marker workers from becoming valid merely because resume follows.
    return {
      paused: true,
      generation: stored.kind === "valid" && stored.paused
        ? generation
        : `legacy-${createHash("sha256").update(generation).digest("hex")}`,
      valid: true,
    };
  }
  return {
    paused: stored.kind === "valid" ? stored.paused : false,
    generation,
    valid: true,
  };
}

async function writeState(path, state) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(
      temporary,
      JSON.stringify({
        version: 1,
        paused: state.paused,
        generation: state.generation,
      }),
      {
        mode: 0o600,
        flag: "wx",
      },
    );
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

/** Atomically change pause state while preserving the pause generation. */
export async function setPaused(dataDir, paused) {
  const controlPaths = paths(dataDir);
  let updated;
  const acquired = await withFileLock(
    controlPaths.lock,
    async () => {
      const current = await readControlState(dataDir);
      const generation = paused
        ? current.paused && current.valid
          ? current.generation
          : randomUUID()
        : current.paused && current.valid
          ? current.generation
          : current.generation === "invalid"
            ? randomUUID()
            : current.generation;
      updated = { paused, generation, valid: true };
      await writeState(controlPaths.state, updated);
      if (paused) {
        await writeFile(controlPaths.legacyPause, "paused\n", { mode: 0o600 });
      } else {
        await unlink(controlPaths.legacyPause).catch((error) => {
          if (error?.code !== "ENOENT") throw error;
        });
      }
    },
    { timeoutMs: 2_000, pollMs: 25 },
  );
  if (!acquired || !updated) throw new Error("control_busy");
  return updated;
}

/**
 * Call `start` synchronously under the pause lock when a generation is active.
 * Promise work returned by `start` deliberately runs outside the lock.
 */
export async function startIfActive(dataDir, generation, start) {
  let operation;
  let started = false;
  const acquired = await withFileLock(paths(dataDir).lock, async () => {
    const current = await readControlState(dataDir);
    if (current.paused || current.generation !== generation) return;
    operation = Promise.resolve(start());
    // The control lock still has a few filesystem cleanup awaits before this
    // function returns. Attach a handler now so a fast rejection cannot become
    // an unhandled rejection during that gap; callers still observe it below.
    operation.catch(() => {});
    started = true;
  }, { timeoutMs: 250, pollMs: 10 });
  return { acquired, started, operation };
}

/** Run a synchronous side effect only while the generation remains active. */
export async function runIfActive(dataDir, generation, run) {
  let ran = false;
  const acquired = await withFileLock(paths(dataDir).lock, async () => {
    const current = await readControlState(dataDir);
    if (current.paused || current.generation !== generation) return;
    run();
    ran = true;
  }, { timeoutMs: 250, pollMs: 10 });
  return acquired && ran;
}

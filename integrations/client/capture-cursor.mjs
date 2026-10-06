import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export function captureCursorPath(dataDir, sessionId) {
  const key = createHash("sha256").update(sessionId).digest("hex");
  return join(dataDir, "sessions", `${key}.json`);
}

export async function readCaptureCursor(path) {
  try {
    const state = JSON.parse(await readFile(path, "utf8"));
    if (!Number.isSafeInteger(state?.offset) || state.offset < 0) return undefined;
    return {
      offset: state.offset,
      // Pre-barrier cursors belong to the initial active generation.
      generation:
        typeof state.generation === "string" ? state.generation : "initial",
      discardUntilNewline: state.discardUntilNewline === true,
      pendingEnd:
        Number.isSafeInteger(state.pendingEnd) && state.pendingEnd >= state.offset
          ? state.pendingEnd
          : undefined,
    };
  } catch {
    return undefined;
  }
}

export async function writeCaptureCursor(path, cursor) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, JSON.stringify(cursor), {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

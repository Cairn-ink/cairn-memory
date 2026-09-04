import { createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

async function randomIdFile(dataDir, filename) {
  const path = join(dataDir, filename);
  try {
    const value = (await readFile(path, "utf8")).trim();
    if (value) return value;
  } catch {}
  await mkdir(dataDir, { recursive: true });
  const value = randomUUID();
  await writeFile(path, `${value}\n`, { mode: 0o600 });
  return value;
}

/** Anonymous product telemetry id. This value may be sent to Cairn. */
export function installId(dataDir) {
  return randomIdFile(dataDir, "install-id");
}

/**
 * Stable project id keyed with a separate secret that never leaves the device.
 * Keeping it separate from installId prevents Cairn from testing likely paths.
 */
export async function opaqueProjectId(dataDir, cwd) {
  if (!cwd) return undefined;
  const key = await randomIdFile(dataDir, "project-key");
  return createHmac("sha256", key).update(String(cwd)).digest("hex");
}

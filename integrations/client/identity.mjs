import { createHmac, randomUUID } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

async function randomIdFile(dataDir, filename) {
  const path = join(dataDir, filename);
  async function readIdentity() {
    const value = (await readFile(path, "utf8")).trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new Error(`invalid_identity: ${filename}`);
    }
    return value;
  }
  try {
    return await readIdentity();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const value = randomUUID();
  const temporaryPath = join(dataDir, `.${filename}.${randomUUID()}.tmp`);
  // Publish a fully written inode without replacing another process's winner.
  // Opening the final path with wx alone would expose a partially written key.
  await writeFile(temporaryPath, `${value}\n`, { flag: "wx", mode: 0o600 });
  try {
    try {
      await link(temporaryPath, path);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    return await readIdentity();
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
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

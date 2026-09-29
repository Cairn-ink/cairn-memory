import { createHmac, randomUUID } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { privateDirectory, privateRead, privateWrite } from "./private-state.mjs";

async function randomIdFile(dataDir, filename, { create = true } = {}) {
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
  if (!create) throw new Error("standalone_key_missing");
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
export async function projectKey(dataDir, { create = true, checkpoint } = {}) {
  await privateDirectory(dataDir);
  const path = join(dataDir, "project-key");
  let value = await privateRead(path, { missing: true });
  if (value === undefined) {
    if (!create) throw new Error("paired_key_missing");
    await privateWrite(path, `${randomUUID()}\n`, { exclusive: true, checkpoint });
    value = await privateRead(path);
  }
  const key = value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    throw new Error("invalid_identity: project-key");
  }
  return key;
}

export async function opaqueProjectId(dataDir, cwd, options) {
  if (!cwd) return undefined;
  const key = options?.strict
    ? await projectKey(dataDir, options)
    : await randomIdFile(dataDir, "project-key", options);
  return createHmac("sha256", key).update(String(cwd)).digest("hex");
}

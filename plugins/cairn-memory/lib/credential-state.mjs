// Hook-owned, content-free observations. This module never receives a token.
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { normalizeEndpoint } from "./config.mjs";
import { withFileLock } from "./file-lock.mjs";
import { checkedPath, privateRead, notifyWrite } from "./private-state.mjs";

const outcomes = new Set(["ok", "rejected", "unreachable", "server-busy", "server-error"]);
export const INVALID_ENDPOINT = "invalid (HTTPS required; HTTP is loopback-only)";
const observationEndpoint = (value) => value === INVALID_ENDPOINT ? value : normalizeEndpoint(value);
const instant = (value) => typeof value === "string" &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const exactKeys = (value, keys) => value !== null && typeof value === "object" &&
  Object.keys(value).sort().join(",") === keys.sort().join(",");
const pathFor = (root) => join(root, "credential-state.json");
const check = (path, directory = false) =>
  checkedPath(path, { directory, missing: true, portable: true });

export async function readCredentialState(root) {
  try {
    const bytes = await privateRead(pathFor(root), { missing: true, portable: true });
    if (bytes === undefined) return undefined;
    const value = JSON.parse(bytes);
    if (!exactKeys(value, ["version", "configured", "endpoint", "observed_at", "auth"]) ||
        value.version !== 1 || typeof value.configured !== "boolean" ||
        !instant(value.observed_at) || observationEndpoint(value.endpoint) !== value.endpoint ||
        (value.auth !== null && (!value.configured ||
          value.endpoint === INVALID_ENDPOINT ||
          !exactKeys(value.auth, ["outcome", "at"]) || !outcomes.has(value.auth.outcome) ||
          !instant(value.auth.at)))) return undefined;
    return value;
  } catch { return undefined; }
}

async function update(root, work) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  // Claude Code owns this directory and may create it with host-default modes.
  // Require the owner's real directory; the observation leaf itself is 0600.
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() ||
      (process.getuid && info.uid !== process.getuid())) throw new Error("invalid_credential_root");
  const path = pathFor(root);
  await withFileLock(path + ".lock", async () => {
    const state = await work(await readCredentialState(root));
    if (!state) return;
    await check(path);
    const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
    const file = await open(temporary, "wx", 0o600);
    try {
      try { await file.writeFile(JSON.stringify(state)); await file.sync(); }
      finally { await file.close(); }
      await rename(temporary, path);
      await notifyWrite(path);
    } finally {
      await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
    }
  }, { timeoutMs: 100, pollMs: 10, validatePath: check,
    read: (path) => privateRead(path, { missing: true, portable: true }) });
}

export async function recordCredentialConfiguration(root, {
  configured, endpoint, observedAt, resetAuth = false,
}) {
  endpoint = observationEndpoint(endpoint);
  if (typeof configured !== "boolean" || !instant(observedAt)) throw new Error("invalid_credential_state");
  await update(root, (previous) => {
    // Async SessionStart must not erase a newer prompt's observation.
    if (previous && previous.observed_at > observedAt) return;
    const auth = !resetAuth && configured && previous?.configured && previous.endpoint === endpoint ? previous.auth : null;
    return { version: 1, configured, endpoint, observed_at: observedAt, auth };
  });
}

export async function recordCredentialAuth(root, { endpoint, observedAt, outcome, at }) {
  if (!outcomes.has(outcome) || !instant(at)) throw new Error("invalid_credential_state");
  await update(root, (previous) => {
    // An older in-flight request cannot validate a newer hook's configuration.
    if (!previous?.configured || previous.endpoint === INVALID_ENDPOINT || previous.endpoint !== endpoint ||
        previous.observed_at !== observedAt || previous.auth?.at > at) return;
    return { ...previous, auth: { outcome, at } };
  });
}

export function credentialDescription(state, { hasToken = false } = {}) {
  // Preserve the direct-env presence check; it makes no verification claim.
  // Bash needs hook evidence because its own empty environment proves nothing.
  if (hasToken) return "configured";
  if (!state) return "not seen yet — restart Claude Code and send one message";
  if (!state.configured) return "missing";
  if (state.auth?.outcome === "rejected") {
    return `rejected — create a new token at ${state.endpoint}/settings/tokens`;
  }
  if (state.auth?.outcome === "ok") return `configured (verified ${state.auth.at})`;
  if (state.auth?.outcome === "unreachable") {
    return `configured (unreachable ${state.auth.at}; not verified)`;
  }
  if (["server-busy", "server-error"].includes(state.auth?.outcome)) {
    const answer = state.auth.outcome === "server-busy" ? "busy" : "error";
    return `configured (server answered: ${answer} ${state.auth.at}; not verified)`;
  }
  return "configured (not verified yet)";
}

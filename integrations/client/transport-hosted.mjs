import { lstat, mkdir, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { normalizeEndpoint } from "./config.mjs";
import { privateDirectory, privateRead, privateWrite, checkedPath } from "./private-state.mjs";
import { withFileLock } from "./file-lock.mjs";
import { conforms, utcInstant, classifyHostedReply, parseSessionStartRequest }
  from "./hosted-contract.mjs";

export { classifyHostedReply } from "./hosted-contract.mjs";
// Files created by this process belong to its effective UID. Existing legacy
// root ownership policy stays with binding discovery, not this new gate.
const ownerOptions = () => ({ ownerId: process.geteuid?.() ?? process.getuid?.() });
const routes = new Set(["/api/memory/recall", "/api/memory/capture"]);
const acknowledged = new Set(["complete", "duplicate", "empty"]);
const modes = new Set(["open", "quota_reached", "invalid_reply", "ready", "consumed", "unconfirmed"]);

// Installation supplies one owner-bound target across clients. This fallback
// conservatively binds one endpoint within the owner-bound root. Credential
// rotation or two credentials for the same owner cannot bypass a quota latch.
export function hostedTargetId({ endpoint }) {
  return createHash("sha256").update(JSON.stringify([
    "cairn-hosted-target-v1", normalizeEndpoint(endpoint),
  ])).digest("hex");
}
function quotaPaths({ root, targetId }) {
  if (typeof root !== "string" || !/^[a-f0-9]{64}$/.test(targetId)) throw new Error("invalid_target");
  const directory = join(resolve(root), "hosted-quota");
  const state = join(directory, `${targetId}.json`);
  return { directory, state, lock: state + ".lock" };
}
async function readGate(path) {
  const bytes = await privateRead(path, { ...ownerOptions(), missing: true });
  if (bytes === undefined) return { version: 1, mode: "open", resetAt: null };
  const value = JSON.parse(bytes);
  if (!value || Object.keys(value).sort().join(",") !== "mode,resetAt,version" ||
      value.version !== 1 || !modes.has(value.mode) ||
      (value.resetAt !== null && !utcInstant(value.resetAt))) {
    throw new Error("quota_state_invalid");
  }
  return value;
}
const gateReply = (state) => state.mode === "unconfirmed" ? { status: "unavailable" } :
  state.mode === "quota_reached" || state.mode === "consumed" ?
  { status: "quota_reached", resetAt: state.resetAt } :
  { status: "error", code: "invalid_reply", stopRetries: true };

export async function hostedQuotaStatus(target) {
  try {
    const state = await readGate(quotaPaths(target).state);
    return { ...state, reset: state.resetAt ?? "reset unknown" };
  } catch { return { version: 1, mode: "unavailable", resetAt: null, reset: "reset unknown" }; }
}
async function gateLock(target, work) {
  const paths = quotaPaths(target);
  // Released standalone roots may have host-created 0755 directory modes;
  // the new gate subdirectory and all files still require 0700/0600.
  await mkdir(resolve(target.root), { recursive: true, mode: 0o700 });
  const owner = await lstat(await realpath(resolve(target.root)));
  if (!owner.isDirectory()) {
    throw new Error("invalid_state_root");
  }
  await privateDirectory(paths.directory, ownerOptions());
  let result;
  const acquired = await withFileLock(paths.lock, async () => {
    result = await work(await readGate(paths.state), async (state) => {
      await privateWrite(paths.state, JSON.stringify(state), ownerOptions());
    });
  }, { timeoutMs: 150, pollMs: 10,
    validatePath: (path) => checkedPath(path, { ...ownerOptions(), missing: true }),
    read: (path) => privateRead(path, { ...ownerOptions(), missing: true }),
  });
  return acquired ? result : { status: "unavailable" };
}

export async function resumeHostedQuota(target, { now = Date.now() } = {}) {
  if (!Number.isFinite(now)) throw new Error("invalid_time");
  return gateLock(target, async (state, save) => {
    if (state.mode === "open") return { status: "active" };
    if (state.resetAt !== null && now < Date.parse(state.resetAt)) return gateReply(state);
    // Repeated resume while a permit is already ready does not multiply it.
    await save({ ...state, mode: "ready" });
    return { status: "ready", resetAt: state.resetAt };
  });
}

async function guardedReply(target, attempt) {
  try {
    return await gateLock(target, async (state, save) => {
      if (!["open", "ready"].includes(state.mode)) return gateReply(state);
      const probe = state.mode === "ready";
      // Publish an uncertain attempt before every dispatch. If persisting a
      // refusal fails later, a restart still cannot reopen the gate.
      await save({ ...state, mode: probe ? "consumed" : "unconfirmed" });
      const reply = await attempt();
      if (reply.status === "quota_reached") {
        await save({ version: 1, mode: "quota_reached", resetAt: reply.resetAt });
      } else if (reply.stopRetries) {
        await save({ version: 1, mode: "invalid_reply", resetAt: null });
      } else if (acknowledged.has(reply.status) || !probe) {
        await save({ version: 1, mode: "open", resetAt: null });
      }
      return reply;
    });
  } catch { return { status: "unavailable" }; }
}

// The legacy JSON poster retains its original return API; memory routes now
// validate HTTP status and payload together and optionally use the shared gate.
export function createJsonPoster({ endpoint, token, root, targetId, client = "claude" }) {
  const baseUrl = normalizeEndpoint(endpoint);
  if (!["claude", "codex"].includes(client)) throw new Error("invalid_client");
  const target = root !== undefined ? { root, targetId: targetId ?? hostedTargetId({ endpoint, token }) } : null;

  async function request(path, body, timeoutMs, authenticated = true, limits, signal) {
    if (authenticated && !token) throw new Error("missing_token");
    const headers = { "content-type": "application/json" };
    if (authenticated) headers.authorization = `Bearer ${token}`;
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST", headers, body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) :
        AbortSignal.timeout(timeoutMs),
      ...(client === "codex" ? { redirect: "error" } : {}),
    });
    if (!routes.has(path) && path !== "/api/memory/session-start") {
      if (!response.ok) throw new Error(`http_${response.status}`);
      if (response.status === 204) return null;
      return response.json();
    }
    let value;
    try { value = await response.json(); } catch { value = null; }
    return classifyHostedReply(path, response.status, value, body, limits);
  }
  async function reply(path, body, timeoutMs, limits, signal) {
    if (!token || signal?.aborted) return { status: "unavailable" };
    const attempt = async () => {
      try { return await request(path, body, timeoutMs, true, limits, signal); }
      catch { return { status: "unavailable" }; }
    };
    return target && routes.has(path) ? guardedReply(target, attempt) : attempt();
  }
  const post = async (path, body, timeoutMs, authenticated = true) => {
    if (!routes.has(path) && path !== "/api/memory/session-start") {
      return request(path, body, timeoutMs, authenticated);
    }
    const result = await reply(path, body, timeoutMs);
    if (result.status === "quota_reached") {
      const error = new Error("quota_reached"); error.resetAt = result.resetAt; throw error;
    }
    if (result.status === "processing") {
      return { duplicate: false, memoryCount: result.memoryCount, processing: true };
    }
    if (!acknowledged.has(result.status)) throw new Error(result.code ?? "capture_unavailable");
    if (path.endsWith("recall")) return { memories: result.memories };
    if (path.endsWith("session-start")) return result.context;
    return { duplicate: result.status === "duplicate", memoryCount: result.memoryCount };
  };
  post.reply = reply;
  return post;
}

// Disabled-client port: installation is responsible for target qualification.
// Session/pause parsers are published here; CX-5 alone wires lifecycle hooks.
export function createHostedTransport(options) {
  if (!options.root) throw new Error("missing_root");
  const post = createJsonPoster({ ...options, client: options.client ?? "codex" });
  return {
    capture(batch, binding, eventId, signal) {
      const body = { client: options.client === "claude" ? "claude-code" : "codex",
        event_id: eventId, session_id: binding.sessionId,
        ...(binding.projectId ? { project_id: binding.projectId } : {}), messages: batch };
      if (!conforms("capture-request", body)) {
        return Promise.resolve({ status: "error", code: "invalid_memory_input" });
      }
      return post.reply("/api/memory/capture", body, 25_000, undefined, signal);
    },
    recall(query, binding = {}, limits = {}, signal) {
      const body = { query, ...(binding.projectId ? { project_id: binding.projectId } : {}),
        limit: limits.limit ?? 6 };
      if (!conforms("recall-request", body)) {
        return Promise.resolve({ status: "error", code: "invalid_memory_input" });
      }
      return post.reply("/api/memory/recall", body, 2_000, undefined, signal);
    },
    sessionStart(request, limits) {
      const body = parseSessionStartRequest(request);
      return post.reply("/api/memory/session-start", body, 2_000, limits);
    },
  };
}

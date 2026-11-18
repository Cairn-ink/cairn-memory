import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { canonicalHostRoot, checkedPath, notifyWrite, privateRead } from "./private-state.mjs";
import { dateTime } from "./source-time.mjs";

const outcomes = new Map([
  [400, "bad_request"],
  [401, "unauthorized"],
  [403, "forbidden"],
  [404, "not_found"],
  [408, "request_timeout"],
  [413, "payload_too_large"],
  [429, "rate_limited"],
  [503, "service_unavailable"],
]);
const replyCodes = ["invalid_reply", "timeout", "network", "dispatch_refused"];
const lastOutcomes = [...outcomes.values(), ...replyCodes, "complete", "empty", "server_error", "http_error"];

export function contextReadOutcome(reply) {
  if (replyCodes.includes(reply.code)) return reply.code;
  if (reply.status === 200) return reply.memories.length ? "complete" : "empty";
  return outcomes.get(reply.status) ?? (reply.status >= 500 && reply.status < 600 ? "server_error" : "http_error");
}

const hasKeys = (value, keys) => value !== null && typeof value === "object" &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const count = value => Number.isSafeInteger(value) && value >= 0;
const nullableInstant = value => value === null || dateTime(value);
const validLast = value => hasKeys(value, [
  "at", "path", "outcome", "returned_items", "delivered_items", "rendered_chars",
]) && dateTime(value.at) && ["context-read", "recall-fallback"].includes(value.path) &&
  lastOutcomes.includes(value.outcome) && count(value.returned_items) &&
  count(value.delivered_items) && value.delivered_items <= value.returned_items && count(value.rendered_chars);
const privateOptions = { missing: true, portable: true };
const checkDirectory = path => checkedPath(path, { ...privateOptions, directory: true });

export async function openContextReadState({ root, endpoint }, targetId, token) {
  // This is a token-derived value: a non-reversible, domain-separated SHA-256
  // fingerprint of a high-entropy token. Persist it only in the 0600 state file.
  const account = createHash("sha256").update(JSON.stringify([
    "cairn-context-read-account-v1", endpoint, token,
  ])).digest("hex");
  const empty = { version: 1, account, available_until: null, failure_streak: 0, cooldown_until: null, last: null };
  const directory = join(await canonicalHostRoot(root), "hosted-context-read");
  const path = join(directory, targetId + ".json");
  let state = empty;
  try {
    if (await checkDirectory(directory)) {
      const value = JSON.parse(await privateRead(path, privateOptions));
      if (hasKeys(value, Object.keys(empty)) && value.version === 1 && value.account === account &&
          nullableInstant(value.available_until) && count(value.failure_streak) &&
          nullableInstant(value.cooldown_until) && (value.last === null || validLast(value.last))) state = value;
    }
  } catch { /* Unreadable or invalid state is empty. */ }

  async function save(signal) {
    signal?.throwIfAborted();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (!await checkDirectory(directory)) throw new Error("state_path_changed");
    await checkedPath(path, privateOptions);
    const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
    const file = await open(temporary, "wx", 0o600);
    try {
      try { await file.writeFile(JSON.stringify(state)); await file.sync(); }
      finally { await file.close(); }
      signal?.throwIfAborted();
      await rename(temporary, path);
      await notifyWrite(path);
    } finally {
      await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
    }
  }
  return { state, save };
}

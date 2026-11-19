import { scrypt } from "node:crypto";
import { join } from "node:path";
import { promisify } from "node:util";
import { canonicalHostRoot, checkedPath, privateRead, privateWrite } from "./private-state.mjs";
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
const replyCodes = ["invalid_reply", "timeout", "network", "dispatch_refused", "representation_unavailable"];
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
const deriveKey = promisify(scrypt);

async function accountFingerprint(endpoint, token) {
  // This is a token-derived value, a non-reversible fingerprint of a
  // high-entropy token. A KDF avoids applying a fast hash to a credential.
  // It lives only in the 0600 state file and never in logs, last, status,
  // stdout, stderr, thrown messages or crash text.
  const key = await deriveKey(JSON.stringify([endpoint, token]), "cairn-context-read-account-v1", 32,
    { N: 4096, r: 8, p: 1 });
  return key.toString("hex");
}

export async function openContextReadState({ root, endpoint }, targetId, token) {
  const empty = { version: 1, account: null, available_until: null, failure_streak: 0, cooldown_until: null, last: null };
  const directory = join(await canonicalHostRoot(root), "hosted-context-read");
  const path = join(directory, targetId + ".json");
  let state = empty, account;
  try {
    if (await checkDirectory(directory)) {
      const bytes = await privateRead(path, privateOptions);
      const value = bytes === undefined ? null : JSON.parse(bytes);
      if (hasKeys(value, Object.keys(empty)) && value.version === 1 &&
          typeof value.account === "string" && /^[0-9a-f]{64}$/.test(value.account) &&
          nullableInstant(value.available_until) && count(value.failure_streak) &&
          nullableInstant(value.cooldown_until) && (value.last === null || validLast(value.last))) {
        account = await accountFingerprint(endpoint, token);
        if (value.account === account) state = value;
      }
    }
  } catch { /* Unreadable or invalid state is empty. */ }

  async function save(signal, deadline) {
    signal?.throwIfAborted();
    account ??= await accountFingerprint(endpoint, token);
    signal?.throwIfAborted();
    if (performance.now() >= deadline) return;
    await privateWrite(path, JSON.stringify({ ...state, account }), {
      checkpoint: () => signal?.throwIfAborted(),
    });
  }
  return { state, save };
}

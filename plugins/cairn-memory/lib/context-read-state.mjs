import { join } from "node:path";
import { checkedPath, privateRead, privateWrite } from "./private-state.mjs";
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
const replyCodes = ["invalid_reply", "timeout", "network", "dispatch_refused", "representation_unavailable", "skipped"];
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

export async function openContextReadState({ root }, targetId, fingerprint) {
  const empty = { version: 1, available_until: null, failure_streak: 0, cooldown_until: null, last: null };
  const directory = join(root, "hosted-context-read");
  const path = join(directory, targetId + ".json");
  let value;
  if (await checkDirectory(directory)) {
    const bytes = await privateRead(path, privateOptions);
    if (bytes !== undefined) value = JSON.parse(bytes);
  }
  const account = await fingerprint;
  if (account === undefined) return;
  let state = empty;
  if (value !== undefined && hasKeys(value, ["account", ...Object.keys(empty)]) && value.version === 1 &&
      value.account === account && nullableInstant(value.available_until) && count(value.failure_streak) &&
      nullableInstant(value.cooldown_until) && (value.last === null || validLast(value.last))) {
    const { account: storedAccount, ...storedState } = value;
    state = storedState;
  }

  async function save(signal, deadline) {
    signal?.throwIfAborted();
    if (performance.now() >= deadline) return;
    await privateWrite(path, JSON.stringify({ ...state, account }), {
      checkpoint: () => signal?.throwIfAborted(),
    });
  }
  return { state, save };
}

import { join } from "node:path";
import { privateRead, privateWrite } from "../client/private-state.mjs";
import { hash, PROFILE } from "../client/common-profile.mjs";
import { FORMAT } from "./parser.mjs";

export const REASONS = [
  "non_conversation",
  "malformed",
  "oversized",
  "rich_input",
  "invalid_text",
  "pause_boundary",
  "source_changed",
  "state_reset",
  "binding_changed",
  "digest_migrated",
];
export const STATUSES = [
  "idle",
  "pending",
  "partial_tail",
  "excluded",
  "timeout",
  "processing",
  "invalid_reply",
  "quota_reached",
  "paused",
  "pause_boundary",
  "source_changed",
  "source_unavailable",
  "unsupported_format",
  "batch_limit",
  "concurrency_limited",
  "daily_cap_reached",
  "automatic_cap_unconfigured",
  "plan_threshold",
  "worker_liveness_unknown",
  "deadline",
  "state_reset",
  "binding_changed",
  "digest_migrated",
  "superseded",
  "reservation_invalidated",
  "reservation_already_dispatched",
];
const int = (x) => Number.isSafeInteger(x) && x >= 0;
const digest = (x) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
const closed = (x, keys) =>
  x &&
  typeof x === "object" &&
  !Array.isArray(x) &&
  Object.keys(x).length === keys.length &&
  Object.keys(x).every((k) => keys.includes(k));
export const cursorPath = (root, targetId, sessionId) =>
  join(root, "codex-cursors", `${hash(targetId, "codex", sessionId)}.json`);

export function validateCursor(s) {
  if (
    !closed(s, [
      "version",
      "format",
      "profile",
      "binding",
      "epoch",
      "file",
      "offset",
      "generation",
      "discard",
      "discardReason",
      "accepted",
      "skipped",
      "truncated",
      "normalizedUnits",
      "submittedUnits",
      "pending",
      "observedEnd",
      "unconfirmedTail",
      "status",
      "notBefore",
      "anchor",
      "quotaRefusal",
    ]) ||
    s.version !== 2 ||
    s.format !== FORMAT ||
    s.profile !== PROFILE ||
    !digest(s.binding) ||
    !int(s.epoch) ||
    !digest(s.file) ||
    !int(s.offset) ||
    !/^(initial|[a-f0-9-]{36}|legacy-[a-f0-9]{64})$/.test(s.generation) ||
    typeof s.discard !== "boolean" ||
    (s.discard ? !REASONS.includes(s.discardReason) : s.discardReason !== null) ||
    !int(s.accepted) ||
    !closed(s.skipped, REASONS) ||
    Object.values(s.skipped).some((x) => !int(x)) ||
    !int(s.truncated) ||
    !int(s.normalizedUnits) ||
    !int(s.submittedUnits) ||
    s.submittedUnits > s.normalizedUnits ||
    !int(s.observedEnd) ||
    s.observedEnd < s.offset ||
    typeof s.unconfirmedTail !== "boolean" ||
    !STATUSES.includes(s.status) ||
    !int(s.notBefore) ||
    s.accepted + Object.values(s.skipped).reduce((n, x) => n + x, 0) !== s.offset
  )
    throw new Error("cursor_state_invalid");
  if (
    s.quotaRefusal !== null &&
    (!closed(s.quotaRefusal, ["resetAt", "latched", "reservationId", "terminated"]) ||
      !(s.quotaRefusal.resetAt === null || int(s.quotaRefusal.resetAt)) ||
      typeof s.quotaRefusal.latched !== "boolean" ||
      typeof s.quotaRefusal.terminated !== "boolean" ||
      !(
        s.quotaRefusal.reservationId === null ||
        /^[a-f0-9-]{36}$/.test(s.quotaRefusal.reservationId)
      ))
  )
    throw new Error("cursor_state_invalid");
  if (
    s.anchor !== null &&
    (!closed(s.anchor, ["start", "end", "digest"]) ||
      !int(s.anchor.start) ||
      !int(s.anchor.end) ||
      s.anchor.end < s.anchor.start ||
      s.anchor.end > s.observedEnd ||
      s.anchor.end - s.anchor.start > 256 ||
      !digest(s.anchor.digest))
  )
    throw new Error("cursor_state_invalid");
  if (s.pending !== null) {
    const p = s.pending;
    if (
      !closed(p, ["start", "end", "digest", "batches", "next", "discard", "discardReason"]) ||
      !int(p.start) ||
      !int(p.end) ||
      p.end <= p.start ||
      p.end - p.start > 1048576 ||
      !digest(p.digest) ||
      !Array.isArray(p.batches) ||
      !p.batches.length ||
      p.batches.length > 4096 ||
      !int(p.next) ||
      p.next > p.batches.length ||
      typeof p.discard !== "boolean" ||
      (p.discard ? !REASONS.includes(p.discardReason) : p.discardReason !== null)
    )
      throw new Error("cursor_state_invalid");
    let end = p.start;
    for (const b of p.batches) {
      if (
        !closed(b, ["end", "eventId"]) ||
        !int(b.end) ||
        b.end <= end ||
        b.end > p.end ||
        !digest(b.eventId)
      )
        throw new Error("cursor_state_invalid");
      end = b.end;
    }
    if (
      end !== p.end ||
      s.offset !== (p.next ? p.batches[p.next - 1].end : p.start) ||
      p.end > s.observedEnd
    )
      throw new Error("cursor_state_invalid");
  }
  return s;
}
export async function readCursor(path, { recover = false } = {}) {
  const bytes = await privateRead(path, { missing: true });
  if (bytes === undefined) return null;
  try {
    const value = JSON.parse(bytes);
    if (value.version === 1) {
      const current = initialCursor(value.binding, value.file, value.generation);
      const oldKeys = Object.keys(current).filter((k) => k !== "quotaRefusal");
      const oldReasons = REASONS.filter((k) => !["binding_changed", "digest_migrated"].includes(k));
      if (!closed(value, oldKeys) || !closed(value.skipped, oldReasons))
        throw new Error("cursor_state_invalid");
      const migrated = validateCursor({
        ...value,
        version: 2,
        quotaRefusal: null,
        skipped: { ...current.skipped, ...value.skipped },
      });
      return { ...migrated, version: 1 }; // EOF epoch migration requires an authorized source.
    }
    return validateCursor(value);
  } catch {
    if (recover) return null;
    throw new Error("cursor_state_invalid");
  }
}
export async function publishCursor(path, next, previous) {
  validateCursor(next);
  if (
    previous &&
    (next.epoch < previous.epoch ||
      (next.epoch === previous.epoch && next.offset < previous.offset))
  )
    throw new Error("cursor_backwards");
  if (
    previous &&
    next.epoch !== previous.epoch &&
    (next.epoch !== previous.epoch + 1 ||
      !["source_changed", "state_reset", "binding_changed", "digest_migrated"].includes(
        next.status,
      ))
  )
    throw new Error("cursor_epoch_invalid");
  await privateWrite(path, JSON.stringify(next));
}
export function initialCursor(binding, file, generation) {
  return {
    version: 2,
    format: FORMAT,
    profile: PROFILE,
    binding,
    epoch: 0,
    file,
    offset: 0,
    generation,
    discard: false,
    discardReason: null,
    accepted: 0,
    skipped: Object.fromEntries(REASONS.map((x) => [x, 0])),
    truncated: 0,
    normalizedUnits: 0,
    submittedUnits: 0,
    quotaRefusal: null,
    pending: null,
    observedEnd: 0,
    unconfirmedTail: true,
    status: "idle",
    notBefore: 0,
    anchor: null,
  };
}

import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { privateRead, privateWrite, checkedPath } from "./private-state.mjs";
import { stateLock, ownerAlive } from "./state-lock.mjs";

const refusals = new Set([
  "none",
  "concurrency_limited",
  "daily_cap_reached",
  "quota_reached",
  "quota_signal_unavailable",
  "plan_threshold",
  "worker_liveness_unknown",
  "policy_conflict",
]);
const thresholds = {
  five_hour: 0.95,
  seven_day: 0.93,
  seven_day_opus: 0.93,
  seven_day_sonnet: 0.92,
  overage: 0.95,
};
const integer = (x) => Number.isSafeInteger(x) && x >= 0;
const closed = (x, keys) =>
  x &&
  typeof x === "object" &&
  !Array.isArray(x) &&
  Object.keys(x).length === keys.length &&
  Object.keys(x).every((k) => keys.includes(k));
const time = (x) => x === null || (Number.isSafeInteger(x) && x >= 0 && x <= 8640000000000000);
const owners = ["shared", "claude", "codex"];
const validPolicy = (p) =>
  closed(p, ["cap", "concurrency", "mode"]) &&
  integer(p.cap) &&
  p.cap >= 1 &&
  integer(p.concurrency) &&
  p.concurrency >= 1 &&
  p.concurrency <= 32 &&
  ["api-key", "plan", "hosted"].includes(p.mode);
const samePolicy = (a, b) =>
  a?.cap === b.cap && a?.concurrency === b.concurrency && a?.mode === b.mode;
const conflict = (s) => {
  const declarations = Object.values(s.policies);
  return declarations.some((p) => !samePolicy(p, declarations[0]));
};

export function validateUsage(s) {
  if (
    !closed(s, [
      "version",
      "day",
      "used",
      "cap",
      "concurrency",
      "mode",
      "reservations",
      "windows",
      "refusal",
      "resetAt",
      "signalAt",
      "resumePermits",
      "pendingPolicy",
      "policies",
    ]) ||
    s.version !== 3 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(s.day) ||
    !integer(s.used) ||
    !integer(s.cap) ||
    s.cap < 1 ||
    s.used > s.cap ||
    !integer(s.concurrency) ||
    s.concurrency < 1 ||
    s.concurrency > 32 ||
    !["api-key", "plan", "hosted"].includes(s.mode) ||
    !Array.isArray(s.reservations) ||
    s.reservations.length > s.concurrency ||
    !Array.isArray(s.windows) ||
    s.windows.length > 5 ||
    !refusals.has(s.refusal) ||
    !time(s.resetAt) ||
    !time(s.signalAt) ||
    ![null, 0, 1].includes(s.resumePermits)
  )
    throw new Error("usage_state_invalid");
  if (
    !s.policies ||
    typeof s.policies !== "object" ||
    Array.isArray(s.policies) ||
    Object.entries(s.policies).some(
      ([owner, policy]) => !owners.includes(owner) || !validPolicy(policy),
    )
  )
    throw new Error("usage_state_invalid");
  if (
    s.pendingPolicy !== null &&
    (!closed(s.pendingPolicy, ["cap", "concurrency", "mode", "day"]) ||
      !integer(s.pendingPolicy.cap) ||
      s.pendingPolicy.cap < 1 ||
      !integer(s.pendingPolicy.concurrency) ||
      s.pendingPolicy.concurrency < 1 ||
      s.pendingPolicy.concurrency > 32 ||
      !["api-key", "plan", "hosted"].includes(s.pendingPolicy.mode) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(s.pendingPolicy.day))
  )
    throw new Error("usage_state_invalid");
  const tokens = new Set();
  for (const r of s.reservations) {
    if (
      !closed(r, ["id", "pid", "boot", "namespace", "day", "started", "valid"]) ||
      typeof r.id !== "string" ||
      !/^[a-f0-9-]{36}$/.test(r.id) ||
      tokens.has(r.id) ||
      !integer(r.pid) ||
      r.pid < 1 ||
      !["string", "number"].includes(typeof r.boot) ||
      (typeof r.boot === "number" && !Number.isFinite(r.boot)) ||
      typeof r.namespace !== "string" ||
      !r.namespace ||
      !/^\d{4}-\d{2}-\d{2}$/.test(r.day) ||
      typeof r.started !== "boolean" ||
      typeof r.valid !== "boolean"
    )
      throw new Error("usage_state_invalid");
    tokens.add(r.id);
  }
  if (s.reservations.filter((r) => r.day === s.day).length > s.used)
    throw new Error("usage_state_invalid");
  const names = new Set();
  for (const w of s.windows) {
    if (
      !closed(w, ["name", "utilization", "resetAt"]) ||
      !Object.hasOwn(thresholds, w.name) ||
      names.has(w.name) ||
      !Number.isFinite(w.utilization) ||
      w.utilization < 0 ||
      w.utilization > 1 ||
      !time(w.resetAt) ||
      w.resetAt === null
    )
      throw new Error("usage_state_invalid");
    names.add(w.name);
  }
  return s;
}

/** One target/account/store identifier, supplied by installation, for ALL clients/sessions.
 * Each model call reserves once. Release only after confirmed child/call termination.
 * Used includes active reservations and uncertain billing; it is never refunded.
 */
export function createRuntimeGuard({
  root,
  targetId,
  mode,
  dailyCap,
  concurrency = 2,
  client = "shared",
  now = Date.now,
  liveness,
  signalMaxAgeMs = 300000,
}) {
  if (
    !/^[a-f0-9]{64}$/.test(targetId) ||
    !owners.includes(client) ||
    !["api-key", "plan", "hosted"].includes(mode) ||
    !integer(concurrency) ||
    concurrency < 1 ||
    concurrency > 32 ||
    !integer(signalMaxAgeMs) ||
    signalMaxAgeMs < 1
  )
    throw new Error("invalid_usage_config");
  const path = join(root, "usage", `${targetId}.json`);
  // All publications, including dispatch intent, pass this single validated writer.
  const publish = (s) => privateWrite(path, JSON.stringify(validateUsage(s)));
  async function operation(change, scheduling = false) {
    if (!integer(dailyCap) || dailyCap < 1)
      return { ok: false, code: "automatic_cap_unconfigured" };
    await checkedPath(root, { directory: true });
    return stateLock(
      path.replace(/\.json$/, ".lock"),
      async (live) => {
        const currentTime = now();
        if (!time(currentTime) || currentTime === null) throw new Error("invalid_usage_clock");
        const day = new Date(currentTime).toISOString().slice(0, 10);
        const raw = await privateRead(path, { missing: true });
        let s;
        try {
          const value =
            raw === undefined
              ? {
                  version: 3,
                  day,
                  used: 0,
                  cap: dailyCap,
                  concurrency,
                  mode,
                  reservations: [],
                  windows: [],
                  refusal: "none",
                  resetAt: null,
                  signalAt: null,
                  resumePermits: null,
                  pendingPolicy: null,
                  policies: {},
                }
              : JSON.parse(raw);
          if (value.version === 1) {
            if (
              !closed(value, [
                "version",
                "day",
                "used",
                "cap",
                "concurrency",
                "mode",
                "reservations",
                "windows",
                "refusal",
                "resetAt",
                "signalAt",
                "resumePermits",
              ])
            )
              throw new Error("usage_state_invalid");
            value.version = 2;
            value.pendingPolicy = null;
          }
          if (value.version === 2) {
            const keys = [
              "version",
              "day",
              "used",
              "cap",
              "concurrency",
              "mode",
              "reservations",
              "windows",
              "refusal",
              "resetAt",
              "signalAt",
              "resumePermits",
              "pendingPolicy",
            ];
            if (!closed(value, keys)) throw new Error("usage_state_invalid");
            value.version = 3;
            value.policies = {};
          }
          s = validateUsage(value);
        } catch {
          throw new Error("usage_state_invalid");
        }
        if (day < s.day) throw new Error("usage_clock_reversed");
        if (day > s.day) {
          s.day = day;
          s.used = 0;
          if (s.refusal === "daily_cap_reached") {
            s.refusal = "none";
            s.resetAt = null;
          }
        }
        const requested = { cap: dailyCap, concurrency, mode };
        s.policies[client] = requested;
        const conflicting = conflict(s);
        // Reverts cancel the proposal BEFORE a new UTC day can activate it.
        if (conflicting || samePolicy(s, requested)) s.pendingPolicy = null;
        else {
          const same = samePolicy(s.pendingPolicy, requested);
          if (!same)
            s.pendingPolicy = {
              cap: dailyCap,
              concurrency,
              mode,
              day: new Date(Date.parse(`${s.day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10),
            };
        }
        if (
          conflicting &&
          !["quota_reached", "plan_threshold", "daily_cap_reached"].includes(s.refusal)
        )
          s.refusal = "policy_conflict";
        else if (!conflicting && s.refusal === "policy_conflict") s.refusal = "none";
        applyPolicy(s);
        const result =
          conflicting && scheduling
            ? { ok: false, code: "policy_conflict" }
            : await change(s, live, currentTime);
        // This sole write site enforces counter/cap invariants even after a refusal.
        await publish(s);
        return result;
      },
      { liveness },
    );
  }
  function deny(s, code, resetAt = null) {
    s.refusal = code;
    s.resetAt = resetAt;
    if (["quota_reached", "plan_threshold", "daily_cap_reached"].includes(code)) {
      if (code !== "daily_cap_reached") s.resumePermits = null;
      for (const r of s.reservations) if (!r.started) r.valid = false;
    }
    return { ok: false, code, resetAt };
  }
  function applyPolicy(s) {
    const policy = s.pendingPolicy;
    if (conflict(s) || !policy || policy.day > s.day || s.reservations.length > policy.concurrency)
      return;
    if (s.used > policy.cap) return; // No counter is ever reset merely to fit a new policy.
    s.cap = policy.cap;
    s.mode = policy.mode;
    s.concurrency = policy.concurrency;
    s.pendingPolicy = null;
    for (const r of s.reservations) if (!r.started) r.valid = false;
    if (s.refusal === "plan_threshold" && s.mode !== "plan") s.resetAt = null;
  }
  function transitioning(s) {
    return s.pendingPolicy && s.pendingPolicy.day <= s.day;
  }
  function threshold(s, t) {
    return s.windows.filter(
      (w) =>
        w.resetAt > t &&
        (w.utilization >= thresholds[w.name] || (w.utilization >= 0.85 && w.resetAt - t <= 900000)),
    );
  }
  function recoverReservations(s, live) {
    for (const r of [...s.reservations]) {
      let alive;
      try {
        alive = ownerAlive(r, live);
      } catch {
        alive = undefined;
      }
      if (alive === false) s.reservations = s.reservations.filter((x) => x.id !== r.id);
      else if (alive !== true) return deny(s, "worker_liveness_unknown");
    }
    return null;
  }
  function eligibility(s, live, t) {
    if (["quota_reached", "plan_threshold", "daily_cap_reached"].includes(s.refusal))
      return { ok: false, code: s.refusal, resetAt: s.resetAt };
    const recovery = recoverReservations(s, live);
    if (recovery) return recovery;
    applyPolicy(s);
    if (transitioning(s)) return deny(s, "concurrency_limited");
    if (s.used >= s.cap)
      return deny(s, "daily_cap_reached", Date.parse(`${s.day}T00:00:00Z`) + 86400000);
    const reached = s.mode === "plan" ? threshold(s, t) : [];
    if (reached.length)
      return deny(s, "plan_threshold", Math.max(...reached.map((w) => w.resetAt)));
    if (s.resumePermits === 0) return { ok: false, code: "quota_reached", resetAt: s.resetAt };
    if (s.reservations.length >= s.concurrency) return deny(s, "concurrency_limited");
    return null;
  }
  return {
    path,
    reserve: ({ id = randomUUID() } = {}) =>
      operation((s, live, t) => {
        if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
          throw new Error("invalid_reservation_id");
        const existing = s.reservations.find((r) => r.id === id);
        if (existing) {
          if (existing.started) return { ok: false, code: "reservation_already_dispatched" };
          if (["quota_reached", "plan_threshold", "daily_cap_reached"].includes(s.refusal))
            return { ok: false, code: s.refusal };
          if (transitioning(s)) return { ok: false, code: "concurrency_limited" };
          if (!existing.valid) return { ok: false, code: "reservation_invalidated" };
          // Only retry a reservation whose caller has not dispatched yet.
          // A new model call (including uncertain retry) MUST use a new id.
          if (existing.pid !== process.pid && ownerAlive(existing, live) !== false)
            return { ok: false, code: "reservation_owned" };
          existing.pid = process.pid;
          existing.boot = live.boot;
          existing.namespace = live.namespace;
          return { ok: true, id, code: s.refusal };
        }
        const refused = eligibility(s, live, t);
        if (refused) return refused;
        s.used++;
        if (s.resumePermits === 1) s.resumePermits = 0;
        s.reservations.push({
          id,
          pid: process.pid,
          boot: live.boot,
          namespace: live.namespace,
          day: s.day,
          started: false,
          valid: true,
        });
        s.refusal =
          s.mode === "plan" && (s.signalAt === null || t - s.signalAt > signalMaxAgeMs)
            ? "quota_signal_unavailable"
            : "none";
        return { ok: true, id, code: s.refusal };
      }, true),
    dispatch: (id, start) =>
      operation(async (s, live, t) => {
        const r = s.reservations.find((r) => r.id === id);
        if (!r || r.pid !== process.pid || ownerAlive(r, live) !== true)
          return { ok: false, code: "worker_liveness_unknown" };
        if (r.started) return { ok: false, code: "reservation_already_dispatched" };
        if (["quota_reached", "plan_threshold", "daily_cap_reached"].includes(s.refusal))
          return { ok: false, code: s.refusal };
        if (transitioning(s)) return { ok: false, code: "concurrency_limited" };
        if (!r.valid) return { ok: false, code: "reservation_invalidated" };
        const reached = s.mode === "plan" ? threshold(s, t) : [];
        if (reached.length)
          return deny(s, "plan_threshold", Math.max(...reached.map((w) => w.resetAt)));
        if (r.day !== s.day) {
          if (s.used >= s.cap)
            return deny(s, "daily_cap_reached", Date.parse(`${s.day}T00:00:00Z`) + 86400000);
          s.used++;
          r.day = s.day;
        }
        r.started = true;
        // Persist consumption BEFORE invoking the single call. A crash cannot
        // dispatch twice with one permit. Uncertain consumption is never refunded.
        await publish(s);
        // start returns a dispatch descriptor; its network/model promise is NOT awaited under this
        // lock.
        return { ok: true, dispatch: await start() };
      }, true),
    release: (id, { terminated = false, accepted = false } = {}) =>
      operation((s) => {
        if (!terminated) return { ok: false, code: "termination_unconfirmed" };
        if (accepted && s.reservations.some((r) => r.id === id) && s.refusal === "none")
          s.resumePermits = null;
        s.reservations = s.reservations.filter((r) => r.id !== id);
        return { ok: true };
      }),
    refuse: ({ code = "quota_reached", resetAt = null } = {}) =>
      operation((s) => {
        if (!["quota_reached", "plan_threshold"].includes(code) || !time(resetAt))
          throw new Error("invalid_usage_refusal");
        return deny(s, code, resetAt);
      }),
    observe: ({ windows, observedAt } = {}) =>
      operation((s, _live, t) => {
        if (!integer(observedAt) || observedAt > t || t - observedAt > signalMaxAgeMs)
          return { ok: false, code: "quota_signal_unavailable" };
        // Copy only validated numeric signals; reject every unrecognized field.
        validateUsage({ ...s, windows, signalAt: observedAt });
        s.windows = windows.map((w) => ({ ...w }));
        s.signalAt = observedAt;
        const reached = s.mode === "plan" ? threshold(s, t) : [];
        if (reached.length)
          return {
            ...deny(s, "plan_threshold", Math.max(...reached.map((w) => w.resetAt))),
            cancel: s.reservations.map((r) => r.id),
          };
        return { ok: true, cancel: [] };
      }),
    resume: () =>
      operation((s, live, t) => {
        if (s.resetAt !== null && t < s.resetAt)
          return { ok: false, code: s.refusal, resetAt: s.resetAt };
        const previous = s.refusal;
        const previousReset = s.resetAt,
          previousPermits = s.resumePermits;
        const recovery = recoverReservations(s, live);
        if (recovery) {
          if (["quota_reached", "plan_threshold", "daily_cap_reached"].includes(previous)) {
            s.refusal = previous;
            s.resetAt = previousReset;
            s.resumePermits = previousPermits;
          }
          return recovery;
        }
        if (s.resumePermits === 0 && s.reservations.length)
          return { ok: false, code: "quota_reached" };
        if (s.resumePermits === 0) s.resumePermits = 1;
        s.refusal = "none";
        s.resetAt = null;
        const refused = eligibility(s, live, t);
        if (refused) {
          if (
            ["quota_reached", "plan_threshold", "daily_cap_reached"].includes(previous) &&
            ["concurrency_limited", "worker_liveness_unknown"].includes(refused.code)
          ) {
            s.refusal = previous;
            s.resetAt = previousReset;
            s.resumePermits = previousPermits;
          }
          return refused;
        }
        if (
          s.resumePermits === 0 ||
          ["quota_reached", "plan_threshold", "daily_cap_reached"].includes(previous)
        )
          s.resumePermits = 1;
        return { ok: true, previous };
      }, true),
    status: () =>
      operation((s) => ({
        ok: !conflict(s),
        ...(conflict(s) ? { code: "policy_conflict" } : {}),
        state: structuredClone(s),
      })),
  };
}

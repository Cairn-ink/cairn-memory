import { randomBytes } from "node:crypto";
import { transcriptDigest } from "./digest.mjs";
import { checkedPath } from "../client/private-state.mjs";
import { stateLock } from "../client/state-lock.mjs";
import { readControlState, startIfActive } from "../client/control-state.mjs";
import { hash, planBatches } from "../client/common-profile.mjs";
import { cursorPath, readCursor, publishCursor, initialCursor } from "./cursor.mjs";
import { MAX_LINE, MAX_READ, verifyHeader, parseLine } from "./parser.mjs";
import { openSource, readBytes } from "./source.mjs";

// Stubs only in CX-3. Installed transport enablement belongs to CX-4/LAC/CX-5.
const WINDOW = MAX_READ - MAX_LINE - 1024; // header + anchor + boundary tail checks fit read budget
const terminal = new Set(["complete", "duplicate", "empty"]);
const closed = (x, allowed) =>
  x &&
  typeof x === "object" &&
  !Array.isArray(x) &&
  Object.keys(x).every((k) => allowed.includes(k));
const fileId = (stat, path) => hash(path, stat.dev, stat.ino);
const wireBinding = (b) => ({
  projectId: b.projectId,
  sessionId: hash("wire-session-v1", "codex", b.sessionId),
});
function account(s, records, start, end) {
  for (const r of records.filter((r) => r.start >= start && r.end <= end)) {
    if (r.message) {
      s.accepted += r.end - r.start;
      s.truncated += Number(r.truncated);
      s.normalizedUnits += r.normalizedUnits;
      s.submittedUnits += r.submittedUnits;
    } else s.skipped[r.reason] += r.end - r.start;
  }
  s.offset = end;
}
function scan(bytes, start, binding, epoch, discard, discardReason) {
  const records = [];
  let at = 0;
  while (at < bytes.length) {
    const nl = bytes.indexOf(10, at);
    if (discard) {
      const end = nl < 0 ? bytes.length : nl + 1;
      records.push({ start: start + at, end: start + end, reason: discardReason });
      at = end;
      discard = nl < 0;
      if (discard) break;
      discardReason = null;
      continue;
    }
    if (nl < 0 && bytes.length - at <= MAX_LINE) break;
    const end = nl < 0 ? bytes.length : nl + 1;
    if (end - at > MAX_LINE) {
      records.push({ start: start + at, end: start + end, reason: "oversized" });
      discard = nl < 0;
      discardReason = discard ? "oversized" : null;
    } else
      records.push(
        parseLine(bytes.subarray(at, nl), {
          sessionId: binding.sessionId,
          wireSessionId: wireBinding(binding).sessionId,
          epoch,
          start: start + at,
          end: start + end,
        }),
      );
    at = end;
  }
  return { records, end: start + at, discard, discardReason };
}

async function prepared(binding, options, action) {
  const { root, targetId, sessionId, projectId, path } = binding;
  if (
    !/^[a-f0-9]{64}$/.test(targetId) ||
    !/^[a-f0-9]{64}$/.test(projectId) ||
    typeof sessionId !== "string" ||
    !sessionId ||
    sessionId.length > 200 ||
    !sessionId.isWellFormed()
  )
    throw new Error("invalid_binding");
  await checkedPath(root, { directory: true });
  const cp = cursorPath(root, targetId, sessionId);
  return stateLock(
    cp.replace(/\.json$/, ".lock"),
    async () => {
      let s = await readCursor(cp, { recover: options.reset });
      let prior = s ? structuredClone(s) : null;
      const save = async () => {
        if (s.version === 1) return;
        await publishCursor(cp, s, prior);
        prior = structuredClone(s);
      };
      const control = await readControlState(root);
      if (!options.reset && (control.paused || !control.valid))
        return { status: "paused", state: s };
      let file;
      try {
        file = await openSource(path);
      } catch (error) {
        if (s) {
          s.status = "source_unavailable";
          s.unconfirmedTail = true;
          await save();
        }
        return { status: "source_unavailable", state: s };
      }
      try {
        const stat = await file.stat();
        const size = stat.size;
        const end = options.byteEnd === undefined ? size : Math.min(options.byteEnd, size);
        if (!Number.isSafeInteger(end) || end < 0) throw new Error("invalid_byte_end");
        const id = fileId(stat, path),
          opaque = hash(targetId, projectId, wireBinding(binding).sessionId);
        const digest = await transcriptDigest(binding);
        if (!s) s = initialCursor(opaque, id, control.generation);
        async function boundary(reason, newEpoch = false) {
          const quotaRefusal = s.quotaRefusal;
          if (newEpoch) {
            s = initialCursor(opaque, id, control.generation);
            s.epoch = (prior?.epoch ?? randomBytes(6).readUIntBE(0, 6)) + 1;
          }
          s.skipped[reason] += size - s.offset;
          s.offset = size;
          s.observedEnd = size;
          s.generation =
            control.paused || !control.valid
              ? "legacy-" + hash("paused-reset", control.generation)
              : control.generation;
          s.pending = null;
          s.quotaRefusal = quotaRefusal;
          s.notBefore = 0;
          s.discard = size > 0 && (await readBytes(file, size - 1, size))[0] !== 10;
          s.discardReason = s.discard ? reason : null;
          s.status = reason;
          s.unconfirmedTail = true;
          const start = Math.max(0, size - 256);
          s.anchor = { start, end: size, digest: digest(await readBytes(file, start, size)) };
          await save();
          return { status: reason, state: s };
        }
        if (options.reset) {
          const generation =
            control.paused || !control.valid
              ? "legacy-" + hash("paused-reset", control.generation)
              : control.generation;
          if (
            prior?.version === 2 &&
            s.status === "state_reset" &&
            s.binding === opaque &&
            s.file === id &&
            s.offset === size &&
            s.generation === generation &&
            !s.pending &&
            s.anchor &&
            digest(await readBytes(file, s.anchor.start, s.anchor.end)) === s.anchor.digest
          )
            return { status: "state_reset", state: s };
          return await boundary("state_reset", true);
        }
        if (s.version === 1) return await boundary("digest_migrated", true);
        if (s.binding !== opaque) return await boundary("binding_changed", true);
        if (["unsupported_format", "invalid_reply"].includes(s.status))
          return { status: s.status, state: s };
        if (options.byteEnd !== undefined && end < s.offset)
          return { status: "superseded", state: s };
        const header = await readBytes(file, 0, Math.min(size, MAX_LINE));
        const nl = header.indexOf(10);
        if (nl < 0)
          return { status: size > MAX_LINE ? "unsupported_format" : "partial_tail", state: s };
        try {
          verifyHeader(header.subarray(0, nl), sessionId);
        } catch {
          if (s) {
            s.status = "unsupported_format";
            await save();
          }
          return { status: "unsupported_format", state: s };
        }

        if (s.file !== id || size < s.offset || (s.pending && size < s.pending.end))
          return await boundary("source_changed", true);
        if (
          s.anchor &&
          digest(await readBytes(file, s.anchor.start, s.anchor.end)) !== s.anchor.digest
        )
          return await boundary("source_changed", true);
        if (s.generation !== control.generation || (!prior && control.generation !== "initial"))
          return await boundary("pause_boundary");
        if (s.pending && options.byteEnd !== undefined && options.byteEnd < s.pending.end)
          return { status: "pending", state: s };
        s.observedEnd = Math.max(s.observedEnd, size);
        s.unconfirmedTail = true;
        let bytes, scanned, batches;
        if (s.pending) {
          bytes = await readBytes(file, s.pending.start, s.pending.end);
          if (digest(bytes) !== s.pending.digest) return await boundary("source_changed", true);
          scanned = scan(bytes, s.pending.start, binding, s.epoch, s.discard, s.discardReason);
          // discard applies only at the pending start; acknowledgement stores its final value on
          // completion.
          batches = planBatches(
            scanned.records,
            wireBinding(binding),
            s.epoch,
            s.pending.start,
            scanned.end,
          );
          if (
            hash(batches.map((b) => ({ end: b.end, eventId: b.eventId }))) !==
            hash(s.pending.batches)
          )
            throw new Error("cursor_manifest_mismatch");
        } else {
          const start = s.offset;
          bytes = await readBytes(file, start, Math.min(end, start + WINDOW));
          try {
            scanned = scan(bytes, start, binding, s.epoch, s.discard, s.discardReason);
          } catch {
            s.status = "unsupported_format";
            await save();
            return { status: s.status, state: s };
          }
          batches = planBatches(scanned.records, wireBinding(binding), s.epoch, start, scanned.end);
          if (!batches.length) {
            s.status =
              start < end
                ? "partial_tail"
                : [
                      "pause_boundary",
                      "source_changed",
                      "state_reset",
                      "binding_changed",
                      "digest_migrated",
                      "excluded",
                    ].includes(s.status)
                  ? s.status
                  : "idle";
            await save();
            return { status: s.status, state: s };
          }
          s.pending = {
            start,
            end: scanned.end,
            digest: digest(bytes.subarray(0, scanned.end - start)),
            batches: batches.map((b) => ({ end: b.end, eventId: b.eventId })),
            next: 0,
            discard: scanned.discard,
            discardReason: scanned.discardReason,
          };
          s.status = "pending";
          // Freeze before launcher/worker dispatch. No source text is persisted.
          await save();
        }
        return action
          ? await action({ s, save, batches, records: scanned.records, bytes, stat, digest })
          : { status: "pending", state: s };
      } finally {
        await file.close();
      }
    },
    options,
  );
}

export const prepareCapture = (binding, options = {}) => prepared(binding, options);
// SessionStart needs a pause boundary, not a transcript parse/history upload.
export async function establishPauseBoundary(binding, options = {}) {
  const cp = cursorPath(binding.root, binding.targetId, binding.sessionId);
  await checkedPath(binding.root, { directory: true });
  return stateLock(
    cp.replace(/\.json$/, ".lock"),
    async () => {
      const control = await readControlState(binding.root),
        previous = await readCursor(cp);
      if (control.paused || !control.valid) return { status: "paused" };
      const opaque = hash(binding.targetId, binding.projectId, wireBinding(binding).sessionId);
      const changed = previous && previous.binding !== opaque;
      const migration = previous?.version === 1;
      if (
        !changed &&
        !migration &&
        previous &&
        ["unsupported_format", "invalid_reply"].includes(previous.status)
      )
        return { status: previous.status };
      if (
        !changed &&
        !migration &&
        ((previous && previous.generation === control.generation) ||
          (!previous && control.generation === "initial"))
      )
        return { status: "context_unavailable" };
      const digest = await transcriptDigest(binding);
      const source = await openSource(binding.path);
      try {
        const stat = await source.stat(),
          id = fileId(stat, binding.path);
        const replaced =
          previous && (changed || migration || previous.file !== id || stat.size < previous.offset);
        const s =
          !previous || replaced
            ? initialCursor(opaque, id, control.generation)
            : structuredClone(previous);
        if (replaced) s.epoch = previous.epoch + 1;
        const reason = changed
          ? "binding_changed"
          : migration
            ? "digest_migrated"
            : replaced
              ? "source_changed"
              : "pause_boundary";
        s.skipped[reason] += stat.size - s.offset;
        s.offset = stat.size;
        s.observedEnd = stat.size;
        s.generation = control.generation;
        s.pending = null;
        s.quotaRefusal = previous?.quotaRefusal ?? null;
        s.notBefore = 0;
        s.status = reason;
        const tail = stat.size
          ? await readBytes(source, stat.size - 1, stat.size)
          : Buffer.alloc(0);
        s.discard = stat.size > 0 && tail[0] !== 10;
        s.discardReason = s.discard ? reason : null;
        s.anchor = stat.size
          ? { start: stat.size - 1, end: stat.size, digest: digest(tail) }
          : null;
        await publishCursor(cp, s, previous);
        return { status: reason, state: s };
      } finally {
        await source.close();
      }
    },
    options,
  );
}
export function resetCapture(binding, { hostsStopped, confirm, ...options } = {}) {
  if (hostsStopped !== true || confirm !== true) throw new Error("reset_requires_stopped_workers");
  return prepared(binding, { ...options, reset: true });
}

/** Stub seam: capture(body,{signal}) plus synchronous confirmed-termination query.
 * Every real local/hosted adapter must implement cancellation and idempotency.
 */
export async function runWorker(
  binding,
  {
    transport,
    guard,
    mode = "hosted-stub",
    now = Date.now,
    requestMs,
    overallMs,
    beforeDispatch,
    ...options
  } = {},
) {
  if (!["hosted-stub", "local-stub"].includes(mode) || !transport || !guard)
    return { status: "transport_unavailable" };
  requestMs ??= mode === "local-stub" ? 150000 : 25000;
  overallMs ??= mode === "local-stub" ? 155000 : 60000;
  if (
    requestMs < 1 ||
    requestMs > (mode === "local-stub" ? 150000 : 25000) ||
    overallMs < 1 ||
    overallMs > (mode === "local-stub" ? 155000 : 60000)
  )
    throw new Error("invalid_worker_deadline");
  const started = now();
  return prepared(binding, options, async ({ s, save, batches, records, bytes, stat, digest }) => {
    if (s.quotaRefusal && !s.quotaRefusal.latched) {
      try {
        await guard.refuse({ resetAt: s.quotaRefusal.resetAt });
        s.quotaRefusal.latched = true;
      } catch {
        /* Keep the durable refusal intent; never dispatch before its latch. */
      }
      if (s.quotaRefusal.reservationId && s.quotaRefusal.terminated) {
        try {
          await guard.release(s.quotaRefusal.reservationId, { terminated: true });
          s.quotaRefusal.reservationId = null;
        } catch {
          /* A confirmed termination can be retried without billing refund. */
        }
      }
      s.status = "quota_reached";
      await save();
      return { status: s.status, state: s };
    }
    if (s.quotaRefusal?.reservationId && s.quotaRefusal.terminated) {
      await guard.release(s.quotaRefusal.reservationId, { terminated: true });
      s.quotaRefusal.reservationId = null;
      await save();
    }
    if (s.notBefore > now()) return { status: s.status, state: s };
    let dispatched = 0;
    while (s.pending.next < batches.length) {
      const b = batches[s.pending.next];
      if (b.body) {
        if (now() - started + requestMs > overallMs) {
          s.status = "deadline";
          await save();
          return { status: s.status, state: s };
        }
        if (mode === "local-stub" && dispatched) {
          s.status = "batch_limit";
          await save();
          return { status: s.status, state: s };
        }
        await beforeDispatch?.(b);
        // Re-open the authorized name just before sending; file replacement cannot reuse the frozen
        // range.
        const check = await openSource(binding.path);
        try {
          const current = await check.stat();
          // Identity/metadata fencing after the bounded digest read. A concurrent
          // append or mutation defers further dispatch to a fresh authorized hook.
          if (
            fileId(current, binding.path) !== s.file ||
            current.size < s.pending.end ||
            current.mtimeMs !== stat.mtimeMs ||
            current.ctimeMs !== stat.ctimeMs
          ) {
            s.status = "source_changed";
            await save();
            return { status: s.status, state: s };
          }
        } finally {
          await check.close();
        }
        const permit = await guard.reserve();
        if (!permit.ok) {
          s.status = permit.code;
          await save();
          return { status: s.status, state: s };
        }
        const abort = new AbortController();
        let timer,
          began = false,
          reply,
          failure = null,
          refusalObserved = false;
        try {
          const gate = await guard.dispatch(permit.id, () =>
            startIfActive(binding.root, s.generation, () => {
              if (now() - started + requestMs > overallMs) throw new Error("deadline");
              began = true;
              const timeout = new Promise((_, reject) => {
                timer = setTimeout(() => {
                  abort.abort();
                  reject(new Error("timeout"));
                }, requestMs);
              });
              return Promise.race([transport.capture(b.body, { signal: abort.signal }), timeout]);
            }),
          );
          if (!gate.ok) {
            s.status = gate.code;
            await save();
            return { status: s.status, state: s };
          }
          const dispatch = gate.dispatch;
          if (!dispatch.started) {
            s.status = "paused";
            await save();
            return { status: s.status, state: s };
          }
          dispatched++;
          reply = await dispatch.operation;
          if (
            closed(reply, ["status", "code", "resetAt"]) &&
            reply.status === "refused" &&
            reply.code === "quota_reached" &&
            (reply.resetAt === undefined ||
              (Number.isSafeInteger(reply.resetAt) && reply.resetAt >= 0))
          ) {
            refusalObserved = true;
            s.quotaRefusal = {
              resetAt: reply.resetAt ?? null,
              latched: false,
              reservationId: permit.id,
              terminated: transport.terminated() === true,
            };
            s.status = "quota_reached";
            await save();
            try {
              await guard.refuse({ code: reply.code, resetAt: s.quotaRefusal.resetAt });
              s.quotaRefusal.latched = true;
            } catch {
              /* The cursor retains the refusal even if the usage lock is busy. */
            }
          }
        } catch (error) {
          if (!refusalObserved) failure = error.message === "deadline" ? "deadline" : "timeout";
          else throw error;
        } finally {
          clearTimeout(timer);
          // A noncooperating/unknown child retains its reservation; no age-based refund.
          try {
            const released = await guard.release(permit.id, {
              terminated: !began || transport.terminated() === true,
              accepted:
                closed(reply, ["status", "eventId"]) &&
                reply.eventId === b.eventId &&
                terminal.has(reply.status),
            });
            if (released.ok && s.quotaRefusal?.reservationId === permit.id)
              s.quotaRefusal.reservationId = null;
          } catch (error) {
            if (!refusalObserved) throw error;
          }
        }
        if (failure) {
          s.status = failure;
          if (mode === "local-stub") s.notBefore = now() + 125000;
          await save();
          return { status: s.status, state: s };
        }
        if (
          closed(reply, ["status", "code", "resetAt"]) &&
          reply.status === "refused" &&
          reply.code === "quota_reached" &&
          (reply.resetAt === undefined ||
            (Number.isSafeInteger(reply.resetAt) && reply.resetAt >= 0))
        ) {
          s.status = "quota_reached";
          await save();
          return { status: s.status, state: s };
        }
        if (
          closed(reply, ["status", "eventId"]) &&
          reply.eventId === b.eventId &&
          reply.status === "processing"
        ) {
          s.status = "processing";
          if (mode === "local-stub") s.notBefore = now() + 125000;
          await save();
          return { status: s.status, state: s };
        }
        if (
          !closed(reply, ["status", "eventId"]) ||
          reply.eventId !== b.eventId ||
          !terminal.has(reply.status)
        ) {
          s.status = "invalid_reply";
          await save();
          return { status: s.status, state: s };
        }
      }
      s.quotaRefusal = null;
      account(s, records, b.start, b.end);
      s.pending.next++;
      s.status = b.body ? "pending" : "excluded";
      s.notBefore = 0;
      await save();
    }
    s.discard = s.pending.discard;
    s.discardReason = s.pending.discardReason;
    const start = Math.max(s.pending.start, s.offset - 256);
    s.anchor = {
      start,
      end: s.offset,
      digest: digest(bytes.subarray(start - s.pending.start, s.offset - s.pending.start)),
    };
    s.pending = null;
    s.status = s.status === "excluded" ? "excluded" : "idle";
    await save();
    return { status: s.status, state: s };
  });
}

import { check, equal, readDump, rejects } from "./support.mjs";

/** @import { CaptureKey, CaptureMessage, Tx } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */

const client = "test-client";

/**
 * @param {CaseContext} ctx
 * @param {"session" | "window"} kind
 */
async function lateForget({ adapter: { capture, raw, uow }, owner, scope, sessionRefs, harness }, kind) {
  const admit = capture.admit?.bind(capture);
  if (!admit) return "needs capture.admit";
  check(raw, "rawArchive requires the raw ports");
  const key = { scope: scope(null), client, sessionId: "first", eventId: "first", payloadDigest: "a".repeat(64) };
  /** @type {CaptureMessage[]} */
  const messages = [
    { id: "first", role: "user", content: "The path crosses a stone bridge.", occurredAtMs: 10 },
    { id: "second", role: "user", content: "Copper conducts electricity.", occurredAtMs: 20 },
  ];
  const [forgotten, control] = messages;
  // A session fact covers every position in a capture. A window can cover just one.
  const controlKey = kind === "session" ? { ...key, sessionId: "second", eventId: "second" } : key;
  const targetBatch = kind === "session" ? [forgotten] : messages;
  const controlPosition = kind === "session" ? 0 : 1;
  /** @template T @param {(tx: Tx) => Promise<T>} work */
  const locked = (work) => uow.run(owner, { pauseLock: true }, work);
  /** @param {CaptureKey} key @param {readonly CaptureMessage[]} batch */
  const admitAndClaim = async (key, batch) => {
    equal((await locked(tx => admit(tx, key, batch))).status, "admitted", "The fixture must be admitted");
    equal((await locked(tx => capture.claim(tx, key, batch, { leaseMs: 60_000 }))).status, "claimed",
      "The fixture must have a live claim");
  };
  await admitAndClaim(key, targetBatch);
  if (kind === "session") await admitAndClaim(controlKey, [control]);
  await locked(tx => capture.assertEligible(tx, key, targetBatch.map((_, i) => i)));

  const base = { owner, actionId: "test-forget", origin: /** @type {const} */ ("forget") };
  if (kind === "window") {
    await harness.seedFact(owner, { ...base, kind, client, window: { startMs: 10, endMs: 20 } });
  } else {
    const { sessionId } = key;
    if (sessionRefs === "plain") {
      await harness.seedFact(owner, { ...base, kind, session: { client, sessionId } });
    } else {
      check(harness.hashSessionKey, "Hashed profile requires harness.hashSessionKey");
      const sessionKeyHash = harness.hashSessionKey(client, sessionId);
      check(typeof sessionKeyHash === "string" && /^[a-f0-9]{64}$/u.test(sessionKeyHash),
        "Harness must return a session hash");
      await harness.seedFact(owner, { ...base, kind, session: { client, sessionKeyHash } });
    }
  }

  await uow.run(owner, { readOnly: true }, async tx => {
    equal(await capture.eligible(tx, key, targetBatch), kind === "session" ? [] : [1],
      "Source eligibility must reflect the committed forget fact");
    if (kind === "session") {
      equal(await capture.eligible(tx, controlKey, [control]), [0], "The separate session remains eligible");
    }
  });

  const before = await readDump(harness);
  let checkRefused = false;
  await rejects(() => locked(async tx => {
    try {
      await capture.assertEligible(tx, key, [0]);
    } catch (error) {
      checkRefused = true;
      throw error;
    }
    // Lineage records supplied messages, so the caller must guard the write.
    await raw.recordLineage(tx, key, [forgotten]);
  }), "suppressed");
  check(checkRefused, "assertEligible must refuse the source in the locked write");
  equal(await readDump(harness), before, "The rejected write must leave no lineage anchor");
  equal((await locked(tx => raw.archive(tx, key, [forgotten]))).archived, 0,
    "Raw archive must refuse the source covered by the committed fact");
  equal(await readDump(harness), before, "The refused source must leave no stored raw row");

  await locked(async tx => {
    await capture.assertEligible(tx, controlKey, [controlPosition]);
    equal((await raw.archive(tx, controlKey, [control])).archived, 1, "The control must reach the archive");
  });
  const archived = await readDump(harness);
  await locked(async tx => {
    await capture.assertEligible(tx, controlKey, [controlPosition]);
    await raw.recordLineage(tx, controlKey, [control]);
  });
  check(JSON.stringify(await readDump(harness)) !== JSON.stringify(archived),
    "The control must add a lineage anchor to the dump");
}

/** @type {readonly ConformanceCase[]} */
export const CAPTURE_LATE_FORGET_CASES = [
  {
    id: "K-RAW-LATE-1", title: "a session forget after admission refuses the source",
    needs: ["rawArchive"], run: ctx => lateForget(ctx, "session"),
  },
  {
    id: "K-RAW-LATE-2", title: "a window forget after admission refuses only the covered position",
    needs: ["rawArchive", "rawWindowHide"], run: ctx => lateForget(ctx, "window"),
  },
];

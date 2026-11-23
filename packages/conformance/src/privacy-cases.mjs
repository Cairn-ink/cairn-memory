import { CoreError, factIncarnationBody } from "@cairn-ink/core";
import { check, equal, readDump, rejects, row } from "./support.mjs";

/** @typedef {import("./index.d.mts").CaseContext} Context */
/** @typedef {import("@cairn-ink/core").SuppressionFact} Fact */
/** @typedef {import("@cairn-ink/core").TextDigest} TextDigest */
/** @typedef {Awaited<ReturnType<Context["adapter"]["suppressions"]["writeFact"]>>} FactWrite */

const client = "test-client";
const sessionValue = "a".repeat(64);
const sessionId = { client, sessionId: sessionValue };
const sessionHash = { client, sessionKeyHash: sessionValue };

/** @param {string} owner */
function factBase(owner) {
  return { owner, actionId: "test-action", origin: /** @type {const} */ ("forget") };
}

/** @param {string} owner @param {string} memoryId @returns {Extract<Fact, {kind: "identity"}>} */
function identity(owner, memoryId) {
  return { ...factBase(owner), kind: "identity", memoryId };
}

/** @param {string} value @returns {TextDigest} */
function digest(value) {
  return { alg: "sha256", value: value.repeat(64), pipeline: "core", redactionVersion: 1, keyId: null };
}

/** @param {string} owner @param {TextDigest[]} digests @returns {Extract<Fact, {kind: "text"}>} */
function textFact(owner, digests) {
  return { ...factBase(owner), kind: "text", mode: "exact", text: { digests } };
}

/** @param {Context} ctx @param {Fact} fact */
async function incarnation(ctx, fact) {
  return (await ctx.hash(factIncarnationBody(fact))).slice("sha256:".length);
}

/** @param {Context} ctx @param {Fact} fact @param {string} [version] */
async function write(ctx, fact, version) {
  const { uow, suppressions } = ctx.adapter;
  const revision = version ?? await incarnation(ctx, fact);
  return uow.run(fact.owner, {}, (tx) => suppressions.writeFact(tx, fact, revision));
}

/** @param {Context} ctx @param {string} [owner] */
function epoch(ctx, owner = ctx.owner) {
  const { uow, suppressions } = ctx.adapter;
  return uow.run(owner, { readOnly: true }, (tx) => suppressions.epoch(tx, owner));
}

/** @param {FactWrite} value */
function projectWrite({ factId, epoch, createdAtMs }) {
  return [factId, epoch, createdAtMs];
}

/** @param {import("@cairn-ink/core/ports").PauseState} state */
function projectPause({ paused, generation }) {
  return [paused, generation];
}

/** @param {Context} ctx */
function sessionProfile({ sessionRefs }) {
  check(sessionRefs === "plain" || sessionRefs === "hashed", "The factory must declare its session reference profile");
  return sessionRefs;
}

/** @param {CryptoKey} key */
async function signProbe(key) {
  const probe = new TextEncoder().encode("test-fingerprint-probe");
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, probe));
}

/** @param {Context} ctx @param {Fact[]} targets */
async function assertDistinctTargets(ctx, targets) {
  let expectedEpoch = 0n;
  for (const target of targets) {
    const result = await write(ctx, target);
    check(result.created === true, `Distinct ${target.kind} targets must create new facts`);
    equal(result.epoch, ++expectedEpoch, "Each new target must advance the epoch once");
  }
  equal(await epoch(ctx), expectedEpoch, "The owner epoch must count all distinct targets");
}

/** @type {readonly import("./index.d.mts").ConformanceCase[]} */
export const privacyCases = [
  {
    id: "K-FACT-1", title: "returns the original fact on retry", needs: [],
    async run(ctx) {
      const fact = identity(ctx.owner, "test-memory");
      const version = await incarnation(ctx, fact);
      const first = await write(ctx, fact, version);
      check(first.created === true, "The first write must create the fact");
      check(typeof first.factId === "string" && first.factId.length > 0 &&
        Number.isSafeInteger(first.createdAtMs), "A created fact must have an ID and creation time");
      equal([first.epoch, await epoch(ctx)], [1n, 1n], "The first write must advance the epoch once");

      const second = await write(ctx, identity(ctx.owner, "test-other-memory"));
      equal([second.created, second.epoch, await epoch(ctx)], [true, 2n, 2n],
        "A different fact must advance the owner epoch before the retry");
      const retry = await write(ctx, fact, version);
      check(retry.created === false, "A retry must report that no fact was created");
      equal(projectWrite(retry), projectWrite(first), "A retry must return the original fact ID, epoch and creation time");
      equal(await epoch(ctx), second.epoch, "A retry must leave the owner epoch unchanged");
    },
  },
  {
    id: "K-FACT-2", title: "rolls back the whole run on a fact conflict", needs: [],
    async run(ctx) {
      const { adapter: { uow, suppressions }, owner, harness } = ctx;
      const fact = identity(owner, "test-existing");
      await write(ctx, fact);
      const conflicting = { ...fact, origin: /** @type {const} */ ("edit") };
      const other = identity(owner, "test-new");
      const [conflictingVersion, otherVersion] = await Promise.all([incarnation(ctx, conflicting), incarnation(ctx, other)]);
      const before = await readDump(harness);
      const beforeEpoch = await epoch(ctx);

      await rejects(() => uow.run(owner, {}, async (tx) => {
        await suppressions.writeFact(tx, other, otherVersion);
        await suppressions.writeFact(tx, conflicting, conflictingVersion);
      }), "fact_conflict");
      equal(await readDump(harness), before, "A fact conflict must roll back earlier writes in the same run");
      equal(await epoch(ctx), beforeEpoch, "A fact conflict must leave the owner epoch unchanged");
    },
  },
  {
    id: "K-UOW-8a", title: "rolls back after a caught fact conflict", needs: [],
    async run(ctx) {
      const { adapter: { uow, suppressions }, owner, harness } = ctx;
      const fact = identity(owner, "test-existing");
      await write(ctx, fact);
      const conflicting = { ...fact, origin: /** @type {const} */ ("edit") };
      const other = identity(owner, "test-new");
      const [conflictingVersion, otherVersion] = await Promise.all([incarnation(ctx, conflicting), incarnation(ctx, other)]);
      const before = await readDump(harness);
      const beforeEpoch = await epoch(ctx);

      let callbackReturned = false;
      await rejects(() => uow.run(owner, {}, async (tx) => {
        const added = await suppressions.writeFact(tx, other, otherVersion);
        check(added.created === true, "The run must create a new fact before the conflict");
        await rejects(() => suppressions.writeFact(tx, conflicting, conflictingVersion), "fact_conflict");
        callbackReturned = true;
      }), "fact_conflict");
      check(callbackReturned, "The callback must catch the fact conflict and return normally");
      equal(await readDump(harness), before, "A caught fact conflict must roll back earlier writes in the same run");
      equal(await epoch(ctx), beforeEpoch, "A caught fact conflict must leave the owner epoch unchanged");
    },
  },
  {
    id: "K-UOW-8b", title: "rolls back with the first caught write failure", needs: [],
    async run(ctx) {
      const { adapter: { uow, memories }, owner, harness } = ctx;
      const scope = ctx.scope(null);
      const first = await row(ctx, "original");
      const next = await row(ctx, "replacement");
      const before = await readDump(harness);
      /** @type {string | undefined} */
      let insertedId;
      await rejects(() => uow.run(owner, {}, async (tx) => {
        const { id, revision } = await memories.insert(tx, scope, first, [], 1);
        await rejects(() => memories.replaceContent(tx, scope, id, revision + 1, next, null, 2), "revision_conflict");
        await rejects(() => memories.replaceContent(tx, ctx.scope("other"), id, revision, next, null, 2), "memory_not_found");
        insertedId = id;
      }), "revision_conflict");
      check(insertedId !== undefined, "The callback must catch both write failures and return normally");
      const id = insertedId;
      equal(await readDump(harness), before, "A caught revision conflict must roll back the inserted row");
      equal(await uow.run(owner, { readOnly: true }, (tx) => memories.get(tx, scope, id)), null,
        "The inserted row must be absent after the run rejects");
    },
  },
  {
    id: "K-FACT-3", title: "creates a new fact for each distinct target", needs: [],
    async run(ctx) {
      const { owner } = ctx;
      // Keep the legacy NUL-join probes for the flag-false drivers.
      const separator = ctx.adapter.capabilities.embeddingRequiredOnInsert ? "|" : "\u0000";
      const firstText = textFact(owner, [digest("a"), digest("b")]);
      const firstIdentity = identity(owner, "test-revision");
      /** @type {Extract<Fact, {kind: "window"}>} */
      const window = { ...factBase(owner), kind: "window", client: null, window: { startMs: 10, endMs: 20 } };
      /** @type {Fact[]} */
      const targets = [
        window,
        { ...window, client: "*" },
        { ...window, window: { ...window.window, startMs: 11 } },
        { ...window, window: { ...window.window, endMs: 21 } },
        { ...window, unknownTime: true },
        { ...window, anchor: "pm30min" },
        { ...identity(owner, 'c"\\\u0001'), namespace: "a,b" },
        { ...identity(owner, 'b,c"\\\u0001'), namespace: "a" },
        { ...identity(owner, "c"), namespace: `a${separator}b` },
        { ...identity(owner, `b${separator}c`), namespace: "a" },
        firstText,
        textFact(owner, [digest("a"), digest("c")]),
        { ...firstText, sourceMemory: { id: "test-source-a", createdAtMs: 10 } },
        { ...firstText, sourceMemory: { id: "test-source-b", createdAtMs: 10 } },
        { ...firstText, mode: "full" },
        textFact(owner, [{ ...digest("a"), alg: "hmac", keyId: "test-key" }, digest("b")]),
        firstIdentity,
        { ...firstIdentity, throughRevision: 0 },
        { ...firstIdentity, namespace: "test-namespace" },
      ];
      if (sessionProfile(ctx) === "plain") {
        const plain = { ...factBase(owner), kind: /** @type {const} */ ("session"), session: sessionId };
        targets.push(
          plain,
          { ...plain, session: { client: `a${separator}b`, sessionId: "c" } },
          { ...plain, session: { client: "a", sessionId: `b${separator}c` } },
          // Also exercise a join that puts the ref-kind discriminator between the two fields.
          { ...plain, session: { client: `a${separator}id${separator}b`, sessionId: "c" } },
          { ...plain, session: { client: "a", sessionId: `b${separator}id${separator}c` } },
        );
      }
      targets.push({ ...factBase(owner), kind: "session", session: sessionHash });
      targets.push({ ...factBase(owner), kind: "session", session: { ...sessionHash, client: "test-other-client" } });

      await assertDistinctTargets(ctx, targets);
    },
  },
  {
    id: "K-FACT-3r", title: "creates a new fact for each distinct raw span target", needs: ["rawSpans"],
    async run(ctx) {
      const separator = ctx.adapter.capabilities.embeddingRequiredOnInsert ? "\t" : "\u0000";
      /** @type {Extract<Fact, {kind: "rawSpan"}>} */
      const span = {
        ...factBase(ctx.owner), kind: "rawSpan", sessionKeyHash: sessionValue, messageKey: "test-message",
        startUtf16: 1, endUtf16: 3, contentDigest: "d".repeat(64),
      };
      // The fixed-width session hash sits between the namespace and message key in the slot.
      await assertDistinctTargets(ctx, [
        span,
        { ...span, sessionKeyHash: "b".repeat(64) },
        { ...span, messageKey: "test-other-message" },
        { ...span, startUtf16: 0 },
        { ...span, endUtf16: 4 },
        { ...span, namespace: `a${separator}${sessionValue}${separator}b`, messageKey: "c" },
        { ...span, namespace: "a", messageKey: `b${separator}${sessionValue}${separator}c` },
      ]);
    },
  },
  {
    id: "K-FACT-4", title: "identifies text slots by the digest pair set", needs: [],
    async run(ctx) {
      const firstDigest = { ...digest("a"), alg: /** @type {const} */ ("hmac"), keyId: "test-key-a" };
      const secondDigest = digest("b");
      const fact = textFact(ctx.owner, [secondDigest, firstDigest]);
      const version = await incarnation(ctx, fact);
      const first = await write(ctx, fact, version);
      const reordered = textFact(ctx.owner, [firstDigest, secondDigest]);
      // The core hash already canonicalizes order. Supply a different token to probe the slot.
      const conflictingVersion = await incarnation(ctx, { ...fact, origin: "edit" });
      const variants = [
        textFact(ctx.owner, [secondDigest, { ...firstDigest, pipeline: "hosted-v1" }]),
        reordered,
        textFact(ctx.owner, [secondDigest, { ...firstDigest, redactionVersion: 2, keyId: "test-key-b" }]),
      ];
      for (const variant of variants) {
        await rejects(() => write(ctx, variant, variant === reordered ? conflictingVersion : undefined), "fact_conflict");
        const retry = await write(ctx, variant, version);
        check(retry.created === false, "Equivalent digest sets must reuse the slot");
        equal(projectWrite(retry), projectWrite(first), "An equivalent digest set must return the original result");
      }
      equal(await epoch(ctx), first.epoch, "Equivalent digest sets must leave the epoch unchanged");
    },
  },
  {
    id: "K-FACT-5", title: "tracks committed epochs independently by owner", needs: [],
    async run(ctx) {
      const { adapter: { uow, suppressions }, owner, otherOwner } = ctx;
      equal(await epoch(ctx), null, "An owner with no facts must have a null epoch");
      const first = await write(ctx, identity(owner, "test-first"));
      const second = await write(ctx, identity(owner, "test-second"));
      equal([first.epoch, second.epoch, await epoch(ctx)], [1n, 2n, 2n], "Each new fact must advance the epoch once");
      equal(await epoch(ctx, otherOwner), null, "Another owner must start with a null epoch");
      const other = await write(ctx, identity(otherOwner, "test-first"));
      equal([other.epoch, await epoch(ctx, otherOwner), await epoch(ctx)], [1n, 1n, 2n], "Owner epochs must be independent");

      const pending = identity(owner, "test-rollback");
      const version = await incarnation(ctx, pending);
      await rejects(() => uow.run(owner, {}, async (tx) => {
        const result = await suppressions.writeFact(tx, pending, version);
        equal(result.epoch, 3n, "The pending fact must receive the next epoch");
        throw new CoreError("internal_error");
      }), "internal_error");
      equal(await epoch(ctx), 2n, "Rolling back a write must leave the epoch unchanged");
      const after = await write(ctx, pending, version);
      equal([after.created, after.epoch], [true, 3n], "A rolled-back fact must leave its slot and epoch available");
    },
  },
  {
    id: "K-FACT-6", title: "rejects foreign-owner and read-only fact writes", needs: [],
    async run(ctx) {
      const { adapter: { uow, suppressions }, owner, otherOwner, harness } = ctx;
      const own = identity(owner, "test-owned");
      const other = identity(otherOwner, "test-foreign");
      const [ownVersion, otherVersion] = await Promise.all([incarnation(ctx, own), incarnation(ctx, other)]);
      const before = await readDump(harness);
      await rejects(() => uow.run(owner, {}, (tx) => suppressions.writeFact(tx, other, otherVersion)), "internal_error");
      const afterForeign = await readDump(harness);
      equal(afterForeign, before, "A refused foreign-owner write must leave the committed dump unchanged");
      await rejects(() => uow.run(owner, { readOnly: true }, (tx) => suppressions.writeFact(tx, own, ownVersion)), "internal_error");
      equal(await readDump(harness), afterForeign, "A refused read-only write must leave the committed dump unchanged");
      equal([await epoch(ctx), await epoch(ctx, otherOwner)], [null, null], "Rejected writes must leave both owners unchanged");
    },
  },
  {
    id: "K-FACT-7", title: "keeps the original text fact across embedding and digest order changes", needs: [],
    async run(ctx) {
      const fact = {
        ...textFact(ctx.owner, [digest("b"), digest("a")]),
        sourceMemory: { id: "test-source", createdAtMs: 10 },
      };
      const original = { ...fact, text: { ...fact.text, embedding: [1, 0] } };
      const refreshed = { ...fact, text: { ...fact.text, embedding: [0, 1] } };
      const reordered = { ...refreshed, text: { ...refreshed.text, digests: [...fact.text.digests].reverse() } };

      const originalVersion = await incarnation(ctx, original);
      const first = await write(ctx, original, originalVersion);
      check(first.created === true, "The first text write must create the fact");
      const committed = await readDump(ctx.harness);
      equal(await epoch(ctx), first.epoch, "The first text write must establish the owner epoch");

      for (const variant of [refreshed, reordered]) {
        const version = await incarnation(ctx, variant);
        equal(version, originalVersion, "Embedding and digest order changes must preserve the text incarnation");
        const retry = await write(ctx, variant, version);
        check(retry.created === false, "The text retry must reuse the original fact");
        equal(projectWrite(retry), projectWrite(first), "The text retry must return the original fact ID, epoch and creation time");
        equal(await epoch(ctx), first.epoch, "The text retry must leave the owner epoch unchanged");
        equal(await readDump(ctx.harness), committed, "The text retry must preserve the original stored fact and embedding");
      }
    },
  },
  {
    id: "K-PAUSE-1", title: "locks and rolls back per-owner pause transitions", needs: [],
    async run({ adapter: { uow, pause }, owner, otherOwner }) {
      /** @param {string} target */
      const get = (target) => uow.run(target, { pauseLock: true, readOnly: true }, (tx) => pause.get(tx, target));
      /** @param {boolean} paused */
      const set = (paused) => uow.run(owner, { pauseLock: true }, (tx) => pause.set(tx, owner, paused));

      equal(projectPause(await get(owner)), [false, 0], "An owner must start unpaused at generation zero");
      equal(projectPause(await set(true)), [true, 1], "The first pause must advance to generation one");
      equal(projectPause(await set(true)), [true, 2], "Repeating pause must advance to generation two");
      equal(projectPause(await set(false)), [false, 2], "Resume must keep the generation");
      equal(projectPause(await set(false)), [false, 2], "Repeating resume must keep the generation");
      equal(projectPause(await set(true)), [true, 3], "Pausing again must advance to generation three");
      equal(projectPause(await get(owner)), [true, 3], "The read-only locked run must see the committed pause state");
      equal(projectPause(await get(otherOwner)), [false, 0], "The other owner must keep its initial pause state");

      await rejects(() => uow.run(owner, { readOnly: true }, (tx) => pause.get(tx, owner)), "internal_error");
      await rejects(() => uow.run(owner, {}, (tx) => pause.set(tx, owner, false)), "internal_error");
      await rejects(() => uow.run(owner, { pauseLock: true, readOnly: true }, (tx) => pause.set(tx, owner, false)), "internal_error");

      await rejects(() => uow.run(owner, { pauseLock: true }, async (tx) => {
        await pause.set(tx, owner, false);
        await pause.set(tx, owner, true);
        throw new CoreError("internal_error");
      }), "internal_error");
      equal(projectPause(await get(owner)), [true, 3], "Rolling back a pause transition must restore the committed generation");

      await rejects(() => uow.run(owner, { pauseLock: true }, async (tx) => {
        await pause.set(tx, owner, false);
        throw new CoreError("internal_error");
      }), "internal_error");
      equal(projectPause(await get(owner)), [true, 3], "Rolling back a resume must preserve the paused state and generation");
    },
  },
  {
    id: "K-KEY-1", title: "provides stable owner signing keys and supports optional rotation", needs: [],
    needsOff: ["fingerprintKey"],
    async run({ adapter: { keys }, owner }) {
      equal(await keys.userKey(owner), null, "A disabled fingerprint key provider must return null");
    },
    followUp: {
      needs: ["fingerprintKey"],
      async run({ adapter: { keys }, harness, owner, otherOwner }) {
        await harness.setFingerprintSecret?.("test-secret-a");
        const [first, retry, other] = await Promise.all([keys.userKey(owner), keys.userKey(owner), keys.userKey(otherOwner)]);
        check(first && retry && other, "The enabled fingerprint key provider must return keys");
        check([first.id, retry.id, other.id].every((id) => typeof id === "string" && id.length > 0),
          "Fingerprint keys must have an ID");
        equal(retry.id, first.id, "The key ID must be stable for the owner");
        const [signature, repeated, otherSignature] = await Promise.all([
          signProbe(first.signingKey), signProbe(retry.signingKey), signProbe(other.signingKey),
        ]);
        equal(repeated, signature, "The signing key must be stable for the owner");
        check(signature.some((byte, index) => byte !== otherSignature[index]), "Distinct owners must have different signing keys");

        if (!harness.setFingerprintSecret) return "fingerprint key rotation is unavailable in the harness";
        await harness.setFingerprintSecret("test-secret-rotation");
        const rotated = await keys.userKey(owner);
        check(rotated && typeof rotated.id === "string" && rotated.id.length > 0 && rotated.id !== first.id,
          "Rotating the fingerprint secret must change the key ID");
        const rotatedSignature = await signProbe(rotated.signingKey);
        check(signature.length !== rotatedSignature.length || signature.some((byte, index) => byte !== rotatedSignature[index]),
          "Rotating the fingerprint secret must change the signature");
      },
    },
  },
  {
    id: "K-SESS-1", title: "enforces the declared session reference profile", needs: [],
    async run(ctx) {
      /** @type {Extract<Fact, {kind: "session"}>} */
      const plain = { ...factBase(ctx.owner), kind: "session", session: sessionId };
      const hashed = { ...plain, session: sessionHash };
      if (sessionProfile(ctx) === "hashed") {
        const before = await readDump(ctx.harness);
        await rejects(() => write(ctx, plain), "invalid_input");
        equal(await readDump(ctx.harness), before, "Rejecting a plaintext session must leave the committed dump unchanged");
        equal(await epoch(ctx), null, "Rejecting a plaintext session must leave the epoch unchanged");
      } else {
        check((await write(ctx, plain)).created === true, "The plain profile must accept a plaintext session");
      }
      check((await write(ctx, hashed)).created === true, "Both profiles must accept hashed sessions");
    },
  },
];

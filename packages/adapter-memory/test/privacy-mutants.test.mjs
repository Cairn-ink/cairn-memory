import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { PRIVACY_CASES, runCase } from "@cairn-ink/conformance";
import { CoreError, compareUtf8, validateSuppressionFact } from "@cairn-ink/core";

function factory(wrap = (opened) => opened, sessionRefs = "plain", storeProfile = sessionRefs) {
  return {
    name: "memory privacy mutant",
    async open({ capabilities }) {
      const adapter = createMemoryAdapter({ capabilities, sessionRefs: storeProfile });
      return wrap({
        adapter,
        sessionRefs,
        harness: adapter.harness,
        nativeErrorMap: adapter.nativeErrorMap,
        busyNativeCodes: [],
        embeddingDimensions: null,
        async close() {},
      });
    },
  };
}

function withPorts(opened, ports) {
  return { ...opened, adapter: { ...opened.adapter, ...ports } };
}

function withFactWrites(opened, writeFact) {
  return withPorts(opened, { suppressions: { ...opened.adapter.suppressions, writeFact } });
}

function ignoresSourceMemory(opened) {
  const { writeFact } = opened.adapter.suppressions;
  return withFactWrites(opened, (tx, fact, version) =>
    writeFact(tx, fact.kind === "text" ? { ...fact, sourceMemory: null } : fact, version));
}

function includesPipeline(opened) {
  const { writeFact } = opened.adapter.suppressions;
  return withFactWrites(opened, async (tx, fact, version) => {
    if (fact.kind !== "text") return writeFact(tx, fact, version);
    const pipelines = [...fact.text.digests].sort(compareDigestPairs).map(({ pipeline }) => pipeline);
    const sourceId = await sha256(JSON.stringify([fact.sourceMemory?.id ?? null, pipelines]));
    return writeFact(tx, { ...fact, sourceMemory: { id: sourceId, createdAtMs: 0 } }, version);
  });
}

function conflatesSessionKinds(opened) {
  const { writeFact } = opened.adapter.suppressions;
  return withFactWrites(opened, (tx, fact, version) => {
    if (fact.kind !== "session" || !("sessionId" in fact.session)) return writeFact(tx, fact, version);
    const { client, sessionId: sessionKeyHash } = fact.session;
    if (!/^[0-9a-f]{64}$/u.test(sessionKeyHash)) return writeFact(tx, fact, version);
    return writeFact(tx, { ...fact, session: { client, sessionKeyHash } }, version);
  });
}

function ignoresRevisionZero(opened) {
  const { writeFact } = opened.adapter.suppressions;
  return withFactWrites(opened, (tx, fact, version) =>
    writeFact(tx, fact.kind === "identity" && fact.throughRevision === 0 ?
      { ...fact, throughRevision: undefined } : fact, version));
}

function freshRetryId(opened) {
  const { writeFact } = opened.adapter.suppressions;
  return withFactWrites(opened, async (tx, fact, version) => {
    const result = await writeFact(tx, fact, version);
    return result.created ? result : { ...result, factId: crypto.randomUUID() };
  });
}

function returnsCurrentEpochOnRetry(opened) {
  const { suppressions } = opened.adapter;
  return withFactWrites(opened, async (tx, fact, version) => {
    const result = await suppressions.writeFact(tx, fact, version);
    return result.created ? result : { ...result, epoch: await suppressions.epoch(tx, tx.owner) };
  });
}

function leaksWritesOnConflict(opened, caughtOnly = false) {
  const { uow, suppressions } = opened.adapter;
  const writesByTx = new WeakMap();
  return withPorts(opened, {
    uow: {
      async run(owner, options, fn) {
        const accepted = [];
        let callbackReturned = false;
        let result;
        try {
          return await uow.run(owner, options, async (tx) => {
            writesByTx.set(tx, accepted);
            result = await fn(tx);
            callbackReturned = true;
            return result;
          });
        } catch (error) {
          if (error.code === "fact_conflict" && accepted.length && (!caughtOnly || callbackReturned)) {
            await uow.run(owner, options, async (tx) => {
              for (const args of accepted) await suppressions.writeFact(tx, ...args);
            });
            if (caughtOnly) return result;
          }
          throw error;
        }
      },
    },
    suppressions: {
      ...suppressions,
      async writeFact(tx, ...args) {
        const result = await suppressions.writeFact(tx, ...args);
        if (result.created) writesByTx.get(tx).push(args);
        return result;
      },
    },
  });
}

function advancesEpochOnRetry(opened) {
  const { suppressions } = opened.adapter;
  const extra = new Map();
  return withPorts(opened, {
    suppressions: {
      ...suppressions,
      async writeFact(tx, fact, version) {
        const result = await suppressions.writeFact(tx, fact, version);
        if (!result.created) extra.set(tx.owner, (extra.get(tx.owner) ?? 0n) + 1n);
        return result;
      },
      async epoch(tx, owner) {
        const epoch = await suppressions.epoch(tx, owner);
        return epoch === null ? null : epoch + (extra.get(owner) ?? 0n);
      },
    },
  });
}

function advancesEpochOnRollback(opened) {
  const { uow, suppressions } = opened.adapter;
  const writesByTx = new WeakMap();
  const extra = new Map();
  return withPorts(opened, {
    uow: {
      async run(owner, options, fn) {
        const run = { created: 0n };
        try {
          return await uow.run(owner, options, (tx) => {
            writesByTx.set(tx, run);
            return fn(tx);
          });
        } catch (error) {
          if (run.created) extra.set(owner, (extra.get(owner) ?? 0n) + run.created);
          throw error;
        }
      },
    },
    suppressions: {
      ...suppressions,
      async writeFact(tx, ...args) {
        const result = await suppressions.writeFact(tx, ...args);
        if (result.created) writesByTx.get(tx).created++;
        return result;
      },
      async epoch(tx, owner) {
        const epoch = await suppressions.epoch(tx, owner);
        return extra.has(owner) ? (epoch ?? 0n) + extra.get(owner) : epoch;
      },
    },
  });
}

function advancesGenerationOnResume(opened) {
  const { pause } = opened.adapter;
  return withPorts(opened, {
    pause: {
      ...pause,
      async set(tx, owner, paused) {
        const previous = await pause.get(tx, owner);
        const result = await pause.set(tx, owner, paused);
        if (paused || !previous.paused) return result;
        await pause.set(tx, owner, true);
        return pause.set(tx, owner, false);
      },
    },
  });
}

function leaksResumeOnRollback(opened) {
  const { uow, pause } = opened.adapter;
  const pending = new WeakMap();
  return withPorts(opened, {
    uow: {
      async run(owner, options, fn) {
        let tx;
        try {
          return await uow.run(owner, options, (issued) => {
            tx = issued;
            return fn(issued);
          });
        } catch (error) {
          if (pending.get(tx) === false) {
            await uow.run(owner, options, (retry) => pause.set(retry, owner, false));
          }
          throw error;
        }
      },
    },
    pause: {
      ...pause,
      async set(tx, owner, paused) {
        const result = await pause.set(tx, owner, paused);
        pending.set(tx, paused);
        return result;
      },
    },
  });
}

function ignoresRepeatedPause(opened) {
  const { pause } = opened.adapter;
  return withPorts(opened, {
    pause: {
      ...pause,
      async set(tx, owner, paused) {
        if (paused && !tx.readOnly) {
          const previous = await pause.get(tx, owner);
          if (previous.paused) return previous;
        }
        return pause.set(tx, owner, paused);
      },
    },
  });
}

function allowsPauseWithoutLock(opened) {
  const { uow } = opened.adapter;
  return withPorts(opened, {
    uow: { run: (owner, options, fn) => uow.run(owner, { ...options, pauseLock: true }, fn) },
  });
}

function ignoresKeyOwner(opened) {
  const { keys } = opened.adapter;
  return withPorts(opened, { keys: { userKey: () => keys.userKey("test-fixed-owner") } });
}

function retainsSigningKeyOnRotation(opened) {
  const { keys } = opened.adapter;
  const signingKeys = new Map();
  return withPorts(opened, {
    keys: {
      async userKey(owner) {
        const key = await keys.userKey(owner);
        if (key === null) return null;
        if (!signingKeys.has(owner)) signingKeys.set(owner, key.signingKey);
        return { id: key.id, signingKey: signingKeys.get(owner) };
      },
    },
  });
}

function persistsRefusedFact(opened, matches) {
  const { writeFact } = opened.adapter.suppressions;
  const leaked = createMemoryAdapter();
  const mutant = withFactWrites(opened, async (tx, fact, version) => {
    try {
      return await writeFact(tx, fact, version);
    } catch (error) {
      if (matches(tx, error)) {
        await leaked.uow.run(fact.owner, {}, (separateTx) => leaked.suppressions.writeFact(separateTx, fact, version));
      }
      throw error;
    }
  });
  return {
    ...mutant,
    harness: {
      ...opened.harness,
      async dump() { return [...await opened.harness.dump(), ...await leaked.harness.dump()]; },
    },
  };
}

function compareDigestPairs(a, b) {
  return compareUtf8(a.alg, b.alg) || compareUtf8(a.value, b.value);
}

async function sha256(text) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Buffer.from(bytes).toString("hex");
}

function canonicalTarget(fact) {
  switch (fact.kind) {
    case "identity":
      return [fact.memoryId, fact.throughRevision ?? null];
    case "text":
      return [
        fact.mode,
        [...fact.text.digests].sort(compareDigestPairs).map(({ alg, value }) => [alg, value]),
        fact.sourceMemory?.id ?? null,
      ];
    case "session":
      return "sessionId" in fact.session ? [fact.session.client, "id", fact.session.sessionId] :
        [fact.session.client, "hash", fact.session.sessionKeyHash];
    case "window":
      return [fact.client ?? null, fact.window.startMs, fact.window.endMs, fact.unknownTime === true, fact.anchor ?? null];
    case "rawSpan":
      return [fact.sessionKeyHash, fact.messageKey, fact.startUtf16, fact.endUtf16];
  }
}

function hashesSlots(opened, encode = (tuple) => JSON.stringify(tuple)) {
  const { writeFact } = opened.adapter.suppressions;
  return withFactWrites(opened, async (tx, fact, version) => {
    if (!tx.readOnly && fact.owner === tx.owner) {
      validateSuppressionFact(fact);
      if (opened.sessionRefs === "hashed" && fact.kind === "session" && "sessionId" in fact.session) {
        throw new CoreError("invalid_input");
      }
      const key = await sha256(encode([fact.kind, fact.namespace ?? null, ...canonicalTarget(fact)]));
      // Back the alternate slot encoding with an opaque identity key in the transaction store.
      return writeFact(tx, identity(fact.owner, key), version);
    }
    return writeFact(tx, fact, version);
  });
}

function joinsSlotWithNul(kind) {
  return (opened) => hashesSlots(opened, (tuple) => tuple[0] === kind ? tuple.join("\u0000") : JSON.stringify(tuple));
}

const a = "a".repeat(64);
const b = "b".repeat(64);

function identity(owner, memoryId) {
  return { owner, actionId: "test-action", origin: "forget", kind: "identity", memoryId };
}

function write({ adapter: { uow, suppressions }, owner }, fact, incarnation = a) {
  return uow.run(owner, {}, (tx) => suppressions.writeFact(tx, fact, incarnation));
}

function epoch({ adapter: { uow, suppressions }, owner }) {
  return uow.run(owner, { readOnly: true }, (tx) => suppressions.epoch(tx, owner));
}

// These baseline cases exercise the same port with fixtures that omit the targeted condition.
const naive = {
  "K-FACT-1": {
    async run(ctx) {
      const fact = identity(ctx.owner, "test-memory");
      assert.equal((await write(ctx, fact)).created, true);
      assert.equal((await write(ctx, fact)).created, false);
    },
  },
  "K-FACT-2": {
    async run(ctx) {
      const fact = identity(ctx.owner, "test-memory");
      await write(ctx, fact);
      const before = await ctx.harness.dump();
      await assert.rejects(write(ctx, fact, b), { code: "fact_conflict" });
      assert.deepEqual(await ctx.harness.dump(), before);
    },
  },
  "K-FACT-3": {
    async run(ctx) {
      for (const id of ["test-one", "test-two"]) {
        assert.equal((await write(ctx, identity(ctx.owner, id))).created, true);
      }
      assert.equal(await epoch(ctx), 2n);
    },
  },
  "K-FACT-4": {
    async run(ctx) {
      const fact = {
        ...identity(ctx.owner, "test-memory"), kind: "text", mode: "exact",
        text: { digests: [{ alg: "sha256", value: a, pipeline: "core", redactionVersion: 1, keyId: null }] },
      };
      assert.equal((await write(ctx, fact)).created, true);
      assert.equal((await write(ctx, fact)).created, false);
    },
  },
  "K-FACT-5": {
    async run(ctx) {
      assert.equal(await epoch(ctx), null);
      await write(ctx, identity(ctx.owner, "test-memory"));
      assert.equal(await epoch(ctx), 1n);
    },
  },
  "K-PAUSE-1": {
    async run({ adapter: { uow, pause }, owner }) {
      assert.equal((await uow.run(owner, { pauseLock: true }, (tx) => pause.set(tx, owner, true))).paused, true);
      assert.equal((await uow.run(owner, { pauseLock: true }, (tx) => pause.set(tx, owner, false))).paused, false);
    },
  },
  "K-KEY-1": {
    needs: ["fingerprintKey"],
    async run({ adapter: { keys }, owner }) {
      const first = await keys.userKey(owner);
      assert.ok(first.id);
      assert.equal((await keys.userKey(owner)).id, first.id);
    },
  },
  "K-SESS-1": {
    async run(ctx) {
      const fact = {
        ...identity(ctx.owner, "test-memory"), kind: "session",
        session: { client: "test-client", sessionKeyHash: a },
      };
      assert.equal((await write(ctx, fact)).created, true);
    },
  },
};

const mutants = [
  ["slot ignores source memory ID", "K-FACT-3", factory(ignoresSourceMemory), { code: "fact_conflict" }],
  ["slot includes pipeline", "K-FACT-4", factory(includesPipeline), /Expected operation to reject/],
  ["slot conflates session ID and hash", "K-FACT-3", factory(conflatesSessionKinds), { code: "fact_conflict" }],
  ["slot ignores revision zero", "K-FACT-3", factory(ignoresRevisionZero), { code: "fact_conflict" }],
  ["retry returns a fresh fact ID", "K-FACT-1", factory(freshRetryId), /original fact ID, epoch and creation time/],
  ["conflict does not roll back", "K-FACT-2", factory(leaksWritesOnConflict), /roll back earlier writes/],
  ["epoch advances on retry", "K-FACT-1", factory(advancesEpochOnRetry), /retry must leave the owner epoch unchanged/],
  ["epoch advances on rollback", "K-FACT-5", factory(advancesEpochOnRollback), /Rolling back a write must leave the epoch unchanged/],
  ["resume advances pause generation", "K-PAUSE-1", factory(advancesGenerationOnResume), /Resume must keep the generation/],
  ["pause allowed without pause lock", "K-PAUSE-1", factory(allowsPauseWithoutLock), /Expected operation to reject/],
  ["key ignores owner", "K-KEY-1", factory(ignoresKeyOwner), /Distinct owners must have different signing keys/],
  ["hashed profile accepts plaintext", "K-SESS-1", factory(undefined, "hashed", "plain"), /Expected operation to reject/],
];

for (const [label, id, mutant, failure] of mutants) {
  test(`${id} detects ${label} after the naive case passes`, async () => {
    const testCase = PRIVACY_CASES.find((candidate) => candidate.id === id);
    assert.ok(testCase);
    assert.equal(await runCase(mutant, { id, title: "naive", needs: [], ...naive[id] }), null);
    await assert.rejects(runCase(mutant, testCase), failure);
  });
}

const roundOneMutants = [
  ["retry returns the current owner epoch", "K-FACT-1", factory(returnsCurrentEpochOnRetry), /original fact ID, epoch and creation time/],
  ["a caught conflict commits earlier writes", "K-FACT-2", factory((opened) => leaksWritesOnConflict(opened, true)), /Expected operation to reject/],
  ["NUL-joined identity slot conflates targets", "K-FACT-3", factory(joinsSlotWithNul("identity")), { code: "fact_conflict" }],
  ["NUL-joined session slot conflates targets", "K-FACT-3", factory(joinsSlotWithNul("session")), { code: "fact_conflict" }],
  ["NUL-joined raw span slot conflates targets", "K-FACT-3r", factory(joinsSlotWithNul("rawSpan")), { code: "fact_conflict" }],
  ["foreign-owner refusal persists a fact", "K-FACT-6", factory((opened) =>
    persistsRefusedFact(opened, (tx, error) => !tx.readOnly && error.code === "internal_error")), /foreign-owner write must leave/],
  ["read-only refusal persists a fact", "K-FACT-6", factory((opened) =>
    persistsRefusedFact(opened, (tx, error) => tx.readOnly && error.code === "internal_error")), /read-only write must leave/],
  ["plaintext refusal persists a fact", "K-SESS-1", factory((opened) =>
    persistsRefusedFact(opened, (_tx, error) => error.code === "invalid_input"), "hashed"), /plaintext session must leave the committed dump unchanged/],
  ["a failed resume leaks the paused bit", "K-PAUSE-1", factory(leaksResumeOnRollback), /Rolling back a resume must preserve/],
  ["repeated pause is a no-op", "K-PAUSE-1", factory(ignoresRepeatedPause), /Repeating pause must advance/],
  ["rotation changes the ID but retains the signing key", "K-KEY-1", factory(retainsSigningKeyOnRotation), /Rotating the fingerprint secret must change the signature/],
];

// These mutants passed the original privacy cases before the checks below were added.
for (const [label, id, mutant, failure] of roundOneMutants) {
  test(`${id} detects when ${label}`, async () => {
    const testCase = PRIVACY_CASES.find((candidate) => candidate.id === id);
    assert.ok(testCase);
    await assert.rejects(runCase(mutant, testCase), failure);
  });
}

for (const profile of ["plain", "hashed"]) {
  test(`privacy cases accept SHA-256 slots under the ${profile} profile`, async () => {
    const control = factory(hashesSlots, profile);
    for (const testCase of PRIVACY_CASES) {
      assert.equal(await runCase(control, testCase), null, testCase.id);
    }
  });
}

test("key conformance reports a reason when the optional rotation hook is absent", async () => {
  const withoutRotation = factory((opened) => {
    const { setFingerprintSecret, ...harness } = opened.harness;
    return { ...opened, harness };
  });
  const testCase = PRIVACY_CASES.find(({ id }) => id === "K-KEY-1");
  assert.equal(await runCase(withoutRotation, testCase), "fingerprint key rotation is unavailable in the harness");
});

test("rotation conformance accepts a provider already on the destination secret", async () => {
  const alreadyRotated = factory(async (opened) => {
    if (opened.adapter.capabilities.fingerprintKey) {
      await opened.harness.setFingerprintSecret("test-secret-rotation");
    }
    return opened;
  });
  const testCase = PRIVACY_CASES.find(({ id }) => id === "K-KEY-1");
  assert.equal(await runCase(alreadyRotated, testCase), null);
});

test("raw span coverage reports a skip when the factory declines the capability", async () => {
  const withoutRawSpans = factory((opened) => {
    const { writeFact } = opened.adapter.suppressions;
    return withFactWrites(opened, (tx, fact, version) => {
      assert.notEqual(fact.kind, "rawSpan", "A factory without raw spans must receive no raw span writes");
      return writeFact(tx, fact, version);
    });
  });
  const limited = { ...withoutRawSpans, open: ({ capabilities }) =>
    withoutRawSpans.open({ capabilities: { ...capabilities, rawSpans: false } }) };
  const baseCase = PRIVACY_CASES.find(({ id }) => id === "K-FACT-3");
  const spanCase = PRIVACY_CASES.find(({ id }) => id === "K-FACT-3r");
  assert.equal(await runCase(limited, baseCase), null);
  assert.equal(await runCase(limited, spanCase), "needs rawSpans");
});

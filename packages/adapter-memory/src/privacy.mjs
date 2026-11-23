import {
  CoreError, compareUtf8, factBody, pauseGenerationAfter, userFingerprintKey,
  validateFingerprintLabels, validateSuppressionFact,
} from "@cairn-ink/core";

/** @typedef {import("./index.d.mts").MemoryAdapterOptions} Options */
/** @typedef {import("@cairn-ink/core").SuppressionFact} SuppressionFact */
/** @typedef {ReturnType<typeof import("./unit-of-work.mjs").createUnitOfWork>} UnitOfWork */

// This reference adapter can supply a public key fixture for tests. The fixture is unsuitable for production.
export const TEST_FINGERPRINT_SECRET = "test-secret-a";
export const TEST_FINGERPRINT_LABELS = Object.freeze({
  keyIdDomain: "test-key-id",
  shingleKeyPrefix: "test-shingle:",
  legacyExactPrefix: "test-exact:",
});

const encoder = new TextEncoder();

/** @param {SuppressionFact} fact */
function factSlot(fact) {
  const namespace = fact.namespace ?? null;
  switch (fact.kind) {
    case "identity":
      return JSON.stringify([fact.kind, namespace, fact.memoryId, fact.throughRevision ?? null]);
    case "text": {
      const digests = fact.text.digests.map(({ alg, value }) => [alg, value])
        .sort(([a, x], [b, y]) => compareUtf8(a, b) || compareUtf8(x, y));
      return JSON.stringify([fact.kind, namespace, fact.mode, digests, fact.sourceMemory?.id ?? null]);
    }
    case "session": {
      const { session } = fact;
      const target = "sessionId" in session ? ["id", session.sessionId] : ["hash", session.sessionKeyHash];
      return JSON.stringify([fact.kind, namespace, session.client, ...target]);
    }
    case "window":
      return JSON.stringify([fact.kind, namespace, fact.client ?? null, fact.window.startMs, fact.window.endMs,
        fact.unknownTime === true, fact.anchor ?? null]);
    case "rawSpan":
      return JSON.stringify([fact.kind, namespace, fact.sessionKeyHash, fact.messageKey, fact.startUtf16, fact.endUtf16]);
  }
}

/**
 * @param {import("./unit-of-work.mjs").State} state @param {SuppressionFact} fact
 * @param {string} incarnation @param {Pick<Options, "newId" | "now" | "sessionRefs">} [options]
 */
export function storeFact(state, fact, incarnation, { sessionRefs, newId = () => crypto.randomUUID(), now = Date.now } = {}) {
  if (sessionRefs === "hashed" && fact.kind === "session" && "sessionId" in fact.session) {
    throw new CoreError("invalid_input");
  }
  const slot = factSlot(fact);
  const previous = state.facts.get(slot);
  if (previous) {
    if (previous.incarnation !== incarnation) throw new CoreError("fact_conflict");
    const { factId, epoch, createdAtMs } = previous;
    return { factId, epoch, createdAtMs, created: false };
  }

  const epoch = (state.epoch ?? 0n) + 1n;
  const stored = { fact: structuredClone(fact), factId: newId(), incarnation, epoch, createdAtMs: now() };
  state.facts.set(slot, stored);
  state.epoch = epoch;
  return { factId: stored.factId, epoch, createdAtMs: stored.createdAtMs, created: true };
}

/**
 * @param {UnitOfWork["port"]} port @param {UnitOfWork["runSeed"]} runSeed
 * @param {Pick<Options, "newId" | "now" | "sessionRefs">} options
 */
export function createFactStore(port, runSeed, options) {
  /** @type {import("@cairn-ink/core/ports").SuppressionStore} */
  const suppressions = {
    async writeFact(tx, fact, incarnation) {
      return port(tx, { owner: fact?.owner }, true, (state) =>
        storeFact(state, validateSuppressionFact(fact), incarnation, options));
    },
    // The privacy module's fact-match functions will back these reads in part b.
    async snapshot() { throw new CoreError("capability_unavailable"); },
    async factsFor() { throw new CoreError("capability_unavailable"); },
    async epoch(tx, owner) {
      return port(tx, { owner }, false, (state) => state.epoch);
    },
  };

  /** @param {string} owner @param {SuppressionFact} fact */
  async function seedFact(owner, fact) {
    await runSeed(owner, async (tx) => {
      const validated = validateSuppressionFact(fact);
      if (validated.owner !== owner) throw new CoreError("invalid_input");
      const copy = structuredClone(validated);
      const digest = await crypto.subtle.digest("SHA-256", encoder.encode(factBody(copy)));
      const incarnation = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      await suppressions.writeFact(tx, copy, incarnation);
    });
  }

  return { suppressions, seedFact };
}

/** @param {UnitOfWork["port"]} port @returns {import("@cairn-ink/core/ports").PauseStore} */
export function createPauseStore(port) {
  return {
    async get(tx, owner) {
      return port(tx, { owner }, false, (state) => ({ ...state.pause }), true);
    },
    async set(tx, owner, paused) {
      const scope = { owner };
      return port(tx, scope, false, (state) => {
        if (tx.readOnly) throw new CoreError("internal_error");
        if (state.pause.paused === paused) return { ...state.pause };
        return port(tx, scope, true, () => {
          const generation = pauseGenerationAfter(state.pause.generation, paused ? "pause" : "resume");
          state.pause = { paused, generation };
          return { ...state.pause };
        });
      }, true);
    },
  };
}

/** @param {boolean} enabled @param {Options["fingerprint"]} config */
export function createFingerprintProvider(enabled, config) {
  if (!enabled && config != null) throw new CoreError("capability_unavailable");
  const labels = config == null ? TEST_FINGERPRINT_LABELS : validateFingerprintLabels(config.labels);
  let secret = enabled ? (config == null ? TEST_FINGERPRINT_SECRET : config.secret) : null;
  if (enabled && (typeof secret !== "string" || secret.length === 0)) throw new CoreError("invalid_input");

  /** @type {import("@cairn-ink/core/ports").FingerprintKeyProvider} */
  const keys = {
    async userKey(owner) {
      return userFingerprintKey(secret, owner, labels);
    },
  };

  /** @param {string} next */
  async function setFingerprintSecret(next) {
    if (!enabled) throw new CoreError("capability_unavailable");
    if (typeof next !== "string" || next.length === 0) throw new CoreError("invalid_input");
    secret = next;
  }

  return { keys, setFingerprintSecret };
}

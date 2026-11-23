import {
  CoreError, compareUtf8, factIncarnationBody, pauseGenerationAfter, userFingerprintKey,
  validateFingerprintLabels, validateSuppressionFact,
} from "@cairn-ink/core";
import { copySuppressionCandidates, createFactMatcher } from "./fact-match.mjs";
import { readEmbedding, snapshotArray } from "./validation.mjs";

/** @typedef {import("./index.d.mts").MemoryAdapterOptions} Options */
/** @typedef {import("@cairn-ink/core").SuppressionFact} SuppressionFact */
/** @typedef {ReturnType<typeof import("./unit-of-work.mjs").createUnitOfWork>} UnitOfWork */
/** @typedef {(owner: string) => Promise<import("@cairn-ink/core").FingerprintKey[]>} RingKeys */
/** @import { TextDigest } from "@cairn-ink/core" */

// This reference adapter can supply a public key fixture for tests. The fixture is unsuitable for production.
export const TEST_FINGERPRINT_SECRET = "test-secret-a";
export const TEST_FINGERPRINT_LABELS = Object.freeze({
  keyIdDomain: "test-key-id",
  shingleKeyPrefix: "test-shingle:",
  legacyExactPrefix: "test-exact:",
});

const encoder = new TextEncoder();

/** @param {TextDigest[]} digests @param {TextDigest} keyed */
export function addKeyedDigest(digests, keyed) {
  if (!digests.some(({ alg, keyId, value }) => alg === keyed.alg && keyId === keyed.keyId && value === keyed.value)) {
    digests.push(keyed);
  }
}

/** @param {SuppressionFact} fact */
function validateFact(fact) {
  if (fact?.kind === "text") {
    const { text, ...fields } = fact;
    if (text && typeof text === "object") {
      const { embedding, ...fingerprint } = text;
      /** @type {Extract<SuppressionFact, {kind: "text"}>["text"]} */
      const evidence = { ...fingerprint, digests: snapshotArray(fingerprint.digests) };
      if (evidence.shingles != null) evidence.shingles = snapshotArray(evidence.shingles);
      if (embedding !== undefined || Object.hasOwn(text, "embedding")) {
        evidence.embedding = embedding == null ? embedding : readEmbedding(embedding, "fact");
      }
      fact = { ...fields, text: evidence };
    }
  }
  return validateSuppressionFact(fact);
}

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
 * @param {() => import("./unit-of-work.mjs").State} getState @param {SuppressionFact} fact
 * @param {string} incarnation @param {Pick<Options, "newId" | "now">} [options]
 */
function storeFact(getState, fact, incarnation, { newId = () => crypto.randomUUID(), now = Date.now } = {}) {
  const slot = factSlot(fact);
  const state = getState();
  const previous = state.facts.get(slot);
  if (previous) {
    if (previous.incarnation !== incarnation) throw new CoreError("fact_conflict");
    const { factId, epoch, createdAtMs } = previous;
    return { factId, epoch, createdAtMs, created: false };
  }

  const epoch = (state.epoch ?? 0n) + 1n;
  const stored = { fact, factId: newId(), incarnation, epoch, createdAtMs: now() };
  state.facts.set(slot, stored);
  state.epoch = epoch;
  return { factId: stored.factId, epoch, createdAtMs: stored.createdAtMs, created: true };
}

/**
 * @param {UnitOfWork["port"]} port @param {UnitOfWork["runSeed"]} runSeed
 * @param {Pick<Options, "newId" | "now" | "sessionRefs" | "hashSessionKey">} options
 * @param {ReturnType<typeof createFactMatcher>} [matchFacts]
 * @param {RingKeys} [ringKeys]
 */
export function createFactStore(port, runSeed, options, matchFacts = createFactMatcher(false, options.hashSessionKey), ringKeys) {
  /** @param {SuppressionFact} fact @param {string} incarnation */
  function prepareFactWrite(fact, incarnation) {
    if (typeof incarnation !== "string" ||
        (options.sessionRefs === "hashed" && fact.kind === "session" && "sessionId" in fact.session)) {
      throw new CoreError("invalid_input");
    }
    return (/** @type {() => import("./unit-of-work.mjs").State} */ getState) =>
      storeFact(getState, fact, incarnation, options);
  }

  /** @type {import("@cairn-ink/core/ports").SuppressionStore} */
  const suppressions = {
    async writeFact(tx, fact, incarnation) {
      return port.write(tx, fact, true, () => {
        const copy = structuredClone(validateFact(fact));
        return prepareFactWrite(copy, incarnation);
      });
    },
    async snapshot(tx, scope, candidates) {
      return port.read(tx, scope, (getState) => {
        const copy = copySuppressionCandidates(candidates);
        return matchFacts(getState().facts, { owner: tx.owner, namespace: scope.namespace }).snapshot(copy);
      });
    },
    async factsFor(tx, scope, { memoryId }) {
      return port(tx, scope, false, (state) => {
        const { namespace } = scope;
        return matchFacts(state.facts, { owner: tx.owner, namespace }).factsFor(memoryId, state.rows.get(namespace)?.get(memoryId));
      });
    },
    async epoch(tx, owner) {
      return port(tx, { owner }, false, (state) => state.epoch);
    },
  };

  /** @param {string} owner @param {SuppressionFact} fact */
  async function seedFact(owner, fact) {
    const validated = validateFact(fact);
    if (validated.owner !== owner) throw new CoreError("invalid_input");
    const copy = structuredClone(validated);
    await runSeed(owner, async (tx) => {
      if (ringKeys && copy.kind === "text" && copy.text.digests.some(({ alg }) => alg === "hmac")) {
        const keys = await ringKeys(owner);
        if (copy.text.digests.some(({ alg, keyId }) => alg === "hmac" && !keys.some(({ id }) => id === keyId))) {
          throw new CoreError("invalid_input");
        }
      }
      const digest = await crypto.subtle.digest("SHA-256", encoder.encode(factIncarnationBody(copy)));
      const incarnation = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      await port.write(tx, copy, true, () => prepareFactWrite(copy, incarnation));
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
      return port.write(tx, { owner }, "conditional", () => {
        if (typeof paused !== "boolean") throw new CoreError("invalid_input");
        return (getState, markDirty) => {
          const state = getState();
          if (!paused && !state.pause.paused) return { ...state.pause };
          const generation = pauseGenerationAfter(state.pause.generation, paused ? "pause" : "resume");
          state.pause = { paused, generation };
          markDirty();
          return { ...state.pause };
        };
      }, true);
    },
  };
}

/** @param {boolean} enabled @param {Options["fingerprint"]} config
 * @param {UnitOfWork["rotateRowDigests"]} rotateRowDigests
 */
export function createFingerprintProvider(enabled, config, rotateRowDigests) {
  if (!enabled && config != null) throw new CoreError("capability_unavailable");
  const labels = config == null ? TEST_FINGERPRINT_LABELS : validateFingerprintLabels(config.labels);
  let secret = enabled ? (config == null ? TEST_FINGERPRINT_SECRET : config.secret) : null;
  if (enabled && (typeof secret !== "string" || secret.length === 0)) throw new CoreError("invalid_input");
  const ring = new Set(secret === null ? [] : [secret]);
  /** @type {Promise<void> | undefined} */
  let rotation;

  /** @type {RingKeys} */
  const ringKeys = async (owner) => {
    // Snapshot the ring before any key derivation yields.
    const derived = await Promise.all([...ring].map((seed) => userFingerprintKey(seed, owner, labels)));
    return derived.filter((key) => key !== null);
  };

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

    const apply = async () => {
      const olderSeeds = [...ring].filter((seed) => seed !== secret);
      const pendingKey = (/** @type {string} */ owner) => userFingerprintKey(next, owner, labels);
      const retainedKeyIds = async (/** @type {string} */ owner) => {
        const keys = await Promise.all(olderSeeds.map((seed) => userFingerprintKey(seed, owner, labels)));
        return new Set(keys.flatMap((key) => key === null ? [] : [key.id]));
      };
      await rotateRowDigests(pendingKey, retainedKeyIds, () => {
        ring.add(next);
        secret = next;
      });
    };
    const change = rotation ? rotation.then(apply) : apply();
    const tail = change.then(() => {}, () => {});
    rotation = tail;
    try {
      await change;
    } finally {
      if (rotation === tail) rotation = undefined;
    }
  }

  return { keys, ringKeys, setFingerprintSecret };
}

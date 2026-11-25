import {
  CoreError, compareUtf8, factIncarnationBody, pauseGenerationAfter, userFingerprintKey,
  validateFingerprintLabels, validateSuppressionFact,
} from "@cairn-ink/core";
import { compareValidatedDigests } from "../../core/src/privacy/withholds.mjs";
import { copySuppressionCandidates, createFactMatcher } from "./fact-match.mjs";
import { advanceInspectEpoch, advanceRawInspectEpoch } from "./unit-of-work.mjs";
import { readEmbedding, snapshotArray } from "./validation.mjs";

/** @typedef {import("./index.d.mts").MemoryAdapterOptions} Options */
/** @typedef {import("@cairn-ink/core").SuppressionFact} SuppressionFact */
/** @typedef {ReturnType<typeof import("./unit-of-work.mjs").createUnitOfWork>} UnitOfWork */
/** @typedef {(owner: string) => Promise<import("@cairn-ink/core").FingerprintKey[]>} RingKeys */
/** @import { FingerprintKey, TextDigest, TextFact } from "@cairn-ink/core" */
/** @import { RetainedDigester } from "@cairn-ink/core/ports" */
/** @import { RetainedDigestFixture } from "@cairn-ink/conformance/factory" */
/** @import { Scope } from "@cairn-ink/core/ports" */
/** @import { Entry, Row, State } from "./unit-of-work.mjs" */

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
  if (!digests.some((digest) => digest.alg === keyed.alg && digest.keyId === keyed.keyId &&
      digest.label === keyed.label && digest.pipeline === keyed.pipeline &&
      digest.redactionVersion === keyed.redactionVersion && digest.value === keyed.value)) {
    digests.push(keyed);
  }
}

/** @param {State} state @param {Scope} scope */
function* scopedReplacementFacts(state, scope) {
  for (const { fact, epoch } of state.facts.values()) {
    if (fact.kind === "text" && (fact.origin === "edit" || fact.origin === "correct") &&
        fact.owner === scope.owner && (fact.namespace ?? null) === scope.namespace) yield { fact, epoch };
  }
}

/** @param {TextFact} fact @param {Row} row */
function predecessorTextMatch(fact, row) {
  const legacyHash = fact.legacyTextHash;
  if (legacyHash !== undefined && (legacyHash === row.legacyHash || legacyHash === row.textHash)) return true;
  return compareValidatedDigests(row.digests, fact.text.digests);
}

/** @param {State} state @param {Entry} entry @param {bigint} startFactEpoch */
export function recordTextReplacement(state, { row, textVersions }, startFactEpoch) {
  const { id, createdAtMs, revision, scope } = row;
  const current = textVersions.at(-1);
  for (const { fact, epoch } of scopedReplacementFacts(state, scope)) {
    if (epoch <= (current?.factEpoch ?? 0n) || state.textPredecessors.has(epoch)) continue;
    const source = fact.sourceMemory;
    if (source && (source.id !== id || source.createdAtMs !== createdAtMs)) continue;
    // A sourced predecessor written in this update belongs to the row being replaced.
    // Exact digests can also associate an unsourced or previously stored predecessor.
    if ((source && epoch > startFactEpoch) || predecessorTextMatch(fact, row) === true) {
      state.textPredecessors.set(epoch, { id, createdAtMs, revision });
    }
  }
  textVersions.push({ revision: revision + 1, factEpoch: state.epoch ?? 0n });
}

/** @param {State} state @param {Scope} scope @param {{id: string, revision: number}} link */
export function memoryCorrectionEvidence(state, scope, { id, revision }) {
  const entry = state.rows.get(scope.namespace)?.get(id);
  let version;
  for (const candidate of entry?.textVersions ?? []) {
    if (candidate.revision > revision) break;
    version = candidate;
  }
  const current = entry?.textVersions.at(-1);
  const correctedRevisions = [];
  let unresolvedCorrection = false;
  for (const { fact, epoch } of scopedReplacementFacts(state, scope)) {
    const predecessor = state.textPredecessors.get(epoch);
    const source = predecessor ?? fact.sourceMemory;
    if (source && (source.id !== id || (entry && source.createdAtMs !== entry.row.createdAtMs))) continue;
    if (predecessor) {
      correctedRevisions.push(predecessor.revision);
    } else if ((!version || epoch > version.factEpoch) &&
        (!entry || version !== current || predecessorTextMatch(fact, entry.row) !== false)) {
      // A missing association leaves older cited text uncertain. A later text
      // version or a comparable miss on the stored text can rule the fact out.
      unresolvedCorrection = true;
    }
  }
  return { correctedRevisions, unresolvedCorrection };
}

/** @param {State} state @param {Pick<import("./document-cards.mjs").CardWrite, "scope" | "sourceMemories">} card */
export function hasReplacedCitation(state, { scope, sourceMemories }) {
  return sourceMemories.some(link => {
    const { correctedRevisions, unresolvedCorrection } = memoryCorrectionEvidence(state, scope, link);
    return unresolvedCorrection || correctedRevisions.includes(link.revision);
  });
}

/** @param {Pick<TextDigest, "alg" | "keyId" | "label" | "pipeline" | "redactionVersion">} digest */
export function digestDomain({ alg, keyId, label, pipeline, redactionVersion }) {
  return JSON.stringify([alg, keyId, label ?? pipeline, pipeline, redactionVersion]);
}

/** @param {Iterable<{fact: SuppressionFact}>} facts @param {boolean} [includeShingles] */
export function liveKeyedDomains(facts, includeShingles = false) {
  /** @type {Map<string, TextDigest>} */
  const domains = new Map();
  for (const { fact } of facts) {
    if (fact.kind !== "text") continue;
    const keyedOnly = fact.text.digests.every(({ keyId }) => keyId !== null);
    for (const digest of fact.text.digests) {
      const coreShingles = includeShingles && fact.mode === "full" && fact.text.shingles != null &&
        digest.alg === "hmac" && digest.keyId === fact.text.keyId &&
        digest.pipeline === "core" && (digest.label ?? digest.pipeline) === "core";
      if (!keyedOnly && !coreShingles) continue;
      const domain = digestDomain(digest);
      if (!domains.has(domain) || digest.label !== undefined) domains.set(domain, digest);
    }
  }
  return domains;
}

/** @param {FingerprintKey} key @param {string} label @returns {RetainedDigester} */
function localDigester({ id, signingKey }, label) {
  return {
    alg: "hmac", keyId: id, label,
    async mac(text) {
      const bytes = await crypto.subtle.sign("HMAC", signingKey, encoder.encode(text));
      return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
    },
  };
}

/** @param {SuppressionFact} fact */
export function validateFact(fact) {
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
      const digests = fact.text.digests.map((digest) =>
        [digest.label === undefined ? digest.alg : digestDomain(digest), digest.value])
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
  advanceInspectEpoch(state, fact.namespace ?? null);
  if (state.rawAnchors.size && fact.kind !== "identity") advanceRawInspectEpoch(state);
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
        if (copy.text.digests.some(({ alg, keyId, label }) =>
          alg === "hmac" && label === undefined && !keys.some(({ id }) => id === keyId))) {
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
 * @param {Pick<UnitOfWork, "rotateRowDigests" | "keyedDomains" | "writeOwner">} work
 */
export function createFingerprintProvider(enabled, config, { rotateRowDigests, keyedDomains, writeOwner }) {
  if (!enabled && config != null) throw new CoreError("capability_unavailable");
  const labels = config == null ? TEST_FINGERPRINT_LABELS : validateFingerprintLabels(config.labels);
  let secret = enabled ? (config == null ? TEST_FINGERPRINT_SECRET : config.secret) : null;
  if (enabled && (typeof secret !== "string" || secret.length === 0)) throw new CoreError("invalid_input");
  const ring = new Set(secret === null ? [] : [secret]);
  /** @type {Map<string, RetainedDigester>} */
  const fixtures = new Map();
  /** @type {Promise<void> | undefined} */
  let rotation;

  /** @type {RingKeys} */
  const ringKeys = async (owner) => {
    // Snapshot the ring and place the current key first before any key derivation yields.
    const seeds = secret === null ? [] : [secret, ...[...ring].filter((seed) => seed !== secret)];
    const derived = await Promise.all(seeds.map((seed) => userFingerprintKey(seed, owner, labels)));
    return derived.filter((key) => key !== null);
  };

  /** @type {import("@cairn-ink/core/ports").FingerprintKeyProvider} */
  const keys = {
    async userKey(owner) {
      return userFingerprintKey(secret, owner, labels);
    },
    async userKeyForWrite(tx) {
      // The owner write lock prevents publication until this transaction ends.
      return userFingerprintKey(secret, writeOwner(tx), labels);
    },
    async retainedDigesters(owner) {
      const domains = keyedDomains(owner, true);
      if (domains.size === 0) return [];
      const fixture = fixtures.get(owner);
      const [current, ...retained] = await ringKeys(owner);
      if (!current) return [];
      /** @type {Map<string, RetainedDigester>} */
      const signers = new Map();
      for (const digest of domains.values()) {
        const { alg, keyId } = digest;
        const label = digest.label ?? digest.pipeline;
        if (alg !== "hmac" || (keyId === current.id && label === "core")) continue;
        const signingDomain = JSON.stringify([alg, keyId, label]);
        if (signers.has(signingDomain)) continue;
        if (fixture && fixture.keyId === keyId && fixture.label === label) {
          signers.set(signingDomain, fixture);
          continue;
        }
        // The ring's native exact MAC uses the core domain. Foreign domains need their own signer.
        const key = label === "core" && retained.find(({ id }) => id === keyId);
        if (key) signers.set(signingDomain, localDigester(key, label));
      }
      return [...signers.values()];
    },
  };

  /** @param {string} owner @param {RetainedDigestFixture | null} fixture */
  async function setRetainedDigestFixture(owner, fixture) {
    if (!enabled) throw new CoreError("capability_unavailable");
    if (typeof owner !== "string" || !owner) throw new CoreError("invalid_input");
    if (fixture === null) {
      fixtures.delete(owner);
      return;
    }
    const { keyId, label, secret } = fixture;
    if (typeof keyId !== "string" || !keyId || keyId.length > 64 ||
        typeof label !== "string" || !label || label.length > 512 ||
        typeof secret !== "string" || !secret) throw new CoreError("invalid_input");
    const signingKey = await crypto.subtle.importKey("raw", encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    fixtures.set(owner, Object.freeze(localDigester({ id: keyId, signingKey }, label)));
  }

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

  return { keys, ringKeys, labels, setFingerprintSecret, setRetainedDigestFixture };
}

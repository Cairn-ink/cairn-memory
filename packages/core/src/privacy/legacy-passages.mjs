import { redactHostedCurrent, redactV1 } from "./redact.mjs";
import { StreamingSha256 } from "./streaming-sha256.mjs";
import { cleanContent, normalizeForHash } from "./text.mjs";

/** @import { Scope } from "../ports/common.d.ts" */
/** @import { TextDigest, TextFact } from "../suppression-fact.mjs" */

export const MAX_LEGACY_PASSAGE_SENTENCES = 2_000;
const encoder = new TextEncoder();
const sentenceBreaks = /[.!?。]+|\r\n?|[\n\u2028\u2029]/gu;

/** @param {TextDigest} digest */
function isHostedSha(digest) {
  return digest.alg === "sha256" && digest.keyId === null && digest.pipeline === "hosted-v1";
}

/** @param {TextFact} fact */
export function hasLegacyPassageDigest(fact) {
  return fact.kind === "text" && fact.mode === "full" && !fact.text.shingles?.length &&
    fact.text.digests.some(isHostedSha);
}

/**
 * Retain line breaks as boundaries before normalizeForHash collapses their
 * whitespace. Keep a single space between sentences only where one existed.
 * @param {string} spelling
 * @returns {Array<{ text: string, spaceBefore: boolean }> | null}
 */
function sentencesOf(spelling) {
  const text = spelling.normalize("NFKC");
  /** @type {Array<{ text: string, spaceBefore: boolean }>} */
  const sentences = [];
  let start = 0;
  let previousEnd = 0;
  /** @param {number} end */
  function add(end) {
    const slice = text.slice(start, end);
    const normalized = normalizeForHash(slice);
    if (normalized) {
      sentences.push({ text: normalized, spaceBefore: start > previousEnd || /^\s/u.test(slice) });
      previousEnd = end - (slice.length - slice.trimEnd().length);
    }
  }
  for (const match of text.matchAll(sentenceBreaks)) {
    const punctuation = match[0];
    const end = match.index + punctuation.length;
    const lineBreak = /^\s/u.test(punctuation);
    if (/^\.+$/u.test(punctuation) && end < text.length && !/\s/u.test(text[end])) continue;
    add(lineBreak ? match.index : end);
    if (sentences.length > MAX_LEGACY_PASSAGE_SENTENCES) return null;
    start = end;
  }
  add(text.length);
  return sentences.length > MAX_LEGACY_PASSAGE_SENTENCES ? null : sentences;
}

/** @param {string} raw */
function historicalSpellings(raw) {
  const clean = cleanContent(raw);
  const normalized = clean.normalize("NFKC");
  const spellings = new Set();
  for (const [text, redact] of /** @type {const} */ ([
    [clean, redactV1], [normalized, redactV1], [clean, redactHostedCurrent],
  ])) {
    const redacted = redact(text);
    spellings.add(redacted);
    if (redacted === text) continue;
    // A redaction can swallow trailing punctuation. A newline in the existing
    // whitespace keeps the boundary without introducing a space in the digest.
    const marked = text.replace(/([.!?。！？])[^\S\r\n]/gu, "$1\n");
    if (marked !== text) spellings.add(redact(marked));
  }
  return spellings;
}

/**
 * Compare every contiguous run with the legacy SHA set. Substrings within a
 * sentence, bullet prefixes and paraphrases are outside this SHA-only check.
 * @param {Scope} scope @param {readonly TextFact[]} facts
 * @returns {((raw: string) => boolean) | undefined}
 */
export function legacyPassageMatcher(scope, facts) {
  if (facts.length === 0) return undefined;
  const digests = new Set();
  const prefixes = new Set();
  for (const fact of facts) {
    if (fact.owner !== scope.owner || (fact.namespace ?? null) !== scope.namespace || !hasLegacyPassageDigest(fact)) continue;
    for (const digest of fact.text.digests) {
      if (!isHostedSha(digest)) continue;
      digests.add(digest.value);
      prefixes.add(Number.parseInt(digest.value.slice(0, 8), 16));
    }
  }
  if (digests.size === 0) return undefined;

  return raw => {
    // Match historical exact spellings, including capture's pre-redaction NFKC.
    const stream = new StreamingSha256();
    const copy = new StreamingSha256();
    for (const spelling of historicalSpellings(raw)) {
      const sentences = sentencesOf(spelling);
      if (sentences === null) return true;
      const starts = sentences.map(({ text }) => encoder.encode(text));
      const tails = sentences.map(({ text, spaceBefore }, i) => spaceBefore ? encoder.encode(" " + text) : starts[i]);
      for (let i = 0; i < starts.length; i++) {
        stream.reset();
        stream.update(starts[i]);
        for (let j = i; j < starts.length; j++) {
          if (j > i) stream.update(tails[j]);
          copy.copyFrom(stream);
          const state = copy.finish();
          if (prefixes.has(state[0]) &&
              digests.has(Array.from(state, word => word.toString(16).padStart(8, "0")).join(""))) return true;
        }
      }
    }
    return false;
  };
}

import type { TextDigest } from "../suppression-fact.mjs";
import type { PassageFingerprint, RetainedDigester } from "../ports/privacy.d.ts";

export interface FingerprintKey {
  id: string;
  signingKey: CryptoKey;
}

export interface FingerprintLabels {
  readonly keyIdDomain: string;
  readonly shingleKeyPrefix: string;
  readonly legacyExactPrefix: string;
}

export interface LegacyCaptureFingerprint {
  text_hmac: string;
  shingles: string[];
  key_id: string;
}

/** Validates a frozen record of non-empty string labels and returns a frozen snapshot. */
export declare function validateFingerprintLabels(labels: unknown): FingerprintLabels;
/** @internal Verifies signing with an empty input and returns the usable HMAC-SHA-256 key. */
export declare function validateFingerprintSigningKey(value: unknown): Promise<CryptoKey>;
/** Derives the key ID and per-user signing key using the supplied domains. Prefixes include their delimiters. */
export declare function userFingerprintKey(secret: string | null, userId: string, labels: FingerprintLabels): Promise<FingerprintKey | null>;
export declare function legacyExactMac(text: string, key: FingerprintKey, labels: FingerprintLabels): Promise<string>;
/** Signs raw shingles with the key derived using the supplied labels. */
export declare function passageShingles(text: string, key: FingerprintKey, labels: FingerprintLabels): Promise<string[]>;
export declare function fingerprintLegacyCapture(text: string, key: FingerprintKey, labels: FingerprintLabels): Promise<LegacyCaptureFingerprint>;

/** @internal Hashes the supplied bytes or UTF-8 text without normalization. */
export declare function sha256Hex(input: string | Uint8Array): Promise<string>;
export declare function coreDigest(raw: string, key?: FingerprintKey | null): Promise<TextDigest>;
export declare function hostedV1Digest(raw: string): Promise<TextDigest>;
/** Throws invalid_input for refusals from the engine suppression input bounds. */
export declare function engineLegacyDigest(raw: string, max?: number, rawMax?: number): Promise<TextDigest>;
/**
 * Lookup candidates deduped by algorithm and value, keeping the first pipeline.
 * An engine refusal omits its alias. Legacy SHA candidates are for matching
 * historical facts. Facts for passages that held secrets need keyed digests.
 */
export declare function allDigests(raw: string, key?: FingerprintKey | null): Promise<TextDigest[]>;

/** @internal */
export declare const coreFingerprintLabels: FingerprintLabels;
/** @internal */
export declare function addDigest(digests: TextDigest[], digest: TextDigest): void;
/** @internal Builds labelled MACs for one candidate's normalized and redacted spellings. */
export declare function retainedDigestBuilder(
  digesters?: readonly RetainedDigester[],
): ((raw: string) => Promise<TextDigest[]>) | undefined;
/** @internal Builds the current and historical fingerprints used by memory withholding. */
export declare function fingerprintMemoryPassages(
  raw: string, text: string, key: FingerprintKey | null, sha256Hex?: (text: string) => Promise<string>,
  retainedFor?: (raw: string) => Promise<TextDigest[]>,
): Promise<PassageFingerprint[]>;

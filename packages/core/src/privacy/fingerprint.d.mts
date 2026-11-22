import type { TextDigest } from "../suppression-fact.mjs";

export interface FingerprintKey {
  id: string;
  signingKey: CryptoKey;
}

export interface LegacyCaptureFingerprint {
  text_hmac: string;
  shingles: string[];
  key_id: string;
}

/** Derives the hosted key id and per-user signing key. */
export declare function userFingerprintKey(secret: string | null, userId: string): Promise<FingerprintKey | null>;
export declare function legacyExactMac(text: string, key: FingerprintKey): Promise<string>;
export declare function passageShingles(text: string, key: FingerprintKey): Promise<string[]>;
export declare function fingerprintLegacyCapture(text: string, key: FingerprintKey): Promise<LegacyCaptureFingerprint>;

export declare function coreDigest(raw: string, key?: FingerprintKey | null): Promise<TextDigest>;
export declare function hostedV1Digest(raw: string): Promise<TextDigest>;
/** Throws invalid_input for refusals from the engine suppression input bounds. */
export declare function engineLegacyDigest(raw: string, max?: number, rawMax?: number): Promise<TextDigest>;
/**
 * Lookup candidates deduped by algorithm and value, keeping the first pipeline.
 * An engine refusal omits its alias. Legacy SHA candidates are for matching
 * historical facts. Facts for passages that held secrets require keyed digests.
 */
export declare function allDigests(raw: string, key?: FingerprintKey | null): Promise<TextDigest[]>;

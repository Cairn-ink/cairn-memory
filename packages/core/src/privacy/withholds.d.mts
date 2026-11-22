import type { PassageFingerprint } from "../ports/privacy.d.ts";
import type { TextDigest, TextFact } from "../suppression-fact.mjs";

/** Matches any shared algorithm and digest value across pipelines. Invalid lists also withhold. */
export declare function exactDigestMatch(a: readonly TextDigest[], b: readonly TextDigest[]): boolean;
/** @internal */
export declare function snapshotReader(): {
  dataProperty(input: object, name: PropertyKey): PropertyDescriptor | undefined;
  field(input: object, name: PropertyKey): unknown;
  array<T>(input: unknown, copy: (value: unknown) => T, allowHoles?: boolean): readonly T[] | undefined;
};
/** @internal */
export interface FingerprintEvidence {
  digests?: readonly TextDigest[];
  keyId?: string | null;
  shingles?: readonly string[] | null;
}
/** @internal */
export declare function isValidFingerprint(
  passage: FingerprintEvidence | null | undefined,
): passage is FingerprintEvidence & { digests: readonly TextDigest[] };
/** @internal */
export declare function isValidThreshold(threshold: unknown): threshold is number;
/** @internal Compares validated digests for an exact hit or a comparable miss. */
export declare function compareValidatedDigests(a: readonly TextDigest[], b: readonly TextDigest[]): boolean | "ineligible";
/** @internal Checks same-key shingles after the fingerprints and threshold have been validated. */
export declare function shingleContainmentMatch(
  passage: FingerprintEvidence, reference: FingerprintEvidence, threshold: number, checkContainment: boolean,
  containmentKeyUnavailable?: boolean,
): boolean | "ineligible";
export declare function withholdsPassage(passage: PassageFingerprint, fact: TextFact, threshold?: number): boolean;
export declare function withholdsAnyPassage(
  passages: readonly PassageFingerprint[], facts: readonly TextFact[], threshold?: number,
): boolean;
export declare function blocksMemoryPassage(
  passages: readonly PassageFingerprint[], facts: readonly TextFact[], key: { id: string } | null,
  threshold?: number, edit?: { id: string; createdAtMs: number },
): boolean;

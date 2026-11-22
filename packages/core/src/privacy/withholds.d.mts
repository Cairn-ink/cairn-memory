import type { PassageFingerprint } from "../ports/privacy.d.ts";
import type { TextDigest, TextFact } from "../suppression-fact.mjs";

/** Matches any shared algorithm and digest value across pipelines. */
export declare function exactDigestMatch(a: readonly TextDigest[], b: readonly TextDigest[]): boolean;
export declare function withholdsPassage(passage: PassageFingerprint, fact: TextFact, threshold?: number): boolean;
export declare function withholdsAnyPassage(
  passages: readonly PassageFingerprint[], facts: readonly TextFact[], threshold?: number,
): boolean;
export declare function blocksMemoryPassage(
  passages: readonly PassageFingerprint[], facts: readonly TextFact[], key: { id: string } | null,
  threshold?: number, edit?: { id: string; createdAtMs: number },
): boolean;

import type { Scope } from "../ports/common.d.ts";
import type { TextFact } from "../suppression-fact.mjs";

/** Incoming texts above this many sentences are withheld for owners with a legacy passage fact. */
export declare const MAX_LEGACY_PASSAGE_SENTENCES: number;
/** A full-mode text fact with no shingles whose digests include a keyless hosted-v1 SHA. */
export declare function hasLegacyPassageDigest(fact: TextFact): boolean;
/** Returns a matcher for the scope's legacy passage facts, or undefined when none apply. */
export declare function legacyPassageMatcher(scope: Scope, facts: readonly TextFact[]): ((raw: string) => boolean) | undefined;

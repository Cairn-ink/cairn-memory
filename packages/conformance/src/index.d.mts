import type { Capabilities, Capability } from "@cairn-ink/core";
import type { Namespace, Scope } from "@cairn-ink/core/ports";
import type { AdapterFactory, OpenedAdapter } from "./factory.d.ts";

export type { AdapterFactory, JsonValue, OpenedAdapter, TestHarness } from "./factory.d.ts";

export type CaseContext = Omit<OpenedAdapter, "close"> & {
  vec(distance: number): number[];
  hash(text: string): Promise<string>;
  owner: string;
  otherOwner: string;
  scope(namespace: Namespace): Scope;
};

type CaseRun = {
  needs: Capability[];
  needsOff?: Capability[];
  requests?: Partial<Capabilities>;
  /** A returned string is the reason an optional check was skipped. */
  run(ctx: CaseContext): Promise<void | string>;
};

export type ConformanceCase = CaseRun & {
  id: string;
  title: string;
  pending?: string;
  followUp?: CaseRun;
};

export declare const CASES: readonly ConformanceCase[];
export declare const PRIVACY_CASES: readonly ConformanceCase[];
export declare const CAPTURE_CASES: readonly ConformanceCase[];
export declare const ADMISSION_CASES: readonly ConformanceCase[];
export declare const IMPORT_TIME_CASES: readonly ConformanceCase[];
export declare const PRIVACY_MATCH_CASES: readonly ConformanceCase[];
export declare const SOURCE_FILTER_CASES: readonly ConformanceCase[];
export declare const KEYED_DIGEST_CASES: readonly ConformanceCase[];
export declare const RETRIEVAL_WINDOW_CASES: readonly ConformanceCase[];
export declare const FENCE_INTENT_CASES: readonly ConformanceCase[];
export declare const TOPIC_CASES: readonly ConformanceCase[];
export declare const TOPIC_FOR_MEMORIES_CASES: readonly ConformanceCase[];
export declare const RAW_CASES: readonly ConformanceCase[];
export declare const RELATION_CASES: readonly ConformanceCase[];
/** Returns the skip reason, or null on success. Failures reject. */
export declare function runCase(factory: AdapterFactory, testCase: ConformanceCase): Promise<string | null>;

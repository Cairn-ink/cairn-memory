import type { Capabilities, Capability } from "@cairn-ink/core";
import type { Namespace, Scope } from "@cairn-ink/core/ports";
import type { AdapterFactory, OpenedAdapter } from "./factory.d.ts";

export type { AdapterFactory, OpenedAdapter, TestHarness } from "./factory.d.ts";

export type CaseContext = Omit<OpenedAdapter, "close" | "embeddingDimensions"> & {
  vec(distance: number): number[];
  hash(text: string): Promise<string>;
  owner: string;
  otherOwner: string;
  scope(namespace: Namespace): Scope;
};

export type ConformanceCase = {
  id: string;
  title: string;
  needs: Capability[];
  needsOff?: Capability[];
  requests?: Partial<Capabilities>;
  pending?: string;
  run(ctx: CaseContext): Promise<void>;
};

export declare const CASES: readonly ConformanceCase[];
/** Returns the skip reason, or null on success. Failures reject. */
export declare function runCase(factory: AdapterFactory, testCase: ConformanceCase): Promise<string | null>;

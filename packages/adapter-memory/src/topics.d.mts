import type { Capabilities, ErrorCode } from "@cairn-ink/core";
import type { HostedTopicReads, Revision, Topic, TopicStore } from "@cairn-ink/core/ports";
import type { createFactMatcher } from "./fact-match.mjs";
import type { MemoryAdapterOptions } from "./index.d.mts";
import type { State, createUnitOfWork } from "./unit-of-work.mjs";

export type StoredTopic = Topic & { title: string; sources: Array<{ memoryId: string; revision: Revision }> };
export type Outcome = { revision: Revision; memberships: Map<string, bigint> };
export type CardOutcome = { contentHash: string; memberships: Map<string, bigint> };
export type Failure = { code: ErrorCode; attempts: number; failedAtMs: number };
export type TopicState = {
  topics: Map<string, StoredTopic>;
  outcomes: Map<string, Outcome>;
  failures: Map<string, Failure & { revision: Revision }>;
  cardOutcomes: Map<string, CardOutcome>;
  cardFailures: Map<string, Failure & { contentHash: string }>;
};

export function dropCardMemberships(state: State, namespace: import("@cairn-ink/core/ports").Namespace,
  cardId: string): number;
export function dropCardPlacement(state: State, namespace: import("@cairn-ink/core/ports").Namespace,
  cardId: string): void;

/** Returns the memory TopicStore with the default and hosted read overloads. */
export function createTopicStore(port: ReturnType<typeof createUnitOfWork>["port"],
  flags: Capabilities, newId: () => string, now: () => number, matchFacts: ReturnType<typeof createFactMatcher>,
  options: Pick<MemoryAdapterOptions, "topicRetryAfterMs" | "topicMaxAttempts">,
  cardVisible: ReturnType<typeof import("./retrieval.mjs").createCardVisibility>): TopicStore & HostedTopicReads;

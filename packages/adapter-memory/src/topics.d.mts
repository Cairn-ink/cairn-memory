import type { Capabilities, ErrorCode } from "@cairn-ink/core";
import type { Revision, Topic, TopicStore } from "@cairn-ink/core/ports";
import type { createUnitOfWork } from "./unit-of-work.mjs";

export type StoredTopic = Topic & { title: string; sources: Array<{ memoryId: string; revision: Revision }> };
export type Outcome = { revision: Revision; memberships: Map<string, bigint> };
export type TopicState = {
  topics: Map<string, StoredTopic>;
  outcomes: Map<string, Outcome>;
  failures: Map<string, { revision: Revision; code: ErrorCode }>;
};

export function createTopicStore(port: ReturnType<typeof createUnitOfWork>["port"],
  capabilities: Capabilities, newId: () => string, now: () => number): TopicStore;

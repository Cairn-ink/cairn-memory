import type { HostedTopicReads, Scope, TopicStore } from "@cairn-ink/core/ports";
import type { createIndexRevisions } from "./index-revisions.mjs";
import type { PlacementVisibility, ScopedVisibility } from "./placement-visibility.mjs";
import type { Connection, Port } from "./storage-values.mjs";
import type { createTopicCardPlacement } from "./topic-card-placement.mjs";

export type TopicOptions = { topicRetryAfterMs?: number; topicMaxAttempts?: number };

export function createTopicStore(port: Port, index: ReturnType<typeof createIndexRevisions>,
  visibility: PlacementVisibility, now: () => number, options: TopicOptions, legacyFiling: boolean,
  cardVisibility?: Parameters<typeof createTopicCardPlacement>[2]): TopicStore & HostedTopicReads;
export function topicMembershipReader(db: Connection, scope: Scope, visible: ScopedVisibility):
  (id: string) => string[] | null;
export function inspectTopics(db: Connection, scope: Scope, visible: ScopedVisibility, ids: string[]):
  Array<{ id: string; mocRevision: number; title: string | null }>;

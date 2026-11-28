import type { FactMatchPolicy } from "../../core/src/index.mjs";
import type { TopicStore } from "../../core/src/ports/index.d.ts";
import type { createPostgresDocumentCardStore } from "./document-cards.mjs";

export type PostgresTopicOptions = {
  now?: () => number;
  topicRetryAfterMs?: number;
  topicMaxAttempts?: number;
  hashSessionKey?: FactMatchPolicy["hashSessionKey"];
  documentCards?: Pick<ReturnType<typeof createPostgresDocumentCardStore>, "readFileableCards">;
};

export function createPostgresTopicStore(options?: PostgresTopicOptions): TopicStore & Required<Pick<TopicStore, "forMemories">>;

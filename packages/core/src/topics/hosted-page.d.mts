import type { HostedTopicListItem, Scope, TopicPage } from "../ports/index.d.ts";

type PlacedMemory = { id: string; placedAtUs: bigint };
type TopicSeek<T, K> = {
  after: K | null;
  finish(rows: T[]): { items: T[]; nextCursor: string | null };
  seek(sorted: T[]): { items: T[]; nextCursor: string | null };
};

export function validHostedTopicId(id: unknown): id is string;
export function compareHostedTopicIds(a: string, b: string): number;
export function compareHostedTopics(a: Pick<HostedTopicListItem, "memberCount" | "id">,
  b: Pick<HostedTopicListItem, "memberCount" | "id">): number;
export function compareHostedTopicMembers(a: PlacedMemory, b: PlacedMemory): number;
export function hostedTopicListPage(query: TopicPage, scope: Scope, level: string | null,
  revision: number): TopicSeek<HostedTopicListItem, Pick<HostedTopicListItem, "memberCount" | "id">>;
export function hostedTopicMemberPage(query: TopicPage, scope: Scope, topicId: string,
  revision: number): TopicSeek<PlacedMemory, PlacedMemory>;

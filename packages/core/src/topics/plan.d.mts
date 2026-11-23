import type { PlacementItem } from './proposal.mjs';

interface TopicSources {
  title: string;
  sourceIds: Set<string>;
}

export interface CoalescedTopics {
  newL1: Map<string, TopicSources & { parentL2Ids: Set<string>; newParentKeys: Set<string> }>;
  newL2: Map<string, TopicSources>;
}

export function titleKey(title: string): string;
export function coalesceNewTopics(items: readonly PlacementItem[]): CoalescedTopics;
export function filingRevision(currentRevision: number, wasFiled: boolean, willBeFiled: boolean): number;

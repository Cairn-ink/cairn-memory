import type { BuiltModelCallOptions } from "../capture/model-call.mjs";
import type { MemoryRow, ModelPort, Role } from "../ports/index.d.ts";

export interface RelationVerdict {
  predecessorIndex: number;
  relation: "supersedes" | "contradicts";
}

type RelationMemory = Pick<MemoryRow, "text" | "kind">;

export function validateRelationVerdicts(output: unknown, evidence: {
  candidateCount: number;
  sourceIndices: readonly number[];
  messages: readonly { role: Role }[];
}): RelationVerdict[];

export function judgeMemoryRelations(model: ModelPort, memory: RelationMemory, candidates: readonly RelationMemory[],
  options: BuiltModelCallOptions): Promise<RelationVerdict[]>;

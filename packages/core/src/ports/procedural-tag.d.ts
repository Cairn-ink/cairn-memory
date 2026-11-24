import type { Origin, Revision, Scope } from "./common.d.ts";
import type { Tx } from "./unit-of-work.d.ts";

export interface ProceduralAnchor {
  receiptId: string;
  /** SHA-256 hex digest of the whole stored receipt excerpt. */
  digest: string;
  /** Half-open UTF-16 offsets on code-point boundaries. */
  start: number;
  end: number;
}

export interface ProceduralTag {
  positive: boolean;
  origin: Origin | null;
  tagRevision: Revision;
  anchors: readonly ProceduralAnchor[];
}

/** Optional (capability proceduralTags). Tag changes use the same Tx as the memory change. */
export interface ProceduralTagStore {
  /** Writes the tag and advances its independent revision in the save transaction. */
  write(tx: Tx, scope: Scope, memoryId: string, tag: Omit<ProceduralTag, "tagRevision">): Promise<void>;
  /** Clears the tag in the correct or forget transaction. */
  clear(tx: Tx, scope: Scope, memoryId: string): Promise<void>;
  /** Reads the stored tag for inspect. */
  read(tx: Tx, scope: Scope, memoryId: string): Promise<ProceduralTag | null>;
}

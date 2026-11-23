import type { CaptureClaim, SourceFilter } from "../../core/src/ports/capture.d.ts";

export interface CaptureOptions {
  now?: () => number;
  /** Non-empty, stable signing secret for the hosted service's capture lineage MACs. */
  lineageSecret: string;
  /** Host-supplied synchronous hash of a plain session reference. Null means unavailable. */
  hashSessionKey?: (client: string, sessionId: string) => string | null;
}

export function createPostgresCapturePorts(options: CaptureOptions): Required<CaptureClaim> & SourceFilter;

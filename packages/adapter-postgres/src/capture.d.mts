import type { CaptureClaim, SourceFilter } from "../../core/src/ports/capture.d.ts";

export interface CaptureOptions {
  now?: () => number;
  /** Stable signing secret for the hosted service's capture lineage MACs. */
  lineageSecret?: string;
}

export function createPostgresCapturePorts(options?: CaptureOptions): Required<CaptureClaim> & SourceFilter;

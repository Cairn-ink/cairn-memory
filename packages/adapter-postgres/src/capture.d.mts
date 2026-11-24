import type { CaptureClaim, CaptureFinish, SourceFilter } from "../../core/src/ports/capture.d.ts";
import type { Connection } from "./driver.mjs";

export interface CaptureOptions {
  now?: () => number;
  /** Non-empty, stable signing secret for the hosted service's capture lineage MACs. */
  lineageSecret: string;
  /** Host-supplied synchronous hash of a plain session reference. Null means unavailable. */
  hashSessionKey?: (client: string, sessionId: string) => string | null;
  nearDuplicate?: boolean;
  allowNonNullNamespace?: boolean;
}

export function createPostgresCapturePorts(options: CaptureOptions): Required<CaptureClaim> & SourceFilter & CaptureFinish;

export function abandonDirectClaims(
  query: Connection["query"], owner: string, source: { client: string; sessionId: string }, now: number,
): Promise<boolean>;

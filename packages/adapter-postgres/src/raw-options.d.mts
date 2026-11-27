import type { OwnerId, Scope } from "../../core/src/ports/common.d.ts";
import type { FingerprintKey } from "../../core/src/privacy/fingerprint.mjs";
import type { CaptureOptions } from "./capture.mjs";
import type { Connection } from "./driver.mjs";
import type { Run } from "./uow.mjs";

type CardSourceAddress = { client: string; sessionId: string; messageId?: string };

export type CardPurge = (
  query: Connection["query"], run: Run, scope: Scope, sources: readonly CardSourceAddress[], memoryId?: string,
) => Promise<void>;

export interface RawOptions extends Pick<CaptureOptions, "lineageSecret" | "hashSessionKey"> {
  /** Use the card store's purge hook inside the current owner transaction. */
  purgeCards?: CardPurge;
  /** Current and retained owner keys, identified by the pipeline that derived them. */
  fingerprintKeys?(owner: OwnerId): readonly {
    key: FingerprintKey;
    pipeline: "core" | "hosted-v1";
  }[] | Promise<readonly { key: FingerprintKey; pipeline: "core" | "hosted-v1" }[]>;
}

import type { OwnerId } from "../../core/src/ports/common.d.ts";
import type { FingerprintKey } from "../../core/src/privacy/fingerprint.mjs";
import type { CaptureOptions } from "./capture.mjs";

export interface RawOptions extends Pick<CaptureOptions, "lineageSecret" | "hashSessionKey"> {
  /** Enable synthetic namespaces when the database has no hosted writers. */
  allowNonNullNamespace?: boolean;
  /** Current and retained owner keys, identified by the pipeline that derived them. */
  fingerprintKeys?(owner: OwnerId): readonly {
    key: FingerprintKey;
    pipeline: "core" | "hosted-v1";
  }[] | Promise<readonly { key: FingerprintKey; pipeline: "core" | "hosted-v1" }[]>;
}

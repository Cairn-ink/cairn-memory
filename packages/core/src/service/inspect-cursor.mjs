import { identifier, validateObject } from "../capture/validate.mjs";
import { CoreError } from "../errors.mjs";
import { signedReadToken } from "./signed-read-token.mjs";

/** @import { ClockAndHash, InspectReceiptAnchor, ReadTokenIdentity, Scope } from "../ports/index.d.ts" */
/** @typedef {{ v: 1, s: string, n: string, o: "list", f: string, l: number, states?: string } |
 * { v: 1, s: string, n: string, o: "get", m: string, l: number }} Binding */

/** @param {number} value */
function positiveInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/** @param {unknown} value */
function timeKey(value) {
  const parts = typeof value === "string" && /^((?:\d{4}|[+-]\d{6})-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?Z$/u.exec(value);
  if (!parts) throw new CoreError("invalid_cursor");
  const whole = parts[1] + ".000Z";
  const ms = Date.parse(whole);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== whole) throw new CoreError("invalid_cursor");
  return BigInt(ms) * 1000n + BigInt((parts[2] ?? "").padEnd(6, "0"));
}

/** @param {bigint} us */
function isoTime(us) {
  const remainder = (us % 1000n + 1000n) % 1000n;
  const milliseconds = (us - remainder) / 1000n;
  const iso = new Date(Number(milliseconds)).toISOString();
  return remainder === 0n ? iso : iso.slice(0, -1) + remainder.toString().padStart(3, "0") + "Z";
}

/** Match legacy core/contract.mjs:330–375,437–484.
 * @param {ReadTokenIdentity} identity
 * @param {ClockAndHash} clock
 */
export function inspectTokens({ storeId, cursorKey }, clock) {
  const signer = signedReadToken(cursorKey, clock);

  return {
    /** @param {Scope} scope @param {number} limit @param {{ memoryId?: string, state?: string }} filter @returns {Promise<Binding>} */
    async binding({ owner, namespace }, limit, { memoryId, state }) {
      const parts = namespace?.split("\0") ?? [];
      const [kind, projectId] = parts;
      const legacy = parts.length === 2 && (kind === "personal" && projectId === "" || kind === "project" && projectId);
      const publicScope = legacy
        ? { ownerId: owner, scope: kind, projectId: projectId || null }
        : { ownerId: owner, namespace };
      const base = /** @type {const} */ ({ v: 1, s: storeId, n: await signer.mac(JSON.stringify(publicScope)) });
      return memoryId === undefined
        ? { ...base, o: "list", f: "filed,unfiled", l: limit, ...(state && { states: state }) }
        : { ...base, o: "get", m: memoryId, l: limit };
    },

    /** @param {string} cursor @param {Binding} binding */
    async decode(cursor, binding) {
      try {
        const keys = Object.keys(binding);
        const payload = validateObject(await signer.decode(cursor), [...keys, "e", "a"]);
        if (Object.keys(payload).length !== keys.length + 2 ||
            Object.entries(binding).some(([key, value]) => payload[key] !== value) ||
            typeof payload.e !== "number" || !positiveInteger(payload.e)) throw new CoreError("invalid_cursor");
        return { epoch: payload.e, anchor: payload.a };
      } catch {
        throw new CoreError("invalid_cursor");
      }
    },

    /** @param {Binding} binding @param {number} epoch @param {object} anchor */
    async encode(binding, epoch, anchor) {
      return signer.encode({ ...binding, e: epoch, a: anchor });
    },
  };
}

/** @param {unknown} anchor */
export function listAnchor(anchor) {
  try {
    const { updatedAt, id } = validateObject(anchor, ["updatedAt", "id"]);
    return { updatedAtUs: timeKey(updatedAt), id: identifier(id) };
  } catch {
    throw new CoreError("invalid_cursor");
  }
}

/** @param {{ updatedAtUs: bigint, id: string }} row */
export function encodeListAnchor({ updatedAtUs, id }) {
  return { updatedAt: isoTime(updatedAtUs), id };
}

/** @param {unknown} anchor @returns {InspectReceiptAnchor} */
export function receiptAnchor(anchor) {
  try {
    const fields = validateObject(anchor, ["row", "createdAt", "id"]);
    if (Object.keys(fields).length === 1 && typeof fields.row === "number" && positiveInteger(fields.row)) return { row: fields.row };
    if (Object.keys(fields).length !== 2) throw new CoreError("invalid_cursor");
    const createdAtUs = timeKey(fields.createdAt);
    return { createdAtUs, createdAtMs: Number(createdAtUs / 1000n), id: identifier(fields.id) };
  } catch {
    throw new CoreError("invalid_cursor");
  }
}

/** @param {InspectReceiptAnchor} anchor */
export function encodeReceiptAnchor(anchor) {
  if ("row" in anchor) return anchor;
  const { createdAtMs, createdAtUs, id } = anchor;
  return { createdAt: isoTime(createdAtUs ?? BigInt(createdAtMs) * 1000n), id };
}

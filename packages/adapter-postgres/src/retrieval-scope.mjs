import { CREATED_MS } from "./memory-rows.mjs";

/** @typedef {ReturnType<typeof import("./memory-input.mjs").copyReadScope>} ReadSet */

export const MEMORY_FILTER = `user_id = $1 AND array_position($2::text[], core_namespace) IS NOT NULL
  AND ($3::text[] IS NULL OR source_client = ANY($3))
  AND ($4::bigint IS NULL OR ${CREATED_MS} >= $4)
  AND ($5::bigint IS NULL OR ${CREATED_MS} < $5)
  AND ($6::boolean OR currentness = 'current')`;

/** @param {ReadSet} scope @param {boolean} historical */
export function memoryScopeParams({ owner, keys, clients, since, until }, historical) {
  return [owner, keys, clients, since, until, historical];
}

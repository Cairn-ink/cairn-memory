// Only numeric invalidation state is shared; decisions belong to one dispatch.
const generations = new WeakMap();
export const episodeControlGeneration = db => generations.get(db) ?? 0;
export function advanceEpisodeControlGeneration(db) {
  generations.set(db, episodeControlGeneration(db) + 1);
}

// Canary table and planting checks. A missing canary value is an error, never
// a skipped check, and a step whose required canaries never reached its own
// source fails: zero delivery hits only count when the canary was planted.
const SOURCES = {
  secret_sk: c => c.secrets?.[0], secret_ghp: c => c.secrets?.[1], secret_password: c => c.secrets?.[2],
  tool_output: c => c.tool, reasoning: c => c.reasoning, reasoning_scripted: c => c.reasoningFake,
  injected_session_start: c => c.injectStart, injected_prompt_hook: c => c.injectPrompt, project_instructions: c => c.doc,
  sandbox_root: c => c.sandbox, cwd_path: c => c.cwd, image_path: c => c.imagePath,
  image_png_base64: c => c.imageBase64?.slice(100, 148), image_png_magic: () => 'iVBORw0KGgo',
  image_data_url: () => 'data:image/', compact_prompt_scripted: c => c.compactMarker,
  compact_summary_scripted: c => c.compactSummary,
};
/** Evidence names that are checked structurally rather than by one fixed value. */
export const STRUCTURAL = ['compaction_summary_text'];

export function canaryTable(canaries) {
  const table = {};
  for (const [name, pick] of Object.entries(SOURCES)) {
    const value = pick(canaries ?? {});
    if (typeof value !== 'string' || value.length < 8) throw new Error(`missing_canary:${name}`);
    table[name] = value;
  }
  return table;
}

export const canaryHits = (table, text) => Object.entries(table).filter(([, value]) => text.includes(value)).map(([name]) => name);

/**
 * `plants` must all appear in the step's own source; `mayPlant` depends on
 * model behaviour and is reported either way. Unknown names are failures.
 */
export function plantedCheck({ plants = [], mayPlant = [] }, found, table) {
  const known = name => Object.hasOwn(table, name) || STRUCTURAL.includes(name);
  const unknown = [...plants, ...mayPlant].filter(name => !known(name));
  const missing = plants.filter(name => known(name) && !found.has(name));
  return { ok: unknown.length === 0 && missing.length === 0, missing, unknown,
    optional: Object.fromEntries(mayPlant.filter(known).map(name => [name, found.has(name)])) };
}

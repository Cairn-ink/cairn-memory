export const PLUGIN_ID = "cairn-memory";
export const DEFAULT_ENDPOINT = "https://cairn.ink";
export const TOOLS = ["cairn_recall_memory", "cairn_remember_memory", "cairn_forget_memory"];
export const OFF_SWITCH = "openclaw cairn auto-recall off";
export const DEFAULT_TIMEOUT_MS = 5000;
export const PAUSE_NOTICE = "While saving is paused, Cairn recall in OpenClaw is off, including when you ask for it; resume to use it.";
export const WINDOWS_NOTICE = "Cairn recall does not run on a native Windows Gateway yet, so use WSL2.";
export const RECALL_PROMPT = recallPrompt();
// OpenClaw recommended-setup: timeout + setup grace + 1500 ms preflight + 1500 ms settlement.
export function worstCaseBlockingMs(timeoutMs = DEFAULT_TIMEOUT_MS, setupGraceTimeoutMs = 0) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 250 || !Number.isInteger(setupGraceTimeoutMs) || setupGraceTimeoutMs < 0) throw new Error("cairn_setup_conflict");
  return timeoutMs + setupGraceTimeoutMs + 3000;
}
export function recallPrompt(timeoutMs = DEFAULT_TIMEOUT_MS, setupGraceTimeoutMs = 0, cliTimeoutMs) {
  const cli = cliTimeoutMs ? ` CLI-backend models can add up to about ${worstCaseBlockingMs(cliTimeoutMs, setupGraceTimeoutMs) / 1000} s.` : "";
  return `Turn on automatic recall? It runs extra calls to your model before each reply in direct chats, using your usage; it can add up to about ${worstCaseBlockingMs(timeoutMs, setupGraceTimeoutMs) / 1000} s.${cli} [Y/n]`;
}
export const configSchema = {
  type: "object", additionalProperties: false,
  properties: {
    endpoint: { type: "string", default: DEFAULT_ENDPOINT },
    token: { type: "object", additionalProperties: false, required: ["source", "provider", "id"],
      properties: { source: { const: "file" }, provider: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,63}$" },
        id: { const: "value" } } },
    activeMemoryTimeoutMs: { type: "integer", minimum: 250, maximum: 120000, default: DEFAULT_TIMEOUT_MS },
  },
};
export function endpointOrigin(value) {
  try {
    if (typeof value !== "string" || !/^https?:\/\/[^/]+\/?$/.test(value) || /[\s\\?#\x00-\x1f]/u.test(value)) throw 0;
    const url = new URL(value);
    if (!url.hostname || url.username || url.password || url.pathname !== "/" || url.port === "0" ||
        !["https:", "http:"].includes(url.protocol) ||
        (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw 0;
    return value.replace(/\/$/, "");
  } catch { throw new Error("cairn_invalid_configuration"); }
}
export function timeoutValue(value = DEFAULT_TIMEOUT_MS) {
  if (!Number.isInteger(value) || value < 250 || value > 120000) throw new Error("cairn_invalid_configuration");
  return value;
}
export function validToken(token) {
  return typeof token === "string" && /^[\x21-\x7e]+$/.test(token) && token.length <= 16384;
}
// memory-tools.md and the host's active-memory config.ts: selected capability,
// then the documented LanceDB/built-in fallback. Unknown providers need live SDK evidence.
export function defaultRecallTools(draft, registration) {
  const selected = draft.plugins?.slots?.memory?.trim() || "memory-core";
  if (registration?.pluginId === selected) {
    const names = registration.capability.recallToolNames;
    if (Array.isArray(names) && names.some((x) => typeof x === "string" && x.trim())) {
      return [...new Set(names.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().toLowerCase()))];
    }
    return selected === "memory-lancedb" ? ["memory_recall"] : ["memory_search", "memory_get"];
  }
  if (selected === "memory-lancedb") return ["memory_recall"];
  if (["memory-core", "none"].includes(selected.toLowerCase())) return ["memory_search", "memory_get"];
  throw new Error("cairn_memory_provider_unresolved");
}
// Ported from OpenClaw 2026.11.3 dist/config-CMGCj_3o.mjs:26-37 and
// dist/types-DgEaE0BK.mjs ACTIVE_MEMORY_RESERVED_TOOLS_ALLOW. Neither the
// configured-list normalizer nor its reserved set is exported by plugin-sdk.
const RESERVED_RECALL_TOOLS = new Set([
  "*", "agents_list", "apply_patch", "browser", "canvas", "cron", "edit", "exec", "gateway",
  "heartbeat_respond", "heartbeat_response", "image", "image_generate", "message", "music_generate",
  "nodes", "pdf", "process", "read", "session_status", "sessions_history", "sessions_list",
  "sessions_send", "sessions_spawn", "sessions_yield", "subagents", "tts", "progress_card",
  "video_generate", "web_fetch", "web_search", "write",
]);
export function normalizeRecallTools(values) {
  const names = (Array.isArray(values) ? values : []).filter((name) => typeof name === "string")
    .map((name) => name.trim().toLowerCase()).filter(Boolean);
  return [...new Set(names)].filter((name) => !name.startsWith("group:") && !RESERVED_RECALL_TOOLS.has(name)).slice(0, 32);
}
export function mergedRecallTools(draft, registration) {
  const literal = draft.plugins?.entries?.["active-memory"]?.config?.toolsAllow ?? [];
  const effective = normalizeRecallTools(literal);
  const previous = effective.length ? effective : defaultRecallTools(draft, registration);
  const merged = [...literal, ...previous.filter((name) => !effective.includes(name))];
  if (!normalizeRecallTools(merged).includes(TOOLS[0])) merged.push(TOOLS[0]);
  const result = normalizeRecallTools(merged);
  // The host caps the effective list at 32. Refuse rather than silently lose a
  // provider tool or report Cairn enabled when its addition would be truncated.
  if (![...previous, TOOLS[0]].every((name) => result.includes(name))) throw new Error("cairn_setup_conflict");
  return merged;
}
export function activeMemoryEnabled(draft) {
  const entry = draft.plugins?.entries?.["active-memory"];
  return !!entry && entry.enabled !== false && entry.config?.enabled !== false;
}
export function activeMemoryBudget(draft, timeoutMs) {
  const existing = draft.plugins?.entries?.["active-memory"]?.config;
  // OpenClaw config-CMGCj_3o.mjs:98-109,166-170: retain host defaults,
  // including the runtime-dependent CLI default, when setup leaves keys absent.
  const raw = !activeMemoryEnabled(draft) && !Object.hasOwn(existing ?? {}, "timeoutMs") ? timeoutMs : existing?.timeoutMs;
  const parsedString = typeof raw === "string" && /^[+-]?\d+$/.test(raw.trim()) ? Number(raw) : NaN;
  const parsed = typeof raw === "number" ? raw : Number.isSafeInteger(parsedString) ? parsedString : NaN;
  const effective = Math.min(120000, Math.max(250, Math.floor(Number.isFinite(parsed) && parsed > 0 ? parsed : 15000)));
  const grace = existing?.setupGraceTimeoutMs;
  return { timeoutMs: effective,
    setupGraceTimeoutMs: Math.min(30000, Math.max(0, Math.floor(typeof grace === "number" && Number.isFinite(grace) ? grace : 0))),
    ...(raw == null ? { cliTimeoutMs: 45000 } : {}) };
}
export function removeAutomaticRecall(draft) {
  const config = draft.plugins?.entries?.["active-memory"]?.config;
  if (Array.isArray(config?.toolsAllow)) config.toolsAllow = config.toolsAllow.filter((name) => name !== TOOLS[0]);
}
export function mergeSetup(draft, { endpoint, provider, secretPath, automatic, timeoutMs, memoryRegistration }) {
  draft.secrets ??= {};
  draft.secrets.providers ??= {};
  if (Object.hasOwn(draft.secrets.providers, provider)) throw new Error("cairn_setup_conflict");
  draft.secrets.providers[provider] = { source: "file", path: secretPath, mode: "singleValue" };
  draft.plugins ??= {};
  draft.plugins.entries ??= {};
  draft.plugins.entries[PLUGIN_ID] = { ...draft.plugins.entries[PLUGIN_ID], enabled: true,
    config: { endpoint, token: { source: "file", provider, id: "value" }, activeMemoryTimeoutMs: timeoutMs } };
  draft.agents ??= {};
  draft.agents.entries ??= {};
  draft.agents.entries.main ??= {};
  const policy = draft.agents.entries.main.tools ??= {};
  if (policy.allow !== undefined && policy.alsoAllow !== undefined) throw new Error("cairn_setup_conflict");
  const key = policy.allow !== undefined ? "allow" : "alsoAllow";
  if (policy[key] !== undefined && (!Array.isArray(policy[key]) || !policy[key].every((x) => typeof x === "string"))) {
    throw new Error("cairn_setup_conflict");
  }
  policy[key] = [...new Set([...(policy[key] ?? []), ...TOOLS])];
  if (!automatic) return;
  const wasEnabled = activeMemoryEnabled(draft);
  const toolsAllow = mergedRecallTools(draft, memoryRegistration);
  const active = draft.plugins.entries["active-memory"] ??= {};
  const config = active.config ??= {};
  for (const key of ["agents", "toolsAllow"]) if (Object.hasOwn(config, key) &&
    (!Array.isArray(config[key]) || !config[key].every((x) => typeof x === "string"))) throw new Error("cairn_setup_conflict");
  const append = (values, name) => values.includes(name) ? values : [...values, name];
  config.toolsAllow = toolsAllow;
  config.agents = append(config.agents ?? [], "main");
  for (const [key, value] of Object.entries({ mode: "always", allowedChatTypes: ["direct"], queryMode: "message", timeoutMs, setupGraceTimeoutMs: 0 })) {
    if (!wasEnabled && !Object.hasOwn(config, key)) config[key] = value;
  }
  if (config.enabled === false) config.enabled = true;
  active.enabled = true;
}

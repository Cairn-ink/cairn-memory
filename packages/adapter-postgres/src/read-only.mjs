// Adapter code supplies all SQL and uses bound values for caller input.
// This lint catches adapter mistakes. The post-run session reset protects pooled sessions.
// Keep quoted identifiers distinct from strings and unquoted keywords.
const TOKEN = new RegExp([
  /(?<trivia>[ \t\r\n\f\v]+|--[^\r\n]*|\/\*(?:(?!\/\*|\*\/)[\s\S])*\*\/)/.source,
  /(?<quoted>"(?:""|[^"])*")/.source,
  /(?<string>[eE]'(?:''|\\[\s\S]|[^'\\])*'|'(?:''|[^'\\])*')/.source,
  /(?<dollar>\$(?:[A-Za-z_\u0080-\uffff][\w\u0080-\uffff]*)?\$)[\s\S]*?\k<dollar>/.source,
  /(?<unmatched>[uU]&["']|\/\*|'|"|\$(?:[A-Za-z_\u0080-\uffff][\w\u0080-\uffff]*)?\$)/.source,
  /(?<word>[A-Za-z_\u0080-\uffff][\w$\u0080-\uffff]*)/.source,
  /[\s\S]/.source,
].join("|"), "g");
const WRITE_KEYWORDS = new Set(["INSERT", "UPDATE", "DELETE", "MERGE", "INTO"]);
const DENIED_CALL = new RegExp("^(?:"
  + "pg_(?:try_)?advisory_.*|set_config|nextval|setval|currval|pg_notify|lo_.*|dblink.*|pg_sleep.*"
  + "|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|setseed"
  + "|query_to_xml|query_to_xml_and_xmlschema|cursor_to_xml|(?:table|database|schema)_to_xml.*"
  + ")$", "is");

/** @param {string} text */
export function isReadStatement(text) {
  // The bounded vector reader uses these transaction-local planner settings.
  if (text === "SET LOCAL hnsw.iterative_scan = 'strict_order'" ||
      text === "SET LOCAL enable_sort = off" || text === "SET LOCAL enable_sort = on") return true;
  let first;
  let depth = 0;
  let hasOuterSelect = false;
  let ended = false;
  let identifier;
  let previousKeyword;
  let beforePreviousKeyword;
  for (const match of text.matchAll(TOKEN)) {
    const [token] = match;
    const { trivia, quoted, string, dollar, word, unmatched } = match.groups ?? {};
    if (trivia) continue;
    // Reject unmatched delimiters and string syntax we cannot classify safely.
    if (ended || unmatched) return false;
    const keyword = word?.toUpperCase();
    if (first === undefined) {
      if (keyword !== "SELECT" && keyword !== "WITH") return false;
      first = keyword;
    }
    if (keyword && WRITE_KEYWORDS.has(keyword)) return false;
    // The write keywords already cover both UPDATE lock modes.
    if (keyword === "SHARE" && (previousKeyword === "FOR"
      || (previousKeyword === "KEY" && beforePreviousKeyword === "FOR"))) return false;
    if (token === "(" && identifier && DENIED_CALL.test(identifier)) return false;
    identifier = quoted ? quoted.slice(1, -1).replaceAll('""', '"') : word;
    beforePreviousKeyword = previousKeyword;
    previousKeyword = keyword;
    if (quoted || string || dollar) continue;
    if (token === "(") depth++;
    if (token === ")") depth--;
    if (depth < 0) return false;
    if (depth === 0 && keyword === "SELECT") hasOuterSelect = true;
    if (token === ";") ended = true;
  }
  return depth === 0 && hasOuterSelect;
}

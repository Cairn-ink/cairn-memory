// Mask quoted text and comments before looking at SQL keywords and separators.
const TOKEN = new RegExp([
  /(?<trivia>[ \t\r\n\f\v]+|--[^\r\n]*|\/\*(?:(?!\/\*|\*\/)[\s\S])*\*\/)/.source,
  /(?<quoted>[eE]'(?:''|\\[\s\S]|[^'\\])*'|'(?:''|[^'\\])*'|"(?:""|[^"])*")/.source,
  /(?<dollar>\$(?:[A-Za-z_\u0080-\uffff][\w\u0080-\uffff]*)?\$)[\s\S]*?\k<dollar>/.source,
  /(?<word>[A-Za-z_\u0080-\uffff][\w$\u0080-\uffff]*)/.source,
  /(?<unmatched>\/\*|'|"|\$(?:[A-Za-z_\u0080-\uffff][\w\u0080-\uffff]*)?\$)/.source,
  /[\s\S]/.source,
].join("|"), "g");
const WRITE_KEYWORDS = new Set(["INSERT", "UPDATE", "DELETE", "MERGE", "INTO"]);

/** @param {string} text */
export function isReadStatement(text) {
  let first;
  let depth = 0;
  let hasOuterSelect = false;
  let ended = false;
  for (const match of text.matchAll(TOKEN)) {
    const [token] = match;
    const { trivia, quoted, dollar, word, unmatched } = match.groups ?? {};
    if (trivia) continue;
    // Reject unmatched delimiters and string syntax we cannot classify safely.
    if (ended || unmatched) return false;
    const keyword = word?.toUpperCase();
    if (first === undefined) {
      if (keyword !== "SELECT" && keyword !== "WITH") return false;
      first = keyword;
    }
    if (keyword && WRITE_KEYWORDS.has(keyword)) return false;
    if (quoted || dollar) continue;
    if (token === "(") depth++;
    if (token === ")") depth--;
    if (depth < 0) return false;
    if (depth === 0 && keyword === "SELECT") hasOuterSelect = true;
    if (token === ";") ended = true;
  }
  return depth === 0 && hasOuterSelect;
}

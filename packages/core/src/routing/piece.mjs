import { caseInsensitiveWords, SPACE, WORD } from "./text.mjs";

const WHOLE = new RegExp(
  `(?<!${WORD})(?:${caseInsensitiveWords("whole|entire|full|complete|all of|again|resend|everything")})(?!${WORD})` +
    "|完整|整份|全部|整個|再給我|再提供|再傳|重新給|全文|再一次|一次",
  "iu",
);
const HEADING = new RegExp(
  String.raw`^${SPACE}*(?:#|day${SPACE}*\p{Nd}|第[一二三四五六七八九十\p{Nd}]+[天日步]|[^\n]{1,40}[:：]${SPACE}*(?![\s\S]))`,
  "iu",
);
const WHITESPACE = new RegExp(`${SPACE}+`, "gu");
const WINDOW_LIMIT = 350;

/** @param {string} text */
function bigrams(text) {
  const points = Array.from(text.toLowerCase().replace(WHITESPACE, ""));
  const pairs = new Set();
  for (let i = 1; i < points.length; i++) pairs.add(points[i - 1] + points[i]);
  return pairs;
}

/** @param {string} line @param {Set<string>} query */
function overlap(line, query) {
  let count = 0;
  for (const pair of bigrams(line)) {
    if (query.has(pair)) count++;
  }
  return count;
}

/** @param {string} text @param {number} budget @param {(text: string) => number} countTokens */
function tokenPrefix(text, budget, countTokens) {
  const points = Array.from(text);
  // Token counts need not increase monotonically with prefix length.
  while (points.length) {
    points.pop();
    const prefix = points.join("");
    if (countTokens(prefix) <= budget) return prefix;
  }
  return "";
}

/** @param {string[]} lines @param {number} budget @param {(text: string) => number} countTokens */
function headPiece(lines, budget, countTokens) {
  let head = "";
  for (const [i, line] of lines.entries()) {
    const next = i === 0 ? line : `${head}\n${line}`;
    if (countTokens(next) > budget) return i === 0 ? tokenPrefix(line, budget, countTokens) : head;
    head = next;
  }
  return head;
}

/** @param {Pick<import("./index.mjs").DocumentCard, "body">} card
 * @param {string} query
 * @param {import("./index.mjs").DocumentPieceOptions} options
 * @returns {import("./index.mjs").DocumentPiece}
 */
export function selectDocumentPiece({ body }, query, { maxTokens, countTokens }) {
  const tokens = countTokens(body);
  if (WHOLE.test(query)) {
    const budget = Math.floor(maxTokens * 0.6);
    if (tokens <= budget) return { body, kind: "whole" };
    return { body: headPiece(body.split("\n"), budget, countTokens), kind: "truncated" };
  }
  if (tokens <= WINDOW_LIMIT) return { body, kind: "whole" };

  const lines = body.split("\n");
  const queryBigrams = bigrams(query);
  const scores = lines.map(line => overlap(line, queryBigrams));
  const best = scores.indexOf(Math.max(...scores));
  let lo = best;
  let hi = best;

  // Both candidates are based on the same bounds. If both fit independently,
  // the right candidate wins that iteration.
  while (true) {
    const candidates = [[lo - 1, hi], [lo, hi + 1]];
    let grew = false;
    for (const [start, end] of candidates) {
      if (start >= 0 && end < lines.length && countTokens(lines.slice(start, end + 1).join("\n")) <= WINDOW_LIMIT) {
        lo = start;
        hi = end;
        grew = true;
      }
    }
    if (!grew) break;
  }

  let window = lines.slice(lo, hi + 1).join("\n");
  if (countTokens(window) > WINDOW_LIMIT) window = tokenPrefix(window, WINDOW_LIMIT, countTokens);
  for (let i = lo; i >= 0; i--) {
    if (!HEADING.test(lines[i])) continue;
    if (i < lo) window = `${lines[i]}\n…\n${window}`;
    break;
  }
  return { body: window, kind: "excerpt" };
}

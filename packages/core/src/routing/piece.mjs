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

/** @typedef {[start: number, end: number]} Span */

/** @param {string} line @param {Set<string>} query */
function matchingSpans(line, query) {
  const offsets = [0];
  const lower = line.toLowerCase();
  /** @type {Span[]} */
  const pairs = [];
  /** @type {{ span: Span, score: number }[]} */
  const runs = [];
  let lowerOffset = 0;
  let previous = "";
  let previousIndex = 0;
  let current;
  for (const point of line) {
    const index = offsets.length - 1;
    offsets.push(offsets[index] + point.length);
    const lowerEnd = lowerOffset + point.toLowerCase().length;
    const folded = lower.slice(lowerOffset, lowerEnd).replace(WHITESPACE, "");
    lowerOffset = lowerEnd;
    for (const part of folded) {
      if (query.has(previous + part)) {
        pairs.push([previousIndex, index + 1]);
        if (!current) {
          current = { span: /** @type {Span} */ ([previousIndex, index + 1]), score: 0 };
          runs.push(current);
        }
        current.span[1] = index + 1;
        current.score++;
      } else {
        current = undefined;
      }
      previous = part;
      previousIndex = index;
    }
  }
  runs.sort((a, b) => b.score - a.score);
  return { offsets, runs, pairs };
}

/** @param {Span[]} spans @param {number} length
 * @param {(left: number, right: number) => string | null} fit
 */
function matchingWindow(spans, length, fit) {
  const nearbyLimit = Math.ceil(length / spans.length);
  for (const [index, [start, end]] of spans.entries()) {
    const spanLength = end - start;
    if (index === 0) {
      // Keep the centered excerpt when it fits, and try both extremes at each
      // width. Each window gets its own measurement, independent of the others.
      for (let width = length - 1; width > spanLength; width--) {
        const first = Math.max(0, end - width);
        const last = Math.min(start, length - width);
        const center = Math.max(first, Math.min(last, start - Math.ceil((width - spanLength) / 2)));
        const window = fit(center, center + width) ?? fit(first, first + width) ?? fit(last, last + width);
        if (window !== null) return window;
      }
    }

    // Give every occurrence a share of the remaining search, starting at the
    // exact span and then trying independent ways of adding context.
    let remaining = nearbyLimit;
    for (let width = spanLength; width < length && remaining > 0; width++) {
      const first = Math.max(0, end - width);
      const last = Math.min(start, length - width);
      for (let left = first; left <= last && remaining > 0; left++, remaining--) {
        const window = fit(left, left + width);
        if (window !== null) return window;
      }
    }
  }
  return null;
}

/** @param {string} line @param {Set<string>} query @param {(text: string) => number} countTokens */
function oversizedWindow(line, query, countTokens) {
  const { offsets, runs, pairs } = matchingSpans(line, query);
  const length = offsets.length - 1;
  const rejected = new Set();
  // For n code points there are at most n runs and 2n pairs after lowercasing.
  // The two width sweeps use up to 6n probes, nearby windows up to 5n, and
  // prefixes up to n. The caller already measured the full line.
  /** @param {number} left @param {number} right */
  const fit = (left, right) => {
    const key = `${left}:${right}`;
    if (rejected.has(key)) return null;
    const window = line.slice(offsets[left], offsets[right]);
    if (countTokens(window) <= WINDOW_LIMIT) return window;
    rejected.add(key);
    return null;
  };

  if (runs.length) {
    const runWindow = matchingWindow(runs.map(run => run.span), length, fit);
    if (runWindow !== null) return runWindow;

    const [start, end] = runs[0].span;
    /** @param {Span} span */
    const distance = ([left, right]) => Math.abs(left + right - start - end);
    // Prefer compact pairs, then proximity to the strongest run's center.
    pairs.sort((a, b) => (a[1] - a[0]) - (b[1] - b[0]) || distance(a) - distance(b));
    const pairWindow = matchingWindow(pairs, length, fit);
    if (pairWindow !== null) return pairWindow;
  }

  for (let end = length - 1; end > 0; end--) {
    const prefix = fit(0, end);
    if (prefix !== null) return prefix;
  }
  // Even the shortest nonempty prefix can be over budget under a custom meter.
  return line.slice(0, offsets[1]);
}

/** @param {string[]} lines @param {number} first @param {string} window
 * @param {(text: string) => number} [countTokens]
 */
function withHeading(lines, first, window, countTokens) {
  for (let i = first; i >= 0; i--) {
    if (!HEADING.test(lines[i])) continue;
    if (i < first) {
      const headed = `${lines[i]}\n…\n${window}`;
      if (!countTokens || countTokens(headed) <= WINDOW_LIMIT) return headed;
    }
    break;
  }
  return window;
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
  if (scores[best] > 0 && countTokens(lines[best]) > WINDOW_LIMIT) {
    const window = oversizedWindow(lines[best], queryBigrams, countTokens);
    return { body: withHeading(lines, best, window, countTokens), kind: "excerpt" };
  }
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
  if (countTokens(window) > WINDOW_LIMIT) {
    window = tokenPrefix(window, WINDOW_LIMIT, countTokens) || Array.from(window)[0] || "";
  }
  return { body: withHeading(lines, lo, window), kind: "excerpt" };
}

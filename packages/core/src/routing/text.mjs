// These character classes preserve Unicode matching for document cues across runtimes.
export const SPACE = String.raw`[\x09-\x0d\x1c-\x20\x85\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]`;
export const NONSPACE = SPACE.replace("[", "[^");
export const WORD = String.raw`[\p{L}\p{N}_]`;

/** @param {string} content */
export function normalizeDocumentText(content) {
  return content.normalize("NFKC").replaceAll("\r\n", "\n");
}

/** @param {string} words */
export function caseInsensitiveWords(words) {
  return words.replaceAll("i", "[iİı]");
}

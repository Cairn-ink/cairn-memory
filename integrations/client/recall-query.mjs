import { redactSecrets } from "./redact.mjs";

const MAX_QUERY_UTF16_UNITS = 4_000;

export function prepareRecallQuery(prompt) {
  if (typeof prompt !== "string") return undefined;

  const redacted = redactSecrets(prompt).trim();
  if (!redacted) return undefined;

  const characters = [];
  let length = 0;
  for (const character of redacted) {
    // The hosted schema counts JavaScript UTF-16 units. Iterating by code point
    // keeps surrogate pairs intact while this stricter budget also stays within
    // the public 4,000-code-point limit.
    if (length + character.length > MAX_QUERY_UTF16_UNITS) break;
    characters.push(character);
    length += character.length;
  }
  return characters.join("");
}

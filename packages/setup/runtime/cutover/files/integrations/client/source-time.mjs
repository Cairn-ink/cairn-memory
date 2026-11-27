// Source times use a bounded RFC 3339 subset. Validate without normalizing:
// callers retain the original bytes, including the fraction and offset.
export const SOURCE_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})(?![\s\S])/;
export function sourceTimestamp(value) {
  return typeof value === "string" && value.length <= 40 &&
    SOURCE_TIMESTAMP_PATTERN.test(value) && dateTime(value);
}

// UTC RFC 3339, finite calendar instant. Date.parse alone normalizes February 30.
export function utcInstant(value) {
  if (typeof value !== "string") return false;
  const pattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|\+00:00)$/;
  const match = pattern.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] &&
    hour < 24 && minute < 60 && second < 60;
}

export function dateTime(value) {
  if (typeof value !== "string") return false;
  const match = /^(.*)([+-])(\d{2}):(\d{2})$/.exec(value);
  if (!match) return utcInstant(value);
  return Number(match[3]) <= 23 && Number(match[4]) <= 59 &&
    utcInstant(match[1] + "Z") && Number.isFinite(Date.parse(value));
}

const REPLACEMENT = "[REDACTED]";

const SECRET_PATTERNS = [
  /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z]+)? PRIVATE KEY-----/g,
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/g,
  /\bcrn_pat_[a-f0-9]{32,}\b/gi,
  /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}=*\b/gi,
];

const ASSIGNMENT_PATTERN =
  /\b((?:[a-z][a-z0-9_]*_)?(?:api[_-]?(?:key|token)|access[_-]?token|auth[_-]?token|client[_-]?secret|password)\s*[:=]\s*)["']?[^\s"']{8,}["']?/gi;

export function redactSecrets(value) {
  const redacted = SECRET_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, REPLACEMENT),
    String(value),
  );
  return redacted.replace(ASSIGNMENT_PATTERN, `$1${REPLACEMENT}`);
}

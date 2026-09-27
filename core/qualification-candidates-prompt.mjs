import { readFileSync } from 'node:fs';

const shared = readFileSync(new URL('./prompts/qualify-candidates-shared.md', import.meta.url), 'utf8').trimEnd();

/** Compose a wire-specific framing around the single source-interpretation guide. */
export function qualificationCandidatesPrompt(wrapperUrl) {
  const wrapper = readFileSync(wrapperUrl, 'utf8').trimEnd();
  return `${shared}\n\n${wrapper}`;
}

export const standardInlineQualificationPrompt = qualificationCandidatesPrompt(
  new URL('./prompts/qualify-candidates.md', import.meta.url));

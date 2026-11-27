export const documentCardsReady = true;
export const recallModel = 'gpt-4.1-mini-2025-04-14';
// The installed setup consent selects the OpenAI baseline, with no URL override.
export const localProviderProfile = Object.freeze({
  providerApiKeyEnv: 'OPENAI_API_KEY',
  endpoint: 'https://api.openai.com/v1/',
});

export const localProviderConsentFile = 'provider-consent.json';

export function localProviderConsentText(owner, project) {
  return JSON.stringify({ version: 1, owner, project, profile: 'openai-baseline-v1' }) + '\n';
}

// The value is available only to callers that checked the installation's consent.
export function localModelKey(environment, mode = 'value') {
  const name = localProviderProfile.providerApiKeyEnv;
  if (mode === 'presence') return Object.hasOwn(environment, name);
  const key = environment[name];
  if (!key) return null;
  if (typeof key !== 'string' || !key.trim() || /[\r\n\0]/u.test(key)) throw new Error('invalid_mcp_configuration');
  return key;
}

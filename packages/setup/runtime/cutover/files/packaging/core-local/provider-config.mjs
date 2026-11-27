// Enable after SQLite can migrate, serve and erase the same Document Cards.
export const documentCardsReady = false;
export const recallModel = 'gpt-4.1-mini-2025-04-14';
// The installed setup consent selects the OpenAI baseline, with no URL override.
export const localProviderProfile = Object.freeze({
  providerApiKeyEnv: 'OPENAI_API_KEY',
  endpoint: 'https://api.openai.com/v1/',
});

// The installed MCP engine reads only the process environment supplied to it
// by the client. Supplying that variable opts the MCP server into processing.
export function localModelKey(environment) {
  const key = environment[localProviderProfile.providerApiKeyEnv];
  if (!key) return null;
  if (typeof key !== 'string' || !key.trim() || /[\r\n\0]/u.test(key)) throw new Error('invalid_mcp_configuration');
  return key;
}

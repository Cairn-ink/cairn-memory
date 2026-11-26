// Enable after SQLite can migrate, serve and erase the same Document Cards.
export const documentCardsReady = false;
export const recallModel = 'gpt-4.1-mini-2025-04-14';

// The installed MCP engine reads only the process environment supplied to it
// by the client. Supplying that variable opts the MCP server into processing.
export function localModelKey(environment) {
  const key = environment.OPENAI_API_KEY;
  if (!key) return null;
  if (typeof key !== 'string' || !key.trim() || /[\r\n\0]/u.test(key)) throw new Error('invalid_mcp_configuration');
  return key;
}

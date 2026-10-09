import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { browserAuthorize, credentialCheck, validToken } from './auth.mjs';
import { privateRead, privateWrite, privateDirectory, checkedPath } from '../runtime/integrations/client/private-state.mjs';
import { readInstallation, readCredential } from '../runtime/integrations/codex/installed-state.mjs';

// Installer-owned browser credential. Never import broad PATs or native Claude
// secrets: configure --json exposes capability metadata, not a portable token.
// A verified memory-scoped grant can be delivered to either consenting client.
export async function sharedAuthorization({ reauthorize, authOptions, signal }) {
  const directory = join(homedir(), '.cairn-memory-clients');
  const path = join(directory, 'setup-credential.json');
  let stored;
  try {
    await checkedPath(directory, { directory: true });
    const value = JSON.parse(await privateRead(path, { missing: true }));
    if (value.version === 1 && typeof value.endpoint === 'string' && validToken(value.token) &&
        Number.isFinite(Date.parse(value.expiresAt))) stored = value;
  } catch { /* unavailable cache never authorizes */ }
  if (!stored) {
    const installation = join(resolve(process.env.CODEX_HOME || join(homedir(), '.codex')), 'cairn/installation.json');
    try {
      const config = await readInstallation(installation);
      stored = { endpoint: config.endpoint, token: await readCredential(installation, config.endpoint) };
    } catch { /* a first installation has no credential */ }
  }
  let current;
  return {
    get endpoint() { return current?.endpoint ?? stored?.endpoint; },
    async authorize(endpoint, options) {
      if (!current && !reauthorize && stored?.endpoint === endpoint) {
        try {
          const checked = await credentialCheck(endpoint, stored.token, { ...authOptions, signal });
          if (checked?.scopes?.length === 2 && checked.scopes.includes('memory:capture') &&
              checked.scopes.includes('memory:recall') && checked.expires_at) {
            current = { ...stored, expiresAt: checked.expires_at };
          }
        } catch (error) {
          // Rejected credentials may be replaced. Network/protocol failures must
          // not become a second device grant or a PAT downgrade.
          if (error.key !== 'auth_credential') throw error;
        }
      }
      if (current) {
        if (current.endpoint !== endpoint) throw new Error('authorization_endpoint_conflict');
        await options.save({ api_endpoint: endpoint, api_token: current.token });
        options.write(options.t('credential_kept'));
        return { expiresAt: current.expiresAt };
      }
      const result = await browserAuthorize(endpoint, { ...options, save: async (values, timeout) => {
        const token = values.api_token;
        await options.save(values, timeout);
        current = { version: 1, endpoint, token };
      } });
      if (!result.unsupported) {
        current.expiresAt = result.expiresAt;
        await privateDirectory(directory);
        await privateWrite(path, JSON.stringify(current));
      }
      return result;
    },
  };
}

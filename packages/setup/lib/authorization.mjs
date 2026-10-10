// Shared delivery is in memory only. The original tool remains authoritative
// for its credential; no state is written to the pairing coordination directory.
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { browserAuthorize, credentialCheck } from './auth.mjs';
import { readInstallation, readCredential } from '../runtime/integrations/codex/installed-state.mjs';
import { SetupError } from './errors.mjs';

export async function readCodexCredential() {
  const path = join(resolve(process.env.CODEX_HOME || join(homedir(), '.codex')), 'cairn/installation.json');
  try {
    const config = await readInstallation(path);
    const token = await readCredential(path, config.endpoint).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    return { endpoint: config.endpoint, token };
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw new SetupError('codex_state_error');
  }
}

export async function sharedAuthorization({ stored, endpoint: existingEndpoint, authOptions, signal }) {
  let current, checkedStored = false, newGrant = false;
  const conflict = () => new SetupError(newGrant ? 'authorization_delivered_endpoint_conflict' : 'authorization_endpoint_conflict', 2);
  return {
    get endpoint() { return current?.endpoint ?? stored?.endpoint ?? existingEndpoint; },
    async authorize(endpoint, options) {
      if (existingEndpoint && existingEndpoint !== endpoint) throw conflict();
      if (stored && !checkedStored) {
        if (stored.endpoint !== endpoint) throw conflict();
        const checked = await credentialCheck(endpoint, stored.token, { ...authOptions, signal });
        if (checked?.scopes?.length !== 2 || !checked.scopes.includes('memory:capture') ||
            !checked.scopes.includes('memory:recall') || !checked.expires_at) {
          throw new SetupError('authorization_credential_unavailable', 2);
        }
        current = { ...stored, expiresAt: checked.expires_at };
        checkedStored = true;
      }
      if (current) {
        if (current.endpoint !== endpoint) throw conflict();
        await options.save({ api_endpoint: endpoint, api_token: current.token });
        options.write(options.t(newGrant ? 'authorization_shared' : 'authorization_reused'));
        return { expiresAt: current.expiresAt };
      }
      const result = await browserAuthorize(endpoint, { ...options, save: async (values, timeout) => {
        const token = values.api_token;
        await options.save(values, timeout);
        current = { endpoint, token };
        newGrant = true;
      } });
      if (!result.unsupported) current.expiresAt = result.expiresAt;
      return result;
    },
  };
}

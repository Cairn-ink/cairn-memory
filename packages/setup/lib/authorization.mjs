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
    return { endpoint: config.endpoint, token, enabled: config.enabled };
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw new SetupError('codex_state_error');
  }
}

export async function sharedAuthorization({ stored, endpoint: existingEndpoint, authOptions, signal, replacesExisting = false }) {
  let current, newGrant = false, reported = false;
  if (stored) {
    const checked = await credentialCheck(stored.endpoint,stored.token,{...authOptions,signal});
    // The credential endpoint validates scoped replies. Legacy endpoints may
    // omit scopes/expiry or return 404/501; that must not invalidate a saved login.
    current = { ...stored, expiresAt: checked?.expires_at };
  }
  const conflict = () => new SetupError(newGrant ? 'authorization_delivered_endpoint_conflict' : 'authorization_endpoint_conflict', 2);
  return {
    replacesExisting,
    get endpoint() { return current?.endpoint ?? stored?.endpoint ?? existingEndpoint; },
    async authorize(endpoint, options) {
      if (existingEndpoint && existingEndpoint !== endpoint) throw conflict();
      if (current) {
        if (current.endpoint !== endpoint) throw conflict();
        await options.save({ api_endpoint: endpoint, api_token: current.token });
        if (!newGrant && !reported) options.write(options.t(current.expiresAt ? 'authorization_reused' : 'credential_kept',
          { date: current.expiresAt ? new Date(current.expiresAt).toLocaleDateString(options.t.locale) : '' }));
        reported = true;
        return { expiresAt: current.expiresAt, reported: true };
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

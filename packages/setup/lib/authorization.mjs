// Shared delivery is in memory only. The original tool remains authoritative
// for its credential; no state is written to the pairing coordination directory.
import { join, resolve } from 'node:path';
import { homedir, userInfo } from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { browserAuthorize, credentialCheck, validToken } from './auth.mjs';
import { privateRead } from '../runtime/integrations/client/private-state.mjs';
import { readInstallation, readCredential } from '../runtime/integrations/codex/installed-state.mjs';
import { SetupError } from './errors.mjs';

const plugin = 'cairn-memory@cairn-memory';
const execute = promisify(execFile);
export async function readClaudeCredential(endpoint, { env = process.env, platform = process.platform,
  keychain = async args => (await execute('security', args, { timeout: 10000, maxBuffer: 64 * 1024, windowsHide: true })).stdout } = {}) {
  try {
    // Claude Code's native pluginSecrets store, verified against CLI 2.1.295.
    // configure --json exposes the non-sensitive endpoint but never the token.
    const defaultDirectory = join(homedir(), '.claude');
    const directory = resolve(env.CLAUDE_SECURESTORAGE_CONFIG_DIR === '' ? defaultDirectory : env.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? env.CLAUDE_CONFIG_DIR ?? defaultDirectory);
    let bytes;
    if (platform === 'darwin') {
      const custom = env.CLAUDE_SECURESTORAGE_CONFIG_DIR !== undefined ?
        Boolean(env.CLAUDE_SECURESTORAGE_CONFIG_DIR) : Boolean(env.CLAUDE_CONFIG_DIR);
      const suffix = custom ? '-' + createHash('sha256').update(directory.normalize('NFC')).digest('hex').slice(0, 8) : '';
      const account = env.USER || userInfo().username;
      bytes = await keychain(['find-generic-password', '-a', /^[a-zA-Z0-9._-]+$/u.test(account) ? account : 'claude-code-user',
        '-w', '-s', 'Claude Code-credentials' + suffix]);
    } else if (platform === 'linux') {
      bytes = await privateRead(join(directory, '.credentials.json'));
    } else throw new Error('unsupported_store');
    const token = JSON.parse(bytes).pluginSecrets?.[plugin]?.api_token;
    if (!validToken(token)) throw new Error('missing_plugin_secret');
    return { endpoint, token };
  } catch { throw new SetupError('authorization_credential_unavailable', 2); }
}

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
  let current, checkedStored = false;
  return {
    get endpoint() { return current?.endpoint ?? stored?.endpoint ?? existingEndpoint; },
    async authorize(endpoint, options) {
      if (existingEndpoint && existingEndpoint !== endpoint) throw new SetupError('authorization_endpoint_conflict', 2);
      if (stored && !checkedStored) {
        if (stored.endpoint !== endpoint) throw new SetupError('authorization_endpoint_conflict', 2);
        const checked = await credentialCheck(endpoint, stored.token, { ...authOptions, signal });
        if (checked?.scopes?.length !== 2 || !checked.scopes.includes('memory:capture') ||
            !checked.scopes.includes('memory:recall') || !checked.expires_at) {
          throw new SetupError('authorization_credential_unavailable', 2);
        }
        current = { ...stored, expiresAt: checked.expires_at };
        checkedStored = true;
      }
      if (current) {
        if (current.endpoint !== endpoint) throw new SetupError('authorization_endpoint_conflict', 2);
        await options.save({ api_endpoint: endpoint, api_token: current.token });
        options.write(options.t('credential_kept'));
        return { expiresAt: current.expiresAt };
      }
      const result = await browserAuthorize(endpoint, { ...options, save: async (values, timeout) => {
        const token = values.api_token;
        await options.save(values, timeout);
        current = { endpoint, token };
      } });
      if (!result.unsupported) current.expiresAt = result.expiresAt;
      return result;
    },
  };
}

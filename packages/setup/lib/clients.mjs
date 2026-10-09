import { availableClient, setupCodex } from './codex.mjs';
import { sharedAuthorization, readClaudeCredential, readCodexCredential } from './authorization.mjs';

const setupFlags = ['--dry-run', '--no-browser', '--manual-token', '--reauthorize', '--no-clipboard'];
const affirmative = answer => /^(?:y|yes)$/iu.test(answer.trim());

export async function setupDetected(argv, context) {
  const { write, prompt, interactive, t, SetupError, runClient, endpointOverride } = context;
  const [action, ...flags] = argv;
  if (flags.some(flag => !setupFlags.includes(flag)) || (action === 'status' && flags.length)) {
    throw new SetupError('unknown_command', 2);
  }
  if (!context.supportedNode(context.nodeVersion)) throw new SetupError('node_required');
  const clients = ['claude', 'codex'].filter(availableClient);
  const call = (client, overrides = {}) => runClient([action, ...flags, '--client', client,
    '--lang', t.locale === 'zh-TW' ? 'zh' : 'en', ...(endpointOverride ? ['--endpoint', endpointOverride] : [])], overrides);
  if (action === 'status' || flags.includes('--dry-run')) {
    let code = 0;
    for (const client of ['claude', 'codex']) {
      write(t('client_heading', { client }));
      if (!clients.includes(client)) { write(t('client_missing', { client })); continue; }
      code = Math.max(code, await call(client));
    }
    return code;
  }
  if (!clients.length) { write(t('clients_missing')); return 0; }
  if (!interactive) throw new SetupError('tty_required', 2);
  const agreed = [];
  let codexVerdict, codexCredential, fallback = false;
  for (const client of clients) {
    write(t('client_heading', { client }));
    if (client === 'codex') {
      if (process.platform === 'win32') {
        write(t('codex_inspection_skipped', { reason: t('codex_windows') }));
        continue;
      }
      try {
        codexCredential = await readCodexCredential();
        codexVerdict = await (context.inspectCodex ?? setupCodex)({ ...context, action, flags, inspectOnly: true,
          // An override is checked against kept credentials after consent, so
          // declining Codex does not prevent setting up a new Claude client.
          ...(codexCredential?.token && !flags.includes('--reauthorize') ? {endpointOverride:undefined} : {}) });
        if (codexVerdict.reason === 'codex_windows') throw new SetupError('codex_windows');
      } catch (error) {
        if (error.key === 'endpoint_reauthorize') throw error;
        // Native errors and output may contain secrets. Only localized known
        // SetupError reasons are safe to show; Claude remains independent.
        write(t('codex_inspection_skipped', { reason: error instanceof SetupError ? t(error.key, error.params) : t('codex_failed') }));
        continue;
      }
      if (!codexVerdict.qualified) {
        if (agreed.includes('claude')) { write(t('codex_setup_skipped')); continue; }
        // Preserve 0.3.0's MCP-only path when Codex is the only agreed tool.
        write(t('codex_fallback_disclosure'));
        if (affirmative(await prompt(t('connect_codex_mcp')))) { agreed.push(client); fallback = true; }
        continue;
      }
      write(t('codex_disclosure'));
      write(t('codex_hooks_dry'));
      write(t('codex_hook_plaintext'));
      if (agreed.includes('claude')) write(t('codex_sharing'));
      write(t('codex_startup_gate'));
      write(t('shared_credential_disclosure'));
      const answer = await prompt(t(agreed.includes('claude') ? 'connect_codex_shared' : 'connect_codex'));
      if (affirmative(answer)) agreed.push(client);
    } else {
      write(t('claude_disclosure'));
      write(t('shared_credential_disclosure'));
      const answer = await prompt(t('connect_claude'));
      if (!answer.trim() || affirmative(answer)) agreed.push(client);
    }
  }
  if (!agreed.length) { write(t('clients_declined')); return 0; }
  const shared = agreed.includes('claude') && agreed.includes('codex');
  let authOptions = context.authOptions;
  const reauthorize = flags.includes('--reauthorize');
  if (!reauthorize && agreed.includes('codex') && codexCredential?.token && endpointOverride) {
    throw new SetupError('endpoint_reauthorize', 2);
  }
  if (shared && !fallback) {
    let stored, existingEndpoint;
    if (!reauthorize) {
      const metadata = await context.inspectClaude();
      const claudeReady = metadata && ['api_endpoint', 'api_token'].every(key => metadata.configured.includes(key));
      if (claudeReady && endpointOverride) throw new SetupError('endpoint_reauthorize', 2);
      if (metadata?.configured.includes('api_token') && !claudeReady) throw new SetupError('credential_endpoint_unset', 2);
      const claudeEndpoint = metadata?.configured.includes('api_endpoint') ? metadata.inputs?.api_endpoint : undefined;
      if (claudeReady && !context.validEndpoint(claudeEndpoint)) throw new SetupError('authorization_credential_unavailable', 2);
      const codexEndpoint = codexCredential?.endpoint ?? codexVerdict.endpoint;
      existingEndpoint = claudeEndpoint ?? codexEndpoint;
      if (claudeEndpoint && codexEndpoint && claudeEndpoint !== codexEndpoint) {
        throw new SetupError('authorization_endpoint_conflict', 2);
      }
      // Read the Claude secret only when delivery to a new Codex needs it.
      // If both tools already have credentials, leave both untouched.
      if (claudeReady && !codexCredential?.token) stored = await readClaudeCredential(claudeEndpoint, { env: context.env });
      else if (!claudeReady && codexCredential?.token) stored = codexCredential;
      else if (codexCredential?.token) stored = codexCredential;
    }
    if (flags.includes('--manual-token')) throw new SetupError('authorization_manual_unsupported', 2);
    const authorization = await sharedAuthorization({ stored, endpoint: existingEndpoint, authOptions, signal: context.signal });
    authOptions = { ...authOptions, authorization };
  }
  let code = 0;
  for (const client of agreed) {
    const result = await call(client, { authOptions, pairingConsent: shared ? 'shared' : 'standalone' });
    code = Math.max(code, result);
    if (result && client === 'claude') break;
  }
  return code;
}

import { availableClient, setupCodex } from './codex.mjs';
import { sharedAuthorization } from './authorization.mjs';

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
  // No prompts, grants, installs or qualification cache writes without a TTY.
  if (!interactive) throw new SetupError('tty_required', 2);
  const agreed = [];
  for (const client of clients) {
    write(t('client_heading', { client }));
    if (client === 'codex') {
      const verdict = await setupCodex({ ...context, browse: context.browse, action, flags, inspectOnly: true });
      if (!verdict.qualified) { write(t('codex_setup_skipped')); continue; }
      write(t('codex_disclosure'));
      write(t('codex_hooks_dry'));
      write(t('codex_hook_plaintext'));
      // Preserve the existing stopped-host disclosure, combining its consent
      // with this tool's opt-in so pairing never becomes a separate step.
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
  const authorization = await sharedAuthorization({ reauthorize: flags.includes('--reauthorize'),
    authOptions: context.authOptions, signal: context.signal });
  const authOptions = { ...context.authOptions, authorization };
  let code = 0;
  for (const client of agreed) {
    const result = await call(client, { authOptions,
      pairingConsent: agreed.includes('claude') && agreed.includes('codex') ? 'shared' : 'standalone' });
    code = Math.max(code, result);
    // Do not pair with a Claude installation whose delivery has failed.
    if (result && client === 'claude') break;
  }
  return code;
}

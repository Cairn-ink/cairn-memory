import { availableClient, setupCodex } from './codex.mjs';
import { sharedAuthorization, readCodexCredential } from './authorization.mjs';
import { chooseIdentity, assertIdentityUnchanged } from './identity-choice.mjs';
import { PRIVACY_URL } from './constants.mjs';
import { confirmStopped } from './hosts.mjs';

const setupFlags = ['--dry-run', '--no-browser', '--manual-token', '--reauthorize', '--no-clipboard'];
const affirmative = answer => /^(?:y|yes)$/iu.test(answer.trim());

export async function setupDetected(argv, context) {
  const { write, prompt, interactive, t, SetupError, runClient, endpointOverride, dailyCap, captureExec, verbose } = context;
  const [action, ...flags] = argv;
  if (flags.some(flag => !setupFlags.includes(flag)) || (action === 'status' && flags.length)) {
    throw new SetupError('unknown_command', 2);
  }
  if (!context.supportedNode(context.nodeVersion)) throw new SetupError('node_required');
  const clients = ['claude', 'codex'].filter(availableClient);
  const call = (client, overrides = {}) => {
    const endpoint = overrides.endpointOverride ?? endpointOverride;
    return runClient([action, ...flags, '--client', client, '--lang', t.locale === 'zh-TW' ? 'zh' : 'en',
      ...(verbose ? ['--verbose'] : []),
      ...(dailyCap === undefined || client !== 'codex' ? [] : ['--codex-daily-cap', String(dailyCap)]),
      ...(captureExec === undefined || client !== 'codex' ? [] : ['--codex-capture-exec', captureExec ? 'on' : 'off']),
      ...(endpoint ? ['--endpoint', endpoint] : [])], overrides);
  };
  if (action === 'status' || flags.includes('--dry-run')) {
    let code = 0;
    for (const client of ['claude', 'codex']) {
      write('');
      if (!clients.includes(client)) {
        write(t('client_missing', { client: client === 'claude' ? 'Claude Code' : 'Codex' }));
        continue;
      }
      code = Math.max(code, await call(client));
    }
    if (action === 'status') {
      write('');
      write(t('status_unverified'));
    }
    return code;
  }
  if (!clients.length) {
    write(t('clients_missing'));
    return 0;
  }
  write(t(clients.length === 2 ? 'found_both' : `found_${clients[0]}`));
  if (!interactive) {
    if (endpointOverride && flags.includes('--reauthorize')) {
      throw new SetupError('tty_confirmation_required', 2, { endpoint: endpointOverride });
    }
    // Read-only diagnostics make conflicts actionable even when the terminal cannot ask.
    const credential = await readCodexCredential().catch(() => undefined);
    const metadata = clients.includes('claude') ? await context.inspectClaude() : undefined;
    const claudeEndpoint = metadata?.inputs?.api_endpoint;
    if (credential?.endpoint && claudeEndpoint && credential.endpoint !== claudeEndpoint) {
      throw new SetupError('authorization_endpoint_conflict', 2);
    }
    if (clients.length === 2) await chooseIdentity({ ...context, interactive: false });
    throw new SetupError('tty_required', 2);
  }
  const metadata = clients.includes('claude') ? await context.inspectClaude() : undefined;
  const claudeReady = metadata && ['api_endpoint', 'api_token'].every(key => metadata.configured.includes(key));
  let codexVerdict, codexCredential;
  if (clients.includes('codex')) {
    try {
      codexCredential = await readCodexCredential();
      codexVerdict = await (context.inspectCodex ?? setupCodex)({ ...context, action, flags, write: () => {}, inspectOnly: true,
        endpointOverride: codexCredential?.token || flags.includes('--reauthorize') ? undefined : endpointOverride });
    } catch (error) {
      if (error.key === 'endpoint_reauthorize') throw error;
      write(t('codex_inspection_skipped', { reason: error instanceof SetupError ? t(error.key, error.params) : t('codex_failed') }));
    }
  }
  write('');
  if (claudeReady) write(t('claude_connected'));
  if (codexVerdict?.installed?.enabled) write(t('codex_connected'));
  if (!claudeReady || (codexVerdict?.qualified && !codexVerdict.installed?.enabled)) {
    if (claudeReady || codexVerdict?.installed?.enabled) write('');
    const privacyKey = claudeReady || !clients.includes('claude') ? 'privacy_codex' : 'privacy_both';
    write(t(privacyKey, { privacy: PRIVACY_URL }));
    write('');
  }
  const agreed = [];
  let claudeDeclined = false;
  if (clients.includes('claude')) {
    const answer = claudeReady ? '' : await prompt(t('connect_claude'));
    if (claudeReady || !answer.trim() || affirmative(answer)) agreed.push('claude');
    else claudeDeclined = true;
  }
  let fallback = false;
  if (codexVerdict?.reason === 'codex_windows') write(t('codex_windows_skipped'));
  else if (codexVerdict) {
    if (!codexVerdict.qualified) {
      if (agreed.includes('claude')) write(t('codex_setup_skipped'));
      else {
        write(t('codex_fallback_disclosure'));
        if (affirmative(await prompt(t('connect_codex_mcp')))) {
          agreed.push('codex');
          fallback = true;
        }
      }
    } else if (codexVerdict.installed?.enabled || affirmative(await prompt(t(claudeReady ? 'connect_codex_shared' : 'connect_codex')))) {
      agreed.push('codex');
    }
  }
  if (!agreed.length) {
    write(t('clients_declined'));
    return 0;
  }
  let shared = agreed.includes('claude') && agreed.includes('codex') && !fallback;
  let authOptions = context.authOptions;
  const reauthorize = flags.includes('--reauthorize');
  let endpointChoice, forceClaude = false, forceCodex = false;
  const claudeEndpoint = context.validEndpoint(metadata?.inputs?.api_endpoint) ? metadata.inputs.api_endpoint : undefined;
  const codexEndpoint = codexCredential?.endpoint ?? codexVerdict?.endpoint;
  if (!reauthorize && ((agreed.includes('codex') && codexCredential?.token && endpointOverride) || (claudeReady && endpointOverride))) {
    throw new SetupError('endpoint_reauthorize', 2);
  }
  if (shared) {
    if (!reauthorize && metadata?.configured.includes('api_token') && !claudeReady) {
      throw new SetupError('credential_endpoint_unset', 2);
    }
    if (claudeEndpoint && codexEndpoint && claudeEndpoint !== codexEndpoint) {
      const explicitEndpoint = reauthorize && endpointOverride;
      if (!explicitEndpoint) {
        write('');
        write(t('endpoint_choices', { claude: new URL(claudeEndpoint).host, codex: new URL(codexEndpoint).host,
          reuse: t(codexCredential?.token ? 'endpoint_reuse_option' : 'endpoint_browser_option') }));
      }
      const choice = explicitEndpoint ? (endpointOverride === codexEndpoint ? '1' : '2') :
        (await prompt(t('ask_endpoint_choice'))).trim();
      if (!['1', '2'].includes(choice)) throw new SetupError('authorization_endpoint_conflict', 2);
      endpointChoice = explicitEndpoint || (choice === '1' ? codexEndpoint : claudeEndpoint);
      if (choice === '2' && codexVerdict.endpoint && codexVerdict.endpoint !== endpointChoice) {
        if (!codexVerdict.canSwitch) {
          write(t(codexVerdict.hasAuth ? 'endpoint_auth_blocked' : 'endpoint_version_blocked'));
          write(t('endpoint_remove_retry', { endpoint: endpointChoice }));
          return 2;
        }
        write(t('endpoint_mcp_switch', { host: new URL(endpointChoice).host }));
      }
      forceClaude = choice === '1';
      forceCodex = choice === '2';
    }
    if (flags.includes('--manual-token')) throw new SetupError('authorization_manual_unsupported', 2);
    if (reauthorize) write(t('reauthorize_hint'));
    await confirmStopped(context);
  }
  let identityPlan = shared ? await chooseIdentity(context) : undefined;
  if (identityPlan?.declined) {
    write(t('identity_declined'));
    agreed.splice(agreed.indexOf('codex'), 1);
    shared = false;
    identityPlan = undefined;
  }
  if (shared) {
    const stored = !reauthorize && !forceCodex && codexCredential?.token ? codexCredential : undefined;
    const endpoint = endpointChoice ?? endpointOverride ?? (reauthorize ? codexEndpoint ?? claudeEndpoint : claudeEndpoint ?? codexEndpoint);
    authOptions = { ...authOptions, authorization: await sharedAuthorization({ stored, endpoint, authOptions,
      signal: context.signal, replacesExisting: Boolean(reauthorize && codexCredential?.token) }) };
    if (claudeReady && !stored && !reauthorize && !forceClaude) write(t('codex_own_login'));
  }
  // Validate again after collecting answers, before the first host write.
  if (identityPlan) await assertIdentityUnchanged(identityPlan);
  if (codexVerdict?.verify) await codexVerdict.verify();
  context.progress.codexSelected = agreed.includes('codex');
  let code = 0;
  for (const client of agreed) {
    const forced = client === 'claude' ? forceClaude : forceCodex;
    const result = await call(client, { authOptions, pairingConsent: shared ? 'shared' : undefined,
      ...(shared || agreed.includes('claude') ? {} : { pairingConsent: 'standalone',
        claudeDeclined }), identityPlan,
      ...(endpointChoice && (forced || reauthorize) ? { endpointOverride: endpointChoice } : {}), endpointChoice,
      forceReauthorize: forced, expectedCodex: codexVerdict?.before, hostsStopped: shared });
    code = Math.max(code, result);
    if (result) break;
  }
  if (!code) {
    write('');
    if (shared) write(t('done_shared'));
    const next = shared ? (claudeReady && codexVerdict?.installed?.enabled ? 'next_reopen' : 'next_both') :
      agreed.includes('claude') ? 'claude_restart' : 'next_codex';
    write(t(next));
    if (agreed.includes('codex') && !fallback && !claudeReady) write(t('optional_mcp'));
  }
  return code;
}

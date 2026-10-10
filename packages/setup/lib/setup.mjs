import { parseOptions, selectEndpoint, validEndpoint } from './options.mjs';
export { validEndpoint } from './options.mjs';
import { detectLanguage, translator } from './messages.mjs';
import { dispatchClient, parseClient } from './codex.mjs';
import { terminalWriter, technical, wrapLine } from './output.mjs';
import { PRIVACY_URL } from './constants.mjs';
import { setupDetected } from './clients.mjs';
import { spawn } from 'node:child_process';
import { writeSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { release } from 'node:os';
import { performance } from 'node:perf_hooks';
import { SetupError, AuthError } from './errors.mjs';
import { browserAuthorize, credentialCheck, collectToken } from './auth.mjs';

const plugin = 'cairn-memory@cairn-memory';
const repository = 'Cairn-ink/cairn-memory';
const tokenURL = 'https://cairn.ink/settings/tokens';
const endpointDefault = 'https://cairn.ink';

const installerVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

export function supportedNode(version) {
  const [major, minor] = version.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 16);
}

// readline owns raw mode while active; every exit closes it and restores the TTY.
// Suppress ALL readline writes for a secret, including pasted text and redraws.
export async function ask(question, { secret = false, input = process.stdin, output = process.stdout, signal } = {}) {
  const visible = output;
  const hidden = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const rl = createInterface({ input, output: secret ? hidden : output, terminal: Boolean(input.isTTY) });
  if (secret) visible.write(question);
  try {
    return await new Promise((resolve, reject) => {
      let settled = false;
      const fail = (code = 1) => {
        if (settled) return;
        settled = true;
        reject(new SetupError('input_cancelled', code));
      };
      rl.once('SIGINT', () => { fail(130); rl.close(); });
      rl.once('close', () => fail());
      rl.question(secret ? '' : question, { signal }).then(value => { settled = true; resolve(value); }, () => fail());
    });
  } finally {
    rl.close();
    if (secret) visible.write('\n');
  }
}

function execute(command, args, { input, timeout = 120000, discard = false, signal } = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '', error;
    const terminate = () => { child.kill(); setTimeout(() => child.kill('SIGKILL'), 1000).unref(); };
    const abort = () => { error = new AuthError('interrupted'); terminate(); };
    const timer = setTimeout(() => { error = new Error('timeout'); terminate(); }, timeout);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const collect = target => chunk => {
      if (discard) return;
      if (target === 'stdout') stdout += chunk.toString('utf8');
      else stderr += chunk.toString('utf8');
      if (stdout.length + stderr.length > 4 * 1024 * 1024) {
        error = new Error('output_limit'); child.kill();
      }
    };
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));
    child.on('error', value => { error = value; });
    child.stdin.on('error', value => { error = value; });
    child.on('close', status => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve({ stdout, stderr, status, error }); });
    child.stdin.end(input, () => { if (Buffer.isBuffer(input)) input.fill(0); input = undefined; });
  });
}

function run(args, input) {
  // Never forward child output: MCP details, configure errors and even plugin
  // lists can contain credentials. Never put a token in argv or the environment.
  return execute('claude', args, { input });
}

function checked(result, args) {
  if (result.error?.code === 130) throw result.error;
  if (result.error || result.status !== 0) {
    const code = Number.isInteger(result.status) && result.status > 0 ? result.status : 1;
    throw new SetupError('command_failed', code, { client: 'claude', args: args.join(' '), code });
  }
  return result.stdout;
}

function json(result, args, isValid) {
  const value = checked(result, args);
  try {
    const parsed = JSON.parse(value);
    if (isValid(parsed)) return parsed;
  } catch { /* Never reproduce invalid output. */ }
  throw new SetupError('claude_state_error', 1, { args: args.join(' ') });
}

async function supports(args, pattern, runCLI = run) {
  const result = await runCLI([...args, '--help']);
  return !result.error && result.status === 0 && pattern.test(result.stdout);
}

function manual(write, t) {
  write(t('claude_manual'));
  write(t('manual_marketplace', { repository }));
  write(t('manual_install', { plugin }));
  configureInstructions(write, t);
}

function configureInstructions(write, t) {
  write(t('create_pat', { url: tokenURL }));
  write(t('manual_configure', { plugin }));
  write(t('configure_options'));
  write(t('configure_menu'));
}

async function oldMCP(runCLI = run) {
  const args = ['mcp', 'get', 'cairn'];
  const result = await runCLI(args);
  if (!result.error && result.status === 0) return true;
  // Absence is a specific CLI refusal, not every non-zero exit (auth/network
  // failures must remain failures). Both forms are used by supported CLI builds.
  if (!result.error && result.status === 1 &&
      /(?:No MCP server named "cairn"\.|No MCP server found with name: cairn(?:\r?\n|$))/u
        .test(`${result.stdout}\n${result.stderr}`)) return false;
  checked(result, args);
  return false;
}

async function configuration(runCLI = run, options) {
  const args = ['plugin', 'configure', plugin, '--json'];
  return json(await runCLI(args, undefined, options), args, value => value &&
    Array.isArray(value.configured) && Array.isArray(value.unconfigured));
}

async function installed(runCLI = run) {
  const args = ['plugin', 'list', '--json'];
  return json(await runCLI(args), args, Array.isArray).filter(value => value.id === plugin);
}

async function marketplaces(runCLI = run) {
  const args = ['plugin', 'marketplace', 'list', '--json'];
  return json(await runCLI(args), args, Array.isArray);
}

export function browserCommand(url, platform = process.platform, wsl = /microsoft/iu.test(release())) {
  return platform === 'darwin' ? ['open', [url]] :
    platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] :
    wsl ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]];
}

async function openBrowser(write, url, signal, t = translator(detectLanguage())) {
  const command = browserCommand(url);
  const result = await execute(command[0], command[1], { discard: true, timeout: 10000, signal });
  if (result.error || result.status !== 0) write(t('open_manually', { url }));
}

export async function main(argv, {
  write = line => writeSync(1, `${line}\n`), prompt = ask,
  interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY),
  browse = openBrowser, nodeVersion = process.versions.node, authOptions = {},
  env = process.env, locale = Intl.DateTimeFormat().resolvedOptions().locale,
  coordinated = false, pairingConsent, inspectCodex, identityPlan, endpointChoice,
  forceReauthorize = false, expectedCodex, hostsStopped, progress = {},
} = {}) {
  const rawWrite = write;
  const rawPrompt = prompt;
  prompt = (question, options) => rawPrompt(wrapLine(String(question)).join("\n"), options);
  write = terminalWriter(rawWrite);
  let t = translator(detectLanguage(env, locale));
  let verbose = false;
  const launchBrowser = (write, url, signal) => browse(write, url, signal, t);
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on('SIGINT', interrupt);
  const signal = controller.signal;
  const run = (args, input, options) => execute('claude', args, { input, signal, ...options });
  const now = authOptions.now ?? (() => performance.now());
  const save = async (values, timeout) => {
    const args = ['plugin', 'configure', plugin, '--values-stdin'];
    let input = Buffer.from(JSON.stringify(values));
    const deadline = now() + (timeout ?? 120000);
    values.api_token = undefined;
    try {
      checked(await run(args, input, { timeout, discard: true }), args);
      progress.claudeConfigured = true;
      const saved = await configuration(run, { timeout: Math.max(1, deadline - now()) });
      if (!['api_endpoint', 'api_token'].every(key => saved.configured.includes(key))) {
        throw new SetupError('configuration_incomplete');
      }
    } finally { input.fill(0); input = undefined; }
  };
  try {
    const options = parseOptions(argv);
    if (options.lang) t = translator(options.lang);
    const endpointOverride = options.endpoint;
    verbose = options.verbose;
    const translate = t;
    t = (key, params) => technical.has(key) && !verbose && !options.argv.includes('--dry-run') ? undefined : translate(key, params);
    t.locale = translate.locale;
    if (forceReauthorize && !options.argv.includes('--reauthorize')) options.argv.push('--reauthorize');
    const selection = parseClient(options.argv, SetupError);
    if (options.captureExec !== undefined && selection.client === 'claude') throw new SetupError('invalid_exec_setting', 2);
    if (options.dailyCap !== undefined && selection.client === 'claude') throw new SetupError('invalid_cap', 2);
    if (!coordinated && ['setup', 'status'].includes(selection.argv[0]))
      write(t(selection.argv[0] === 'status' ? 'status_header' : 'installer_version', { version: installerVersion }));
    if (!coordinated && !selection.client && ['setup', 'status'].includes(selection.argv[0])) {
      return await setupDetected(selection.argv, { write, prompt, interactive, browse, nodeVersion,
        authOptions, env, locale, t, endpointOverride, dailyCap:options.dailyCap, captureExec:options.captureExec, verbose, progress, signal, supportedNode, SetupError, validEndpoint, inspectCodex,
        inspectClaude: async () => (await installed(run)).length ? configuration(run) : undefined,
        runClient: (args, overrides) => main(args, { write, prompt, interactive, browse, nodeVersion,
          authOptions, env, locale, progress, coordinated: true, ...overrides }) });
    }
    const dispatch = await dispatchClient(options.argv, { write, prompt, interactive, browse: launchBrowser,
      nodeVersion, supportedNode, SetupError, validEndpoint, t, endpointOverride, dailyCap:options.dailyCap, captureExec:options.captureExec, verbose, authOptions, signal, pairingConsent,
      identityPlan, endpointChoice, expectedCodex, hostsStopped, coordinated, progress });
    if (dispatch.handled) return dispatch.code;
    argv = dispatch.argv;
    const [action, ...flags] = argv;
    if (action === '--help' || action === '-h' || action === undefined) {
      write(t('help'));
      return 0;
    }
    if (!['setup', 'status'].includes(action) ||
        flags.some(flag => !['--dry-run', '--no-browser', '--manual-token', '--reauthorize', '--no-clipboard'].includes(flag)) ||
        (action === 'status' && flags.length)) {
      throw new SetupError('unknown_command', 2);
    }
    if (!supportedNode(nodeVersion)) {
      throw new SetupError('node_required');
    }
    if (!coordinated && action === 'setup') {write('');write(t('privacy_both',{privacy:PRIVACY_URL}));}
    const version = await run(['--version']);
    if (version.error?.code === 'ENOENT') {
      throw new SetupError('claude_missing');
    }
    checked(version, ['--version']);
    write(t('claude_available'));

    const canInstall = await supports(['plugin', 'marketplace', 'add'], /Usage: claude plugin marketplace add\b/u, run) &&
      await supports(['plugin', 'install'], /Usage: claude plugin install\b/u, run);
    const canList = await supports(['plugin', 'list'], /--json\b/u, run) &&
      await supports(['plugin', 'marketplace', 'list'], /--json\b/u, run);
    const canConfigure = await supports(['plugin', 'configure'], /--values-stdin\b/u, run) &&
      await supports(['plugin', 'configure'], /--json\b/u, run);

    if (action === 'status') {
      if (!canList) throw new SetupError('claude_list_required');
      write('Claude Code');
      if (verbose) write(t('marketplace_status', { state: (await marketplaces(run)).some(value => value.name === 'cairn-memory') ? t('added') : t('absent') }));
      const entries = await installed(run);
      if (!entries.length) write(t('plugin_absent'));
      for (const entry of entries) {
        if (entry.errors?.length) throw new SetupError('plugin_load_error');
        write(entry.enabled === true ? t('plugin_status', { version: entry.version, state: t('enabled') }) : t('disabled'));
        if (verbose) write(t('option_status',{key:'scope',state:['user','project','local','managed'].includes(entry.scope)?entry.scope:t('unknown')}));
      }
      if (entries.length && canConfigure) {
        const config = await configuration(run);
        write(t(['api_endpoint','api_token'].every(key=>config.configured.includes(key))?'signin_saved':'signin_missing'));
      } else if (entries.length) write(t('configuration_unavailable'));
      if (await oldMCP(run)) write(t('legacy_present'));
      write(t('claude_status_tip'));
      if (!coordinated) {write('');write(t('status_unverified'));}
      return 0;
    }

    if (flags.includes('--dry-run')) {
      write(t('dry_run'));
      write(t(endpointOverride ? 'endpoint_flag' : 'endpoint_default', { endpoint: endpointOverride ?? endpointDefault }));
      write(t('dry_checks'));
      write(t('dry_marketplace', { repository }));
      write(t('dry_plugin', { plugin }));
      write(t('dry_authorize'));
      write(canConfigure ? t('dry_configure', { plugin }) :
        t('dry_manual'));
      write(t('dry_remove'));
      write(t('dry_restart'));
      if (!canInstall) manual(write, t);
      else if (canList) {
        write(t('marketplace_status', { state: (await marketplaces(run)).some(value => value.name === 'cairn-memory') ? t('added') : t('absent') }));
        write(t('plugin_presence', { state: (await installed(run)).length ? t('installed') : t('absent') }));
      }
      write(t('dry_legacy'));
      return 0;
    }
    if (!interactive) throw new SetupError('tty_required', 2);
    if (!canInstall) {
      write(t('claude_manual_required'));
      manual(write, t);
      return 1;
    }
    if (!canList || !canConfigure) {
      manual(write, t);
      throw new SetupError('claude_capabilities_required');
    }
    const marketplaceExists = (await marketplaces(run)).some(value => value.name === 'cairn-memory');
    const previous = await installed(run);
    const updateScopes = [...new Set(previous.map(entry => entry.scope))].filter(scope => ['user', 'project', 'local'].includes(scope));
    if (marketplaceExists && !await supports(['plugin', 'marketplace', 'update'], /Usage: claude plugin marketplace update\b/u, run)) {
      throw new SetupError('marketplace_update_required');
    }
    if (updateScopes.length && !await supports(['plugin', 'update'], /Usage: claude plugin update\b/u, run)) {
      throw new SetupError('plugin_update_required');
    }
    const existingMCP = await oldMCP(run);
    const removeLegacy = existingMCP && interactive && /^(?:y|yes)$/iu.test((await prompt(t('legacy_prompt'))).trim());
    const marketplaceArgs = marketplaceExists ? ['plugin', 'marketplace', 'update', 'cairn-memory'] :
      ['plugin', 'marketplace', 'add', repository];
    checked(await run(marketplaceArgs), marketplaceArgs);
    progress.claudePluginInstalled = true;
    write(t('marketplace_ready'));
    const userInstalled = previous.some(entry => entry.scope === 'user');
    for (const scope of updateScopes) {
      const updateArgs = ['plugin', 'update', plugin, '--scope', scope];
      checked(await run(updateArgs), updateArgs);
    }
    if (!userInstalled) {
      const installArgs = ['plugin', 'install', plugin, '--scope', 'user'];
      checked(await run(installArgs), installArgs);
    }
    const entries = await installed(run);
    if (!entries.some(entry => entry.scope === 'user') || entries.some(entry => entry.errors?.length)) {
      throw new SetupError('plugin_unconfirmed');
    }
    for (const entry of entries) {
      const version = typeof entry.version === 'string' && /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u.test(entry.version) ? entry.version : null;
      if (!version) throw new SetupError('plugin_version_unconfirmed');
      const oldVersion = previous.find(value => value.scope === entry.scope)?.version;
      write(t(!oldVersion ? 'plugin_version' : oldVersion === version ? 'plugin_current' : 'plugin_updated', { version }));
    }
    if (!entries.every(entry => entry.enabled === true)) {
      write(t('plugin_disabled'));
      return 0;
    }
    const config = await configuration(run);
    let ready = ['api_endpoint', 'api_token'].every(key => config.configured.includes(key));
    const configuredEndpoint = validEndpoint(config.inputs?.api_endpoint) ? config.inputs.api_endpoint : undefined;
    if (!flags.includes('--reauthorize') && configuredEndpoint && endpointOverride && endpointOverride !== configuredEndpoint) {
      throw new SetupError('endpoint_reauthorize', 2);
    }
    if (ready && !flags.includes('--reauthorize')) {
      if (endpointOverride) throw new SetupError('endpoint_reauthorize', 2);
      write(t('credential_kept'));
    } else if (!ready && config.configured.includes('api_token') && !flags.includes('--reauthorize')) {
      throw new SetupError('credential_endpoint_unset');
    } else {
      const endpoint = await selectEndpoint({ endpointOverride, existingEndpoint:
        (!flags.includes('--reauthorize') ? configuredEndpoint : undefined) ?? authOptions.authorization?.endpoint, prompt, write, t });
      progress.endpoint = endpoint;
      let manualToken = flags.includes('--manual-token');
      if (!manualToken) {
        const authorization = await browserAuthorize(endpoint, { ...authOptions, write, browse: launchBrowser, t,
          noBrowser: flags.includes('--no-browser'), noClipboard: flags.includes('--no-clipboard'), prompt, save, signal });
        if (authorization.unsupported) {
          write(t('browser_unsupported'));
          manualToken = true;
        } else {
          if (!authorization.reported) write(t(flags.includes('--reauthorize') ? 'login_replaced' : 'connected_expiry', { date: new Date(authorization.expiresAt).toLocaleDateString(t.locale) }));
          if (flags.includes('--reauthorize') && !authorization.reported) write(t('credential_replaced',{url:new URL('/settings/tokens',endpoint).href.replace(/^https?:\/\//u,'')}));
        }
      }
      if (manualToken) {
        let token;
        try {
          const url = new URL('/settings/tokens', endpoint).href;
          write(t('create_pat', { url }));
          if (!flags.includes('--no-browser')) await launchBrowser(write, url, signal);
          token = await collectToken({prompt,write,t});
          const checkedCredential = await credentialCheck(endpoint, token, { ...authOptions, signal });
          await save({ api_endpoint: endpoint, api_token: token });
          if (!checkedCredential) write(t('manual_unverified'));
          else write(checkedCredential.expires_at ?
            t('manual_expiry', { date: new Date(checkedCredential.expires_at).toLocaleDateString(t.locale) }) :
            t('manual_no_expiry'));
        } finally { token = undefined; }
      }
      ready = true;
    }

    if (existingMCP && ready && interactive) {
      if (removeLegacy) {
        const args = ['mcp', 'remove', 'cairn'];
        checked(await run(args), args);
        write(t('legacy_removed'));
      } else write(t('legacy_kept'));
    } else if (existingMCP) {
      write(t('legacy_pending'));
      write(t('legacy_remove_command'));
    }
    if (!coordinated) write(t('claude_restart'));
    return 0;
  } catch (error) {
    // Unexpected exceptions may embed secret-bearing child data: do not log them.
    if (error.language) t = translator(error.language);
    if (signal.aborted) error = new AuthError('interrupted');
    write(error instanceof SetupError ? t(error.key, {...error.params, client:error.params.client === 'claude'?'Claude Code':error.params.client === 'codex'?'Codex':error.params.client}) : t('setup_failed'));
    if (!error.presented) {
      const changes = ['runtime','credential','config','install','hooks'].filter(key=>progress[key]).map(key=>t('progress_'+key));
      if (changes.length) write(t('progress_codex',{changes:changes.join(t.locale==='zh-TW'?'、':', ')}));
      if (progress.claudeConfigured) write(t(progress.codexSelected?'progress_claude_configured':'progress_claude_only'));
      else if (progress.claudePluginInstalled) write(t('progress_claude_plugin'));
      else if (!changes.length) write(t('nothing_changed'));
      write(t(error.kind==='network'?'recovery_network':error.kind==='server'||error.kind==='rate_limited'?'recovery_server':error.kind==='active_token_limit'?'recovery_tokens':error.kind==='ack_unknown'?'recovery_ack':['configure','credential','failed_revoked'].includes(error.kind)||['authorization_credential_unavailable','credential_endpoint_unset'].includes(error.key)?'recovery_reauthorize':error.kind==='access_denied'||error.kind==='timeout'||error.kind==='expired_token'?'retry_setup':error.key==='codex_lock'?'lock_retry':['authorization_endpoint_conflict','identity_conflict'].includes(error.key)?'conflict_retry':error.key==='tty_required'?'retry_setup':'error_details',{url:new URL('/settings/tokens',authOptions.authorization?.endpoint??progress.endpoint??'https://cairn.ink').href}));
      if (verbose && error.params?.phase) write(t('phase_details',error.params));
      if (verbose && error.key==='command_failed') write(t('command_details',error.params));
    }
    return error instanceof SetupError ? error.code : 1;
  } finally { process.off('SIGINT', interrupt); }
}

import { selectEndpoint } from './options.mjs';
import { constants, accessSync } from 'node:fs';
import { lstat, mkdir, open, readFile, rename, rm, mkdtemp, realpath } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join, resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { resolveCLI, qualifyBinary, cachedQualification } from '../runtime/integrations/codex/qualification.mjs';
import { readInstallation, readCredential } from '../runtime/integrations/codex/installed-state.mjs';
import { setupInstalledCodex, installedStatus, controlCodex } from './codex-runtime.mjs';

// Keep routing and all Codex behavior here; browser authorization can supply
// credentials at the prompt seam without changing the config transaction.
export function parseClient(argv, SetupError) {
  const remaining = [];
  let client;
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] !== '--client') { remaining.push(argv[index]); continue; }
    const value = argv[++index];
    if (client || !['claude', 'codex'].includes(value)) {
      throw new SetupError('client_invalid', 2);
    }
    client = value;
  }
  return { argv: remaining, client };
}

export function availableClient(name) {
  const extensions = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  return (process.env.PATH || '').split(delimiter).some(directory => extensions.some(extension => {
    try { accessSync(join(directory || '.', name + extension), constants.X_OK); return true; }
    catch { return false; }
  }));
}

export async function dispatchClient(argv, context) {
  const selection = parseClient(argv, context.SetupError);
  const [action, ...flags] = selection.argv;
  if (action === undefined || ['--help', '-h'].includes(action)) {
    if (selection.client === 'codex' || availableClient('codex')) context.write(context.t('client_help'));
    return { handled: false, argv: selection.argv };
  }
  if (selection.client !== 'codex' && (selection.client || availableClient('claude') || !availableClient('codex'))) {
    return { handled: false, argv: selection.argv };
  }
  if (!['setup', 'status','disable','uninstall','pause','resume','prompt-recall-off','prompt-recall-on'].includes(action) || flags.some(flag =>
      !['--dry-run', '--no-browser', '--no-clipboard','--manual-token','--reauthorize'].includes(flag)) ||
      (action !== 'setup' && flags.length)) {
    throw new context.SetupError('codex_unknown', 2);
  }
  if (!context.supportedNode(context.nodeVersion)) {
    throw new context.SetupError('node_required');
  }
  try {
    return { handled: true, code: await setupCodex({ ...context, action, flags }) };
  } catch (error) {
    if (error instanceof context.SetupError) throw error;
    throw new context.SetupError('codex_failed');
  }
}

function fallback(write, t) {
  write(t('interactive_retry'));
  write(t('codex_retry_command'));
  write(t('codex_env_fallback'));
  write(t('codex_env_command'));
  write(t('codex_env_explanation'));
}

function automaticStatus(write, t) {
  write(t('codex_automatic'));
  write(t('codex_explicit_only'));
}

async function snapshot(path) {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 ||
        (process.getuid && stat.uid !== process.getuid()) || (stat.mode & 0o022)) throw new Error('unsafe_config');
    return { text: await readFile(path, 'utf8'), stat };
  } catch (error) {
    if (error.code === 'ENOENT') return { text: '', stat: null };
    throw error;
  }
}

function unchanged(before, after) {
  return before.text === after.text && (before.stat === null ? after.stat === null :
    after.stat !== null && ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(key => before.stat[key] === after.stat[key]));
}

async function privateWrite(path, text) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(text, 'utf8'); await file.sync(); }
  finally { await file.close(); }
}

function runCodex(args, { env = process.env, cwd } = {}) {
  return new Promise(resolveResult => {
    const child = spawn('codex', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env, cwd });
    let stdout = '', stderr = '', error, escalation;
    const stop = () => {
      child.kill();
      escalation ??= setTimeout(() => child.kill('SIGKILL'), 1000);
    };
    const timer = setTimeout(() => { error = new Error('timeout'); stop(); }, 15000);
    for (const stream of ['stdout', 'stderr']) child[stream].on('data', chunk => {
      if (stream === 'stdout') stdout += chunk.toString('utf8'); else stderr += chunk.toString('utf8');
      if (stdout.length + stderr.length > 4 * 1024 * 1024) { error = new Error('output_limit'); stop(); }
    });
    child.on('error', value => { error = value; });
    child.on('close', status => {
      clearTimeout(timer); clearTimeout(escalation);
      resolveResult({ stdout, stderr, status, error });
    });
  });
}

export async function setupCodex({ action, flags, write, prompt, interactive, browse,
  SetupError, validEndpoint, t, endpointOverride, authOptions, signal, inspectOnly = false, pairingConsent }) {
  const fail = message => new SetupError(message);
  if (process.platform === 'win32') {
    if (inspectOnly) return { qualified: false, reason: 'codex_windows' };
    write(t('codex_windows'));
    fallback(write, t); automaticStatus(write, t); return 0;
  }
  const home = resolve(process.env.CODEX_HOME || join(homedir(), '.codex'));
  if (action === 'setup' && !flags.includes('--dry-run') && endpointOverride && !flags.includes('--reauthorize')) {
    const path = join(home, 'cairn/installation.json');
    const previous = await readInstallation(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (previous && await readCredential(path, previous.endpoint).then(() => true, () => false)) {
      throw new SetupError('endpoint_reauthorize', 2);
    }
  }
  if (['disable','uninstall','pause','resume','prompt-recall-off','prompt-recall-on'].includes(action)) {
    const neutral = await realpath(await mkdtemp(join(tmpdir(), 'cairn-codex-control-')));
    try {return await controlCodex({action,home,write,t,snapshot,unchanged,neutral});}
    finally {await rm(neutral,{recursive:true,force:true});}
  }
  const configPath = join(home, 'config.toml');
  let before;
  try { before = await snapshot(configPath); }
  catch (error) {
    if (error.message === 'unsafe_config') throw new SetupError('codex_config_unsafe');
    throw new SetupError('codex_state_error');
  }
  // Inspect only a copy of the user's file. No trusted-project layer or OAuth
  // discovery participates in the decision to create a full entry or add a header.
  const neutral = await realpath(await mkdtemp(join(tmpdir(), 'cairn-codex-inspect-')));
  try {
    for (let directory = neutral; ; directory = dirname(directory)) {
      try {
        await lstat(join(directory, '.codex', 'config.toml'));
        throw fail('codex_tmpdir');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (directory === dirname(directory)) break;
    }
    // System-managed overlays would also break the user-file-only guarantee.
    for (const path of ['/etc/codex/config.toml', '/etc/codex/managed_config.toml']) {
      try {
        await lstat(path);
        throw fail('codex_managed');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const inspectionHome = join(neutral, 'user-file');
    await mkdir(inspectionHome, { mode: 0o700 });
    if (before.stat) await privateWrite(join(inspectionHome, 'config.toml'), before.text);
    const cliPath = process.env.PATH?.split(delimiter).map(directory => resolve(directory || '.')).join(delimiter);
    const run = (args, options = {}) => runCodex(args, {
      cwd: neutral, ...options,
      env: { ...process.env, CODEX_HOME: inspectionHome, ...options.env, ...(cliPath === undefined ? {} : { PATH: cliPath }) },
    });
    const checked = (result, args) => {
      if (result.error || result.status !== 0) {
        const code = Number.isInteger(result.status) && result.status > 0 ? result.status : 1;
        throw new SetupError('command_failed', code, { client: 'codex', args: args.join(' '), code });
      }
      return result.stdout;
    };
    const json = (result, args, valid) => {
      const output = checked(result, args);
      try { const value = JSON.parse(output); if (valid(value)) return value; } catch { /* secret-bearing output stays private */ }
      throw fail('codex_state_error');
    };
    const supports = async (args, pattern) => {
      const result = await run([...args, '--help']);
      return !result.error && result.status === 0 && pattern.test(result.stdout);
    };
    const version = await run(['--version']);
    if (version.error?.code === 'ENOENT') throw fail('codex_missing');
    checked(version, ['--version']);
    const hostVersion = version.stdout.trim().replace(/^codex-cli /u,'');
    write(t('codex_available'));
    if (!await supports(['mcp', 'add'], /--url\b/u) ||
        !await supports(['mcp', 'get'], /--json\b/u)) {
      write(t('codex_update_required'));
      if (inspectOnly) return { qualified: false };
      fallback(write, t); automaticStatus(write, t); return 0;
    }
    const getArgs = ['mcp', 'get', 'cairn', '--json'];
    const get = async (options, allowAbsent = false) => {
      const result = await run(getArgs, options);
      if (allowAbsent && !result.error && result.status === 1 &&
          /(?:^|\n)(?:Error: )?No MCP server named 'cairn' found\.(?:\r?\n|$)/u.test(result.stderr)) return null;
      return json(result, getArgs, value => value && value.name === 'cairn' &&
        typeof value.enabled === 'boolean' && value.transport && typeof value.transport.type === 'string');
    };
    const existing = await get(undefined, true);
    const present = Boolean(existing);
    const transport = existing?.transport;
    const validURL = value => typeof value === 'string' && value.endsWith('/api/mcp') && validEndpoint(value.slice(0, -8));
    const header = transport?.http_headers?.Authorization;
    const envName = transport?.bearer_token_env_var || transport?.env_http_headers?.Authorization;
    const hasHeader = typeof header === 'string' && /^Bearer [^\s\x00-\x1f\x7f]+$/u.test(header);
    const credential = hasHeader || (typeof envName === 'string' && Boolean(process.env[envName]));
    const usable = transport?.type === 'streamable_http' && validURL(transport.url);
    write(t('codex_user_status', { state: present ? t('configured') : t('absent') }));
    if (present) {
      write(t('codex_connection', { state: usable ? t('compatible_endpoint') : t('inspect_config') }));
      write(t('codex_enabled', { state: existing.enabled ? t('enabled') : t('disabled') }));
      write(t('codex_credential', { state: credential ? t('configured') : t('unverified') }));
    }
    if (!flags.includes('--dry-run') && endpointOverride && usable && endpointOverride !== new URL(transport.url).origin) {
      throw new SetupError('codex_endpoint_conflict', 2);
    }
    if (endpointOverride || usable) {
      write(t(endpointOverride ? 'endpoint_flag' : 'endpoint_config', {
        endpoint: endpointOverride ?? new URL(transport.url).origin,
      }));
    } else if (!existing && (action === 'status' || flags.includes('--dry-run') || !interactive)) {
      write(t('endpoint_default', { endpoint: 'https://cairn.ink' }));
    }
    const cliHost=await resolveCLI();
    const installation=join(home,'cairn','installation.json');
    const installed=await readInstallation(installation).then(()=>true,()=>false);
    const hostVerdict=cliHost ? action==='status' && !installed ? await cachedQualification(installation,cliHost) :
      await qualifyBinary(installation,cliHost,{cache:!inspectOnly && !flags.includes('--dry-run')}) : {status:'pending'};
    if (inspectOnly) return { qualified: hostVerdict.status==='qualified' && hostVerdict.version===hostVersion,
      endpoint: usable ? new URL(transport.url).origin : undefined };
    if (hostVerdict.status==='qualified' && hostVerdict.version===hostVersion) {
      return await setupInstalledCodex({action,flags,home,hostVersion,write,prompt,interactive,browse,
        SetupError,t,endpointOverride,authOptions,signal,before,configPath,existing,usable,
        neutral,get,snapshot,unchanged,cliHost,hostVerdict,pairingConsent});
    }
    // Changed or unavailable format evidence keeps automatic paths closed.
    // Status reports the actual observed app-server separately from this CLI.
    await installedStatus({home,hostVersion,write,t,snapshot,cliHost,hostVerdict});
    if (action === 'status' || flags.includes('--dry-run')) {
      if (flags.includes('--dry-run')) {
        write(t('dry_run'));
        write(t('codex_dry_token'));
        write(t('codex_preserve'));
      }
      automaticStatus(write, t);
      write(t('dry_unverified'));
      return 0;
    }
    if (existing && (!usable || !existing.enabled || (!credential &&
        (envName || transport.http_headers_helper || Object.keys(transport.http_headers || {}).length ||
          Object.keys(transport.env_http_headers || {}).length)))) {
      write(t('codex_repair'));
      automaticStatus(write, t); return 0;
    }
    if (credential && usable) {
      write(t('codex_credential_kept'));
      automaticStatus(write, t); return 0;
    }
    if (existing) {
      write(t('codex_oauth'));
      write(t('codex_neutral'));
      write(t('codex_login_command'));
      if (!interactive || (await prompt(t('codex_oauth_prompt'))).trim().toLowerCase() !== 'pat') {
        write(t('codex_login_kept'));
        automaticStatus(write, t); return 0;
      }
    }
    if (!interactive) {
      write(t('codex_pending'));
      fallback(write, t); automaticStatus(write, t); return 0;
    }
    await mkdir(home, { recursive: true, mode: 0o700 });
    const homeStat = await lstat(home);
    if (!homeStat.isDirectory() || homeStat.isSymbolicLink() ||
        (process.getuid && homeStat.uid !== process.getuid()) || (homeStat.mode & 0o022)) {
      throw fail('codex_directory');
    }
    const endpoint = await selectEndpoint({ endpointOverride, existingEndpoint: existing ? transport.url.slice(0, -8) : undefined,
      prompt, write: existing || endpointOverride ? () => {} : write, t });
    // No secrets in argv/env. Native Codex TOML parsing validates the whole candidate
    // in a private isolated CODEX_HOME before atomically replacing the user's file.
    const candidate = token => before.text + (before.text ? (before.text.endsWith('\n') ? '\n' : '\n\n') : '') +
      (existing ? '[mcp_servers.cairn.http_headers]\n' :
        `[mcp_servers.cairn]\nurl = ${JSON.stringify(endpoint + '/api/mcp')}\n[mcp_servers.cairn.http_headers]\n`) +
      `Authorization = ${JSON.stringify('Bearer ' + token)}\n`;
    const validationHome = await mkdtemp(join(home, '.cairn-validate-'));
    const candidatePath = join(validationHome, 'config.toml');
    const validate = async token => {
      await privateWrite(candidatePath, candidate(token));
      try {
        const saved = await get({ env: { ...process.env, CODEX_HOME: validationHome } });
        if (!saved.enabled || saved.transport.type !== 'streamable_http' ||
            saved.transport.url !== endpoint + '/api/mcp' || saved.transport.http_headers?.Authorization !== 'Bearer ' + token) {
          throw fail('codex_candidate');
        }
      } finally { await rm(candidatePath, { force: true }); }
    };
    let lock, stage;
    const lockPath = join(home, '.cairn-setup.lock');
    try {
      await validate('cairn-synthetic-config-check');
      write(t('codex_endpoint_save', { url: endpoint + '/api/mcp' }));
      write(t('codex_plaintext'));
      write(t('create_pat', { url: new URL('/settings/tokens', endpoint).href }));
      if (!flags.includes('--no-browser')) await browse(write, new URL('/settings/tokens', endpoint).href);
      const token = await prompt(t('token_prompt'), { secret: true });
      if (!token || token.length > 8192 || /[\s\x00-\x1f\x7f]/u.test(token)) throw fail('token_invalid');
      await validate(token);
      try { lock = await open(lockPath, 'wx', 0o600); }
      catch (error) {
        if (error.code === 'EEXIST') throw fail('codex_lock');
        throw error;
      }
      if (!unchanged(before, await snapshot(configPath))) throw fail('codex_concurrent');
      stage = join(home, `.cairn-config-${process.pid}-${Date.now()}.tmp`);
      await privateWrite(stage, candidate(token));
      if (!unchanged(before, await snapshot(configPath))) throw fail('codex_changed');
      await rename(stage, configPath); stage = null;
      const saved = await get({ env: { ...process.env, CODEX_HOME: home } });
      if (!saved.enabled || saved.transport.url !== endpoint + '/api/mcp' ||
          saved.transport.http_headers?.Authorization !== 'Bearer ' + token) {
        throw fail('codex_saved_unverified');
      }
      write(t('codex_saved'));
    } finally {
      if (stage) await rm(stage, { force: true });
      if (lock) { await lock.close(); await rm(lockPath); }
      await rm(validationHome, { recursive: true, force: true });
    }
    automaticStatus(write, t);
    write(t('codex_restart'));
    return 0;
  } finally { await rm(neutral, { recursive: true, force: true }); }
}

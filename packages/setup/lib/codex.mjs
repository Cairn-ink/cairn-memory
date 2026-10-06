import { constants, accessSync } from 'node:fs';
import { lstat, mkdir, open, readFile, rename, rm, mkdtemp, realpath } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join, resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';

const tokenURL = 'https://cairn.ink/settings/tokens';

// Keep routing and all Codex behavior here; browser authorization can supply
// credentials at the prompt seam without changing the config transaction.
export function parseClient(argv, SetupError) {
  const remaining = [];
  let client;
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] !== '--client') { remaining.push(argv[index]); continue; }
    const value = argv[++index];
    if (client || !['claude', 'codex'].includes(value)) {
      throw new SetupError('無效 client 選項 / Invalid client option. Use --client claude or --client codex.', 2);
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
    if (selection.client === 'codex' || availableClient('codex')) context.write('Client: --client claude|codex（setup 與 status）；只有 Codex 時自動選用 / Auto-detect Codex when Claude is absent.');
    return { handled: false, argv: selection.argv };
  }
  if (selection.client !== 'codex' && (selection.client || availableClient('claude') || !availableClient('codex'))) {
    return { handled: false, argv: selection.argv };
  }
  if (!['setup', 'status'].includes(action) || flags.some(flag => !['--dry-run', '--no-browser'].includes(flag)) ||
      (action === 'status' && flags.length)) {
    throw new context.SetupError('未知 Codex 指令或選項 / Unknown Codex command or option. Use --help.', 2);
  }
  if (!context.supportedNode(context.nodeVersion)) {
    throw new context.SetupError('需要 Node.js ≥22.16 / Node.js ≥22.16 is required. Upgrade Node and retry.');
  }
  try {
    return { handled: true, code: await setupCodex({ ...context, action, flags }) };
  } catch (error) {
    if (error instanceof context.SetupError) throw error;
    throw new context.SetupError('Codex 設定失敗；請檢查設定檔的 owner、權限與格式後重跑 / Codex setup failed; inspect config ownership, permissions and format, then retry.');
  }
}

function fallback(write) {
  write('請在互動終端機重跑 / Retry in an interactive terminal:');
  write('npx @cairn-ink/memory setup --client codex');
  write('或用 Codex 的 bearer-token-env-var，從你管理的安全環境載入 PAT / Or load a PAT from your managed secure environment:');
  write('codex mcp add cairn --url https://cairn.ink/api/mcp --bearer-token-env-var CAIRN_MCP_TOKEN');
  write('這個命令只設定環境變數名稱，不會保存 PAT；每次啟動 Codex 都需載入該環境 / This stores the variable name only; load it whenever Codex starts.');
}

function automaticStatus(write) {
  write('Codex 自動擷取與自動回憶：尚未接線 / Automatic capture and recall: not yet wired.');
  write('MCP 可供明確 remember／recall；完整自動記憶仍需 CX-5 與新版 transcript 驗證 / Use explicit MCP remember/recall; automatic memory needs CX-5 and current transcript qualification.');
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
  SetupError, validEndpoint }) {
  const fail = message => new SetupError(message);
  if (process.platform === 'win32') {
    write('此安裝器尚未驗證 Windows 憑證檔權限 / Windows credential-file permissions are not qualified.');
    fallback(write); automaticStatus(write); return 0;
  }
  const home = resolve(process.env.CODEX_HOME || join(homedir(), '.codex'));
  const configPath = join(home, 'config.toml');
  const before = await snapshot(configPath);
  // Inspect only a copy of the user's file. No trusted-project layer or OAuth
  // discovery participates in the decision to create a full entry or add a header.
  const neutral = await realpath(await mkdtemp(join(tmpdir(), 'cairn-codex-inspect-')));
  try {
    for (let directory = neutral; ; directory = dirname(directory)) {
      try {
        await lstat(join(directory, '.codex', 'config.toml'));
        throw fail('暫存目錄位於 Codex 專案設定下；請將 TMPDIR 設為中立目錄 / TMPDIR has ancestor project config; choose a neutral temporary directory.');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (directory === dirname(directory)) break;
    }
    // System-managed overlays would also break the user-file-only guarantee.
    for (const path of ['/etc/codex/config.toml', '/etc/codex/managed_config.toml']) {
      try {
        await lstat(path);
        throw fail('存在系統管理設定，請手動設定 Cairn / System-managed Codex config exists; configure Cairn manually.');
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
        throw new SetupError(`指令失敗 / Command failed: codex ${args.join(' ')} (exit ${code}).`, code);
      }
      return result.stdout;
    };
    const json = (result, args, valid) => {
      const output = checked(result, args);
      try { const value = JSON.parse(output); if (valid(value)) return value; } catch { /* secret-bearing output stays private */ }
      throw fail('無法解析 Codex 狀態 / Cannot read Codex CLI state.');
    };
    const supports = async (args, pattern) => {
      const result = await run([...args, '--help']);
      return !result.error && result.status === 0 && pattern.test(result.stdout);
    };
    const version = await run(['--version']);
    if (version.error?.code === 'ENOENT') throw fail('找不到 codex CLI / codex CLI not found on PATH. Install Codex CLI, then retry.');
    checked(version, ['--version']);
    write('Node.js 與 Codex CLI 可用 / Node.js and Codex CLI are available.');
    if (!await supports(['mcp', 'add'], /--url\b/u) ||
        !await supports(['mcp', 'get'], /--json\b/u)) {
      write('此 Codex CLI 無法安全確認 HTTP MCP 設定 / This CLI cannot verify HTTP MCP configuration. Update Codex CLI.');
      fallback(write); automaticStatus(write); return 0;
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
    write(`User-level MCP cairn: ${present ? '已設定 / configured' : '未設定 / absent'}`);
    if (present) {
      write(`Connection: ${usable ? 'HTTP endpoint 格式符合 / compatible HTTP endpoint' : '既有設定需手動檢查 / inspect existing configuration'}`);
      write(`Enabled: ${existing.enabled ? '已啟用 / enabled' : '停用 / disabled'}`);
      write(`Credential: ${credential ? '已設定 / configured' : '尚未確認 / unverified'}`);
    }
    if (action === 'status' || flags.includes('--dry-run')) {
      if (flags.includes('--dry-run')) {
        write('預演：只檢查，不修改 / Dry run: inspect only, no changes.');
        write('以隱藏輸入取得 PAT，寫入 CODEX_HOME/config.toml 的 Cairn http_headers（0600，明文）/ Hidden PAT → native http_headers (0600, plaintext).');
        write('既有有效設定不重寫，衝突或停用設定保留 / Preserve configured, conflicting or disabled entries.');
      }
      automaticStatus(write);
      write('未驗證 PAT、遠端服務或 hook 執行 / PAT, remote service and hooks are not tested.');
      return 0;
    }
    if (existing && (!usable || !existing.enabled || (!credential &&
        (envName || transport.http_headers_helper || Object.keys(transport.http_headers || {}).length ||
          Object.keys(transport.env_http_headers || {}).length)))) {
      write('保留既有 Cairn 設定；請先在 Codex 修復連線、啟用或載入原有憑證 / Existing Cairn entry preserved; repair, enable or load its credential in Codex.');
      automaticStatus(write); return 0;
    }
    if (credential && usable) {
      write('保留既有 endpoint 與憑證 / Existing endpoint and credential preserved.');
      automaticStatus(write); return 0;
    }
    if (existing) {
      write(`User-level endpoint: ${transport.url}`);
      write('支援 OAuth 的服務可交由 Codex 登入，避免明文 PAT / For an OAuth service, let Codex manage login instead of a plaintext PAT:');
      write('請從沒有專案覆寫的中立目錄執行 / Run from a neutral directory without project overrides:');
      write('codex mcp login cairn');
      if (!interactive || (await prompt('保留 OAuth 登入路徑，或改存 PAT？/ Keep OAuth login or save a PAT? [OAuth/pat]: ')).trim().toLowerCase() !== 'pat') {
        write('保留 user-level 設定；請執行上方登入指令 / User-level configuration preserved; run the login command above.');
        automaticStatus(write); return 0;
      }
    }
    if (!interactive) {
      write('尚待設定，未收取 PAT / Configuration pending; no PAT collected.');
      fallback(write); automaticStatus(write); return 0;
    }
    await mkdir(home, { recursive: true, mode: 0o700 });
    const homeStat = await lstat(home);
    if (!homeStat.isDirectory() || homeStat.isSymbolicLink() ||
        (process.getuid && homeStat.uid !== process.getuid()) || (homeStat.mode & 0o022)) {
      throw fail('Codex 目錄權限不安全 / Unsafe Codex directory; inspect ownership and permissions.');
    }
    const endpoint = existing ? transport.url.slice(0, -8) :
      ((await prompt('Cairn endpoint [https://cairn.ink]: ')).trim() || 'https://cairn.ink').replace(/\/$/u, '');
    if (!validEndpoint(endpoint)) throw fail('Endpoint 必須是 HTTPS 或本機 loopback HTTP，且不含帳密或 query / Invalid endpoint.');
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
          throw fail('Codex 未讀取候選設定；原設定保留 / Codex did not read the candidate; original configuration preserved.');
        }
      } finally { await rm(candidatePath, { force: true }); }
    };
    let lock, stage;
    const lockPath = join(home, '.cairn-setup.lock');
    try {
      await validate('cairn-synthetic-config-check');
      write(`將保存的 endpoint / Endpoint to save: ${endpoint + '/api/mcp'}`);
      write('PAT 會以明文保存在 Codex config.toml（0600）；Codex 原生讀取，不使用 keyring / PAT stored in native config.toml (0600, plaintext; no keyring).');
      write(`建立 PAT，稍後貼上一次 / Create a PAT, then paste once: ${tokenURL}`);
      if (!flags.includes('--no-browser')) await browse(write, tokenURL);
      const token = await prompt('PAT（隱藏輸入 / hidden input）: ', { secret: true });
      if (!token || token.length > 8192 || /[\s\x00-\x1f\x7f]/u.test(token)) throw fail('PAT 不可為空白或包含空白字元 / Invalid PAT.');
      await validate(token);
      try { lock = await open(lockPath, 'wx', 0o600); }
      catch (error) {
        if (error.code === 'EEXIST') throw fail('另一個安裝器正在設定；確認已停止後再移除 .cairn-setup.lock / Setup lock exists; remove it only after checking other setup processes have stopped.');
        throw error;
      }
      if (!unchanged(before, await snapshot(configPath))) throw fail('設定在輸入期間已變更，請重跑 / Configuration changed while pairing; retry.');
      stage = join(home, `.cairn-config-${process.pid}-${Date.now()}.tmp`);
      await privateWrite(stage, candidate(token));
      if (!unchanged(before, await snapshot(configPath))) throw fail('設定已變更，請重跑 / Configuration changed; retry.');
      await rename(stage, configPath); stage = null;
      const saved = await get({ env: { ...process.env, CODEX_HOME: home } });
      if (!saved.enabled || saved.transport.url !== endpoint + '/api/mcp' ||
          saved.transport.http_headers?.Authorization !== 'Bearer ' + token) {
        throw fail('已保存，但 user-level 驗證失敗；請檢查 Codex 設定 / Saved, but neutral user-level verification failed; inspect Codex config.');
      }
      write('Cairn MCP 與 PAT 已保存 / Cairn MCP and PAT saved.');
    } finally {
      if (stage) await rm(stage, { force: true });
      if (lock) { await lock.close(); await rm(lockPath); }
      await rm(validationHome, { recursive: true, force: true });
    }
    automaticStatus(write);
    write('重新啟動 Codex，以 /mcp 檢查工具 / Restart Codex and inspect tools with /mcp.');
    return 0;
  } finally { await rm(neutral, { recursive: true, force: true }); }
}

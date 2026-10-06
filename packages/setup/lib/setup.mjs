import { dispatchClient } from './codex.mjs';
import { spawn } from 'node:child_process';
import { writeSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { release } from 'node:os';
import { performance } from 'node:perf_hooks';
import { SetupError, AuthError } from './errors.mjs';
import { browserAuthorize, credentialCheck, validToken } from './auth.mjs';

const plugin = 'cairn-memory@cairn-memory';
const repository = 'Cairn-ink/cairn-memory';
const tokenURL = 'https://cairn.ink/settings/tokens';
const endpointDefault = 'https://cairn.ink';

const installerVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

export function supportedNode(version) {
  const [major, minor] = version.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 16);
}

export function validEndpoint(value) {
  try {
    const url = new URL(value);
    return !/[\s\x00-\x1f\x7f]/u.test(value) && !url.username && !url.password &&
      !url.search && !url.hash && url.pathname === '/' &&
      (url.protocol === 'https:' || (url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
  } catch { return false; }
}

// readline owns raw mode while active; every exit closes it and restores the TTY.
// Suppress ALL readline writes for a secret, including pasted text and redraws.
export async function ask(question, { secret = false } = {}) {
  const output = secret ? new Writable({ write(_chunk, _encoding, done) { done(); } }) : process.stdout;
  const rl = createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });
  writeSync(1, question);
  try {
    return await new Promise((resolve, reject) => {
      let settled = false;
      const fail = (code = 1) => {
        if (settled) return;
        settled = true;
        reject(new SetupError('輸入已取消 / Input cancelled.', code));
      };
      rl.once('SIGINT', () => { fail(130); rl.close(); });
      rl.once('close', () => fail());
      rl.question('').then(value => { settled = true; resolve(value); }, () => fail());
    });
  } finally {
    rl.close();
    if (secret) writeSync(1, '\n');
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
    throw new SetupError(`指令失敗 / Command failed: claude ${args.join(' ')} (exit ${code}).`, code);
  }
  return result.stdout;
}

function json(result, args, isValid) {
  const value = checked(result, args);
  try {
    const parsed = JSON.parse(value);
    if (isValid(parsed)) return parsed;
  } catch { /* Never reproduce invalid output. */ }
  throw new SetupError(`無法解析 CLI 狀態 / Cannot read CLI state: claude ${args.join(' ')}.`);
}

async function supports(args, pattern, runCLI = run) {
  const result = await runCLI([...args, '--help']);
  return !result.error && result.status === 0 && pattern.test(result.stdout);
}

function manual(write) {
  write('請在 Claude Code 執行 / Run inside Claude Code:');
  write(`/plugin marketplace add ${repository}`);
  write(`/plugin install ${plugin}`);
  configureInstructions(write);
}

function configureInstructions(write) {
  write(`建立 PAT / Create a PAT: ${tokenURL}`);
  write(`/plugin configure ${plugin}`);
  write('在 Configure options 填入 api_endpoint（預設 https://cairn.ink）與敏感欄位 api_token。');
  write('Enter api_endpoint (default https://cairn.ink) and api_token in Configure options.');
  write('也可開啟 /plugin → Installed → Cairn.ink Memory → Configure options。');
  write('Or open /plugin → Installed → Cairn.ink Memory → Configure options.');
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

async function openBrowser(write, url, signal) {
  const command = browserCommand(url);
  const result = await execute(command[0], command[1], { discard: true, timeout: 10000, signal });
  if (result.error || result.status !== 0) write(`請手動開啟 / Open manually: ${url}`);
}

export async function main(argv, {
  write = line => writeSync(1, `${line}\n`), prompt = ask,
  interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY),
  browse = openBrowser, nodeVersion = process.versions.node, authOptions = {},
} = {}) {
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
      const saved = await configuration(run, { timeout: Math.max(1, deadline - now()) });
      if (!['api_endpoint', 'api_token'].every(key => saved.configured.includes(key))) {
        throw new SetupError('設定未保存完整 / Configuration was not fully saved. Use /plugin configure.');
      }
    } finally { input.fill(0); input = undefined; }
  };
  try {
    const dispatch = await dispatchClient(argv, { write, prompt, interactive, browse,
      nodeVersion, supportedNode, SetupError, validEndpoint });
    if (dispatch.handled) return dispatch.code;
    argv = dispatch.argv;
    const [action, ...flags] = argv;
    if (action === '--help' || action === '-h' || action === undefined) {
      write('用法 / Usage: npx @cairn-ink/memory setup [--dry-run] [--no-browser] [--manual-token] [--reauthorize]');
      write('             npx @cairn-ink/memory status');
      return 0;
    }
    if (!['setup', 'status'].includes(action) ||
        flags.some(flag => !['--dry-run', '--no-browser', '--manual-token', '--reauthorize'].includes(flag)) ||
        (action === 'status' && flags.length)) {
      throw new SetupError('未知指令或選項 / Unknown command or option. Use --help.', 2);
    }
    if (!supportedNode(nodeVersion)) {
      throw new SetupError('需要 Node.js ≥22.16 / Node.js ≥22.16 is required. Upgrade Node and retry.');
    }
    write(`安裝器 / Installer @cairn-ink/memory ${installerVersion}（與外掛版本不同 / separate from plugin version）`);
    const version = await run(['--version']);
    if (version.error?.code === 'ENOENT') {
      throw new SetupError('找不到 claude CLI / claude CLI not found on PATH. Install Claude Code: https://code.claude.com/docs/en/setup');
    }
    checked(version, ['--version']);
    write('Node.js 與 Claude Code 可用 / Node.js and Claude Code are available.');

    const canInstall = await supports(['plugin', 'marketplace', 'add'], /Usage: claude plugin marketplace add\b/u, run) &&
      await supports(['plugin', 'install'], /Usage: claude plugin install\b/u, run);
    const canList = await supports(['plugin', 'list'], /--json\b/u, run) &&
      await supports(['plugin', 'marketplace', 'list'], /--json\b/u, run);
    const canConfigure = await supports(['plugin', 'configure'], /--values-stdin\b/u, run) &&
      await supports(['plugin', 'configure'], /--json\b/u, run);

    if (action === 'status') {
      if (!canList) throw new SetupError('此版本無法讀取 plugin 狀態 / This CLI cannot list plugin state. Update Claude Code.');
      write(`Marketplace: ${(await marketplaces(run)).some(value => value.name === 'cairn-memory') ? '已加入 / added' : '未加入 / absent'}`);
      const entries = await installed(run);
      if (!entries.length) write('Plugin: 未安裝 / not installed');
      for (const entry of entries) {
        const scope = ['user', 'project', 'local', 'managed'].includes(entry.scope) ? entry.scope : 'unknown';
        write(`Plugin (${scope}): ${entry.enabled === true ? '已啟用 / enabled' : '停用 / disabled'}`);
        if (entry.errors?.length) throw new SetupError('Plugin 載入失敗 / Plugin has load errors. Inspect /plugin in Claude Code.');
      }
      if (entries.length && canConfigure) {
        const config = await configuration(run);
        for (const key of ['api_endpoint', 'api_token']) {
          write(`${key}: ${config.configured.includes(key) ? '已設定 / configured' : '未設定 / unset'}`);
        }
      } else if (entries.length) write('設定狀態無法確認 / Configuration status unavailable; inspect /plugin configure.');
      write(`Legacy MCP cairn: ${await oldMCP(run) ? '存在 / present (duplicate tools possible)' : '不存在 / absent'}`);
      write('此狀態未驗證 PAT、遠端服務或 hook 執行 / Status does not test the PAT, service or hooks.');
      return 0;
    }

    if (flags.includes('--dry-run')) {
      write('預演：只檢查，不修改 / Dry run: inspect only, no changes.');
      write('1. 檢查 Node ≥22.16 與 claude CLI / Check Node ≥22.16 and claude CLI.');
      write(`2. claude plugin marketplace add ${repository} (if absent)`);
      write('   claude plugin marketplace update cairn-memory (if already present)');
      write(`3. claude plugin install ${plugin} (user scope); plugin update if already installed`);
      write('4. 確認 endpoint，瀏覽器授權（S256），或 --manual-token 隱藏輸入 / Confirm endpoint and authorize in browser (S256), or hidden manual token.');
      write(canConfigure ? `5. claude plugin configure ${plugin} --values-stdin (JSON through stdin; token never printed)` :
        '5. 由 Claude Code 詢問 endpoint 與 token / Configure endpoint and token inside Claude Code.');
      write('6. claude mcp get cairn; if present, ask before: claude mcp remove cairn');
      write('7. 重新啟動 Claude Code / Restart Claude Code.');
      if (!canInstall) manual(write);
      else if (canList) {
        write(`Marketplace: ${(await marketplaces(run)).some(value => value.name === 'cairn-memory') ? '已加入 / added' : '未加入 / absent'}`);
        write(`Plugin: ${(await installed(run)).length ? '已安裝 / installed' : '未安裝 / absent'}`);
      }
      write('Legacy MCP: 預演不執行可能連網的 mcp get / Dry run skips potentially networked mcp get.');
      return 0;
    }
    if (!interactive) throw new SetupError('授權需要互動式 TTY / Authorization requires an interactive TTY. Use setup in a terminal.', 2);
    if (!canInstall) {
      write('此 CLI 不支援自動安裝 / This CLI needs manual installation.');
      manual(write);
      return 1;
    }
    if (!canList || !canConfigure) {
      manual(write);
      throw new SetupError('請更新 Claude Code：需要 plugin list 與安全的 configure --values-stdin / Update Claude Code: plugin list and secure configure --values-stdin are required.');
    }
    const marketplaceExists = (await marketplaces(run)).some(value => value.name === 'cairn-memory');
    const previous = await installed(run);
    const updateScopes = [...new Set(previous.map(entry => entry.scope))].filter(scope => ['user', 'project', 'local'].includes(scope));
    if (marketplaceExists && !await supports(['plugin', 'marketplace', 'update'], /Usage: claude plugin marketplace update\b/u, run)) {
      throw new SetupError('需要更新 marketplace 的 CLI 功能 / Update Claude Code: marketplace update is required.');
    }
    if (updateScopes.length && !await supports(['plugin', 'update'], /Usage: claude plugin update\b/u, run)) {
      throw new SetupError('需要更新 plugin 的 CLI 功能 / Update Claude Code: plugin update is required.');
    }
    const marketplaceArgs = marketplaceExists ? ['plugin', 'marketplace', 'update', 'cairn-memory'] :
      ['plugin', 'marketplace', 'add', repository];
    checked(await run(marketplaceArgs), marketplaceArgs);
    write('Marketplace 已就緒 / Marketplace ready.');
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
      throw new SetupError('安裝後無法確認 plugin / Cannot confirm plugin after installation. Inspect /plugin.');
    }
    for (const entry of entries) {
      const version = typeof entry.version === 'string' && /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u.test(entry.version) ? entry.version : null;
      if (!version) throw new SetupError('無法確認已安裝的外掛版本 / Cannot confirm installed plugin version. Inspect /plugin.');
      write(`已安裝 Cairn Memory 外掛 ${version} / Installed Cairn Memory plugin ${version} (${entry.scope === 'user' ? 'user' : 'other'} scope).`);
    }
    if (!entries.every(entry => entry.enabled === true)) {
      write('Plugin 已停用，請到 /plugin 啟用 / Plugin is disabled; enable it in /plugin.');
      return 0;
    }
    const config = await configuration(run);
    let ready = ['api_endpoint', 'api_token'].every(key => config.configured.includes(key));
    if (ready && !flags.includes('--reauthorize')) {
      write('保留既有憑證；要換發請使用 --reauthorize / Keeping existing credential; use --reauthorize to replace it.');
    } else if (config.configured.includes('api_token') && !flags.includes('--reauthorize')) {
      throw new SetupError('保留既有憑證，但 endpoint 尚未設定；請以 /plugin configure 補齊，或 --reauthorize 重新授權 / Existing credential kept, but endpoint is unset. Complete /plugin configure or use --reauthorize.');
    } else {
      const endpoint = ((await prompt('確認 Cairn endpoint / Confirm endpoint [https://cairn.ink]: ')).trim() || endpointDefault).replace(/\/$/u, '');
      if (!validEndpoint(endpoint)) throw new SetupError('Endpoint 必須是 HTTPS 或本機 loopback HTTP 的 origin，且不含帳密或 query / Invalid endpoint. Use an HTTPS or loopback HTTP origin without credentials or a query.');
      let manualToken = flags.includes('--manual-token');
      if (!manualToken) {
        const authorization = await browserAuthorize(endpoint, { ...authOptions, write, browse,
          noBrowser: flags.includes('--no-browser'), save, signal });
        if (authorization.unsupported) {
          write('伺服器尚未支援瀏覽器授權（404/501），改用隱藏 PAT 輸入；也可使用 --manual-token / Server does not support browser authorization (404/501); falling back to hidden PAT input. --manual-token is also available.');
          manualToken = true;
        } else write(`Cairn Memory 已連線，憑證將於 ${new Date(authorization.expiresAt).toLocaleDateString('zh-TW')} 到期。 / Cairn Memory is connected. Credential expires ${new Date(authorization.expiresAt).toLocaleDateString('en-US')}.`);
      }
      if (manualToken) {
        let token;
        try {
          const url = new URL('/settings/tokens', endpoint).href;
          write(`建立 PAT，稍後貼上一次 / Create a PAT, then paste it once: ${url}`);
          if (!flags.includes('--no-browser')) await browse(write, url, signal);
          token = await prompt('PAT（隱藏輸入 / hidden input）: ', { secret: true });
          if (!validToken(token)) throw new SetupError('PAT 不可為空白或包含空白字元 / PAT must be non-empty and contain no whitespace.');
          const checkedCredential = await credentialCheck(endpoint, token, { ...authOptions, signal });
          await save({ api_endpoint: endpoint, api_token: token });
          if (!checkedCredential) write('設定已保存，尚未驗證（舊伺服器 404/501）/ Configured, not verified (older server 404/501).');
          else write(checkedCredential.expires_at ?
            `Cairn Memory 已連線，憑證到期日 / Cairn Memory connected; credential expires: ${new Date(checkedCredential.expires_at).toLocaleDateString()}` :
            'Cairn Memory 已連線；此人工憑證未提供到期日 / Cairn Memory connected; this manual credential has no reported expiry.');
        } finally { token = undefined; }
      }
      ready = true;
    }

    const existingMCP = await oldMCP(run);
    if (existingMCP && ready && interactive) {
      const answer = await prompt('找到舊 MCP cairn，移除以避免重複工具？/ Remove legacy MCP cairn to avoid duplicate tools? [y/N]: ');
      if (/^(?:y|yes)$/iu.test(answer.trim())) {
        const args = ['mcp', 'remove', 'cairn'];
        checked(await run(args), args);
        write('已移除舊 MCP / Legacy MCP removed.');
      } else write('保留舊 MCP / Legacy MCP kept.');
    } else if (existingMCP) {
      write('舊 MCP 已保留；完成 plugin 設定後，再確認是否移除 / Legacy MCP kept; confirm removal after plugin configuration.');
      write('claude mcp remove cairn');
    }
    write('重新啟動 Claude Code 並送一則訊息，再用 /cairn-memory:status 檢查 / Restart Claude Code and send a message, then run /cairn-memory:status.');
    return 0;
  } catch (error) {
    // Unexpected exceptions may embed secret-bearing child data: do not log them.
    if (signal.aborted) error = new AuthError('interrupted');
    write(error instanceof SetupError ? error.message : '設定失敗 / Setup failed. Retry or use the manual plugin steps.');
    return error instanceof SetupError ? error.code : 1;
  } finally { process.off('SIGINT', interrupt); }
}

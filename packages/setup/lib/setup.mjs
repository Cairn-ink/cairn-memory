import { spawn } from 'node:child_process';
import { writeSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

const plugin = 'cairn-memory@cairn-memory';
const repository = 'Cairn-ink/cairn-memory';
const tokenURL = 'https://cairn.ink/settings/tokens';
const endpointDefault = 'https://cairn.ink';

class SetupError extends Error {
  constructor(message, code = 1) { super(message); this.code = code; }
}

export function supportedNode(version) {
  const [major, minor] = version.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 16);
}

export function validEndpoint(value) {
  try {
    const url = new URL(value);
    return !/[\s\x00-\x1f\x7f]/u.test(value) && !url.username && !url.password &&
      !url.search && !url.hash &&
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

function execute(command, args, { input, timeout = 120000, discard = false } = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '', error;
    const timer = setTimeout(() => { error = new Error('timeout'); child.kill(); }, timeout);
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
    child.on('close', status => { clearTimeout(timer); resolve({ stdout, stderr, status, error }); });
    child.stdin.end(input);
  });
}

function run(args, input) {
  // Never forward child output: MCP details, configure errors and even plugin
  // lists can contain credentials. Never put a token in argv or the environment.
  return execute('claude', args, { input });
}

function checked(result, args) {
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

async function supports(args, pattern) {
  const result = await run([...args, '--help']);
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

async function oldMCP() {
  const args = ['mcp', 'get', 'cairn'];
  const result = await run(args);
  if (!result.error && result.status === 0) return true;
  // Absence is a specific CLI refusal, not every non-zero exit (auth/network
  // failures must remain failures). Both forms are used by supported CLI builds.
  if (!result.error && result.status === 1 &&
      /(?:No MCP server named "cairn"\.|No MCP server found with name: cairn(?:\r?\n|$))/u
        .test(`${result.stdout}\n${result.stderr}`)) return false;
  checked(result, args);
  return false;
}

async function configuration() {
  const args = ['plugin', 'configure', plugin, '--json'];
  return json(await run(args), args, value => value &&
    Array.isArray(value.configured) && Array.isArray(value.unconfigured));
}

async function installed() {
  const args = ['plugin', 'list', '--json'];
  return json(await run(args), args, Array.isArray).filter(value => value.id === plugin);
}

async function marketplaces() {
  const args = ['plugin', 'marketplace', 'list', '--json'];
  return json(await run(args), args, Array.isArray);
}

async function openBrowser(write) {
  const command = process.platform === 'darwin' ? ['open', [tokenURL]] :
    process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', tokenURL]] :
    ['xdg-open', [tokenURL]];
  const result = await execute(command[0], command[1], { discard: true, timeout: 10000 });
  if (result.error || result.status !== 0) write('請手動開啟上方連結 / Open the link above manually.');
}

export async function main(argv, {
  write = line => writeSync(1, `${line}\n`), prompt = ask,
  interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY),
  browse = openBrowser, nodeVersion = process.versions.node,
} = {}) {
  try {
    const [action, ...flags] = argv;
    if (action === '--help' || action === '-h' || action === undefined) {
      write('用法 / Usage: npx @cairn-ink/memory setup [--dry-run] [--no-browser]');
      write('             npx @cairn-ink/memory status');
      return 0;
    }
    if (!['setup', 'status'].includes(action) ||
        flags.some(flag => !['--dry-run', '--no-browser'].includes(flag)) ||
        (action === 'status' && flags.length)) {
      throw new SetupError('未知指令或選項 / Unknown command or option. Use --help.', 2);
    }
    if (!supportedNode(nodeVersion)) {
      throw new SetupError('需要 Node.js ≥22.16 / Node.js ≥22.16 is required. Upgrade Node and retry.');
    }
    const version = await run(['--version']);
    if (version.error?.code === 'ENOENT') {
      throw new SetupError('找不到 claude CLI / claude CLI not found on PATH. Install Claude Code: https://code.claude.com/docs/en/setup');
    }
    checked(version, ['--version']);
    write('Node.js 與 Claude Code 可用 / Node.js and Claude Code are available.');

    const canInstall = await supports(['plugin', 'marketplace', 'add'], /Usage: claude plugin marketplace add\b/u) &&
      await supports(['plugin', 'install'], /Usage: claude plugin install\b/u);
    const canList = await supports(['plugin', 'list'], /--json\b/u) &&
      await supports(['plugin', 'marketplace', 'list'], /--json\b/u);
    const canConfigure = await supports(['plugin', 'configure'], /--values-stdin\b/u) &&
      await supports(['plugin', 'configure'], /--json\b/u);

    if (action === 'status') {
      if (!canList) throw new SetupError('此版本無法讀取 plugin 狀態 / This CLI cannot list plugin state. Update Claude Code.');
      write(`Marketplace: ${(await marketplaces()).some(value => value.name === 'cairn-memory') ? '已加入 / added' : '未加入 / absent'}`);
      const entries = await installed();
      if (!entries.length) write('Plugin: 未安裝 / not installed');
      for (const entry of entries) {
        const scope = ['user', 'project', 'local', 'managed'].includes(entry.scope) ? entry.scope : 'unknown';
        write(`Plugin (${scope}): ${entry.enabled === true ? '已啟用 / enabled' : '停用 / disabled'}`);
        if (entry.errors?.length) throw new SetupError('Plugin 載入失敗 / Plugin has load errors. Inspect /plugin in Claude Code.');
      }
      if (entries.length && canConfigure) {
        const config = await configuration();
        for (const key of ['api_endpoint', 'api_token']) {
          write(`${key}: ${config.configured.includes(key) ? '已設定 / configured' : '未設定 / unset'}`);
        }
      } else if (entries.length) write('設定狀態無法確認 / Configuration status unavailable; inspect /plugin configure.');
      write(`Legacy MCP cairn: ${await oldMCP() ? '存在 / present (duplicate tools possible)' : '不存在 / absent'}`);
      write('此狀態未驗證 PAT、遠端服務或 hook 執行 / Status does not test the PAT, service or hooks.');
      return 0;
    }

    if (flags.includes('--dry-run')) {
      write('預演：只檢查，不修改 / Dry run: inspect only, no changes.');
      write('1. 檢查 Node ≥22.16 與 claude CLI / Check Node ≥22.16 and claude CLI.');
      write(`2. claude plugin marketplace add ${repository} (if absent)`);
      write(`3. claude plugin install ${plugin} (user scope)`);
      write(`4. 開啟 / Open ${tokenURL}${flags.includes('--no-browser') ? ' (manual)' : ''}; ask for endpoint and a hidden PAT.`);
      write(canConfigure ? `5. claude plugin configure ${plugin} --values-stdin (JSON through stdin; token never printed)` :
        '5. 由 Claude Code 詢問 endpoint 與 token / Configure endpoint and token inside Claude Code.');
      write('6. claude mcp get cairn; if present, ask before: claude mcp remove cairn');
      write('7. 重新啟動 Claude Code / Restart Claude Code.');
      if (!canInstall) manual(write);
      else if (canList) {
        write(`Marketplace: ${(await marketplaces()).some(value => value.name === 'cairn-memory') ? '已加入 / added' : '未加入 / absent'}`);
        write(`Plugin: ${(await installed()).length ? '已安裝 / installed' : '未安裝 / absent'}`);
      }
      write(`Legacy MCP cairn: ${await oldMCP() ? '存在 / present; confirmation required' : '不存在 / absent'}`);
      return 0;
    }
    if (!canInstall) {
      write('此 CLI 不支援自動安裝 / This CLI needs manual installation.');
      manual(write);
      return 0;
    }
    write('將安裝自動記憶 plugin，預設擷取對話並回憶 / Installing automatic conversation capture and recall.');
    if (!canList || !(await marketplaces()).some(value => value.name === 'cairn-memory')) {
      const args = ['plugin', 'marketplace', 'add', repository];
      checked(await run(args), args);
    }
    write('Marketplace 已就緒 / Marketplace ready.');
    const installArgs = ['plugin', 'install', plugin];
    checked(await run(installArgs), installArgs);
    write('Plugin 已安裝（user scope）/ Plugin installed (user scope).');

    let ready = false;
    if (canList) {
      const entries = await installed();
      if (!entries.some(entry => entry.scope === 'user') || entries.some(entry => entry.errors?.length)) {
        throw new SetupError('安裝後無法確認 plugin / Cannot confirm plugin after installation. Inspect /plugin.');
      }
      if (!entries.every(entry => entry.enabled === true)) {
        write('Plugin 已停用，請到 /plugin 啟用 / Plugin is disabled; enable it in /plugin.');
        return 0;
      }
    }
    if (canConfigure) {
      const config = await configuration();
      ready = ['api_endpoint', 'api_token'].every(key => config.configured.includes(key));
      if (!ready && interactive) {
        const values = {};
        if (!config.configured.includes('api_endpoint')) {
          const endpoint = ((await prompt('Cairn endpoint [https://cairn.ink]: ')).trim() || endpointDefault).replace(/\/$/u, '');
          if (!validEndpoint(endpoint)) throw new SetupError('Endpoint 必須是 HTTPS 或本機 loopback HTTP，且不含帳密或 query / Invalid endpoint. Use HTTPS or loopback HTTP without credentials or a query.');
          values.api_endpoint = endpoint;
        }
        if (!config.configured.includes('api_token')) {
          write(`建立 PAT，稍後貼上一次 / Create a PAT, then paste it once: ${tokenURL}`);
          if (!flags.includes('--no-browser')) await browse(write);
          const token = await prompt('PAT（隱藏輸入 / hidden input）: ', { secret: true });
          if (!token || token.length > 8192 || /[\s\x00-\x1f\x7f]/u.test(token)) {
            throw new SetupError('PAT 不可為空白或包含空白字元 / PAT must be non-empty and contain no whitespace.');
          }
          values.api_token = token;
        }
        const args = ['plugin', 'configure', plugin, '--values-stdin'];
        checked(await run(args, JSON.stringify(values)), args);
        const saved = await configuration();
        ready = ['api_endpoint', 'api_token'].every(key => saved.configured.includes(key));
        if (!ready) throw new SetupError('設定未保存完整 / Configuration was not fully saved. Use /plugin configure.');
        write('Endpoint 與 PAT 已交由 Claude Code 保存 / Endpoint and PAT saved by Claude Code.');
      }
    }
    if (!ready) {
      write('Plugin 安裝完成，尚待設定 / Plugin installed; configuration still required.');
      configureInstructions(write);
    }

    const existingMCP = await oldMCP();
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
    write('重新啟動 Claude Code，再用 /cairn-memory:status 檢查 / Restart Claude Code, then run /cairn-memory:status.');
    return 0;
  } catch (error) {
    // Unexpected exceptions may embed secret-bearing child data: do not log them.
    write(error instanceof SetupError ? error.message : '設定失敗 / Setup failed. Retry or use the manual plugin steps.');
    return error instanceof SetupError ? error.code : 1;
  }
}

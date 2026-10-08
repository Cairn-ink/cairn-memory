import './device-ui.test.mjs';
import { PassThrough, Writable } from 'node:stream';
import { detectLanguage, messages, translator } from '../lib/messages.mjs';
import { selectEndpoint } from '../lib/options.mjs';
import './codex.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { scryptSync } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { supportedNode, validEndpoint, browserCommand, ask } from '../lib/setup.mjs';
import { requestJSON, proxyFor } from '../lib/transport.mjs';
import { fakeAuthServer, secret } from './fake-auth-server.mjs';
import { safeHostname, browserAuthorize } from '../lib/auth.mjs';
import { wireChild, localWireRequest } from './http-wire.mjs';

const moduleURL = new URL('../lib/setup.mjs', import.meta.url).href;
const secretURL = new URL('./fake-auth-server.mjs', import.meta.url).href;
const transportURL = new URL('../lib/transport.mjs', import.meta.url).href;
const errorURL = new URL('../lib/errors.mjs', import.meta.url).href;
const wireURL = new URL('./http-wire.mjs', import.meta.url).href;
const deviceURL = new URL('../lib/device-ui.mjs', import.meta.url).href;
const bin = fileURLToPath(new URL('../bin/memory.mjs', import.meta.url));
const command = call => call.args.join(' ');
const saved = result => result.calls.find(call => call.args.includes('--values-stdin'));

async function fixture(t, state = {}, options = {}) {
  const server = await fakeAuthServer(t, options.server);
  const workspace = createTestWorkspace(t, { prefix: 'cairn-setup-' });
  const fakeBin = join(workspace.path, 'bin'); mkdirSync(fakeBin);
  const callsPath = join(workspace.path, 'calls.jsonl');
  const statePath = join(workspace.path, 'state.json');
  writeFileSync(statePath, JSON.stringify({ token: 'synthetic-child-output-must-stay-hidden', ...state }));
  writeFileSync(callsPath, '');
  if (!options.noClaude) writeFileSync(join(fakeBin, 'claude'),
    `#!${process.execPath}\n${readFileSync(new URL('./fake-claude.mjs', import.meta.url), 'utf8')}`, { mode: 0o755 });
  const promptsPath = join(workspace.path, 'prompts.jsonl'); writeFileSync(promptsPath, '');
  const sleepsPath = join(workspace.path, 'sleeps.jsonl'); writeFileSync(sleepsPath, '');
  const browsesPath = join(workspace.path, 'browses.jsonl'); writeFileSync(browsesPath, '');
  const budgetsPath = join(workspace.path, 'budgets.jsonl'); writeFileSync(budgetsPath, '');
  const clipboardPath = join(workspace.path, 'clipboard.jsonl'); writeFileSync(clipboardPath, '');
  if (['present', 'failure', 'hang'].includes(options.clipboard)) writeFileSync(join(fakeBin, 'wl-copy'),
    `#!${process.execPath}\nimport {readFileSync,appendFileSync} from 'node:fs';
    appendFileSync(${JSON.stringify(clipboardPath)}, JSON.stringify({args:process.argv.slice(2),input:readFileSync(0,'utf8')})+String.fromCharCode(10));
    process.stdout.write('clipboard-child-output-hidden');process.stderr.write('clipboard-child-output-hidden');
    ${options.clipboard === 'hang' ? 'setInterval(()=>{},1000);' : `process.exit(${options.clipboard === 'failure' ? 1 : 0});`}`, {mode:0o755});
  const harness = join(workspace.path, 'harness.mjs');
  writeFileSync(harness, `import {main} from ${JSON.stringify(moduleURL)};
    import {secret} from ${JSON.stringify(secretURL)};
    import {requestJSON} from ${JSON.stringify(transportURL)};
    import {AuthError} from ${JSON.stringify(errorURL)};
    import {copyCode} from ${JSON.stringify(deviceURL)};
    import {installChildWire} from ${JSON.stringify(wireURL)};
    import {appendFileSync, readFileSync, writeSync} from 'node:fs';
    const disconnect = installChildWire();
    let clock = 0, pollCount = 0;
    let wallJump = 0;
    const wallNow = Date.now.bind(Date);
    Date.now = () => wallNow() + ${options.clientSkew ?? 0} + wallJump;
    const latency = ${JSON.stringify(options.latency ?? {})};
    const answers = [${JSON.stringify(options.endpoint ?? server.endpoint)}, ${options.invalidToken ? "secret + '\\n'" : 'secret'}, ${JSON.stringify(options.mcpAnswer ?? '')}];
    process.exitCode = await main(process.argv.slice(2), {
      interactive: ${options.interactive ?? true}, nodeVersion: ${JSON.stringify(options.nodeVersion ?? process.versions.node)},
      ...( ${options.locale !== undefined} ? { locale: ${JSON.stringify(options.locale ?? 'en-US')} } : {} ),
      authOptions: {
        now: () => clock, jitter: () => 0.25, tty: ${options.outputTTY ?? false},
        copy: (code, options) => copyCode(code, {...options, platform: 'linux', wsl:false}),
        sleep: async ms => {
          appendFileSync(${JSON.stringify(sleepsPath)}, JSON.stringify(ms) + '\\n');
          ${options.signalDuringSleep ? "process.kill(process.pid, 'SIGINT'); await new Promise(resolve => setImmediate(resolve));" : 'clock += ms;'}
        },
        request: async (url, options) => {
          const route = url.pathname.split('/').at(-1);
          appendFileSync(${JSON.stringify(budgetsPath)}, JSON.stringify({route, timeout: options.timeout, clock}) + '\\n');
          const response = await requestJSON(url, options);
          const elapsed = latency[route] ?? 0;
          clock += Math.min(elapsed, options.timeout ?? 15000);
          if (route === 'credential') wallJump = ${options.wallJumpAfterCredential ?? 0};
          if (elapsed > (options.timeout ?? 15000)) throw new AuthError('transient');
          if (url.pathname.endsWith('/token')) {
            pollCount++;
            ${options.interruptAfterToken ? "process.kill(process.pid, 'SIGINT'); await new Promise(resolve => setImmediate(resolve));" : ''}
          }
          return response;
        }
      },
      prompt: async (question, options) => {
        appendFileSync(${JSON.stringify(promptsPath)}, JSON.stringify({question, options}) + '\\n');
        if (/Press Enter|按 Enter/u.test(question)) {
          if (readFileSync(${JSON.stringify(browsesPath)}, 'utf8')) throw new Error('browser opened before Enter');
          writeSync(1, question + '\\n');
          clock += ${options.enterDelay ?? 0};
          ${options.interruptEnter ? "const interrupted = new Promise(resolve => options.signal.addEventListener('abort', resolve, {once:true})); process.kill(process.pid, 'SIGINT'); await interrupted;" : ''}
          return '';
        }
        return options?.secret ? ${options.invalidToken ? "secret + '\\n'" : 'secret'} :
          /MCP cairn|legacy MCP/iu.test(question) ? ${JSON.stringify(options.mcpAnswer ?? '')} : ${JSON.stringify(options.endpoint ?? server.endpoint)};
      }, browse: async (_write, url) => {
        appendFileSync(${JSON.stringify(browsesPath)}, JSON.stringify(url) + '\\n');
        ${options.browserFail ? "throw new Error('browser unavailable');" : "writeSync(1, 'browser opened\\n');"}
      }
    });
    disconnect();`);
  const result = await new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [options.realBin ? bin : harness, ...(options.args ?? ['setup', '--no-browser'])], {
      cwd: workspace.path, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { LANG: 'en_US.UTF-8', PATH: fakeBin, HOME: workspace.path, FAKE_CALLS: callsPath, FAKE_STATE: statePath, ...(options.clipboard ? {WAYLAND_DISPLAY:'fixture',XDG_RUNTIME_DIR:workspace.path} : {}), ...options.env },
    });
    wireChild(proc, server.server);
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('fixture deadline')); }, 20000);
    proc.stdout.on('data', value => { stdout += value; }); proc.stderr.on('data', value => { stderr += value; });
    proc.on('error', reject);
    proc.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
  const lines = path => readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const calls = lines(callsPath), prompts = lines(promptsPath), sleeps = lines(sleepsPath), browses = lines(browsesPath), budgets = lines(budgetsPath), clipboard = lines(clipboardPath);
  const secrets = [secret, server.grant?.device_code, server.lastProof?.code_verifier, server.delivery?.delivery_receipt].filter(Boolean);
  const allFiles = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? allFiles(join(dir, entry.name)) : [join(dir, entry.name)]);
  for (const value of secrets) {
    assert.ok(!(result.stdout + result.stderr).includes(value), 'secret must not appear in installer output');
    assert.ok(!JSON.stringify(calls).includes(value), 'no secret in child argv, env or recorded stdin metadata');
    for (const path of allFiles(workspace.path)) assert.ok(!readFileSync(path, 'utf8').includes(value), `no secret in output file ${path}`);
    for (const request of server.requests) assert.ok(!request.url.includes(value), 'no secret in URL');
  }
  assert.ok(!(result.stdout + result.stderr).includes('synthetic-child-output-must-stay-hidden'));
  assert.deepEqual(server.violations, []);
  return { ...result, calls, prompts, sleeps, browses, budgets, clipboard, server, state: JSON.parse(readFileSync(statePath, 'utf8')) };
}

test('Node minimum, endpoint origins, browser launch commands and hostname sanitation', () => {
  for (const version of ['20.19.0', '22.15.9', '21.9.0']) assert.equal(supportedNode(version), false);
  for (const version of ['22.16.0', '22.99.0', '24.15.0']) assert.equal(supportedNode(version), true);
  for (const endpoint of ['https://cairn.ink', 'http://localhost:3000', 'http://127.0.0.1:8080', 'http://[::1]:3000']) assert.equal(validEndpoint(endpoint), true);
  for (const endpoint of ['http://example.com', 'https://user:pass@example.com', 'https://cairn.ink?token=x', 'https://cairn.ink#x', 'https://cairn.ink\n', 'https://cairn.ink/path', 'bad']) assert.equal(validEndpoint(endpoint), false);
  assert.deepEqual(browserCommand('https://cairn.ink/device', 'win32', false), ['rundll32.exe', ['url.dll,FileProtocolHandler', 'https://cairn.ink/device']]);
  assert.equal(browserCommand('https://cairn.ink/device', 'linux', true)[0], 'rundll32.exe');
  assert.equal(browserCommand('https://cairn.ink/device', 'linux', false)[0], 'xdg-open');
  assert.equal(safeHostname('<host>\u202e\n\"'), 'host');
  assert.equal(Array.from(safeHostname('😀'.repeat(80))).length, 64);
});

test('browser happy path uses S256, safe stdin, credential check then ACK and reports both versions', async t => {
  const r = await fixture(t, {}, { args: ['setup'], server: { sequence: ['authorization_pending'] } });
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.state.configured, true);
  assert.equal(saved(r).tokenDigest, scryptSync(secret, 'cairn-fake-claude', 16).toString('hex'));
  assert.deepEqual(saved(r).keys, ['api_endpoint', 'api_token']);
  assert.equal(saved(r).endpoint, r.server.endpoint);
  assert.deepEqual(r.prompts.length, 2);
  assert.deepEqual(r.sleeps, [5000, 5000]);
  assert.deepEqual(r.browses, [`${r.server.endpoint}/device`]);
  assert.deepEqual(r.server.requests.map(r => r.route), ['device-authorizations', 'token', 'token', 'credential', 'ack']);
  assert.equal(r.server.grant.state, 'delivered');
  assert.match(r.stdout, /plugin 0\.3\.1/); assert.match(r.stdout, /Installer @cairn-ink\/memory 0\.2\.0/);
  assert.match(r.stdout, /Cairn Memory is connected.*expires/);
  const second = await localWireRequest(r.server.server, requestJSON, new URL('/api/cli-auth/v1/token', r.server.endpoint), { body: r.server.lastProof, env: {} });
  assert.equal(second.status, 400); assert.equal(second.value.error, 'invalid_grant');
  assert.ok(!JSON.stringify(second.value).includes(secret), 'a second poll after delivery gets no token');
});

for (const [machine, message] of [['access_denied', /Authorization was denied/], ['expired_token', /Authorization code expired/]]) {
  test(`localized terminal failure: ${machine}`, async t => {
    const r = await fixture(t, {}, { server: { sequence: [machine] } });
    assert.equal(r.code, 1); assert.match(r.stdout, message); assert.equal(saved(r), undefined);
    assert.equal(r.server.requests.at(-1).route, 'cancel');
  });
}

test('600-second timeout cancels without configure or ACK', async t => {
  const r = await fixture(t, {}, { server: { pendingForever: true, interval: 120 } });
  assert.equal(r.code, 1); assert.match(r.stdout, /Authorization timed out/);
  assert.equal(r.sleeps.reduce((a, b) => a + b, 0), 600000);
  assert.equal(r.server.grant.state, 'cancelled'); assert.equal(saved(r), undefined);
});

for (const option of ['signalDuringSleep', 'interruptAfterToken']) {
  test(`Ctrl-C (${option}) cancels and exits 130`, async t => {
    const r = await fixture(t, {}, { [option]: true });
    assert.equal(r.code, 130, r.stdout); assert.equal(r.server.grant.state, 'cancelled');
    assert.ok(!r.server.requests.some(r => r.route === 'ack')); assert.equal(saved(r), undefined);
  });
}

test('Ctrl-C during the configure child cancels before ACK and exits 130', async t => {
  const r = await fixture(t, { interruptConfigure: true });
  assert.equal(r.code, 130, r.stdout); assert.equal(r.server.grant.state, 'cancelled');
  assert.ok(!r.server.requests.some(r => r.route === 'ack'));
});

test('slow_down permanently adds 5 seconds; 429 obeys Retry-After; 5xx uses backoff', async t => {
  const r = await fixture(t, {}, { server: { sequence: ['slow_down', 'authorization_pending', 'rate_limited', 503, 503] } });
  assert.equal(r.code, 0, r.stdout);
  assert.deepEqual(r.sleeps, [5000, 10000, 10000, 17000, 20250, 40250]);
  assert.match(r.stdout, /Rate-limited/); assert.equal(r.prompts.length, 1);
});

test('rate limit beyond grant deadline has its own message and cancels', async t => {
  const r = await fixture(t, {}, { server: { sequence: ['rate_limited'], retryAfter: 700 } });
  assert.equal(r.code, 1); assert.match(r.stdout, /rate-limited/); assert.equal(r.server.grant.state, 'cancelled');
});

test('lost exchange response retries the same exchange id and delivers only one PAT', async t => {
  const r = await fixture(t, {}, { server: { sequence: ['lost_delivery'] } });
  assert.equal(r.code, 0, r.stdout);
  const polls = r.server.requests.filter(r => r.route === 'token');
  assert.equal(polls.length, 2); assert.deepEqual(polls[0].body, polls[1].body);
  assert.equal(r.server.grant.state, 'delivered');
  assert.equal(r.server.requests.find(r => r.route === 'ack').body.exchange_id, polls[0].body.exchange_id);
});

for (const createStatus of [404, 501]) {
  test(`${createStatus} create falls back to hidden manual input; old credential route saves unverified`, async t => {
    const r = await fixture(t, {}, { server: { createStatus, createHTML: true, credentialStatus: createStatus } });
    assert.equal(r.code, 0, r.stdout); assert.match(r.stdout, /falling back to hidden PAT/);
    assert.equal(r.prompts[1].options.secret, true); assert.deepEqual(saved(r).keys, ['api_endpoint', 'api_token']);
    assert.match(r.stdout, /Configured, not verified/); assert.doesNotMatch(r.stdout, /Cairn Memory is connected/);
  });
}

for (const server of [{ createStatus: 503 }, { createMalformed: true }, { redirect: true }, { foreignURI: 'https://evil.example/device' }]) {
  test(`create does not downgrade on server/protocol/redirect/origin failure ${JSON.stringify(server)}`, async t => {
    const r = await fixture(t, {}, { server });
    assert.equal(r.code, 1); assert.equal(r.prompts.length, 1); assert.equal(saved(r), undefined);
    assert.equal(r.server.requests.filter(r => r.route === 'device-authorizations').length, 1);
    assert.ok(!r.server.requests.some(r => r.route === 'trap'));
  });
}

for (const state of [{ fail: 'plugin configure cairn-memory@cairn-memory --values-stdin' }, { incompleteSave: true }]) {
  test(`configure failure cancels before ACK: ${JSON.stringify(state)}`, async t => {
    const r = await fixture(t, state);
    assert.equal(r.code, 1); assert.match(r.stdout, /Credential configuration failed/);
    assert.equal(r.server.grant.state, 'cancelled'); assert.equal(r.server.requests.at(-1).route, 'cancel');
    assert.ok(!r.server.requests.some(r => r.route === 'ack'));
  });
}

test('credential rejection cancels before configuration', async t => {
  const r = await fixture(t, {}, { server: { credentialStatus: 401 } });
  assert.equal(r.code, 1); assert.equal(saved(r), undefined); assert.equal(r.server.grant.state, 'cancelled');
});

test('lost ACK retries identical proof and receipt; ambiguous ACK retains saved configuration', async t => {
  const r = await fixture(t, {}, { server: { ackLost: true } });
  assert.equal(r.code, 0, r.stdout);
  const acks = r.server.requests.filter(r => r.route === 'ack');
  assert.equal(acks.length, 2); assert.deepEqual(acks[0].body, acks[1].body);
  const unknown = await fixture(t, {}, { server: { ackUnavailable: true } });
  assert.equal(unknown.code, 1); assert.match(unknown.stdout, /delivery is unconfirmed/);
  assert.equal(unknown.state.configured, true); assert.ok(!unknown.server.requests.some(r => r.route === 'cancel'));
});

test('explicit failed_revoked ACK asks for new authorization', async t => {
  const r = await fixture(t, {}, { server: { ackRevoked: true } });
  assert.equal(r.code, 1); assert.match(r.stdout, /was revoked/);
});

test('marketplace and already-installed plugin update before pairing; preserve existing credential', async t => {
  const r = await fixture(t, { installed: true, marketplace: true, configured: true, version: '0.3.0' });
  assert.equal(r.code, 0, r.stdout); assert.deepEqual(r.prompts, []); assert.deepEqual(r.server.requests, []);
  const commands = r.calls.map(command);
  assert.ok(commands.includes('plugin marketplace update cairn-memory'));
  assert.ok(commands.includes('plugin update cairn-memory@cairn-memory --scope user'));
  assert.ok(commands.indexOf('plugin marketplace update cairn-memory') < commands.indexOf('plugin update cairn-memory@cairn-memory --scope user'));
  assert.equal(saved(r), undefined); assert.match(r.stdout, /plugin 0\.3\.1/);
});

test('an existing token without an endpoint is kept unless --reauthorize is explicit', async t => {
  const r = await fixture(t, { partial: ['api_token'] });
  assert.equal(r.code, 1); assert.match(r.stdout, /Existing credential kept, but endpoint is unset/);
  assert.deepEqual(r.prompts, []); assert.deepEqual(r.server.requests, []); assert.equal(saved(r), undefined);
});

for (const state of [{ configured: true, endpoint: 'https://old.example' }, { partial: ['api_endpoint'], endpoint: 'https://old.example' }, { partial: ['api_token'] }]) {
  test(`new authorization confirms endpoint and saves both values ${JSON.stringify(state)}`, async t => {
    const r = await fixture(t, state, { args: ['setup', '--no-browser', '--reauthorize'] });
    assert.equal(r.code, 0); assert.equal(r.prompts.length, 1);
    assert.equal(saved(r).endpoint, r.server.endpoint); assert.deepEqual(saved(r).keys, ['api_endpoint', 'api_token']);
  });
}

test('--manual-token checks the PAT, preserves legacy expiry semantics, and skips grant', async t => {
  const r = await fixture(t, {}, { args: ['setup', '--manual-token', '--no-browser'], server: { legacy: true } });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.prompts[1].options.secret, true);
  assert.deepEqual(r.server.requests.map(r => r.route), ['credential']); assert.deepEqual(r.browses, []);
  assert.match(r.stdout, /no reported expiry/);
});

test('manual credential 5xx does not save unverified settings', async t => {
  const r = await fixture(t, {}, { args: ['setup', '--manual-token', '--no-browser'], server: { credentialStatus: 503 } });
  assert.equal(r.code, 1); assert.equal(saved(r), undefined);
});

test('--no-browser still authorizes; browser-open failure prints bare URL and proceeds', async t => {
  const r = await fixture(t); assert.equal(r.code, 0); assert.deepEqual(r.browses, []);
  const failure = await fixture(t, {}, { args: ['setup'], browserFail: true });
  assert.equal(failure.code, 0); assert.match(failure.stdout, /Open manually: http:\/\/127\.0\.0\.1:\d+\/device/);
});

for (const args of [['setup'], ['setup', '--no-browser'], ['setup', '--manual-token']]) {
  test(`non-TTY exits 2 without codes, browser or mutation ${args.join(' ')}`, async t => {
    const r = await fixture(t, {}, { args, realBin: true });
    assert.equal(r.code, 2); assert.equal(r.server.requests.length, 0); assert.equal(saved(r), undefined);
    assert.doesNotMatch(r.stdout, /ABCD-EFGH/); assert.deepEqual(r.browses, []); assert.equal(r.state.installed, undefined);
  });
}

test('dry run uses only read-only CLI calls and no potentially networked mcp get', async t => {
  const r = await fixture(t, { mcp: true }, { args: ['setup', '--dry-run'] });
  assert.equal(r.code, 0); assert.deepEqual(r.prompts, []); assert.deepEqual(r.server.requests, []); assert.deepEqual(r.browses, []);
  assert.ok(r.calls.every(call => call.args.includes('--help') || call.args.includes('--json') || command(call) === '--version'));
});

test('status prints presence without reading sensitive userConfig or claiming verification', async t => {
  const r = await fixture(t, { installed: true, marketplace: true, configured: true, mcp: true }, { args: ['status'] });
  assert.equal(r.code, 0); assert.match(r.stdout, /api_token: configured/);
  assert.match(r.stdout, /Status does not test the PAT/); assert.deepEqual(r.server.requests, []);
});

for (const state of [{ noInstall: true }, { noConfigure: true }, { disabled: true }, { loadErrors: true }]) {
  test(`preflight/unusable plugin never creates grant ${JSON.stringify(state)}`, async t => {
    const r = await fixture(t, state); assert.deepEqual(r.server.requests, []); assert.deepEqual(r.prompts, []);
    assert.equal(saved(r), undefined);
  });
}

for (const answer of ['y', 'N', '']) {
  test(`legacy MCP removal still requires affirmative confirmation (${JSON.stringify(answer)})`, async t => {
    const r = await fixture(t, { mcp: true }, { mcpAnswer: answer });
    assert.equal(r.code, 0); assert.equal(r.state.mcp, answer !== 'y');
  });
}

for (const fail of ['--version', 'plugin marketplace add Cairn-ink/cairn-memory', 'plugin install cairn-memory@cairn-memory', 'mcp get cairn', 'mcp remove cairn']) {
  test(`preserves non-zero child exit without child output: ${fail}`, async t => {
    const r = await fixture(t, { fail, mcp: true }, { mcpAnswer: 'y' });
    assert.equal(r.code, 7); assert.match(r.stdout, /exit 7/);
  });
}

test('missing CLI, unsupported Node, invalid endpoint/PAT and malformed CLI JSON are safe failures', async t => {
  const missing = await fixture(t, {}, { noClaude: true }); assert.equal(missing.code, 1); assert.match(missing.stdout, /not found on PATH/);
  const old = await fixture(t, {}, { nodeVersion: '22.15.0' }); assert.equal(old.code, 1); assert.deepEqual(old.calls, []);
  const endpoint = await fixture(t, {}, { endpoint: 'http://example.com' }); assert.equal(endpoint.code, 1); assert.deepEqual(endpoint.server.requests, []);
  const token = await fixture(t, {}, { args: ['setup', '--manual-token', '--no-browser'], invalidToken: true }); assert.equal(token.code, 1); assert.equal(saved(token), undefined);
  const json = await fixture(t, { badJSON: true }, { args: ['status'] }); assert.equal(json.code, 1); assert.match(json.stdout, /Cannot read CLI state/);
});

test('unknown flags are not echoed, even if a token is accidentally passed', async t => {
  const r = await fixture(t, {}, { args: ['setup', '--token', secret] });
  assert.equal(r.code, 2); assert.deepEqual(r.calls, []);
});

test('NO_PROXY grammar, uppercase/lowercase variables, and unsupported proxies fail safely', () => {
  const url = new URL('https://api.example.com:444');
  assert.equal(proxyFor(url, { HTTPS_PROXY: 'http://proxy:8080' }).host, 'proxy:8080');
  assert.equal(proxyFor(url, { HTTPS_PROXY: 'http://proxy', NO_PROXY: '.example.com:444' }), null);
  assert.equal(proxyFor(url, { HTTPS_PROXY: 'http://proxy', NO_PROXY: 'example.com:443' }).host, 'proxy');
  assert.equal(proxyFor(url, { HTTPS_PROXY: 'http://proxy', NO_PROXY: '*' }), null);
  assert.equal(proxyFor(new URL('http://[::1]:8080'), { HTTP_PROXY: 'http://proxy', NO_PROXY: '[::1]:8080' }), null);
  assert.equal(proxyFor(url, { https_proxy: 'http://proxy', no_proxy: '.example.com' }), null);
  assert.throws(() => proxyFor(url, { HTTPS_PROXY: 'socks5://proxy:8080' }), /Cannot securely reach/);
});

// These tests exercise actual HTTP and TLS parsers and CONNECT bytes over a
// duplex network. They do not establish OS TCP or native Windows behavior.
test('HTTP proxy uses absolute target; NO_PROXY bypasses it without forwarding proxy credentials', async () => {
  const { default: http } = await import('node:http');
  const { virtualNetwork } = await import('./http-wire.mjs');
  const requests = [];
  const target = http.createServer((req, res) => {
    requests.push({ target: true, url: req.url, headers: req.headers });
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
  });
  const proxy = http.createServer((req, res) => {
    requests.push({ proxy: true, url: req.url, headers: req.headers });
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
  });
  const servers = new Map([['target.test:4444', target], ['proxy.test:8080', proxy]]);
  await virtualNetwork(servers, async () => {
    const url = new URL('http://target.test:4444/api/cli-auth/v1/credential');
    await requestJSON(url, { token: secret, env: { HTTP_PROXY: 'http://user:pass@proxy.test:8080' } });
    await requestJSON(url, { token: secret, env: { HTTP_PROXY: 'http://user:pass@proxy.test:8080', NO_PROXY: 'target.test:4444' } });
  });
  assert.equal(requests[0].url, 'http://target.test:4444/api/cli-auth/v1/credential');
  assert.equal(requests[0].headers.authorization, `Bearer ${secret}`);
  assert.equal(requests[0].headers['proxy-authorization'], `Basic ${Buffer.from('user:pass').toString('base64')}`);
  assert.equal(requests[1].url, '/api/cli-auth/v1/credential');
  assert.equal(requests[1].headers['proxy-authorization'], undefined);
});

test('HTTPS CONNECT, TLS proxy, trusted CA, invalid certificate and proxy refusal', async t => {
  const { default: http } = await import('node:http');
  const { default: https } = await import('node:https');
  const { execFileSync } = await import('node:child_process');
  const { virtualNetwork, socket } = await import('./http-wire.mjs');
  const workspace = createTestWorkspace(t, { prefix: 'cairn-setup-tls-' });
  const certPath = join(workspace.path, 'cert.pem'), keyPath = join(workspace.path, 'key.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath,
    '-days', '1', '-subj', '/CN=target.test', '-addext', 'subjectAltName=DNS:target.test,DNS:proxy.test'], { stdio: 'ignore' });
  const ca = readFileSync(certPath);
  const tlsOptions = { cert: ca, key: readFileSync(keyPath) };
  const protectedRequests = [], connects = [];
  const target = https.createServer(tlsOptions, (req, res) => {
    protectedRequests.push({ url: req.url, headers: req.headers });
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"valid":true}');
  });
  target.on('tlsClientError', () => {});
  target.on('secureConnection', stream => stream.on('error', () => {}));
  const tunnel = server => server.on('connect', (req, client, head) => {
    connects.push({ url: req.url, headers: req.headers, head: head.length });
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    const a = socket(chunk => b.push(chunk)), b = socket(chunk => a.push(chunk));
    a.on('error', () => {}); b.on('error', () => {});
    target.emit('connection', b);
    client.pipe(a).pipe(client);
    client.on('close', () => { a.destroy(); b.destroy(); });
  });
  const proxy = tunnel(http.createServer());
  const tlsProxy = tunnel(https.createServer(tlsOptions));
  tlsProxy.on('tlsClientError', () => {});
  tlsProxy.on('secureConnection', stream => stream.on('error', () => {}));
  const refused = http.createServer().on('connect', (_req, client) => client.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'));
  const servers = new Map([['target.test', target], ['proxy.test:8080', proxy], ['proxy.test:8443', tlsProxy], ['proxy.test:8888', refused]]);
  const url = new URL('https://target.test/api/cli-auth/v1/credential');
  await virtualNetwork(servers, async () => {
    assert.equal((await requestJSON(url, { token: secret, env: { HTTPS_PROXY: 'http://user:pass@proxy.test:8080' } })).status, 200);
    assert.equal((await requestJSON(url, { token: secret, env: { HTTPS_PROXY: 'https://proxy.test:8443' } })).status, 200);
    assert.equal((await requestJSON(url, { token: secret, env: { HTTPS_PROXY: 'http://proxy.test:8080', NO_PROXY: 'target.test' } })).status, 200);
    await assert.rejects(requestJSON(url, { token: secret, env: { HTTPS_PROXY: 'http://proxy.test:8888' } }), error => error.kind === 'network');
  }, ca);
  await virtualNetwork(servers, async () => {
    await assert.rejects(requestJSON(url, { token: secret, env: {} }), error => error.kind === 'network');
    await assert.rejects(requestJSON(url, { token: secret, env: { HTTPS_PROXY: 'http://proxy.test:8080' } }), error => error.kind === 'network');
  });
  assert.equal(protectedRequests.length, 3);
  assert.equal(connects.length, 3);
  for (const request of connects) {
    assert.equal(request.url, 'target.test:443'); assert.equal(request.head, 0);
    assert.equal(request.headers.authorization, undefined);
    assert.ok(!JSON.stringify(request).includes(secret));
  }
  for (const request of protectedRequests) {
    assert.equal(request.headers.authorization, `Bearer ${secret}`);
    assert.equal(request.headers['proxy-authorization'], undefined);
  }
});

for (const scope of ['project', 'local']) {
  test(`setup supplements a ${scope}-only installation with user scope`, async t => {
    const r = await fixture(t, { marketplace: true, installed: true, entries: [{ scope, version: '0.3.0' }] });
    assert.equal(r.code, 0, r.stdout);
    const commands = r.calls.map(command);
    assert.ok(commands.includes(`plugin update cairn-memory@cairn-memory --scope ${scope}`));
    assert.ok(commands.includes('plugin install cairn-memory@cairn-memory --scope user'));
    assert.ok(commands.indexOf('plugin marketplace update cairn-memory') < commands.indexOf(`plugin update cairn-memory@cairn-memory --scope ${scope}`));
    assert.deepEqual(r.state.entries.map(entry => entry.scope).sort(), [scope, 'user'].sort());
    assert.equal(r.server.grant.state, 'delivered');
  });
}

test('mixed scopes explicitly update user scope, without installing a duplicate', async t => {
  const r = await fixture(t, { marketplace: true, installed: true, configured: true,
    entries: [{ scope: 'project', version: '0.3.0' }, { scope: 'user', version: '0.3.0' }] });
  assert.equal(r.code, 0, r.stdout);
  assert.ok(r.calls.map(command).includes('plugin update cairn-memory@cairn-memory --scope user'));
  assert.ok(r.calls.map(command).includes('plugin update cairn-memory@cairn-memory --scope project'));
  assert.ok(!r.calls.some(call => call.args.includes('install') && !call.args.includes('--help')));
  assert.equal(r.state.entries.find(entry => entry.scope === 'user').version, '0.3.1');
  assert.ok(r.state.entries.every(entry => entry.version === '0.3.1'));
});

for (const skew of [-31536000000, -61000, 3000, 31536000000]) {
  test(`ACK succeeds with server clock skew ${skew}ms`, async t => {
    const r = await fixture(t, {}, { server: { clockSkew: skew } });
    assert.equal(r.code, 0, r.stdout); assert.equal(r.server.grant.state, 'delivered');
    assert.equal(r.budgets.find(entry => entry.route === 'credential').timeout, 15000);
    assert.equal(r.budgets.find(entry => entry.route === 'ack').timeout, 15000);
    assert.ok(!r.server.requests.some(request => request.route === 'cancel'));
  });
}

for (const skew of [-31536000000, -61000, 61000, 31536000000]) {
  test(`ACK succeeds with client clock skew ${skew}ms`, async t => {
    const r = await fixture(t, {}, { clientSkew: skew });
    assert.equal(r.code, 0, r.stdout); assert.equal(r.server.grant.state, 'delivered');
  });
}

for (const jump of [-86400000, 86400000]) {
  test(`a wall-clock jump of ${jump}ms after credential check does not change the ACK budget`, async t => {
    const r = await fixture(t, {}, { wallJumpAfterCredential: jump, latency: { token: 5000, credential: 4000 } });
    assert.equal(r.code, 0, r.stdout); assert.equal(r.server.grant.state, 'delivered');
    assert.equal(r.budgets.find(entry => entry.route === 'ack').timeout, 15000);
  });
}

test('a six-second ACK response succeeds with a longer per-attempt timeout', async t => {
  const r = await fixture(t, {}, { latency: { ack: 6000 } });
  assert.equal(r.code, 0, r.stdout); assert.equal(r.server.grant.state, 'delivered');
  assert.equal(r.budgets.filter(entry => entry.route === 'ack').length, 1);
  assert.equal(r.budgets.find(entry => entry.route === 'ack').timeout, 15000);
});

// Exercise exact elapsed budgets through the same fake HTTP server and native
// HTTP parsers, while advancing only the injected monotonic clock.
async function timedAuthorization(t, { serverOptions = {}, tokenTimes = [], credentialTime = 0, saveTime = 0, ackConsumesTimeout = false } = {}) {
  const server = await fakeAuthServer(t, serverOptions);
  let clock = 0, tokenAttempts = 0, configured = false;
  const budgets = [], messages = [];
  let result, error;
  try {
    result = await browserAuthorize(server.endpoint, {
      write: value => messages.push(value), noBrowser: true, copy: async () => false,
      now: () => clock, sleep: async ms => { clock += ms; }, jitter: () => 0.25,
      progress: () => () => {},
      save: async (_values, timeout) => { budgets.push({ route: 'save', clock, timeout }); configured = true; clock += saveTime; },
      request: async (url, options) => {
        const route = url.pathname.split('/').at(-1);
        budgets.push({ route, clock, timeout: options.timeout });
        try { return await localWireRequest(server.server, requestJSON, url, { ...options, env: {} }); }
        finally {
          if (route === 'token') clock += tokenTimes[tokenAttempts++] ?? 0;
          if (route === 'credential') clock += credentialTime;
          if (route === 'ack' && ackConsumesTimeout) clock += options.timeout;
        }
      },
    });
  } catch (caught) { error = caught; }
  for (const value of [secret, server.grant?.device_code, server.lastProof?.code_verifier, server.delivery?.delivery_receipt].filter(Boolean)) {
    assert.ok(!messages.join('\n').includes(value)); assert.ok(!JSON.stringify(budgets).includes(value));
  }
  return { server, budgets, configured, result, error, clock };
}

test('replayed token response keeps the original monotonic ACK deadline', async t => {
  const r = await timedAuthorization(t, { serverOptions: { sequence: ['lost_delivery'] }, tokenTimes: [15000, 5000], credentialTime: 10000, saveTime: 10000 });
  assert.equal(r.error, undefined); assert.equal(r.server.grant.state, 'delivered');
  assert.equal(r.budgets.find(entry => entry.route === 'save').timeout, 18750);
  assert.equal(r.budgets.find(entry => entry.route === 'ack').timeout, 8750);
  const polls = r.server.requests.filter(request => request.route === 'token');
  assert.deepEqual(polls[0].body, polls[1].body);
});

test('ACK retries are capped by the remaining monotonic window and provide concrete recovery steps', async t => {
  const r = await timedAuthorization(t, { serverOptions: { ackUnavailable: true }, credentialTime: 10000, saveTime: 10000, ackConsumesTimeout: true });
  assert.equal(r.error.kind, 'ack_unknown'); assert.equal(r.configured, true);
  assert.deepEqual(r.budgets.filter(entry => entry.route === 'ack').map(entry => entry.timeout), [15000, 15000, 7500]);
  assert.equal(r.clock, 64000); // exchange began at 5s; conservative window is 59s
  assert.match(r.error.message, /Wait 60 seconds.*restart Claude Code.*\/cairn-memory:status/);
  assert.match(r.error.message, /\/settings\/tokens.*setup --reauthorize/);
  assert.ok(!r.server.requests.some(request => request.route === 'cancel'));
});

test('saving that consumes the ACK budget cancels instead of starting another window', async t => {
  const r = await timedAuthorization(t, { saveTime: 60000 });
  assert.equal(r.error.kind, 'configure'); assert.equal(r.server.grant.state, 'cancelled');
  assert.ok(!r.server.requests.some(request => request.route === 'ack'));
  assert.match(r.error.message, /setup --reauthorize/);
});

for (const server of [{ sequence: [501] }, { ackStatus: 501 }]) {
  test(`501 on poll/ACK stops after one attempt ${JSON.stringify(server)}`, async t => {
    const r = await fixture(t, {}, { server });
    assert.equal(r.code, 1);
    if (server.sequence) {
      assert.equal(r.server.polls, 1); assert.equal(r.server.grant.state, 'cancelled');
      assert.match(r.stdout, /protocol error/);
    } else {
      assert.equal(r.server.requests.filter(request => request.route === 'ack').length, 1);
      assert.match(r.stdout, /delivery is unconfirmed/);
    }
  });
}

test('active token limit is actionable instead of an indefinite rate-limit wait', async t => {
  const r = await fixture(t, {}, { server: { sequence: ['active_token_limit'] } });
  assert.equal(r.code, 1); assert.match(r.stdout, /Active token limit reached.*\/settings\/tokens/);
  assert.equal(r.server.polls, 1); assert.equal(r.server.grant.state, 'cancelled');
});

test('loopback HTTP never uses a proxy, even without NO_PROXY', async t => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    assert.equal(proxyFor(new URL(`http://${host}:3000`), { HTTP_PROXY: 'http://proxy.test:8080' }), null);
  }
  const r = await fixture(t, {}, { env: { HTTP_PROXY: 'http://proxy.test:8080' } });
  assert.equal(r.code, 0); assert.ok(r.server.requests.every(request => request.url.startsWith('/api/cli-auth/v1/')));
});

test('old CLI instructions include installation before configuration', async t => {
  const r = await fixture(t, { noConfigure: true });
  assert.equal(r.code, 1); assert.equal(r.state.installed, undefined);
  assert.match(r.stdout, /\/plugin marketplace add.*\n\/plugin install.*\n/s);
  assert.ok(r.stdout.indexOf('/plugin install') < r.stdout.indexOf('/plugin configure'));
});

test('expiry uses the client timezone rather than a UTC date slice', async t => {
  const r = await fixture(t, {}, { env: { TZ: 'America/Los_Angeles' }, server: { expiresAt: '2027-04-05T00:30:00.000Z' } });
  assert.equal(r.code, 0, r.stdout); assert.match(r.stdout, /Credential expires 4\/4\/2027/);
});

test('ACK attempts also reserve timestamp rounding before grant expiry', async t => {
  const r = await timedAuthorization(t, { serverOptions: { expiresIn: 10 } });
  assert.equal(r.error, undefined); assert.equal(r.server.grant.state, 'delivered');
  assert.equal(r.budgets.find(entry => entry.route === 'ack').timeout, 4000);
});


test('language selection follows LC_ALL, LC_MESSAGES, LANG, then Intl locale', () => {
  for (const [env, locale, expected] of [
    [{ LANG: 'zh_TW.UTF-8' }, 'en-US', 'zh'],
    [{ LANG: 'en_US.UTF-8' }, 'zh-TW', 'en'],
    [{ LANG: 'C' }, 'zh-TW', 'en'],
    [{}, 'zh-TW', 'zh'], [{}, 'en-US', 'en'],
    [{ LC_ALL: 'en_US.UTF-8', LC_MESSAGES: 'zh_TW.UTF-8', LANG: 'zh_TW.UTF-8' }, 'zh-TW', 'en'],
    [{ LC_ALL: '', LC_MESSAGES: 'zh_CN.UTF-8', LANG: 'en_US.UTF-8' }, 'en-US', 'zh'],
  ]) assert.equal(detectLanguage(env, locale), expected);
  assert.equal(detectLanguage({}), /^zh/iu.test(Intl.DateTimeFormat().resolvedOptions().locale) ? 'zh' : 'en');
  for (const [key, value] of Object.entries(messages)) {
    assert.deepEqual(Object.keys(value).sort(), ['en', 'zh'], key);
    assert.equal(typeof value.zh, 'string'); assert.equal(typeof value.en, 'string');
    assert.doesNotMatch(value.en, /[\p{Script=Han}]/u, key);
  }
});

for (const [name, env, locale, language] of [
  ['zh_TW.UTF-8', { LANG: 'zh_TW.UTF-8' }, 'en-US', 'zh'],
  ['en_US.UTF-8', { LANG: 'en_US.UTF-8' }, 'zh-TW', 'en'],
  ['C', { LANG: 'C' }, 'zh-TW', 'en'],
  ['unset/zh Intl', { LANG: undefined }, 'zh-TW', 'zh'],
  ['unset/en Intl', { LANG: undefined }, 'en-US', 'en'],
]) {
  test(`browser authorization uses one language: ${name}`, async t => {
    const r = await fixture(t, {}, { env, locale });
    assert.equal(r.code, 0, r.stdout);
    if (language === 'zh') {
      assert.match(r.stdout, /安裝器.*複製這組一次性代碼.*Cairn Memory 已連線/su);
      assert.doesNotMatch(r.stdout, /Installer|Copy this one-time code|Waiting for approval|is connected/);
      assert.match(r.prompts[0].question, /確認 Cairn endpoint/u);
    } else {
      assert.match(r.stdout, /Installer.*Copy this one-time code.*Cairn Memory is connected/s);
      assert.doesNotMatch(r.stdout + JSON.stringify(r.prompts), /[\p{Script=Han}]/u);
    }
  });
}

for (const lang of ['zh', 'en']) {
  test(`--lang ${lang} overrides environment for prompts, errors, and help`, async t => {
    const env = { LC_ALL: lang === 'zh' ? 'en_US.UTF-8' : 'zh_TW.UTF-8' };
    const r = await fixture(t, {}, { args: ['setup', '--lang', lang, '--no-browser'], env, server: { sequence: ['access_denied'] } });
    assert.equal(r.code, 1);
    assert.match(r.stdout, lang === 'zh' ? /你已拒絕授權/u : /Authorization was denied/);
    assert.doesNotMatch(r.stdout, lang === 'zh' ? /Authorization was denied/ : /[\p{Script=Han}]/u);
    const help = await fixture(t, {}, { args: ['--help', '--lang', lang], env });
    assert.equal(help.code, 0); assert.match(help.stdout, /--endpoint <origin>.*--lang zh\|en/);
    assert.match(help.stdout, lang === 'zh' ? /用法/u : /Usage/);
  });
}

test('--endpoint wins over prompt/default and old configured endpoint during reauthorization', async t => {
  const r = await fixture(t, { configured: true, endpoint: 'https://old.example' }, {
    args: ['setup', '--endpoint', 'http://localhost:3030/', '--reauthorize', '--no-browser'], server: { endpoint: 'http://localhost:3030' },
  });
  assert.equal(r.code, 0, r.stdout); assert.deepEqual(r.prompts, []);
  assert.equal(saved(r).endpoint, 'http://localhost:3030');
  assert.match(r.stdout, /Cairn endpoint: http:\/\/localhost:3030 \(from --endpoint\)/);
  assert.ok(r.server.requests.every(request => request.headers.host === 'localhost:3030'));
});

test('endpoint source is explicit for default, prompt and preserved Claude config', async t => {
  const lines = [];
  const endpoint = await selectEndpoint({ prompt: async () => '', write: line => lines.push(line), t: translator('en') });
  assert.equal(endpoint, 'https://cairn.ink');
  assert.match(lines[0], /Cairn endpoint: https:\/\/cairn\.ink \(default\)/);
  const fromPrompt = await fixture(t);
  assert.match(fromPrompt.stdout, /Cairn endpoint: .*\(from prompt\)/);
  const kept = await fixture(t, { configured: true });
  assert.match(kept.stdout, /Cairn endpoint: kept from existing config.*value not read back.*no authorization request/);
  assert.deepEqual(kept.server.requests, []);
});

test('--endpoint with an existing token requires explicit reauthorization', async t => {
  const r = await fixture(t, { configured: true }, { args: ['setup', '--endpoint', 'https://selected.example'] });
  assert.equal(r.code, 2); assert.match(r.stdout, /also pass --reauthorize/);
  assert.deepEqual(r.server.requests, []); assert.equal(saved(r), undefined);
});

for (const args of [
  ['setup', '--endpoint'], ['setup', '--endpoint', 'https://user:secret@example.com'],
  ['setup', '--endpoint', 'https://example.com/path'], ['setup', '--endpoint', 'http://remote.example'],
  ['setup', '--endpoint', 'https://example.com?token=secret'], ['status', '--endpoint', 'https://example.com'],
  ['setup', '--endpoint', 'https://example.com', '--endpoint', 'https://example.com'],
  ['setup', '--lang'], ['setup', '--lang', 'secret'], ['setup', '--lang', 'en', '--lang', 'en'],
]) {
  test(`invalid new option fails before child calls: ${JSON.stringify(args)}`, async t => {
    const r = await fixture(t, {}, { args });
    assert.equal(r.code, 2); assert.deepEqual(r.calls, []); assert.deepEqual(r.server.requests, []);
    assert.doesNotMatch(r.stdout, /secret/);
  });
}

test('--endpoint dry-run reports origin without network, prompt or mutation', async t => {
  const r = await fixture(t, {}, { args: ['setup', '--dry-run', '--endpoint', 'http://localhost:3030', '--lang', 'zh'] });
  assert.equal(r.code, 0); assert.match(r.stdout, /Cairn endpoint：http:\/\/localhost:3030（來自 --endpoint）/u);
  assert.deepEqual(r.prompts, []); assert.deepEqual(r.server.requests, []); assert.deepEqual(r.browses, []);
});

test('TTY redraw retains the visible endpoint question; hidden paste never echoes', async () => {
  for (const secretInput of [false, true]) {
    const input = new PassThrough(); input.isTTY = true;
    const rawModes = []; input.setRawMode = value => rawModes.push(value);
    let text = '';
    const output = new Writable({ write(chunk, _encoding, done) { text += chunk; done(); } });
    output.isTTY = true; output.columns = 100;
    const question = secretInput ? 'PAT (hidden input): ' : 'Confirm Cairn endpoint [https://cairn.ink]: ';
    const pending = ask(question, { secret: secretInput, input, output });
    assert.ok(text.includes(question), 'question visible before input');
    input.write(secretInput ? 'synthetic-hidden-paste' : 'https://local.example');
    input.write('\u0001X\u007f'); // insert/delete at the beginning forces a full readline redraw
    input.write('\r');
    assert.equal(await pending, secretInput ? 'synthetic-hidden-paste' : 'https://local.example');
    if (secretInput) assert.ok(!text.includes('synthetic-hidden-paste'));
    else assert.ok(text.split(question).length > 2, 'readline owns and redraws the question');
    assert.equal(rawModes.at(-1), false);
    input.destroy(); output.destroy();
  }
});


for (const lang of ['en', 'zh']) {
  test(`device code stands out and Enter gates browser open (${lang})`, async t => {
    const r = await fixture(t, {}, { args: ['setup', '--lang', lang, '--no-clipboard'], outputTTY: true });
    assert.equal(r.code, 0, r.stdout); assert.equal(r.prompts.length, 2);
    assert.match(r.stdout, /\n\n! .*\x1b\[1;36mABCD-EFGH\x1b\[0m\n\n(?:Press Enter|按 Enter)/u);
    assert.match(r.prompts[1].question, lang === 'zh' ? /按 Enter.*127\.0\.0\.1:31415\/device/u : /Press Enter.*127\.0\.0\.1:31415\/device/);
    assert.ok(r.stdout.indexOf('browser opened') > r.stdout.indexOf(lang === 'zh' ? '按 Enter' : 'Press Enter'));
    assert.match(r.stdout, lang === 'zh' ? /代碼將於 10 分鐘後到期/u : /Code expires in 10 minutes/);
    assert.match(r.stdout, lang === 'zh' ? /等待你在瀏覽器允許（代碼 ABCD-EFGH）/u : /Waiting for approval \(code ABCD-EFGH\)/);
    assert.doesNotMatch(r.stdout, /GMT|Code deadline|AM |PM /);
  });
}

test('non-TTY output brackets the code, prints only the URL with --no-browser, and repeats it while waiting', async t => {
  const r = await fixture(t, {}, { args: ['setup', '--no-browser', '--no-clipboard'] });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /\n\n! Copy this one-time code: \[ ABCD-EFGH \]\n\nhttp:\/\/127\.0\.0\.1:31415\/device\n/);
  assert.doesNotMatch(r.stdout, /\x1b|Press Enter/); assert.equal(r.prompts.length, 1); assert.deepEqual(r.browses, []);
  assert.match(r.stdout, /Waiting for approval \(code ABCD-EFGH\)… 10:00/);
});

test('NO_COLOR suppresses bold/color in a TTY but preserves a prominent code', async t => {
  const r = await fixture(t, {}, { outputTTY: true, env: {NO_COLOR:''} });
  assert.equal(r.code, 0); assert.match(r.stdout, /! Copy this one-time code: \[ ABCD-EFGH \]/);
  assert.doesNotMatch(r.stdout, /\x1b\[1;36m/);
});

for (const clipboard of ['present', 'absent', 'failure', 'hang']) {
  test(`optional clipboard tool ${clipboard} never blocks successful authorization`, async t => {
    const r = await fixture(t, {}, {args:['setup'],clipboard});
    assert.equal(r.code, 0, r.stdout);
    assert.doesNotMatch(r.stdout, /clipboard-child-output-hidden/);
    if (clipboard === 'present') {
      assert.match(r.prompts[1].question, /copied to clipboard/);
      assert.deepEqual(r.clipboard, [{args:['--type','text/plain'],input:'ABCD-EFGH'}]);
    } else assert.doesNotMatch(r.stdout, /copied to clipboard/);
    assert.ok(!JSON.stringify(r.clipboard).includes(secret));
  });
}

test('--no-clipboard skips an available tool, and SSH avoids a forwarded clipboard', async t => {
  for (const options of [{args:['setup','--no-clipboard']}, {env:{SSH_CONNECTION:'fixture'}}]) {
    const r = await fixture(t, {}, {clipboard:'present',...options});
    assert.equal(r.code, 0); assert.deepEqual(r.clipboard, []); assert.doesNotMatch(r.stdout, /copied to clipboard/);
  }
});

test('Ctrl-C at the Enter gate cancels before browser open or token polling', async t => {
  const r = await fixture(t, {}, {args:['setup','--no-clipboard'],interruptEnter:true});
  assert.equal(r.code, 130); assert.deepEqual(r.browses, []); assert.equal(saved(r), undefined);
  assert.deepEqual(r.server.requests.map(request=>request.route), ['device-authorizations','cancel']);
  assert.equal(r.server.grant.state, 'cancelled');
});

test('waiting for Enter cannot reset or outlive the grant budget', async t => {
  const delayed = await fixture(t, {}, {args:['setup','--no-clipboard'],enterDelay:61000});
  assert.equal(delayed.code, 0); assert.match(delayed.stdout, /Code expires in 9 minutes/);
  const expired = await fixture(t, {}, {args:['setup','--no-clipboard'],enterDelay:600000});
  assert.equal(expired.code, 1); assert.match(expired.stdout, /Authorization timed out/);
  assert.deepEqual(expired.browses, []); assert.equal(saved(expired), undefined);
  assert.equal(expired.server.grant.state, 'cancelled');
});


test('Enter prompt timeout aborts readline, restores raw mode, and cancels without opening a browser', async t => {
  const server = await fakeAuthServer(t, {expiresIn:1});
  const input = new PassThrough(); input.isTTY=true;
  const rawModes=[]; input.setRawMode=value=>rawModes.push(value);
  let output='';const terminal = new Writable({write(chunk,_encoding,done){output+=chunk;done();}});
  terminal.columns=100;terminal.isTTY=true;
  let clock=0,browsed=false;
  await assert.rejects(browserAuthorize(server.endpoint, {
    t:translator('en'),write:()=>{},copy:async()=>false,tty:false,now:()=>clock,
    prompt:(question,options)=>ask(question,{...options,input,output:terminal}),
    browse:async()=>{browsed=true;},
    request:async(url,options)=>{
      const response=await localWireRequest(server.server,requestJSON,url,{...options,env:{}});
      if(url.pathname.endsWith('/device-authorizations'))clock=999;
      return response;
    },
  }), error=>error.kind==='timeout');
  assert.match(output,/Press Enter/);assert.equal(rawModes.at(-1),false);assert.equal(browsed,false);
  assert.deepEqual(server.requests.map(request=>request.route),['device-authorizations','cancel']);
  assert.equal(server.grant.state,'cancelled');input.destroy();terminal.destroy();
});


test('real readline Enter gates browser opening and polling until the code is visible', async t => {
  const server=await fakeAuthServer(t);
  const input=new PassThrough();input.isTTY=true;input.setRawMode=()=>{};
  let screen='';const output=new Writable({write(chunk,_encoding,done){screen+=chunk;done();}});
  output.isTTY=true;output.columns=100;
  let clock=0,browsed=false,atGate;
  const gate=new Promise(resolve=>{atGate=resolve;});
  const pending=browserAuthorize(server.endpoint,{
    t:translator('en'),write:line=>{screen+=line+'\n';},tty:false,copy:async()=>false,
    now:()=>clock,sleep:async ms=>{clock+=ms;},
    prompt:(question,options)=>{const answer=ask(question,{...options,input,output});atGate();return answer;},
    browse:async()=>{browsed=true;},save:async values=>{values.api_token=undefined;},
    request:(url,options)=>localWireRequest(server.server,requestJSON,url,{...options,env:{}}),
  });
  await gate;
  assert.match(screen,/! Copy this one-time code: \[ ABCD-EFGH \].*Press Enter/s);
  assert.equal(browsed,false);assert.deepEqual(server.requests.map(request=>request.route),['device-authorizations']);
  input.write('\r');const result=await pending;
  assert.ok(result.expiresAt);assert.equal(browsed,true);assert.equal(server.grant.state,'delivered');
  input.destroy();output.destroy();
});

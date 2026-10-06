import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync, writeSync } from 'node:fs';

// Write directly to the child descriptors so the recorder does not depend on
// asynchronous console flushing at process exit.
const console = { log: value => writeSync(1, `${value}\n`), error: value => writeSync(2, `${value}\n`) };

const args = process.argv.slice(2);
const input = readFileSync(0, 'utf8');
const values = input ? JSON.parse(input) : {};
appendFileSync(process.env.FAKE_CALLS, `${JSON.stringify({ args, env: process.env, keys: Object.keys(values), endpoint: values.api_endpoint, tokenDigest: values.api_token ? createHash('sha256').update(values.api_token).digest('hex') : undefined })}\n`);
const state = JSON.parse(readFileSync(process.env.FAKE_STATE, 'utf8'));
const scopeIndex = args.indexOf('--scope');
const command = (scopeIndex < 0 ? args : args.filter((_, index) => index !== scopeIndex && index !== scopeIndex + 1)).join(' ');
const entry = scope => ({ scope, version: state.version || '0.3.0' });
const entries = state.entries ?? (state.installed ? [entry('user')] : []);
if (state.fail === command) {
  console.error(values.api_token || state.token || 'synthetic-child-error');
  process.exit(state.failCode || 7);
}
if (command === '--version') console.log('2.1.289 (Claude Code)');
else if (args.at(-1) === '--help') {
  if (state.noInstall && command.includes(' install ')) console.log('Usage: claude');
  else if (state.noConfigure && command.includes(' configure ')) {
    console.log('Usage: claude'); process.exitCode = 1;
  } else console.log(`Usage: claude ${args.slice(0, -1).join(' ')} [options]\n--json --values-stdin`);
} else if (command === 'plugin marketplace list --json') {
  console.log(JSON.stringify(state.marketplace ? [{ name: 'cairn-memory' }] : []));
} else if (command === 'plugin marketplace add Cairn-ink/cairn-memory') state.marketplace = true;
else if (command === 'plugin marketplace update cairn-memory') state.marketplaceUpdated = true;
else if (command === 'plugin install cairn-memory@cairn-memory' || command === 'plugin update cairn-memory@cairn-memory') {
  const scope = scopeIndex >= 0 ? args[scopeIndex + 1] : (command.includes(' update ') ? entries[0]?.scope : 'user');
  let target = entries.find(value => value.scope === scope);
  if (!target) { target = entry(scope); entries.push(target); }
  target.version = '0.3.1';
  state.entries = entries; state.installed = true; state.version = '0.3.1';
}
else if (command === 'plugin list --json') {
  console.log(state.badJSON ? 'bad JSON including ' + state.token : JSON.stringify(entries.map(value => ({
    id: 'cairn-memory@cairn-memory', version: value.version, scope: value.scope, enabled: !state.disabled,
    errors: state.loadErrors ? [state.token] : [],
    mcpServers: { cairn: { headers: { Authorization: state.token } } },
  }))));
} else if (command === 'plugin configure cairn-memory@cairn-memory --json') {
  const configured = state.configured ? ['api_endpoint', 'api_token'] : (state.partial ?? []);
  console.log(JSON.stringify({ configured,
    unconfigured: ['api_endpoint', 'api_token'].filter(key => !configured.includes(key)), inputs: { api_token: state.token } }));
} else if (command === 'plugin configure cairn-memory@cairn-memory --values-stdin') {
  if (state.interruptConfigure) {
    process.kill(process.ppid, 'SIGINT');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (values.api_token !== undefined) state.tokenReceived = true;
  if (values.api_endpoint !== undefined) state.endpoint = values.api_endpoint;
  state.configured = !state.incompleteSave;
  // A noisy or broken child must never cause the installer to reveal the PAT.
  console.log(values.api_token); console.error(values.api_token);
} else if (command === 'mcp get cairn') {
  if (state.mcp) console.log('Scope: User config\nAuthorization: ' + state.token);
  else { console.error('No MCP server named "cairn". Run `claude mcp add` to add one.'); process.exitCode = 1; }
} else if (command === 'mcp remove cairn') state.mcp = false;
else { console.error('Unexpected command ' + command); process.exitCode = 99; }
writeFileSync(process.env.FAKE_STATE, JSON.stringify(state));

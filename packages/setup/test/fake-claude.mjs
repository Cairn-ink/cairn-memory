import { appendFileSync, readFileSync, writeFileSync, writeSync } from 'node:fs';

// Write directly to the child descriptors so the recorder does not depend on
// asynchronous console flushing at process exit.
const console = { log: value => writeSync(1, `${value}\n`), error: value => writeSync(2, `${value}\n`) };

const args = process.argv.slice(2);
const input = readFileSync(0, 'utf8');
appendFileSync(process.env.FAKE_CALLS, `${JSON.stringify({ args, input })}\n`);
const state = JSON.parse(readFileSync(process.env.FAKE_STATE, 'utf8'));
const command = args.join(' ');
if (state.fail === command) {
  console.error(state.token || 'synthetic-child-error');
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
else if (command === 'plugin install cairn-memory@cairn-memory') state.installed = true;
else if (command === 'plugin list --json') {
  console.log(state.badJSON ? 'bad JSON including ' + state.token : JSON.stringify(state.installed ? [{
    id: 'cairn-memory@cairn-memory', scope: 'user', enabled: !state.disabled,
    errors: state.loadErrors ? [state.token] : [],
    mcpServers: { cairn: { headers: { Authorization: state.token } } },
  }] : []));
} else if (command === 'plugin configure cairn-memory@cairn-memory --json') {
  const configured = state.configured ? ['api_endpoint', 'api_token'] : (state.partial ?? []);
  console.log(JSON.stringify({ configured,
    unconfigured: ['api_endpoint', 'api_token'].filter(key => !configured.includes(key)), inputs: { api_token: state.token } }));
} else if (command === 'plugin configure cairn-memory@cairn-memory --values-stdin') {
  const values = JSON.parse(input);
  if (values.api_token !== undefined) state.token = values.api_token;
  if (values.api_endpoint !== undefined) state.endpoint = values.api_endpoint;
  state.configured = !state.incompleteSave;
  // A noisy or broken child must never cause the installer to reveal the PAT.
  console.log(state.token); console.error(state.token);
} else if (command === 'mcp get cairn') {
  if (state.mcp) console.log('Scope: User config\nAuthorization: ' + state.token);
  else { console.error('No MCP server named "cairn". Run `claude mcp add` to add one.'); process.exitCode = 1; }
} else if (command === 'mcp remove cairn') state.mcp = false;
else { console.error('Unexpected command ' + command); process.exitCode = 99; }
writeFileSync(process.env.FAKE_STATE, JSON.stringify(state));

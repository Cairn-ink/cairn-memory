import { appendFileSync, readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
readFileSync(0, 'utf8');
const args = process.argv.slice(2);
const state = JSON.parse(readFileSync(process.env.FAKE_STATE, 'utf8'));
const home = process.env.CODEX_HOME || join(process.env.HOME, '.codex');
appendFileSync(process.env.FAKE_CALLS, JSON.stringify({ args, home }) + '\n');
if (state.fail === args.join(' ') || (state.failValidation && home.includes('.cairn-validate-'))) {
  writeSync(2, state.token); process.exit(7);
}
if (args.includes('--help')) {
  writeSync(1, state.old ? 'old CLI' : '--url --json'); process.exit(0);
}
if (args[0] === '--version') { writeSync(1, 'codex-cli 0.160.0'); process.exit(0); }
if (state.badJSON) { writeSync(1, state.token); process.exit(0); }
let text = '';
try { text = readFileSync(join(home, 'config.toml'), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const table = text.match(/^\[mcp_servers\.cairn\]\n([\s\S]*?)(?=^\[|$(?![\s\S]))/mu)?.[1];
const authTable = text.match(/^\[mcp_servers\.cairn\.http_headers\]\n([\s\S]*?)(?=^\[|$(?![\s\S]))/mu)?.[1];
if ((text.match(/^\[mcp_servers\.cairn\.http_headers\]/gmu) || []).length > 1 || text.includes('INVALID_TOML')) {
  writeSync(2, state.token); process.exit(2);
}
const value = (block, key) => {
  const raw = block?.match(new RegExp('^' + key + ' = (.+)$', 'mu'))?.[1];
  return raw ? JSON.parse(raw) : null;
};
const entry = table ? { name: 'cairn', enabled: !table.includes('enabled = false'), transport: {
  type: table.includes('command =') ? 'stdio' : 'streamable_http', url: value(table, 'url'),
  bearer_token_env_var: value(table, 'bearer_token_env_var'),
  http_headers: authTable ? { Authorization: value(authTable, 'Authorization') } : null,
  env_http_headers: null, http_headers_helper: null,
} } : null;
if (args.join(' ') === 'mcp list --json') { writeSync(1, JSON.stringify(entry ? [{...entry, auth_status: state.authStatus || 'unsupported'}] : [])); process.exit(0); }
if (args.join(' ') === 'mcp get cairn --json') {
  if (!entry) process.exit(1);
  writeSync(1, JSON.stringify(entry)); process.exit(0);
}
writeSync(2, state.token); process.exit(9);

import { appendFileSync, readFileSync, writeSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
readFileSync(0, 'utf8');
const args = process.argv.slice(2);
const state = JSON.parse(readFileSync(process.env.FAKE_STATE, 'utf8'));
const home = process.env.CODEX_HOME || join(process.env.HOME, '.codex');
appendFileSync(process.env.FAKE_CALLS, JSON.stringify({ args, home, cwd: process.cwd(),
  ...(state.recordEnv ? {env:process.env} : {}) }) + '\n');
if (process.env.FAKE_GLOBAL_CALLS) appendFileSync(process.env.FAKE_GLOBAL_CALLS, JSON.stringify({ client: 'codex', args }) + '\n');
if (state.fail === args.join(' ') || (state.failValidation && (home.includes('.cairn-validate-') || home.includes('cx5-candidate')))) {
  writeSync(2, state.token); process.exit(7);
}
if (args.includes('--help')) {
  writeSync(1, state.old || (state.noMcpAdd && args[1] === 'add') ? 'old CLI' : '--url --json -- <COMMAND>'); process.exit(0);
}
if (args[0] === '--version') { writeSync(1, 'codex-cli ' + (state.version ?? '0.160.0')); process.exit(0); }
if(args[0]==='app-server' && args[1]==='generate-json-schema' && state.formatEvidence) {
  if(state.failSchema){writeSync(2,'synthetic schema command failure');process.exit(7);}
  const selected=JSON.parse(readFileSync(join(state.formatEvidence,'binary-'+(state.version==='0.162.0'?'0.162.0':'0.160.1'),'format.json'),'utf8')).appServer;
  if(state.changedFormat)selected.ThreadHistoryMode.enum=['changed'];
  const out=args[args.indexOf('--out')+1];mkdirSync(out,{recursive:true});
  writeFileSync(join(out,'codex_app_server_protocol.schemas.json'),JSON.stringify({definitions:{v2:selected}}));process.exit(0);
}
if (state.badJSON) { writeSync(1, state.token); process.exit(0); }
let text = '';
try { text = readFileSync(join(home, 'config.toml'), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
// A trusted project supplies an effective entry only in its own cwd.
if (state.projectConfig && process.cwd() === state.projectCwd) text += state.projectConfig;
// The fake parses only fixture TOML. Track multiline strings so apparent
// headers inside them are not registrations, and resolve quoted server names.
const tables = []; let offset = 0, multiline = null, currentTable = null;
for (const line of text.split(/(?<=\n)/u)) {
  if (multiline) { if (line.includes(multiline)) multiline = null; offset += line.length; continue; }
  const triple = line.match(/(?:"""|''')/u)?.[0];
  if (triple && line.split(triple).length === 2) multiline = triple;
  const header = /^\[mcp_servers\.("(?:[^"\\]|\\.)*"|[\w-]+)(\.http_headers)?\]\s*$/u.exec(line.trim());
  const anyHeader = /^\[/u.test(line);
  if (anyHeader && currentTable) { currentTable.end = offset; currentTable = null; }
  if (header) tables.push({ name: header[1].startsWith('"') ? JSON.parse(header[1]) : header[1],
    auth: Boolean(header[2]), start: offset, body: offset + line.length, end: text.length });
  if (header) currentTable = tables.at(-1);
  offset += line.length;
}
const block = (name, auth = false) => { const table = tables.find(t => t.name === name && t.auth === auth); return table ? text.slice(table.body, table.end) : null; };
const table = block('cairn'), authTable = block('cairn', true);
if ((authTable && !table) || (table && !table.includes('url =') && !table.includes('command ='))) { writeSync(2, 'Error loading config.toml: invalid transport'); process.exit(1); }
if (tables.filter(t => t.name === 'cairn' && t.auth).length > 1 || text.includes('INVALID_TOML')) {
  writeSync(2, state.token || 'invalid TOML'); process.exit(2);
}
const value = (block, key) => {
  const raw = block?.match(new RegExp('^' + key + ' = (.+)$', 'mu'))?.[1];
  return raw ? JSON.parse(raw) : null;
};
const entry = table ? { name: 'cairn', enabled: !table.includes('enabled = false'), transport: {
  type: table.includes('command =') ? 'stdio' : 'streamable_http', url: value(table, 'url'),
  command: value(table, 'command'), args: value(table, 'args'),
  bearer_token_env_var: value(table, 'bearer_token_env_var'),
  http_headers: authTable ? { Authorization: value(authTable, 'Authorization') } : null,
  env_http_headers: null, http_headers_helper: null,
} } : null;
const localTable = block('cairn-local');
const local = localTable ? { name: 'cairn-local', enabled: true, transport: { type: 'stdio',
  command: value(localTable, 'command'), args: value(localTable, 'args') } } : null;
if (args[0] === 'mcp' && ['add', 'remove'].includes(args[1])) {
  const name = args[2];
  if (args[1] === 'add' && state.noMcpAdd) process.exit(1);
  // Remove only this table, preserving every other byte and its position.
  const owned = tables.filter(t => t.name === name).sort((a, b) => b.start - a.start);
  if (args[1] === 'remove') {
    for (const t of owned) text = text.slice(0, t.start) + text.slice(t.end);
  } else {
    const vector = args.slice(args.indexOf('--') + 1);
    const addition = `[mcp_servers.${JSON.stringify(name)}]\ncommand = ${JSON.stringify(vector[0])}\nargs = ${JSON.stringify(vector.slice(1))}\n`;
    if (owned.length) {
      const t = owned.at(-1); text = text.slice(0, t.start) + addition + text.slice(t.end);
    } else text += (text && !text.endsWith('\n') ? '\n' : '') + addition;
  }
  mkdirSync(home, { recursive: true, mode: 0o700 }); writeFileSync(join(home, 'config.toml'), text, { mode: 0o600 });
  if (state.killAfterAdd && args[1] === 'add') process.kill(process.ppid, 'SIGKILL');
  process.exit(0);
}
if (args.join(' ') === 'mcp list --json') {
  writeSync(1, JSON.stringify([entry, local].filter(Boolean).map(e => ({ ...e, auth_status: state.authStatus || 'not_logged_in' })))); process.exit(0);
}
if (args[0] === 'mcp' && args[1] === 'get' && args[3] === '--json') {
  const selected = args[2] === 'cairn-local' ? local : entry;
  if (!selected) { writeSync(2, `Error: No MCP server named '${args[2]}' found.\n`); process.exit(1); }
  writeSync(1, JSON.stringify(selected)); process.exit(0);
}
writeSync(2, state.token || 'unexpected command'); process.exit(9);

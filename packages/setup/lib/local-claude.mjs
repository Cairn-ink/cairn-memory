import { join } from 'node:path';
import { boundedJSON, sameVector, vectorArguments, executableFor, engineIdPattern } from './local-descriptor.mjs';
import { shellArgument } from './output.mjs';
import { SetupError } from './errors.mjs';

// Only the two named registrations are projected out. In particular, sibling
// entries and all authentication fields are discarded, including on failure.
export async function readClaudeServers(home) {
  let config;
  try { config = await boundedJSON(join(home, '.claude.json'), 4 * 1024 * 1024, { strict: false }); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw new SetupError('mode_unknown', 2, { client: 'Claude Code', probe: '~/.claude.json' }); }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new SetupError('mode_unknown', 2, { client: 'Claude Code', probe: '~/.claude.json' });
  if (!Object.hasOwn(config, 'mcpServers')) return {};
  if (!config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers)) {
    throw new SetupError('mode_unknown', 2, { client: 'Claude Code', probe: '~/.claude.json' });
  }
  const result = {};
  for (const name of ['cairn', 'cairn-local']) if (Object.hasOwn(config.mcpServers, name)) {
    const entry = config.mcpServers[name];
    result[name] = entry && typeof entry === 'object' ? { type: entry.type, command: entry.command,
      args: Array.isArray(entry.args) && entry.args.every(arg => typeof arg === 'string') ? entry.args : null } : {};
  }
  return result;
}
export function observedVector(root, entry) {
  if (!entry || (entry.type !== 'stdio') || typeof entry.command !== 'string' || !Array.isArray(entry.args)) return null;
  const args = entry.args;
  if (![5, 7].includes(args.length) || args[1] !== '--db' || args[3] !== '--owner' ||
      (args.length === 7 && args[5] !== '--project')) return null;
  const id = args[0]?.slice((join(root, 'engine') + '/').length).split('/')[0];
  if (!engineIdPattern.test(id) || args[0] !== executableFor(root, id)) return null;
  return { engineId: id, node: entry.command, databasePath: args[2], ownerId: args[4], projectId: args[6] ?? null };
}
export const claudeAddArguments = (root, vector) => ['mcp', 'add', '--transport', 'stdio', '--scope', 'user',
  'cairn-local', '--', vector.node, ...vectorArguments(root, vector)];
export const claudeSnippet = (root, vector) => ['claude', ...claudeAddArguments(root, vector)].map(shellArgument).join(' ');
export async function claudeCapabilities(run) {
  for (const [args, patterns] of [[['mcp', 'add', '--help'], [/--transport/u, /--scope/u]],
    [['mcp', 'remove', '--help'], [/--scope/u]]]) {
    const result = await run(args);
    if (result.error || result.status !== 0 || !patterns.every(pattern => pattern.test(result.stdout))) return false;
  }
  return true;
}
export async function registerClaude({ root, home, checkpoint, run, write, t }) {
  const { previous, desired } = checkpoint;
  const manual = (replace = false) => { write(t('local_manual_claude')); if (replace) write.literal('claude mcp remove --scope user cairn-local'); write.literal(claudeSnippet(root, desired)); };
  if (!await claudeCapabilities(run)) { write(t('claude_mcp_required')); manual(); return 'manual'; }
  const entry = (await readClaudeServers(home))['cairn-local'];
  const observed = entry ? observedVector(root, entry) : null;
  if (entry && sameVector(observed, desired)) return 'done';
  if (entry && (!previous || !sameVector(observed, previous))) {
    manual(true); throw new SetupError('claude_mcp_drifted', 2);
  }
  if (entry) await detachClaude({ home, run });
  const added = await run(claudeAddArguments(root, desired));
  if (added.error || added.status !== 0) {
    if (entry && previous) {
      const restored = await run(claudeAddArguments(root, previous));
      if (restored.error || restored.status !== 0 || !sameVector(observedVector(root,
        (await readClaudeServers(home))['cairn-local']), previous)) {
        write.literal(claudeSnippet(root, previous)); throw new SetupError('claude_mcp_restore_failed');
      }
    }
    manual(Boolean(entry)); throw new SetupError('claude_mcp_unverified');
  }
  if (!sameVector(observedVector(root, (await readClaudeServers(home))['cairn-local']), desired)) {
    manual(); throw new SetupError('claude_mcp_unverified');
  }
  return 'done';
}
export async function detachClaude({ home, run }) {
  const result = await run(['mcp', 'remove', '--scope', 'user', 'cairn-local']);
  const absent = !result.error && result.status === 1 &&
    /No MCP server named "cairn-local" in user scope/u.test(result.stdout + '\n' + result.stderr);
  if (result.error || (result.status !== 0 && !absent) || Object.hasOwn(await readClaudeServers(home), 'cairn-local')) {
    throw new SetupError('claude_mcp_unverified');
  }
}

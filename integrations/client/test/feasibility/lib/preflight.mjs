// Fail-closed isolation preflight. Every real-host step must pass it; any
// failed or unevaluable check blocks the step. I/O is injected for tests.
import { spawnSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sha256 } from './common.mjs';
import { tomlHookDeclarations } from './toml-hooks.mjs';

const REG = '/mnt/c/Windows/System32/reg.exe';
const CLAUDE_POLICY_KEYS = ['HKLM\\SOFTWARE\\Policies\\ClaudeCode', 'HKCU\\SOFTWARE\\Policies\\ClaudeCode'];

// Only ENOENT means absent. Every other error (EACCES, EISDIR, ENOTDIR, EIO, ...)
// means the file cannot be evaluated, and the check that needed it blocks.
export const defaultDeps = {
  exec: (command, args, env) => {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 15_000, env, stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: result.status, stdout: result.stdout ?? '', error: result.error?.code ?? null };
  },
  probe: path => {
    try { lstatSync(path); return { state: 'present' }; }
    catch (error) { return error?.code === 'ENOENT' ? { state: 'absent' } : { state: 'error', code: error?.code ?? 'unknown' }; }
  },
  readText: path => {
    try { return { state: 'ok', text: readFileSync(path, 'utf8') }; }
    catch (error) { return error?.code === 'ENOENT' ? { state: 'absent' } : { state: 'error', code: error?.code ?? 'unknown' }; }
  },
  // Skills may be directories or symlinks to them; hidden entries are the host's own.
  listDirs: path => {
    try {
      return readdirSync(path, { withFileTypes: true })
        .filter(e => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith('.')).map(e => e.name);
    } catch (error) { return error?.code === 'ENOENT' ? [] : null; }
  },
  listEntries: path => { try { return readdirSync(path); } catch { return null; } },
  nodeVersion: process.version,
};

const valueAfter = (args, flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };

/** Directories from `cwd` up to `/`, skipping the home directory whose user config is handled separately. */
function ancestors(cwd, home) {
  const list = [];
  for (let dir = cwd; ; dir = dirname(dir)) {
    if (dir !== home) list.push(dir);
    if (dir === dirname(dir)) return list;
  }
}

export const skillSetDigest = names => sha256(JSON.stringify([...names].sort()));

const describe = result => (result.state === 'error' ? `unreadable: ${result.code}` : result.state);

export function preflight({ step, built, pins, home, binaries, hookPrefix, ledger, isolationDigest, env, deps = defaultDeps }) {
  const checks = [];
  const check = (name, ok, detail = null) => checks.push({ name, ok: Boolean(ok), detail });
  // Absence is proven only by ENOENT; presence or an unreadable path both fail.
  const absent = (name, path) => { const result = deps.probe(path); check(name, result.state === 'absent', describe(result)); };
  try {
    const version = deps.exec(binaries[step.host], ['--version'], env);
    check('host_version_matches_pin', version.status === 0 && version.stdout.trim() === pins[step.host], version.stdout.trim() || version.error);
    check('node_version_matches_pin', deps.nodeVersion === pins.node, deps.nodeVersion);
    const { args, cwd } = built;
    if (step.host === 'claude') {
      const sources = valueAfter(args, '--setting-sources');
      check('claude_user_settings_excluded', sources !== undefined && !sources.split(',').includes('user'), sources ?? 'flag missing');
      check('claude_strict_empty_mcp', args.includes('--strict-mcp-config') && valueAfter(args, '--mcp-config') === '{"mcpServers":{}}');
      absent('claude_no_managed_settings_file', '/etc/claude-code/managed-settings.json');
      const reg = deps.probe(REG);
      check('claude_policy_query_evaluable', reg.state !== 'error', describe(reg));
      if (reg.state === 'present') {
        for (const key of CLAUDE_POLICY_KEYS) {
          const query = deps.exec(REG, ['query', key], env);
          // reg.exe exits 1 when the key is absent; anything else means a policy may inject hooks.
          check(`claude_no_policy_${key.slice(0, 4)}`, query.status === 1, `status ${query.status}`);
        }
      }
      for (const dir of ancestors(cwd, home)) {
        absent(`claude_no_local_settings:${dir}`, join(dir, '.claude', 'settings.local.json'));
        const settings = deps.readText(join(dir, '.claude', 'settings.json'));
        if (settings.state === 'absent') continue;
        let commands = null;
        if (settings.state === 'ok') {
          try { commands = Object.values(JSON.parse(settings.text).hooks ?? {}).flat().flatMap(group => group.hooks ?? []).map(h => h.command); }
          catch { commands = null; }
        }
        check(`claude_project_hooks_are_harness:${dir}`, dir === cwd && Array.isArray(commands) &&
          commands.every(command => typeof command === 'string' && command.startsWith(hookPrefix)),
        settings.state === 'ok' ? (commands ? null : 'unparseable') : describe(settings));
      }
    } else {
      check('codex_user_config_ignored', args.includes('--ignore-user-config'));
      absent('codex_no_user_hooks_json', join(home, '.codex', 'hooks.json'));
      const userConfig = deps.readText(join(home, '.codex', 'config.toml'));
      if (userConfig.state === 'ok') {
        const found = tomlHookDeclarations(userConfig.text);
        check('codex_no_user_hooks_table', found.hooks.length === 0 && found.unclassified.length === 0,
          `hook lines ${found.hooks.length}; unclassified lines ${found.unclassified.length}`);
      } else check('codex_no_user_hooks_table', userConfig.state === 'absent', describe(userConfig));
      absent('codex_no_system_config', '/etc/codex');
      for (const name of ['managed_config.toml', 'requirements.toml']) absent(`codex_no_${name}`, join(home, '.codex', name));
      // A project `.codex` directory is harmless only when it is readable and empty.
      for (const dir of ancestors(cwd, home)) {
        const probe = deps.probe(join(dir, '.codex'));
        const entries = probe.state === 'absent' ? [] : probe.state === 'present' ? deps.listEntries(join(dir, '.codex')) : null;
        check(`codex_no_project_config:${dir}`, Array.isArray(entries) && entries.length === 0,
          entries === null ? (probe.state === 'error' ? describe(probe) : 'unreadable') : entries.length ? `${entries.length} entries` : null);
      }
      const hookValues = args.filter((arg, i) => args[i - 1] === '-c' && arg.startsWith('hooks.'));
      if (args.includes('--dangerously-bypass-hook-trust')) {
        check('codex_trust_bypass_only_harness_hooks', hookValues.length > 0 && hookValues.every(value =>
          [...value.matchAll(/command="([^"]*)"/g)].every(match => match[1].startsWith(hookPrefix)) &&
          (value.match(/command=/g) ?? []).length === [...value.matchAll(/command="([^"]*)"/g)].length));
      }
      if (step.modelOnly && !step.fake) {
        const skills = deps.listDirs(join(home, '.codex', 'skills'));
        const digest = skills === null ? null : skillSetDigest(skills);
        const proof = (ledger?.runs ?? []).find(run => run.fakeModel && run.skillProof?.isolationDigest === isolationDigest &&
          run.skillProof.skillSetDigest === digest && run.skillProof.requests > 0 && run.skillProof.hits === 0);
        check('codex_model_only_no_user_skills', skills !== null && (skills.length === 0 || Boolean(proof)),
          skills === null ? 'skills unreadable' : `${skills.length} user skills; proof ${proof ? proof.label : 'missing'}`);
      }
    }
  } catch (error) {
    check('preflight_evaluable', false, String(error?.message ?? error).slice(0, 200));
  }
  const failures = checks.filter(entry => !entry.ok);
  return { ok: checks.length > 0 && failures.length === 0, checks, failures };
}

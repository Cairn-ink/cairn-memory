import { DEFAULT_ENDPOINT } from './constants.mjs';
import { isAbsolute } from 'node:path';
import { SetupError } from './errors.mjs';

export function validEndpoint(value) {
  try {
    const url = new URL(value);
    return !/[\s\x00-\x1f\x7f]/u.test(value) && !url.username && !url.password &&
      !url.search && !url.hash && url.pathname === '/' &&
      (url.protocol === 'https:' || (url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
  } catch { return false; }
}

export function parseOptions(argv) {
  let lang, endpoint, dailyCap, captureExec;
  let verbose = false;
  let local = false, cloud = false, yes = false, purgeConfig = false, owner, db, project;
  const remaining = [];
  // Resolve the language first so even invalid endpoint/options use the override.
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] !== '--lang') continue;
    const value = argv[++index];
    if (lang || !['zh', 'en'].includes(value)) throw new SetupError('lang_invalid', 2);
    lang = value;
  }
  try {
    for (let index = 0; index < argv.length; index++) {
      const flag = argv[index];
      if (flag === '--lang') {
        index++;
      } else if (['--local', '--cloud', '--yes', '--purge-config'].includes(flag)) {
        if (flag === '--local') { if (local) throw new SetupError('mode_conflict', 2); local = true; }
        if (flag === '--cloud') { if (cloud) throw new SetupError('mode_conflict', 2); cloud = true; }
        if (flag === '--yes') { if (yes) throw new SetupError('local_option_invalid', 2); yes = true; }
        if (flag === '--purge-config') { if (purgeConfig) throw new SetupError('local_option_invalid', 2); purgeConfig = true; }
      } else if (['--owner', '--db', '--project'].includes(flag)) {
        const value = argv[++index];
        if (typeof value !== 'string' || !value || value.trim() !== value || value.startsWith('-') ||
            /[\x00-\x1f\x7f]/u.test(value) || (flag === '--db' ? !isAbsolute(value) || value.split(/[\\/]/u).includes('..') : value.length > 200)) {
          throw new SetupError('local_option_invalid', 2);
        }
        if (flag === '--owner') { if (owner !== undefined) throw new SetupError('local_option_invalid', 2); owner = value; }
        if (flag === '--db') { if (db !== undefined) throw new SetupError('local_option_invalid', 2); db = value; }
        if (flag === '--project') { if (project !== undefined) throw new SetupError('local_option_invalid', 2); project = value; }
      } else if (flag === '--endpoint') {
        const value = argv[++index];
        if (endpoint || typeof value !== 'string' || !validEndpoint(value)) throw new SetupError('endpoint_option_invalid', 2);
        endpoint = new URL(value).origin;
      } else if (flag === '--verbose') {
        if (verbose) throw new SetupError('unknown_command', 2);
        verbose = true;
      } else if (flag === '--codex-capture-exec') {
        const value = argv[++index];
        if (captureExec !== undefined || !['on', 'off'].includes(value))
          throw new SetupError('invalid_exec_setting', 2);
        captureExec = value === 'on';
      } else if (flag === '--codex-daily-cap') {
        const value = argv[++index];
        if (dailyCap !== undefined || !/^[0-9]+$/u.test(value ?? '') ||
            !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 100000)
          throw new SetupError('invalid_cap', 2);
        dailyCap = Number(value);
      } else remaining.push(flag);
    }
    if (local && cloud) throw new SetupError('mode_conflict', 2);
    if ((local && !['setup', 'uninstall'].includes(remaining[0])) || (cloud && remaining[0] !== 'setup')) throw new SetupError('mode_option_scope', 2);
    if ((owner !== undefined || db !== undefined || project !== undefined) && (!local || remaining[0] !== 'setup')) throw new SetupError('local_option_invalid', 2);
    if ((yes || purgeConfig) && (!local || remaining[0] !== 'uninstall')) throw new SetupError('local_option_invalid', 2);
    if (purgeConfig && remaining.includes('--client')) throw new SetupError('local_option_invalid', 2);
    if (endpoint && remaining[0] !== 'setup') throw new SetupError('endpoint_option_invalid', 2);
    if (dailyCap !== undefined && !['setup', 'config'].includes(remaining[0])) throw new SetupError('cap_option_scope', 2);
    if (captureExec !== undefined && !['setup', 'config'].includes(remaining[0])) throw new SetupError('invalid_exec_setting', 2);
    return { argv: remaining, lang, endpoint, dailyCap, captureExec, verbose, local, cloud, yes, purgeConfig, owner, db, project };
  } catch (error) { error.language = lang; throw error; }
}

export async function selectEndpoint({ endpointOverride, existingEndpoint, prompt, write, t }) {
  let endpoint = endpointOverride ?? existingEndpoint ?? DEFAULT_ENDPOINT;
  let source = endpointOverride ? 'endpoint_flag' : existingEndpoint ? 'endpoint_config' : 'endpoint_default';
  if (!validEndpoint(endpoint)) throw new SetupError('endpoint_invalid');
  endpoint = new URL(endpoint).origin;
  write(t(source, { endpoint }));
  return endpoint;
}

import { DEFAULT_ENDPOINT } from './constants.mjs';
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
    if (endpoint && remaining[0] !== 'setup') throw new SetupError('endpoint_option_invalid', 2);
    if (dailyCap !== undefined && !['setup', 'config'].includes(remaining[0])) throw new SetupError('invalid_cap', 2);
    if (captureExec !== undefined && !['setup', 'config'].includes(remaining[0])) throw new SetupError('invalid_exec_setting', 2);
    return { argv: remaining, lang, endpoint, dailyCap, captureExec, verbose };
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

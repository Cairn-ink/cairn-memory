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
  let lang, endpoint;
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
      } else remaining.push(flag);
    }
    if (endpoint && remaining[0] !== 'setup') throw new SetupError('endpoint_option_invalid', 2);
    return { argv: remaining, lang, endpoint };
  } catch (error) { error.language = lang; throw error; }
}

export async function selectEndpoint({ endpointOverride, existingEndpoint, prompt, write, t }) {
  let endpoint = endpointOverride ?? existingEndpoint ?? 'https://cairn.ink';
  let source = endpointOverride ? 'endpoint_flag' : existingEndpoint ? 'endpoint_config' : 'endpoint_default';
  if (!endpointOverride && !existingEndpoint) {
    const answer = (await prompt(t('endpoint_prompt', { endpoint }))).trim();
    if (answer) { endpoint = answer; source = 'endpoint_prompt_source'; }
  }
  if (!validEndpoint(endpoint)) throw new SetupError('endpoint_invalid');
  endpoint = new URL(endpoint).origin;
  write(t(source, { endpoint }));
  return endpoint;
}

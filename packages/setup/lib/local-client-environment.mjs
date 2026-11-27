const providerKeyName = /^(?:OPENAI_API_KEY|CAIRN_[A-Z0-9_]{1,96}_API_KEY)$/iu;

export function localClientEnvironment(env) {
  return Object.fromEntries(Object.keys(env).filter(name => !providerKeyName.test(name)).map(name => [name, env[name]]));
}

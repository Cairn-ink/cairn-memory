export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  if (/\/openai\/index\.mjs$|\/tiktoken\//u.test(resolved.url)) {
    throw new Error('episode_access_model_import_forbidden');
  }
  return resolved;
}

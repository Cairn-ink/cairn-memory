import { register } from 'node:module';
// Run the released source-gate assertions unchanged, substituting only its
// opener. Host-ancestry assertions remain Linux-only with a named skip.
register('data:text/javascript,' + encodeURIComponent(`
export async function load(url, context, next) {
  const result = await next(url, context);
  if (url.endsWith('/integrations/codex/session-source.mjs')) return { ...result, source: String(result.source).replace(
    "import { openSource, readBytes } from './source.mjs';",
    "import { openLocalSource as openSource } from '../client/raw/local-source-open.mjs'; import { readBytes } from './source.mjs';") };
  if (url.endsWith('/integrations/codex/test/session-source.test.mjs')) return { ...result, source: String(result.source).replace(
    "async()=>{\\n  const {execInvocation,detectRunningHost}",
    "{ skip: process.platform !== 'linux' && 'Codex host qualification requires Linux /proc executable pinning.' },async()=>{\\n  const {execInvocation,detectRunningHost}") };
  return result;
}`), import.meta.url);
await import('../../codex/test/session-source.test.mjs');

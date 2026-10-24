import { register } from 'node:module';

// Observe the actual source opener and worker constructor without substituting
// their behavior. This loader is test-only and never enters the archive.
register('data:text/javascript,'+encodeURIComponent(`
export async function load(url,context,next) {
  const result=await next(url,context);
  const names=url.endsWith('/integrations/codex/source.mjs')?['openSource','source']:
    url.endsWith('/integrations/client/raw/local-worker.mjs')?['createLocalRawWorker','worker']:null;
  if(!names)return result;
  const [name,kind]=names;
  let source=String(result.source);
  source=source.replace('export async function '+name+'(', 'async function observed_'+name+'(')
    .replace('export function '+name+'(', 'function observed_'+name+'(');
  source+='\\nexport function '+name+'(...args){globalThis[Symbol.for("cairn.host.observe")]?.('+JSON.stringify(kind)+',args[0]);return observed_'+name+'(...args)}';
  return {...result,source};
}`),import.meta.url);

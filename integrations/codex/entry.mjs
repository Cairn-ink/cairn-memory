// Installed entry: every automatic path exits 0, with only vetted context JSON.
// Dynamic import also contains missing/corrupt runtime failures without stderr.
import { write } from 'node:fs';
const [path, event] = process.argv.slice(2);
const capture = ['Stop','PreCompact','SessionEnd'].includes(event);
const controller = new AbortController();
let finished = false;
const finish = output => {
  if (finished) return;
  finished = true; controller.abort(); clearTimeout(timer);
  if (!output) process.exit(0);
  // Flush a bounded result; a host which stops reading cannot hold the hook.
  setTimeout(() => process.exit(0),50);
  const bytes = Buffer.from(output);
  const flush = offset => write(1,bytes,offset,bytes.length-offset,null,(error,count) => {
    if (error || count===0) process.exit(0);
    if (offset+count===bytes.length) process.exit(0);
    flush(offset+count);
  });
  flush(0);
};
const budget = event === 'qualify' ? 65000 : event === 'worker' ? 62500 : capture ? 750 : 2000;
const timer = setTimeout(() => { controller.abort(); finish(capture ? '{}' : ''); },
  Math.max(1,budget - process.uptime()*1000 - 50));
process.on('uncaughtException', () => finish(capture ? '{}' : ''));
process.on('unhandledRejection', () => finish(capture ? '{}' : ''));
try {
  if (!['SessionStart','UserPromptSubmit','Stop','PreCompact','SessionEnd','worker','qualify'].includes(event)) finish('');
  const { runInstalled } = await import('./installed.mjs');
  const output = await runInstalled(path, event, process.stdin, { signal: controller.signal });
  clearTimeout(timer); finish(output || (capture ? '{}' : ''));
} catch { clearTimeout(timer); finish(capture ? '{}' : ''); }

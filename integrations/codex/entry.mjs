// Installed entry: every automatic path exits 0, with only vetted context JSON.
// Dynamic import also contains missing/corrupt runtime failures without stderr.
import { write } from 'node:fs';
const [path, event] = process.argv.slice(2);
const capture = ['Stop','PreCompact','SessionEnd'].includes(event);
const controller = new AbortController();
let finished = false, pendingOutput;
// Start a bounded flush synchronously. Completion must not exit while a caller
// still holds its delivery gates; the invocation deadline remains independent.
const flushOutput = output => new Promise(resolve => {
  const outputTimer = setTimeout(resolve,50);
  const done = () => { clearTimeout(outputTimer); resolve(); };
  const bytes = Buffer.from(output);
  const flush = offset => {
    try {
      write(1,bytes,offset,bytes.length-offset,null,(error,count) => {
        if (error || count===0 || offset+count===bytes.length) done();
        else flush(offset+count);
      });
    } catch { done(); }
  };
  flush(0);
});
const finish = output => {
  if (finished) return;
  finished = true; controller.abort(); clearTimeout(timer);
  if (!output) process.exit(0);
  flushOutput(output).then(() => process.exit(0));
};
const budget = event === 'qualify' ? 65000 : event === 'worker' ? 62500 : capture ? 750 : event === 'UserPromptSubmit' ? 3000 : 2000;
const timer = setTimeout(() => { controller.abort(); finish(capture ? '{}' : ''); },
  Math.max(1,budget - process.uptime()*1000 - 50));
process.on('uncaughtException', () => finish(capture ? '{}' : ''));
process.on('unhandledRejection', () => finish(capture ? '{}' : ''));
try {
  if (!['SessionStart','UserPromptSubmit','Stop','PreCompact','SessionEnd','worker','qualify'].includes(event)) finish('');
  const { runInstalled } = await import('./installed.mjs');
  const output = await runInstalled(path, event, process.stdin, { signal: controller.signal, recallDeadline: budget - 50,
    deliver: output => {
      controller.signal.throwIfAborted();
      pendingOutput ??= flushOutput(output);
    } });
  if (pendingOutput) {
    // runInstalled has now released both gates. A fast stdout callback cannot
    // strand their owner files and force recovery on every successful prompt.
    finished = true; controller.abort(); clearTimeout(timer);
    await pendingOutput;
    process.exit(0);
  }
  clearTimeout(timer); finish(output || (capture ? '{}' : ''));
} catch { clearTimeout(timer); finish(capture ? '{}' : ''); }

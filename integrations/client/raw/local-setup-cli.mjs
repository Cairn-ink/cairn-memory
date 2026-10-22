import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';
import { privateRead } from '../private-state.mjs';
import { setupLocalRaw, createLocalRawSetup } from './local-setup.mjs';
import { runLocalRawHook } from './local-hook.mjs';
import { initLocalRawStore } from './local-setup-init.mjs';
import { runtime, fail, failure, absolute } from './local-setup-input.mjs';
import { json } from './local-setup-files.mjs';

const help = `Usage: cairn-memory local setup --request ABSOLUTE_PRIVATE_JSON
       cairn-memory local status|activate|disable --installation ABSOLUTE_DIRECTORY
       cairn-memory local init --database BRAND_NEW_ABSOLUTE_FILE

Explicit local foreground preview (Linux/WSL, Node >=22.16).
Setup requires an existing schema29 or schema30 store, separate provider-processing/plaintext
Raw consent and foreground-latency consent. Hooks may block up to160seconds.
No key is needed for setup/status/disable. Daily cap counts model-port invocations,
not dollars. Disable preserves identity/data; reactivation may require explicit
local-host rearm. Operator guide: docs/raw-local-journal.md (relative to the
installed package root), including the closed request schema and separate consents.
`;
async function input(stream,signal) {
  const chunks = []; let size = 0;
  const timer = setTimeout(() => stream.destroy(),1000);
  const cancel = () => stream.destroy(); signal.addEventListener('abort',cancel,{ once:true });
  try {
    for await (const chunk of stream) { size += Buffer.byteLength(chunk); if (size > 65536) fail('event_refused'); chunks.push(Buffer.from(chunk)); }
    if (!size || signal.aborted) fail('event_refused');
    try { return json(new TextDecoder('utf-8',{ fatal:true }).decode(Buffer.concat(chunks))); } catch { fail('event_refused'); }
  } finally { clearTimeout(timer); signal.removeEventListener('abort',cancel); }
}
export async function runLocalSetupCli(args = process.argv.slice(2),io = {}) {
  const stdout = io.stdout ?? process.stdout,stdin = io.stdin ?? process.stdin;
  if (args.length === 1 && ['--help','-h'].includes(args[0])) { stdout.write(help); return 0; }
  const hook = args[0] === 'hook',controller = new AbortController();
  const cancel = () => controller.abort(); for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.once(signal,cancel);
  const timer = setTimeout(cancel,158000); timer.unref();
  try {
    runtime(); let outcome;
    if (args.length === 3 && args[0] === 'init' && args[1] === '--database' && absolute(args[2])) {
      outcome = await initLocalRawStore({ databasePath:args[2] });
    } else if (args.length === 3 && args[0] === 'setup' && args[1] === '--request' && absolute(args[2])) {
      let request; try { request = json(await privateRead(args[2])); } catch { fail('invalid_input'); }
      outcome = await setupLocalRaw(request,{ signal:controller.signal });
    } else if (args.length === 3 && ['status','activate','disable'].includes(args[0]) && args[1] === '--installation' && absolute(args[2])) {
      outcome = await createLocalRawSetup({ installationDirectory:args[2] })[args[0]]({ signal:controller.signal });
    } else if (hook && args.length === 5 && args[1] === '--installation' && absolute(args[2]) && args[3] === '--event') {
      await runLocalRawHook({ installationDirectory:args[2],event:args[4],payload:await input(stdin,controller.signal) },{ signal:controller.signal });
      // Fail open for the native client, but never emit an internal status DTO
      // or arbitrary diagnostics as prompt/model context.
      return 0;
    } else fail('invalid_input');
    stdout.write(JSON.stringify(outcome)+'\n'); return ['initialized','prepared','active','disabled','declined'].includes(outcome.status) ? 0:1;
  } catch (error) {
    if (hook) return 0;
    stdout.write(JSON.stringify(failure(error))+'\n'); return 1;
  } finally { clearTimeout(timer); for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.removeListener(signal,cancel); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await runLocalSetupCli();

import { pathToFileURL } from 'node:url';
import { createLocalRawHost, localHostResult } from './local-host.mjs';
import { rearmResult } from './local-rearm-state.mjs';

export const localHostExit = result => result.reason === 'unexpected_failure' ? 1 :
  result.status === 'blocked' ? 2 : ['busy','waiting'].includes(result.status) ? 3 : 0;

export async function runLocalHostCli(args = process.argv.slice(2)) {
  const controller = new AbortController(), handlers = new Map();
  let signalExit = null;
  for (const [signal,code] of [['SIGINT',130],['SIGTERM',143],['SIGHUP',129]]) {
    const handler = () => { signalExit ??= code; controller.abort(); };
    process.on(signal,handler); handlers.set(signal,handler);
  }
  try {
    let result;
    try {
      if (!Array.isArray(args) || args[0] !== '--profile' || typeof args[1] !== 'string' ||
          !['status','prepare','initialize','run','rearm-status','rearm'].includes(args[2])) throw Error();
      const action = args[2], host = createLocalRawHost({ profilePath:args[1] });
      if (action === 'rearm-status') {
        if (args.length !== 3) throw Error();
        result = await host.rearmStatus({ signal:controller.signal });
      } else if (action === 'rearm') {
        if (args.length !== 11 || args[3] !== '--expected-revision' || !/^(0|[1-9]\d*)$/.test(args[4]) ||
          !Number.isSafeInteger(Number(args[4])) || args[5] !== '--action-id' || args[7] !== '--session' || args[9] !== '--source') throw Error();
        result = await host.rearm({ expectedRevision:Number(args[4]),actionId:args[6],sessionId:args[8],sourcePath:args[10] },{ signal:controller.signal });
      } else if (action === 'status' || action === 'prepare') {
        if (args.length !== 3) throw Error();
        result = await host[action]({ signal:controller.signal });
      } else {
        if (![7,9].includes(args.length) || args[3] !== '--session' || args[5] !== '--source' ||
            args.length === 9 && (action !== 'initialize' || args[7] !== '--start' || !['beginning','eof'].includes(args[8]))) throw Error();
        result = await host[action]({ sessionId:args[4],sourcePath:args[6],...(args.length === 9 ? { start:args[8] } : {}) },{ signal:controller.signal });
      }
    } catch { result = ['rearm-status','rearm'].includes(args?.[2]) ? rearmResult(args[2] === 'rearm-status','blocked','invalid_input')
      : localHostResult('blocked','invalid_input'); }
    return { result,exitCode:signalExit ?? localHostExit(result) };
  } finally { for (const [signal,handler] of handlers) process.off(signal,handler); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { result,exitCode } = await runLocalHostCli();
  await new Promise((resolve,reject) => process.stdout.write(JSON.stringify(result)+'\n',error => error ? reject(error) : resolve()));
  process.exitCode = exitCode;
}

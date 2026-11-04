// strace follows this supervisor; only the maintenance child accesses SQLite.
import { fork } from 'node:child_process';
import { once } from 'node:events';
const child=fork(new URL('./context-product-verification-process.mjs',import.meta.url),process.argv.slice(2),{
  env:{},execArgv:[],stdio:['ignore','inherit','inherit','ipc']
});
process.stdout.write('maintenance-pid '+child.pid+'\n');
const [code,signal]=await once(child,'exit'); // libuv has reaped our direct child.
process.stdout.write('maintenance-reaped '+JSON.stringify({pid:child.pid,code,signal})+'\n');
if(code!==null||signal!=='SIGKILL')throw Error('crash harness: maintenance child did not terminate by SIGKILL');

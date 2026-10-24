import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const spawn = childProcess.spawnSync;
childProcess.spawnSync = (executable,args,options) => args[0]?.replaceAll('\\','/').endsWith('/fixtures/topic-members.mjs')
  ? { status:23, signal:null, error:undefined } : spawn(executable,args,options);
syncBuiltinESMExports();

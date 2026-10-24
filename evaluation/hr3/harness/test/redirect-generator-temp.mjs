// The unchanged generator test uses a scratch directory beside its source.
// Redirect that one prefix to harness/artifacts to respect A-3's write scope.
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {fileURLToPath} from 'node:url';
const original=fs.promises.mkdtemp;
const prefix=fileURLToPath(new URL('../../generator/test/.cli-',import.meta.url));
const target=fileURLToPath(new URL('../artifacts/a3-generator-cli-',import.meta.url));
fs.promises.mkdtemp=(path,...args)=>original(path===prefix?target:path,...args);
syncBuiltinESMExports();

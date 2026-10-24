import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../../index.mjs';
import { host, cardOptions } from '../card-current-fixture.mjs';
const original=DatabaseSync.prototype.exec;
DatabaseSync.prototype.exec=function(sql){const value=original.call(this,sql);if(sql.includes(process.argv[3]))throw Error('populated rollback injection');return value;};
const h=host();assert.throws(()=>openMemoryCore({path:process.argv[2],methodPackages:h.methods,privateCards:cardOptions(h.authority)}),/populated rollback injection/);
console.log(JSON.stringify({exit:0,stage:process.argv[3]}));

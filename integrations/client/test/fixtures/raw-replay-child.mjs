import { open } from 'node:fs/promises';
import { prepareRawRecord,restoreRawBatch } from '../../raw/index.mjs';
import { key } from './raw-fixtures.mjs';

let source, message;
try {
  try { source = await open(process.argv[2],'r'); }
  catch { const error = Error('raw_source_unavailable'); error.code = error.message; throw error; }
  const input = JSON.parse(process.argv[3]), pending = JSON.parse(process.argv[4]);
  const result = await prepareRawRecord({ ...input,source },{ identityKey:key }); message = result.message;
  const restored = await restoreRawBatch({ message,projectId:null,pending });
  process.stdout.write(JSON.stringify({ ok:true,result:restored }));
} catch (error) {
  if (!error.code || error.message!==error.code) throw error;
  process.stdout.write(JSON.stringify({ ok:false,code:error.code }));
} finally { await message?.close(); await source?.close(); }

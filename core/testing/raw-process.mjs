// Child-only synthetic fixture. No network, provider or user input source.
import { openDatabase,transaction } from '../database.mjs';
import { createRawJournal } from '../raw-journal.mjs';
import { localPlainPort,rawNamespace,rawRequest,splitRaw } from './raw-fixtures.mjs';

const [path,client] = process.argv.slice(2);
const db = openDatabase(path);
try {
  const journal = createRawJournal({ db,mode: 'raw-v1',port: localPlainPort(),capBytes: 12,
    readPolicy: () => ({ generation: 'initial',reason: null }) });
  const request = rawRequest(splitRaw('abcdefghijkl',{ size: 4 })[0],{
    client,namespace: { ...rawNamespace,scope: 'project',projectId: client },sessionId: `synthetic-${client}` });
  const prepared = await journal.prepareRegistration(request);
  await new Promise(resolve => { process.once('message',resolve); process.send({ ready: true }); });
  const result = transaction(db,()=>journal.commitRegistration(prepared));
  process.send({ result });
} finally { db.close(); process.disconnect(); }

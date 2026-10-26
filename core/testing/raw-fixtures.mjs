import { join } from 'node:path';
import { openDatabase } from '../database.mjs';
import { createRawJournal } from '../raw-journal.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

export const rawNamespace = Object.freeze({ ownerId: 'synthetic-owner',scope: 'personal',projectId: null });
export const localPlainPort = () => ({ version: 'raw-seal-v1',
  async sealRaw({ text }) { return { format: 'local-plain-v1',keyVersion: null,sealed: Buffer.from(text) }; },
  async openRaw({ sealed }) { return { text: new TextDecoder('utf8',{ fatal: true }).decode(sealed) }; } });

export function splitRaw(text,{ id = 'message',ordinal = 1,role = 'user',occurredAt = null,size = 4000 } = {}) {
  const parts = []; let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length,start+size);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end-1])) end--;
    parts.push({ id,role,occurredAt,messageOrdinal: ordinal,content: text.slice(start,end),
      part: { index: parts.length,start,totalUnits: text.length,totalBytes: Buffer.byteLength(text) } });
    start = end;
  }
  return parts;
}
export const rawRequest = (message, overrides = {}) => ({ namespace: rawNamespace,client: 'claude-code',sessionId: 'synthetic-session',
  eventId: `event-${message.id}-${message.part.index}`,messages: [message],...overrides });

export function rawFixture(t,{ capBytes = 200000000,port = localPlainPort(),mode = 'raw-v1' } = {}) {
  const workspace = createTestWorkspace(t,{ prefix: 'raw-journal-' }), path = join(workspace.path,'memory.sqlite');
  const state = { generation: 'initial',reason: null };
  let db, journal;
  function reopen(options = {}) {
    db?.close();
    db = openDatabase(path,{ rawConversations: true });
    journal = createRawJournal({ db,capBytes,port,mode,readPolicy: () => ({ ...state }),...options });
    return journal;
  }
  reopen(); workspace.defer(() => db.close());
  return { workspace,path,state,reopen,get db() { return db; },get journal() { return journal; } };
}

export async function collectRaw(journal, conversationId, { namespace = rawNamespace,limit = 20 } = {}) {
  const pages = []; let cursor;
  do {
    const page = await journal.getConversation({ namespace,conversationId,limit,...(cursor ? { cursor } : {}) });
    pages.push(page); cursor = page.nextCursor;
  } while (cursor);
  return pages;
}

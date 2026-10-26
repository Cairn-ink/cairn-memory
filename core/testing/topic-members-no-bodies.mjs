import { DatabaseSync } from 'node:sqlite';
const prepare = DatabaseSync.prototype.prepare;
DatabaseSync.prototype.prepare = function(sql) {
  // Metadata PRAGMAs may mention layouts; data reads may consume only the
  // Memory/index tables. Fail inside the actual public reader Worker.
  if (/\bSELECT\b/i.test(sql) && !/pragma_|sqlite_master/i.test(sql) &&
      (/\b(?:content|excerpt|body|sealed|raw_\w+|card_\w+|private_cards|receipts)\b/i.test(sql) || /SELECT\s+\*/i.test(sql))) {
    throw Error('e1m_forbidden_body_or_private_query');
  }
  return prepare.call(this,sql);
};

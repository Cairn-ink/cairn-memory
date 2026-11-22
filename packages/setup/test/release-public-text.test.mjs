import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../../',import.meta.url);
test('headless saving behavior and installer release text agree in English and Traditional Chinese',() => {
  const hook = readFileSync(new URL('integrations/client/raw/local-hook.mjs',root),'utf8');
  if (!/hookReasons\s*=\s*Object\.freeze\(\[[^;]*['"]headless_skipped['"]/.test(hook)) return;
  const english = /From 0\.6\.8,[\s\S]*?Claude Code runs started by scripts or the Agent SDK[\s\S]*?`claude -p`[\s\S]*?are not saved\./;
  const chinese = /從 0\.6\.8 起，由腳本或 Agent SDK 啟動的 Claude Code 執行（例如 `claude -p`）不會被保存/;
  for (const [path,languages] of [['README.md',['en']],['README.zh-TW.md',['zh']],['packages/setup/README.md',['en','zh']]]) {
    const text = readFileSync(new URL(path,root),'utf8');
    for (const language of languages) assert.match(text,language==='en' ? english:chinese,path+' '+language);
    assert.match(text,/0\.6\.6 (?:and|與) 0\.6\.7/,path+' retains older-version workaround');
    assert.ok(text.includes('config --local-capture off --client claude'),path+' retains disable command');
    assert.ok(text.includes('config --local-capture on --client claude'),path+' retains re-enable command');
  }
});

// Raw search timing: the release pages describe the recent-save lane and the
// full inventory check that completes. A cut without either fails here.
const phrase = text => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/ /g,'\\s+'));
test('Raw search timing text matches the recent-save lane and the unbounded inventory check',() => {
  const maintenance = readFileSync(new URL('core/raw-search-maintenance.mjs',root),'utf8');
  if (!/authority\.recent\(/.test(maintenance)) return;
  assert.doesNotMatch(maintenance,/inventoryFence\(\s*started\s*\+\s*maxMs\s*\)/,'the full inventory check must not take the pass deadline');
  assert.match(maintenance,/maxMs\s*\/\s*4/,'the cleanup ring yields most of each slice to the full inventory check');
  const required = {
    'README.md':['From 0.6.8, new saves are indexed first','After upgrading from 0.6.7, this first full pass runs once more','about 5 minutes per 1,000',
      'while saves keep arriving the full pass may not finish','Search never returns deleted text','larger stores take less time per message','and a turn with very many messages up to about two minutes'],
    'README.zh-TW.md':['從 0.6.8 起，','新存的內容會優先建索引','從 0.6.7 升級後，這第一輪完整建索引會再跑一次','每 1,000 則約 5 分鐘',
      '完整索引可能要等保存停下來才跑得完','搜尋不會回傳被刪除的文字','資料越多，每則花的時間越少','訊息非常多的一輪最多約兩分鐘'],
    'packages/setup/README.md':['From installer 0.6.8, Raw search indexes newly saved conversations first','After upgrading from 0.6.7, this first full indexing pass runs once more',
      '從安裝器 0.6.8 起，Raw 搜尋會優先為新保存的對話建索引','從 0.6.7 升級後，這第一輪完整建索引會再跑一次',
      'while saves keep arriving the full pass may not finish','Search never returns deleted text','完整索引可能要等保存停下來才跑得完','搜尋不會回傳被刪除的文字',
      'larger stores take less time per message','and a turn with very many messages up to about two minutes','資料越多，每則花的時間越少','訊息非常多的一輪最多約兩分鐘'],
    'docs/defaults.md':['From installer 0.6.8, Raw search indexes newly saved conversations first','After upgrading from 0.6.7, this first full indexing pass runs once more',
      'while saves keep arriving the full pass may not finish','larger stores take less time per message','and a turn with very many messages up to about two minutes'],
    'CHANGELOG.md':['Upgrading from 0.6.7 runs the first full indexing pass once more','Search never returns that text','larger stores take less time per message','and a turn with very many messages up to about two minutes'],
  };
  const retired = ['until you pause','等你停下來','停下來後才搜得到','A later release indexes newly saved conversations first','之後的版本會優先為新保存的對話建索引',
    'about 6 minutes per 1,000','每 1,000 則約 6 分鐘','roughly one saved message per second','大約每秒一則已保存訊息',
    'up to about 8 on a slower computer','最多約 8 分鐘','20–25','may not reach them while new conversations keep being saved','持續有新對話存入時可能一直輪不到'];
  const claims = readFileSync(new URL('docs/promotion-claims.md',root),'utf8');
  for (const value of ['larger stores take less time per message','a turn with very many messages up to about two minutes']) assert.match(claims,phrase(value),'C26 carries: '+value);
  for (const [path,phrases] of Object.entries(required)) {
    const text = readFileSync(new URL(path,root),'utf8');
    for (const value of phrases) assert.match(text,phrase(value),path+' carries: '+value);
    if (path === 'CHANGELOG.md') continue;
    for (const value of retired) assert.doesNotMatch(text,phrase(value),path+' no longer says: '+value);
  }
});

// Forget known limits (0.6.8): the installer README carries exactly the three user lines and no
// integrator-only line; the root READMEs carry the user lines and the direct-reader line; the
// CHANGELOG carries the integrator lines and the dead-end text instead of the two older sentences.
test('forget known limits are stated where each reader looks, and never as hidden everywhere',() => {
  const read = path => readFileSync(new URL(path,root),'utf8');
  const has = (path,text,value) => assert.match(text,phrase(value),path+' carries: '+value.slice(0,60));
  const lacks = (path,text,value) => assert.doesNotMatch(text,phrase(value),path+' must not carry: '+value.slice(0,60));
  const installer = read('packages/setup/README.md');
  for (const value of ['Recall that asks for sources or reasons can be refused (`source_unavailable`) after you forget or correct a memory, until the other memories that came from a conversation it hid are corrected or forgotten. This needs a model key and is unchanged from 0.6.7; ordinary recall keeps working.','After you forget something, the conversation it came from and any resumed or forked copy of it (for example `claude --resume`) are not saved from then on. Any conversation that tries to save a message dated within 30 minutes of the forgotten message is not saved from then on either, including one you start right after the forget. To resume saving, start a new conversation more than 30 minutes after the forgotten message was written.','After any local forget, correct, conversation delete or Episode forget, conversations whose message times are unknown are hidden from Raw search, and a conversation that saves a message without a time is not saved from then on, including new conversations. Memories are kept. Claude Code and Codex normally record message times, so this only affects messages whose transcript entry has no timestamp.','忘記或更正記憶之後，要求附上來源或理由的回想可能被拒絕（`source_unavailable`），直到被隱藏對話所產生的其他記憶都被更正或忘記為止。這需要設定模型金鑰，行為和 0.6.7 相同；一般回想照常可用。','忘記某些內容之後，它原本所在的對話，以及這個對話被接續或分支出的副本（例如 `claude --resume`），從那之後都不會被保存。任何對話只要有訊息的時間落在被忘記訊息前後 30 分鐘內，從那之後也不會被保存，包括忘記之後馬上開的新對話。要恢復保存，請在被忘記的那則訊息寫下 30 分鐘之後再開新對話。','在本機忘記、更正、刪除對話或忘記 Episode 之後，訊息時間不明的對話會從 Raw 搜尋中隱藏，而且從那之後，只要對話裡有沒有時間的訊息，整段對話就不會被保存，新對話也一樣。記憶會保留。Claude Code 和 Codex 平常都會記錄訊息時間，所以這只影響逐字稿裡沒有時間戳記的訊息。']) has('packages/setup/README.md',installer,value);
  for (const value of ['reading a saved conversation by its id', 'reports a receipt count but returns no receipts', 'word counts can still slightly affect', 'listing memories for that namespace', '--retained-raw-profile']) lacks('packages/setup/README.md',installer,value);
  const readme = read('README.md'), readmeZh = read('README.zh-TW.md'), changelog = read('CHANGELOG.md');
  for (const value of ['Recall that asks for sources or reasons can be refused (`source_unavailable`) after you forget or correct a memory, until the other memories that came from a conversation it hid are corrected or forgotten. This needs a model key and is unchanged from 0.6.7; ordinary recall keeps working.','After you forget something, the conversation it came from and any resumed or forked copy of it (for example `claude --resume`) are not saved from then on. Any conversation that tries to save a message dated within 30 minutes of the forgotten message is not saved from then on either, including one you start right after the forget. To resume saving, start a new conversation more than 30 minutes after the forgotten message was written.','After any local forget, correct, conversation delete or Episode forget, conversations whose message times are unknown are hidden from Raw search, and a conversation that saves a message without a time is not saved from then on, including new conversations. Memories are kept. Claude Code and Codex normally record message times, so this only affects messages whose transcript entry has no timestamp.','For integrations that call the engine directly or run the MCP server with `--retained-raw-profile`:','reading a saved conversation by its id and listing saved conversations are not yet stopped by a forget. On stores that were not upgraded with the offline safety migration they still return a conversation hidden by a forget or correction, with its text. On upgraded stores the hidden conversation is returned without its text, and listing saved conversations and the saved-text usage summary are refused (`evidence_unavailable`, `source_unavailable`) after a forget. Search, recall and memory sources do not return hidden conversations. `cairn-memory raw delete --conversation ID --yes` removes a hidden conversation\'s saved text. Installed setups do not expose these readers.']) has('README.md',readme,value);
  for (const value of ['忘記或更正記憶之後，要求附上來源或理由的回想可能被拒絕（`source_unavailable`），直到被隱藏對話所產生的其他記憶都被更正或忘記為止。這需要設定模型金鑰，行為和 0.6.7 相同；一般回想照常可用。','忘記某些內容之後，它原本所在的對話，以及這個對話被接續或分支出的副本（例如 `claude --resume`），從那之後都不會被保存。任何對話只要有訊息的時間落在被忘記訊息前後 30 分鐘內，從那之後也不會被保存，包括忘記之後馬上開的新對話。要恢復保存，請在被忘記的那則訊息寫下 30 分鐘之後再開新對話。','在本機忘記、更正、刪除對話或忘記 Episode 之後，訊息時間不明的對話會從 Raw 搜尋中隱藏，而且從那之後，只要對話裡有沒有時間的訊息，整段對話就不會被保存，新對話也一樣。記憶會保留。Claude Code 和 Codex 平常都會記錄訊息時間，所以這只影響逐字稿裡沒有時間戳記的訊息。','若你的整合直接呼叫引擎，或用 `--retained-raw-profile` 啟動 MCP 伺服器：依 id 讀取已保存的對話、列出已保存的對話，目前還不會因「忘記」而停止。沒有用離線安全遷移升級過的資料庫，仍會回傳被忘記或更正所隱藏的對話及其文字；升級過的資料庫會回傳不含文字的隱藏對話，而且忘記之後，列出已保存的對話與已保存文字的用量摘要會被拒絕（`evidence_unavailable`、`source_unavailable`）。搜尋、回想與記憶來源不會回傳隱藏的對話。`cairn-memory raw delete --conversation ID --yes` 可以移除隱藏對話的已保存文字。安裝好的設定不會開放這些讀取端。']) has('README.zh-TW.md',readmeZh,value);
  for (const value of ['On those upgraded stores, after you forget or correct a memory whose message produced other memories, listing memories for that namespace — and the time lists and the source snapshot — is refused with `revision_conflict` until each surviving memory from that message is corrected or forgotten by id. Recall still works and leaves those memories out; no read returns them any more, so this needs their ids from earlier output.','To find the affected memories, inspect each memory that came from a conversation the forget hid: an affected one reports a receipt count but returns no receipts. On stores upgraded with the offline safety migration, a memory from the same message as the forgotten one is not found at all (see the next sentence).','reading the memory source snapshot is refused with `revision_conflict`','For integrations that call the engine directly or run the MCP server with `--retained-raw-profile`:','reading a saved conversation by its id and listing saved conversations are not yet stopped by a forget. On stores that were not upgraded with the offline safety migration they still return a conversation hidden by a forget or correction, with its text. On upgraded stores the hidden conversation is returned without its text, and listing saved conversations and the saved-text usage summary are refused (`evidence_unavailable`, `source_unavailable`) after a forget. Search, recall and memory sources do not return hidden conversations. Still open as of installer 0.6.10. `cairn-memory raw delete --conversation ID --yes` removes a hidden conversation\'s saved text. Installed setups do not expose these readers.','Until cleanup removes a deleted item\'s index entries, its word counts can still slightly affect other results\' ranking scores; its text is never returned.','After you forget something, the conversation it came from and any resumed or forked copy of it (for example `claude --resume`) are not saved from then on. Any conversation that tries to save a message dated within 30 minutes of the forgotten message is not saved from then on either, including one you start right after the forget. To resume saving, start a new conversation more than 30 minutes after the forgotten message was written.','After any local forget, correct, conversation delete or Episode forget, conversations whose message times are unknown are hidden from Raw search, and a conversation that saves a message without a time is not saved from then on, including new conversations. Memories are kept. Claude Code and Codex normally record message times, so this only affects messages whose transcript entry has no timestamp.']) has('CHANGELOG.md',changelog,value);
  for (const value of ['On those upgraded stores, a memory from the same message as the forgotten one instead makes listing memories refuse with `revision_conflict`','can only be corrected or forgotten by an id noted beforehand']) lacks('CHANGELOG.md',changelog,value);
  // No wording from the narrower conversation-named forget fence (a later release), and no "hidden everywhere".
  for (const [path,text] of [['packages/setup/README.md',installer],['README.md',readme],['README.zh-TW.md',readmeZh],['CHANGELOG.md',changelog]]) {
    assert.doesNotMatch(text,/hidden everywhere/i,path+' must not say hidden everywhere');
    for (const value of ['merely nearby in time is no longer hidden','hides only that conversation and its copies',"can't be continued",'Start a new conversation to resume saving','Raw capture of messages without a time is refused']) lacks(path,text,value);
  }
});

// Embedding budget (0.6.8): the setup notice, the release pages and the defaults page describe the
// shared daily estimate with the same words, and none keeps the per-server-run wording.
test('the embedding budget is described the same way in the setup notice and the release pages',() => {
  const read = path => readFileSync(new URL(path,root),'utf8');
  const english = 'up to an estimated US$1 per day per running Cairn server';
  const chinese = '每個執行中的 Cairn server 每天預估上限約 US$1';
  for (const [path,values] of [['packages/setup/lib/messages.mjs',[english,chinese]],['packages/setup/README.md',[english,chinese]],
    ['docs/defaults.md',[english]],['README.md',[english]],['README.zh-TW.md',[chinese]]]) {
    const text = read(path);
    for (const value of values) assert.match(text,phrase(value),path+' carries: '+value);
    assert.doesNotMatch(text,/US\$1\s+per\s+server\s+run/,path+' no longer says per server run');
  }
});

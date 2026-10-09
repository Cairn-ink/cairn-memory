# Codex 安裝與自動記憶：CX-5

2026-10-10 更新。Installer 0.3.0（CX-5）已發布；這份原始碼升為 **0.4.0，尚未發布**，等待 chichi 核准。配套 plugin 維持 0.3.2、protocol 維持 0.3.0。本次只改 installer 協調、同意、授權與配對；frozen runtime、hook／recall framing 與 A7 certificate inputs 保持原樣。

本機是 **codex-cli 0.160.1**。CX-5 已接上 browser credential、私有 runtime、四個 user hooks、Stop／PreCompact capture，以及 SessionStart pause EOF boundary。UserPromptSubmit recall 注入已通過 [A7 pinned-host adversarial evaluation](../evaluation/codex-a7/RESULTS.md)，**在格式合格的 host 預設開啟**，可用 kill switch 關閉。MCP recall 仍可使用。

格式驗收只讀安裝的 binary 與本機 repo refs，使用自製 synthetic sessions，沒有讀真實對話。A7 另經 chichi 授權，以真實模型跑在隔離的 disposable CODEX_HOME／repo 與本機 fake Cairn 上；沒有遠端 Cairn 查詢、production 操作或發布。

## 版本與格式證據

[格式證據與 hash](../integrations/codex/test/fixtures/format-evidence-0.160.1.json) 記錄原生 ELF 的 SHA-256、完整 generated schema 的 SHA-256，以及每個 fixture 的 hash。

| 證據 | 結果與界線 |
| --- | --- |
| `codex --version` | `codex-cli 0.160.1`，exit 0 |
| `codex app-server generate-json-schema --out <private-dir>` | exit 0；HookEventName 包含四個事件，HookMetadata 支援 user source、trust status 與 spill threshold |
| binary 內嵌 command schemas | 八份 input/output schema；UserPromptSubmit output 明確允許 `hookSpecificOutput.additionalContext`；不是猜測的版本範圍 |
| 隔離 app-server `hooks/list` | 四個 hooks 被讀為 user source、enabled、untrusted；沒有 trust bypass |
| 原生 `codex exec` synthetic session | 產生 flat paginated ordinal JSONL、`source:exec`／`thread_source:user` header 與 canonical UserMessage/item_completed；網路 socket 被 seccomp 禁止，重試後中斷，exit 130 |
| assistant fixture | 依該 binary 的 generated ThreadItem／AgentMessageInputContent 與 serde enum／`AgentMessageContent::Text with 1 element` markers 撰寫 synthetic AgentMessage；沒有成功模型回覆的原生 assistant transcript |
| 重現 | [qualify-codex.mjs](../scripts/qualify-codex.mjs) 對指定 native binary 產生私有 schema evidence；本次重跑的完整 schema hash 相同，九份選取 schema 逐一核對 |

2026-10-09 schema 與離線原生 history 追加驗收，直接執行本機 app-server-daemon releases 的 native binary，HOME／CODEX_HOME 皆指向新建 0700 私有目錄，沒有讀真實設定、sessions 或呼叫模型：

| Native binary | 證據與判定 |
| --- | --- |
| 0.161.0 | `--version`／`generate-json-schema` exit 0；八份內嵌 hook schema、44 個選取與遞迴 `$ref` definitions、七個 serde markers 與 0.160.1 相同，**合格**。[Evidence](../integrations/codex/test/fixtures/format-evidence-0.161.0.json) |
| 0.162.0 | 同樣 exit 0，八份 hook schema 相同；parser 已支援穩定的 `partial_answer`；binary 自身的 `thread/searchOccurrences` SQL 用 `UNION ALL` 納入 partial items 與 turn 的 final item，**capture／recall 合格**。`SubAgentActivity` 另加 model／reasoningEffort，這類 item 仍排除。[Evidence](../integrations/codex/test/fixtures/format-evidence-0.162.0.json) |

兩版的 assistant records 都是依 schema／serde evidence 撰寫的 synthetic inputs，沒有冒稱模型輸出。另以 [probe-codex-phases.mjs](../scripts/probe-codex-phases.mjs) 在私有 HOME／CODEX_HOME 建立 idle native threads，seed disk rollouts，再由原生 `thread/resume`、`thread/turns/list`、`thread/items/list` 讀回；兩次 app-server 均 exit 0，沒有 `turn/start` 或模型呼叫。[凍結讀回結果](../integrations/codex/test/fixtures/phase-0.162.0-native-read.json) 只驗證 seeded records 的序列化，不是實際模型輸出。語意依據是 binary 自身的 [thread/searchOccurrences SQL](../integrations/codex/test/fixtures/binary-0.162.0/search-occurrences.sql)：查詢以 `UNION ALL` 結合所有 `partial_answer` items 與 turn 的 `final_agent_item_id`，將兩者視為獨立的索引內容。這無法證明真實模型的 final 不重複先前文字。兩段依原順序各送一筆 assistant message，由訊息序列保留完整回答，不串接 delta、也不另外產生一筆合併答案。中斷 turn 的 completed partial 仍是已完成訊息；只有 item_started／delta 的內容排除。response_item／agent_message 鏡像亦排除，cursor 與 frozen retry 保證重跑不重複計數。未知 phase（包含 item_started）使 scan fail closed。原本 0.160.1 的 native lifecycle／A7 證據保持原範圍。

安裝與 status 用 [qualification.mjs](../integrations/codex/qualification.mjs) 比對完整相關格式 fingerprint，包含遞迴參照的 content／phase／delivery／trust definitions，以及八份 command input/output schema。未知或較舊版本若與已知合格 evidence 相同就接受；格式不同則關閉，顯示 `Codex <ver> 的格式已變更，擷取與回憶暫停，等待 plugin 更新`。Pending 顯示尚未驗證，probe 失敗顯示驗證失敗；兩者都提示執行 `status --client codex` 重試，不能把 probe 失敗當成格式改變。尚未安裝時 status 只讀取快取；沒有 verdict 就說明格式尚未檢查，不生成 schema。

每次 hook 由 Linux `/proc` 沿 shell／env 父程序尋找最近的 native Codex，從 argv 分辨 CLI 與 app-server，不以 install-time `codex --version` 代表 daemon。只 stat binary identity 並讀 owner-private verdict，不生成 schema、不讀整個 binary；缺 verdict 時排入獨立背景 qualification，當次 hook 關閉。快取 key 包含 device／inode／size／mtime／ctime，verdict 另綁定已知 evidence policy；binary 更新或已知 evidence policy 更新都不能沿用舊資格。Detached capture worker 帶入 launcher 選定的 host，重查 identity／verdict 後才執行。Status 分別顯示 CLI 與最後觀察的 app-server 資格；同時有合格與未合格 host 時會顯示 recall 依 host 開關，不把合格 CLI 也報成關閉；多個不同 daemon 同時存在時，每個 hook 仍獨立判定，但 status 只保存最近觀察的同類 host。

Capture creator 接受已凍結的 `0.157.1`、`0.160.1`、`0.161.0`、`0.162.0`；其他 creator 可用本次已合格 host 的版本，或 owner-private cache 中任一 current-policy qualified verdict 的版本證據。Creator 的舊 binary 被更新或移除，不會抹掉已驗證的格式證據；stale policy、changed fingerprint、unsafe／corrupt cache 不授權。版本缺證據回傳可重試的 `creator_unqualified`，不保存永久 `unsupported_format`；已保存的 `unsupported_format` 沒有拒絕原因可供區分，因此保留 latch，不能靠 creator 資格自動清除。未知 phase／結構不符等真正格式 latch 在 pause、resume 與 SessionStart 後仍永久關閉；後續 Stop 在開啟 transcript 前返回，不反覆 rescan。需依既有 stopped-worker／confirm 流程明確 reset 才能清除。因此 daemon 0.163.0 → 0.164.0 → 0.163.0 或 CLI 0.160.1 resume 都能持續 capture，前提是 creator 0.163.0 已有合格證據。保留舊 cursor/profile ID，避免改變 frozen retry identity。Fork、subagent、非 CLI/exec source、未知 discriminator 同樣拒絕，沒有擴充 source scope。Schema qualification 不代表所有 resumed writer 或真實 compaction 已完成 host 驗收。


## 使用方式

```sh
# 0.4.0 未發布，先從 source 執行
node packages/setup/bin/memory.mjs setup
node packages/setup/bin/memory.mjs status
node packages/setup/bin/memory.mjs setup --client codex
node packages/setup/bin/memory.mjs status --client codex
node packages/setup/bin/memory.mjs setup --client codex --dry-run

# 已發布 0.3.0：單工具 setup；預設雙工具需等待 0.4.0 發布
npx @cairn-ink/memory@latest setup --client codex
```

需要 Node ≥22.16、Linux／WSL，以及已驗收的 Codex。安裝在互動終端機確認 endpoint、設定每日 capture 請求 cap，再走與 Claude 相同的 device browser authorization。Hooks 不接受 broad PAT fallback；授權 route 不支援時保留 disabled 狀態，明說原因。`--no-browser` 顯示代碼供手動開頁，`--reauthorize` 換發 hook credential；保存成功並讀回驗證後才 ACK。

MCP 是獨立授權：預設保留或新增裸 HTTP entry，提供 `codex mcp login cairn`，由 Codex 保存 OAuth credential。請在中立目錄登入，避免專案設定覆寫。既有有效 PAT／env credential 路徑保留；明確選 `pat` 或 `--manual-token` 時才用隱藏 prompt 保存 MCP PAT。**MCP PAT 為 config.toml 裡的 0600 明文；它不會被拿來當 hook credential。**

### 兩個 client 共用 identity

0.4.0 省略 `--client` 時會偵測兩個 CLI，逐一揭露並詢問。Claude 預設 `[Y/n]`，Codex `[y/N]`。兩者都同意時，Codex 的同一個問題也確認先退出兩個 host 與背景 capture workers，採用共用 identity；沒有另一個 pairing 步驟。格式未合格的 Codex 會說明並略過，Claude 可繼續，正常 exit 0。只有一個工具則詢問並設定該工具；兩者都找不到時說明需先安裝 CLI。

雙工具共用一次 memory-scoped browser authorization；credential 經各工具原有保存與驗證流程交付，使用現有 `initializePairing`／`completePairing` transaction，不重鑄既有 project key。先裝 Claude 或先裝 Codex，重跑都能加入另一個工具；Codex standalone 的原 key／root 可成為共享 identity。有兩個獨立 key 時拒絕，不自動搬移或 backfill。新配對仍要求啟用且版本 `>=0.1.2 <1.0.0` 的穩定 Claude plugin，並驗證 configure 支援 `pairing_record`。停用外掛保留停用，須先到 `/plugin` 啟用。

預設流程把 browser credential 保存在 `~/.cairn-memory-clients/setup-credential.json`（父目錄 0700、檔案 0600 明文），重跑先查 credential API，確認 memory scopes 與到期日後重用，不另開瀏覽器。也能重用既有 Codex 的 private hook credential。`--reauthorize` 在同一次雙工具 run 只換發一次。MCP OAuth／PAT 仍獨立，broad PAT 不會被拿來授權 hooks。舊版 Claude-only native secret 沒有 installer 私有副本時，configure metadata 不能提供可轉交的 token；明確的 `--client claude` 保留原憑證，加入 Codex 需要可共用的 memory-scoped 授權。

非 TTY 的預設 `setup` 不會詢問、安裝或授權，有偵測到工具時 exit 2；`status` 與 `setup --dry-run` 可使用。`--client claude|codex` 維持單工具規則，`disable`／`uninstall`／`pause`／`resume` 維持 per-client flags。預設 `status` 回報兩者，包含缺少 CLI 的訊息。Explicit Codex-only setup 保留原有 pairing／standalone 行為；不會替 Claude 更新 marketplace。


Opaque project ID 使用同一 root 的既有 HMAC key 與相同的 literal project path。配對安裝測試直接比較 Claude、Codex 的結果；不使用新 salt、client discriminator 或 realpath 重寫 project path。Codex-only 首次安裝使用既有 standalone identity transaction。

## 安裝位置與控制

`$CODEX_HOME` 未設定時為 `~/.codex`。安裝器只維護自己的 command，保留 config.toml 註解、無關 MCP、hooks.json 其他 hooks／屬性。

| 位置 | 內容與權限 |
| --- | --- |
| `$CODEX_HOME/hooks.json` | 四個 user command hooks；只含固定 node/runtime/config 路徑與事件名，不含 token；重跑與卸載辨識自己的 command 形狀／installation 路徑，清除所有舊 node／digest handlers |
| `$CODEX_HOME/cairn/installation.json` | 0600，固定 endpoint／binding／cap／runtime metadata |
| `$CODEX_HOME/cairn/credential.json` | 0600，memory-scoped browser credential；所在目錄 0700，明文私有檔，非 keyring |
| `$CODEX_HOME/cairn/runtime/0.4.0-<manifest-hash>/` | runtime 目錄 0700、檔案 0600；從 npm 包的 frozen hash manifest 複製，不依賴 npx cache，不在原路徑覆寫不同程式 |
| `$CODEX_HOME/cairn/qualification/` | 0700；binary identity verdict、pending lock 與最後觀察的 CLI／app-server descriptor 為 0600，不含 token／transcript |
| 共享 private root | identity、control generation、endpoint quota、usage、Codex-only daily cap policy 與 hosted-pause 最後觀察／availability；Codex cursor 與 Claude cursor 分開 |

```sh
node packages/setup/bin/memory.mjs pause --client codex
node packages/setup/bin/memory.mjs resume --client codex
node packages/setup/bin/memory.mjs disable --client codex
node packages/setup/bin/memory.mjs uninstall --client codex
node packages/setup/bin/memory.mjs prompt-recall-off --client codex
node packages/setup/bin/memory.mjs prompt-recall-on --client codex
```

`prompt-recall-off` 是只針對 UserPromptSubmit 注入的 kill switch：在 installation 旁寫入 owner-private `prompt-recall.json`（0600，`{"version":1,"enabled":false}`），之後 prompt hook 不查 recall、不注入；capture、pause 與 MCP 不受影響。檔案不存在代表 A7 預設（開啟）；不可讀、權限不安全或內容不合法時一律 fail closed（關閉）。Recall 前與回傳 context 前各讀一次，recall 進行中途關閉也不會注入。Status 會顯示目前狀態。Hook 以 `env -i` 啟動，shell 環境變數無法傳入，所以 kill switch 是檔案設定而非 env；`pause` 與 `disable` 仍是較粗的開關。

Pause／resume 操作共享本機控制；不擅自解除 hosted pause。Disable 先撤銷 installation／舊 generation，再移除自己登記的 handlers。**Uninstall 同時執行 unpair**：先撤銷 Codex workers，再在共享 setup lock 下以 native configure 清空 Claude 的 `pairing_record`，移除 Codex binding／shared record，保留 Claude 原 root、project key、pause、fingerprint history 與記憶，驗證 Claude 已 enabled。這也處理 pairing pending。若 Claude CLI 不可用或恢復無法驗證，回傳 exit 1、明說恢復失敗；Codex credential／installation 仍移除，恢復 CLI 後重跑 uninstall 可重試，不需 browser auth。失敗時保留私有、無 token 的 `~/.cairn-memory-clients/codex-uninstall-<installation hash>.json` ownership receipt；成功後移除，避免從其他 CODEX_HOME 誤解除配對。Uninstall 另刪除自己的 runtime 與該 endpoint 的 Codex policy，保留 MCP；policy 目錄不安全時明說略過清除，仍移除 credential／installation，不跟隨 symlink。Standalone 的 `cairn-standalone` key 也保留。重跑 setup 可重新啟用；重複 disable／uninstall 安全。新 node／digest 的授權或 candidate validation 失敗，保留上次成功 installation；Browser 授權／MCP candidate 驗證成功前不變動 identity；其後保存並讀回 disabled binding，交付／完成配對，再寫 policy／hooks 與 activation。若原生 pairing delivery 中途失敗，明說 pairing pending、要求 hosts／workers 維持停止；重跑完成同一個 identity。卸載不是 server token revocation，必要時到帳號設定撤銷 credential。

`status` 與 dry-run 不授權、不查 endpoint、不讀 transcript。未安裝 CX-5 時 status 只讀現有 cache，不生成 schema、不建立 `$CODEX_HOME/cairn/qualification/`；已安裝時可在熱路徑之外驗證格式。Status 顯示 host／installer、registration、credential presence、policy、local pause、UTC 日 cap usage、quota，以及 hosted pause 最後觀察；不把「已登記」寫成「已信任／已連線」。重新啟動 Codex，在 `/hooks` 檢閱並信任四個 handlers。安裝器不使用任何 trust bypass flag。

## Capture、recall 與 privacy

Stop／PreCompact 的入口總 budget 750 ms，host timeout 1 s；只回 `{}`，透過 stdin 交付 closed、無正文的 handoff。這兩個 foreground 入口不讀 credential、不請求 hosted pause-state；detached worker 才讀 credential 並驗證 enforced state，且在 dispatch 前重查。Worker 最長 62.5 s，失敗不污染 host stdout/stderr；所有自動入口內部失敗 exit 0。登記的 command 先以 `/usr/bin/env -i` 建立 HOME／固定 node PATH／LANG，再啟動第一個 Node process，避免 host preloads 先於 entry 執行。Worker／version 子程序亦使用封閉環境，不繼承 Node preloads、proxy credential 或 plugin token。

Capture 只讀 hook 授權的 source，選 canonical submitted user／assistant text。Tool、reasoning、mirror、HookPrompt、hook context、compaction summary、環境 metadata 都不送出；使用既有 redactor、4,000／20,000 UTF-16 units、24 messages、65,536 DTO bytes、frozen idempotent event IDs。`client:codex`，不傳原始路徑或 session ID。Processing、lost reply、quota refusal 保留 pending range；有效 acknowledge 才前進。

Hosted `/api/memory/pause-state` 必須是有效、enforced 的 protocol 0.3.0 state；缺失、未 enforce、regressing generation 都拒絕 capture。觀察到新 generation 時，在共享 control lock 下旋轉本機 generation，不清掉使用者 pause。Resume 後第一次授權 hook 對 stale／missing cursor 建立 EOF boundary，不補送 paused／offline／unseen session 的舊文字。Codex workers 使用 concurrency 2 與使用者明確設定的 daily cap；**這個本機 cap 不套到 Claude**。Endpoint 的既有 server quota 與 local pause 仍共用。Claude 不呼叫或要求 Codex 的 H5 pause-state，不因 404、unenforced、invalid policy 停止記憶；server 已有的 quota／pause 回覆照既有 transport 處理。Claude status 以 best-effort private reads 顯示 malformed／unreadable／future policy 與 shared pause availability；沒有 policy 時輸出維持原樣，relative／empty plugin-data 不進入新的 private policy reader。Availability 只讀 secret-free 最後觀察，不把它當 capture 授權。尚未觀察、僅已過期的 healthy state，或 observation file 本身異常，都不誤報 endpoint unavailable。只有實際觀察到 endpoint／protocol 問題時 Claude status 才報 unavailable，附觀察時間；舊的失敗觀察會標示 historical。Codex status 分別顯示 not yet observed／observation invalid 等狀態，仍不宣稱目前已連線。

UserPromptSubmit port 有同一 2 s budget、redacted 4,000-unit query、project/session binding、完整 receipts、固定 untrusted framing、whole-entry authority filter、8,000-unit／32 KiB context cap，以及注入前 generation 重查。A7 harness 在 disposable CODEX_HOME 以實際 native binary 生成並保存合格 verdict，再送第一個 prompt；未合格則在 install 階段停止，沒有 patch／bypass gate。**A7 port 跟隨格式資格**，合格 host 預設開啟；changed／pending／unavailable host 不查 recall、不注入，kill switch 關閉時亦同。Codex 把 hook `additionalContext` 放在 developer 層，安全性來自 whole-entry authority filter、untrusted framing、JSON quoting 與模型的判讀，不是精確版本字串。0.160.1 的 A7 是此 delivery format 的實證；相同 schema 的新 host 可沿用格式資格，不冒稱已逐版跑模型。A7 認證（[RESULTS](../evaluation/codex-a7/RESULTS.md)）只接受 `approved-commands.json` 的 26 個字面值與其釘住的輸出，佈局由輸出比對證明；這份核准清單只涵蓋 campaign 的 workspace 與誠實任務，重跑 A7 時若出現新指令形狀，須先人工審查再加入。Hook JSON／argv／env 無法改變 qualification。SessionStart 只處理 pause boundary，不呼叫或 acknowledge `/session-start` context。

## Gate table

| Gate | 本次狀態 | 解除條件 |
| --- | --- | --- |
| Host 格式與 installed lifecycle | 0.160.1／0.161.0／0.162.0 合格；未知但格式相同可快取接受。0.162.0 的 completed partial 與 final 各保留一次，unfinished 排除。交付 native schema evidence、synthetic fixtures、private runtime 與 fake-Codex E2E | 真實 interactive trust／flush／resume／PreCompact matrix 仍須 release acceptance；格式改變或 qualification pending 繼續拒絕 |
| Browser hook credential／identity | 接線完成，私有保存先於 ACK；配對 parity 測試通過 | 兩個 client 使用同一帳號；相容的 Claude plugin 已安裝；否則 standalone 可用但尚未共用 target |
| Prompt recall A7 | **通過，同 delivery format 的合格 host 預設開啟**：2026-10-09 以 `gpt-6-astra`／medium 跑 15 組 adversarial（含 6 組繁中／中英混合）× 3 = 45 runs，0 harmful、45/45 delivered；英文與中文 positive control 皆 3/3。之後依多輪 review 從 raw 證據重新認證（不再呼叫模型，共 55 次）：detector v8 要求每個執行指令與 26 個審查過的字面值逐字相同、每份輸出與審查過的 campaign 佈局輸出相符；git object 檔名採協調者 10/9 核准的 `stable-plus-variable`；51/51 PASS，3914 個 mutation 全部如預期。[結果](../evaluation/codex-a7/RESULTS.md)；kill switch `prompt-recall-off` | hook additionalContext delivery／placement、filter／framing／quoting、預設模型或 reasoning effort 變更時重跑 A7。Schema 與遞迴 delivery references 可偵測 wire 變化，但不能證明 schema 未暴露的 placement／實作行為沒有改變；發現這類變更也須重跑 |
| SessionStart context | Pause boundary 完成，context **關閉** | 本機 qualified o200k counter、sibling context authority／lifecycle acceptance，以及對 session context 重跑 A7 |
| Hosted H5／U-6 | Codex worker 要求 enforced pause-state；Claude 保留既有行為，不受未驗收 gate 阻擋；沒有 endpoint 驗收 | 指定部署 SHA／endpoint 的 authenticated capture、pause、quota 與 context conformance；本次禁止網路與 production |
| LAC／HMA | 不在此次 hosted runtime scope | 原設計契約的 model isolation／usage／latency gates；沒有宣稱 local adapter 已完成 |
| 發布 | 0.3.0 已發布；Installer 0.4.0 尚未發布 | chichi 審核 patch groups、更新 Claude bundle 與 release gates 後發布 |

## 驗證與剩餘限制

新增測試使用 fake CLI、synthetic HOME、記憶體 HTTP／IPC，涵蓋 install/re-run/status/disable/uninstall、browser ACK、OAuth／PAT 分離、secret argv/env/log canaries、paired identity、Stop／PreCompact、pause/resume EOF、quota processing、版本拒絕、open stdin 與 2 s recall deadline。實際執行與 exit code 記於 delivery manifest；不從 log 尾端推斷成功。

既有部分 suite 需監聽 loopback，本環境回傳 `listen EPERM`，完整 suite 的非零退出碼保留為受限驗證，不能列作通過。新離線 suite 與 shared guards 不開 socket。原先 SIGKILL／斷電留下 setup lock、stage 或私有 PAT 副本的回收限制仍存在；只有確認所有 setup processes 已停止後才能人工清理，沒有不安全的自動回收。Atomic rename 不宣稱 directory-fsync 的斷電保證。


Round 3 重新驗收基準為 `5ce3fab`。Claude re-review 在 real host 回報 round 2：
`npm test` 630/630、`test:pairing` 270/270、`test:codex` 149/149、
`test:setup` 196/196，exit 0。這是 reviewer 的基準結果，不能當成本輪新 tree 的結果。
本輪將 node-upgrade fixture 改為 running Node 加上 private second-node shim，
不依賴個人 nvm 路徑；新增 uninstall/unpair、semver/capability 與 status regressions。
各 Node matrix 與本輪完整 commands 的 actual exit/count 另記 delivery manifest。

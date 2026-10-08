# Codex 安裝與自動記憶：CX-5

2026-10-08 核對，基準為 `d7f52b95`（已發布的 installer 0.2.0）。這份原始碼將 installer 升為 **0.3.0，尚未發布**。配套 plugin 升為未發布的 0.3.2，protocol 維持 0.3.0；配套 plugin 僅增加 Codex policy／pause gate 的離線 status 診斷；Claude capture、recall、pause／resume 維持 origin/main 的行為。既有 0.3.1 不自動取得新程式。

本機是 **codex-cli 0.160.1**。CX-5 已接上 browser credential、私有 runtime、四個 user hooks、Stop／PreCompact capture，以及 SessionStart pause EOF boundary。UserPromptSubmit recall 注入已通過 [A7 pinned-host adversarial evaluation](../evaluation/codex-a7/RESULTS.md)，**在 0.160.1 預設開啟**，可用 kill switch 關閉。MCP recall 仍可使用。

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

Capture creator 精確接受 `0.157.1` 與 `0.160.1` 的已驗收 cli/exec paginated layout；保留舊 cursor/profile ID，避免改變 frozen retry identity。安裝與每次 hook 啟動只接受 host **0.160.1**。0.160.0、0.160.2、其他 minor、未知 suffix 都不自動擷取；版本不在清單時先拒絕，再接觸 source。Fork、subagent、非 CLI source、未知 discriminator 同樣拒絕。Schema pin 不代表所有 resumed writer 或真實 compaction 已完成 host 驗收。

## 使用方式

```sh
# 本次未發布，先從 source 執行
node packages/setup/bin/memory.mjs setup --client codex
node packages/setup/bin/memory.mjs status --client codex
node packages/setup/bin/memory.mjs setup --client codex --dry-run

# 0.3.0 經 chichi 發布後才會包含本次功能
npx @cairn-ink/memory@latest setup --client codex
```

需要 Node ≥22.16、Linux／WSL，以及已驗收的 Codex。安裝在互動終端機確認 endpoint、設定每日 capture 請求 cap，再走與 Claude 相同的 device browser authorization。Hooks 不接受 broad PAT fallback；授權 route 不支援時保留 disabled 狀態，明說原因。`--no-browser` 顯示代碼供手動開頁，`--reauthorize` 換發 hook credential；保存成功並讀回驗證後才 ACK。

MCP 是獨立授權：預設保留或新增裸 HTTP entry，提供 `codex mcp login cairn`，由 Codex 保存 OAuth credential。請在中立目錄登入，避免專案設定覆寫。既有有效 PAT／env credential 路徑保留；明確選 `pat` 或 `--manual-token` 時才用隱藏 prompt 保存 MCP PAT。**MCP PAT 為 config.toml 裡的 0600 明文；它不會被拿來當 hook credential。**

### 兩個 client 共用 identity

發現 Claude CLI／既有 Claude identity 時，setup 要求先退出兩個 host 與 capture workers，確認採用既有 identity。它使用既有 pairing transaction，不重鑄已有 project key，將 pairing record 分別交給 Claude plugin configure 與 Codex 私有設定，驗證交付後才完成配對。有衝突 key／無法安全採用時拒絕，沒有自動 migration 或 backfill。

新配對要求已安裝、啟用且版本為 `>=0.1.2 <1.0.0` 的 Cairn Claude plugin（不接受 prerelease／未知格式），並檢查 configure metadata 支援 `pairing_record`。`0.1.2` 首次加入 explicit pairing record／project identity（`ba33fb1`）；`0.3.1` 已具備所需能力，`0.3.2` 的 status 診斷不是配對前提。測試直接讀目前 plugin metadata，major 變更必須明確重新驗收。沒有另加 policy userConfig，也不在 Codex setup 更新 marketplace／外掛。缺少、舊版、停用或不相容外掛時，明說改用 Codex standalone，繼續 browser 授權與自動 capture；不修改 Claude key／設定，也不冒稱兩個 memory target 已共用。新 standalone 一律放在 `$CODEX_HOME/cairn-standalone`，以明確的 Codex-only binding 隔離 Claude 既有或未來的 default root。重新執行成功安裝時保留原有 identity，不因外掛降版／移除而默默切換 target。若原本是 standalone、現在已有相容外掛，setup 會明說保留舊 target 的原因與改配對步驟：退出 hosts／workers，先 uninstall，再 setup；原 standalone key／記憶保留，改用 Claude target 不會搬移舊 standalone 記憶。

兩個 client 仍須在 browser 使用**同一 Cairn 帳號、同一 endpoint**；credential API 沒有提供另一個 client 的 owner comparison，安裝器不能冒稱已驗證帳號相同。配對只寫 pairing record，保留 Claude 原有 endpoint 與 hidden credential。

Opaque project ID 使用同一 root 的既有 HMAC key 與相同的 literal project path。配對安裝測試直接比較 Claude、Codex 的結果；不使用新 salt、client discriminator 或 realpath 重寫 project path。Codex-only 首次安裝使用既有 standalone identity transaction。

## 安裝位置與控制

`$CODEX_HOME` 未設定時為 `~/.codex`。安裝器只維護自己的 command，保留 config.toml 註解、無關 MCP、hooks.json 其他 hooks／屬性。

| 位置 | 內容與權限 |
| --- | --- |
| `$CODEX_HOME/hooks.json` | 四個 user command hooks；只含固定 node/runtime/config 路徑與事件名，不含 token；重跑與卸載辨識自己的 command 形狀／installation 路徑，清除所有舊 node／digest handlers |
| `$CODEX_HOME/cairn/installation.json` | 0600，固定 endpoint／binding／cap／runtime metadata |
| `$CODEX_HOME/cairn/credential.json` | 0600，memory-scoped browser credential；所在目錄 0700，明文私有檔，非 keyring |
| `$CODEX_HOME/cairn/runtime/0.3.0-<manifest-hash>/` | runtime 目錄 0700、檔案 0600；從 npm 包的 frozen hash manifest 複製，不依賴 npx cache，不在原路徑覆寫不同程式 |
| 共享 private root | identity、control generation、endpoint quota、usage、Codex-only daily cap policy 與 hosted-pause 最後觀察／availability；Codex cursor 與 Claude cursor 分開 |

```sh
node packages/setup/bin/memory.mjs pause --client codex
node packages/setup/bin/memory.mjs resume --client codex
node packages/setup/bin/memory.mjs disable --client codex
node packages/setup/bin/memory.mjs uninstall --client codex
node packages/setup/bin/memory.mjs prompt-recall-off --client codex
node packages/setup/bin/memory.mjs prompt-recall-on --client codex
```

`prompt-recall-off` 是只針對 UserPromptSubmit 注入的 kill switch：在 installation 旁寫入 owner-private `prompt-recall.json`（0600，`{"version":1,"enabled":false}`），之後 prompt hook 不查 recall、不注入；capture、pause 與 MCP 不受影響。檔案不存在代表 A7 預設（開啟）；不可讀、權限不安全或內容不合法時一律 fail closed（關閉）。Status 會顯示目前狀態。Hook 以 `env -i` 啟動，shell 環境變數無法傳入，所以 kill switch 是檔案設定而非 env；`pause` 與 `disable` 仍是較粗的開關。

Pause／resume 操作共享本機控制；不擅自解除 hosted pause。Disable 先撤銷 installation／舊 generation，再移除自己登記的 handlers。**Uninstall 同時執行 unpair**：先撤銷 Codex workers，再在共享 setup lock 下以 native configure 清空 Claude 的 `pairing_record`，移除 Codex binding／shared record，保留 Claude 原 root、project key、pause、fingerprint history 與記憶，驗證 Claude 已 enabled。這也處理 pairing pending。若 Claude CLI 不可用或恢復無法驗證，回傳 exit 1、明說恢復失敗；Codex credential／installation 仍移除，恢復 CLI 後重跑 uninstall 可重試，不需 browser auth。失敗時保留私有、無 token 的 `~/.cairn-memory-clients/codex-uninstall-<installation hash>.json` ownership receipt；成功後移除，避免從其他 CODEX_HOME 誤解除配對。Uninstall 另刪除自己的 runtime 與該 endpoint 的 Codex policy，保留 MCP；policy 目錄不安全時明說略過清除，仍移除 credential／installation，不跟隨 symlink。Standalone 的 `cairn-standalone` key 也保留。重跑 setup 可重新啟用；重複 disable／uninstall 安全。新 node／digest 的授權或 candidate validation 失敗，保留上次成功 installation；Browser 授權／MCP candidate 驗證成功前不變動 identity；其後保存並讀回 disabled binding，交付／完成配對，再寫 policy／hooks 與 activation。若原生 pairing delivery 中途失敗，明說 pairing pending、要求 hosts／workers 維持停止；重跑完成同一個 identity。卸載不是 server token revocation，必要時到帳號設定撤銷 credential。

`status` 與 dry-run 不授權、不查 endpoint、不讀 transcript。Status 顯示 host／installer、registration、credential presence、policy、local pause、UTC 日 cap usage、quota，以及 hosted pause 最後觀察；不把「已登記」寫成「已信任／已連線」。重新啟動 Codex，在 `/hooks` 檢閱並信任四個 handlers。安裝器不使用任何 trust bypass flag。

## Capture、recall 與 privacy

Stop／PreCompact 的入口總 budget 750 ms，host timeout 1 s；只回 `{}`，透過 stdin 交付 closed、無正文的 handoff。這兩個 foreground 入口不讀 credential、不請求 hosted pause-state；detached worker 才讀 credential 並驗證 enforced state，且在 dispatch 前重查。Worker 最長 62.5 s，失敗不污染 host stdout/stderr；所有自動入口內部失敗 exit 0。登記的 command 先以 `/usr/bin/env -i` 建立 HOME／固定 node PATH／LANG，再啟動第一個 Node process，避免 host preloads 先於 entry 執行。Worker／version 子程序亦使用封閉環境，不繼承 Node preloads、proxy credential 或 plugin token。

Capture 只讀 hook 授權的 source，選 canonical submitted user／assistant text。Tool、reasoning、mirror、HookPrompt、hook context、compaction summary、環境 metadata 都不送出；使用既有 redactor、4,000／20,000 UTF-16 units、24 messages、65,536 DTO bytes、frozen idempotent event IDs。`client:codex`，不傳原始路徑或 session ID。Processing、lost reply、quota refusal 保留 pending range；有效 acknowledge 才前進。

Hosted `/api/memory/pause-state` 必須是有效、enforced 的 protocol 0.3.0 state；缺失、未 enforce、regressing generation 都拒絕 capture。觀察到新 generation 時，在共享 control lock 下旋轉本機 generation，不清掉使用者 pause。Resume 後第一次授權 hook 對 stale／missing cursor 建立 EOF boundary，不補送 paused／offline／unseen session 的舊文字。Codex workers 使用 concurrency 2 與使用者明確設定的 daily cap；**這個本機 cap 不套到 Claude**。Endpoint 的既有 server quota 與 local pause 仍共用。Claude 不呼叫或要求 Codex 的 H5 pause-state，不因 404、unenforced、invalid policy 停止記憶；server 已有的 quota／pause 回覆照既有 transport 處理。Claude status 以 best-effort private reads 顯示 malformed／unreadable／future policy 與 shared pause availability；沒有 policy 時輸出維持原樣，relative／empty plugin-data 不進入新的 private policy reader。Availability 只讀 secret-free 最後觀察，不把它當 capture 授權。尚未觀察、僅已過期的 healthy state，或 observation file 本身異常，都不誤報 endpoint unavailable。只有實際觀察到 endpoint／protocol 問題時 Claude status 才報 unavailable，附觀察時間；舊的失敗觀察會標示 historical。Codex status 分別顯示 not yet observed／observation invalid 等狀態，仍不宣稱目前已連線。

UserPromptSubmit port 有同一 2 s budget、redacted 4,000-unit query、project/session binding、完整 receipts、固定 untrusted framing、whole-entry authority filter、8,000-unit／32 KiB context cap，以及注入前 generation 重查。**A7 predicate 只對精確的 0.160.1 為 true**（`QUALIFIED_CONTEXT_HOSTS`），其他版本不查 recall、不注入；kill switch 關閉時亦同。Codex 把 hook `additionalContext` 放在 developer 層，因此安全性來自 framing 與 JSON quoting，A7 已以真實模型驗證。Hook JSON／argv／env 無法改變 qualification。SessionStart 只處理 pause boundary，不呼叫或 acknowledge `/session-start` context。

## Gate table

| Gate | 本次狀態 | 解除條件 |
| --- | --- | --- |
| 0.160.1 格式與 installed lifecycle | 已交付精確 pin、binary schema evidence、synthetic fixtures、private runtime 與 fake-Codex E2E | 真實 interactive trust／flush／resume／PreCompact matrix 仍須 release acceptance；未知版本繼續拒絕 |
| Browser hook credential／identity | 接線完成，私有保存先於 ACK；配對 parity 測試通過 | 兩個 client 使用同一帳號；相容的 Claude plugin 已安裝；否則 standalone 可用但尚未共用 target |
| Prompt recall A7 | **通過，0.160.1 預設開啟**：2026-10-09 以 `gpt-6-astra`／medium 跑 15 組 adversarial（含 6 組繁中／中英混合）× 3 = 45 runs，0 harmful、45/45 delivered；英文與中文 positive control 皆 3/3。[結果](../evaluation/codex-a7/RESULTS.md)；kill switch `prompt-recall-off` | 新 host 版本、預設模型或 reasoning effort 變更時，以 `evaluation/codex-a7/` 重跑後才擴充 `QUALIFIED_CONTEXT_HOSTS` |
| SessionStart context | Pause boundary 完成，context **關閉** | 本機 qualified o200k counter、sibling context authority／lifecycle acceptance，以及對 session context 重跑 A7 |
| Hosted H5／U-6 | Codex worker 要求 enforced pause-state；Claude 保留既有行為，不受未驗收 gate 阻擋；沒有 endpoint 驗收 | 指定部署 SHA／endpoint 的 authenticated capture、pause、quota 與 context conformance；本次禁止網路與 production |
| LAC／HMA | 不在此次 hosted runtime scope | 原設計契約的 model isolation／usage／latency gates；沒有宣稱 local adapter 已完成 |
| 發布 | Installer minor 升為 0.3.0；沒有 publish | chichi 審核 patch groups、更新 Claude bundle 與 release gates 後發布 |

## 驗證與剩餘限制

新增測試使用 fake CLI、synthetic HOME、記憶體 HTTP／IPC，涵蓋 install/re-run/status/disable/uninstall、browser ACK、OAuth／PAT 分離、secret argv/env/log canaries、paired identity、Stop／PreCompact、pause/resume EOF、quota processing、版本拒絕、open stdin 與 2 s recall deadline。實際執行與 exit code 記於 delivery manifest；不從 log 尾端推斷成功。

既有部分 suite 需監聽 loopback，本環境回傳 `listen EPERM`，完整 suite 的非零退出碼保留為受限驗證，不能列作通過。新離線 suite 與 shared guards 不開 socket。原先 SIGKILL／斷電留下 setup lock、stage 或私有 PAT 副本的回收限制仍存在；只有確認所有 setup processes 已停止後才能人工清理，沒有不安全的自動回收。Atomic rename 不宣稱 directory-fsync 的斷電保證。


Round 3 重新驗收基準為 `5ce3fab`。Claude re-review 在 real host 回報 round 2：
`npm test` 630/630、`test:pairing` 270/270、`test:codex` 149/149、
`test:setup` 196/196，exit 0。這是 reviewer 的基準結果，不能當成本輪新 tree 的結果。
本輪將 node-upgrade fixture 改為 running Node 加上 private second-node shim，
不依賴個人 nvm 路徑；新增 uninstall/unpair、semver/capability 與 status regressions。
各 Node matrix 與本輪完整 commands 的 actual exit/count 另記 delivery manifest。

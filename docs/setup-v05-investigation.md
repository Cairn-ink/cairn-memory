# 安裝器 0.5.0：調查與安全決定

以下調查以本次 checkout 的程式與 Codex rust-v0.160.1 為準。

## Codex OAuth 與 MCP 網址

Codex 的 OAuth store key 包含伺服器名稱與 URL 的雜湊；讀取 fallback store 時
也必須符合 URL，執行時同樣核對原本的名稱與 URL。因此 0.160.1 的 native
OAuth 不會因修改 MCP URL，就把原伺服器的 credential 帶到新伺服器。

來源：[官方 oauth.rs](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/rmcp-client/src/oauth.rs)，
`compute_store_key`、`load_oauth_tokens` 與 runtime 的 previous-token 篩選。

這不代表明寫的 HTTP headers、bearer token 環境變數或 helper 也安全。
安裝器只在 0.160.1、沒有這些 authentication 欄位、且 native CLI 驗證新設定
成功時改 URL。其他版本或設定會要求 `codex mcp logout cairn`、移除 MCP entry，
再對選定 endpoint 重新授權。安裝器不讀 Codex OAuth store。

## 備份身分與舊記憶的 recall 範圍

專案 ID 是由 project key 與專案路徑計算的 HMAC。換 key 後，同一路徑會產生
另一個 ID。此 repository 不足以證明所有帳號內的舊記憶都能透過新 ID recall。
因此沒有保留「備份那份存過的記憶仍在帳號裡」這個未驗證的承諾。

實際提示只保證本機另一把 key 改名備份、不刪除，並提醒舊專案可能不再自動
對上原身分。備份發生在授權、credential 與 MCP candidate 驗證成功之後，
使用原 pairing setup lock；先寫 private recovery receipt，再以不覆寫的
link/unlink 改名、fsync directory。後續 pairing 失敗會還原原檔名與 bytes。

## 背景 worker 的等待時間

Codex `integrations/codex/entry.mjs` 的 worker budget 是 62,500 ms，
`installed.mjs` 的 capture overall budget 是 60,000 ms。

Claude 的 `launch-capture.mjs` 啟動 detached `hook.mjs`，沒有整體 deadline。
`hook.mjs` 每 24 筆訊息一批，每批 POST 最多 25,000 ms，外加 file lock 等待。
多批工作可能超過一分鐘。因此提示改成「完全關閉工具，等背景工作結束」，
不宣稱等一分鐘就安全。本次沒有修改 worker 的時間限制。

## 非互動 codex exec 是否會自動擷取

**會進入可擷取的路徑**，條件是 hooks 已允許、host 格式合格、具有可讀 transcript、
安裝與授權有效，且未暫停或超過額度。Cairn parser 明確接受 `source: exec`，
沒有依是否為 TTY 排除。既有 frozen transcript fixtures 也包含 exec source。

[官方 exec 實作](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/exec/src/lib.rs)
以使用者 config 建立 in-process app-server，設定 `SessionSource::Exec`，預設
`ThreadSource::User`，並保留 hook trust 設定。這支持 exec 使用相同 hook 路徑的
判斷。本次另在獨立 HOME／CODEX_HOME、最小環境與合成 hooks 中，執行本機
原生 Codex 0.162.1 的非互動 `exec --skip-git-repo-check --json`。
只在這個合成 fixture 使用 `--dangerously-bypass-hook-trust` 以模擬已允許的
hooks；安裝器沒有使用或新增任何 trust bypass。provider 指向無服務的本機
port 9，不使用個人登入、模型 key 或 Cairn 服務。

實測看到 **SessionStart**，20 秒後中斷，最後 SIGKILL（Python returncode -9，沒有正常 exit code）。
沒有完成模型 turn，也沒有觀察 Stop 或真正的 capture 網路請求；不能把它當成
完整 capture 成功的實測。既有離線 runtime 測試則以 `source: exec` fixtures
驗證 Stop／worker 的擷取路徑。因此「完成的合格 exec 對話可能被擷取」仍是
原始碼與離線測試的推論。詳見[合成 probe 證據](evidence/setup-v05-exec-probe.json)。

建議後續預設略過 exec 的自動 capture，提供明確 opt-in，保留互動工作對話的
額度；否則 CI、批次任務與 agent automation 可能大量存入記憶並消耗每日上限。
仍需區分「非互動 exec」與「透過 app-server 的互動產品」，不宜只以沒有 TTY
為判斷條件。本次依要求只調查，**未修改任何 exec capture 行為**。

## 驗證範圍

新增十個流程的中英文輸出快照、80 欄檢查、語言檢查、衝突問題的各條分支、
非互動零寫入、每日上限預設／旗標／保留與後續修改、備份時序與失敗還原。
既有安全測試繼續涵蓋私有檔案、secret canary、credential 驗證、hook trust、
pairing transaction、暫停與卸載。測試使用專用 TMPDIR、依序執行。

補充：格式合格的 Codex 使用 `--manual-token` 時，仍需要獨立的 memory-scoped
瀏覽器授權來啟用 hooks；這個旗標只選擇 MCP 的 PAT，不會略過 hooks 授權。
因此伺服器不支援瀏覽器登入時，提示先更新伺服器，再重跑 setup，避免原建議的
`--manual-token` 指令又走回相同失敗。本次保留不以廣泛 PAT 啟用 hooks 的限制。

每日上限的後續修改沿用既有 runtime 保護：有當日計數時，不因修改上限而重設
已用次數。安裝器在停用 capture 的期間宣告新 policy，讓它於下一個 UTC 每日
重置生效；status 顯示當天實際上限，並用一行說明待套用的新值。新的測試涵蓋
12 次已用量、config 調高、setup 調低與下一日生效。runtime guard 本身未修改。

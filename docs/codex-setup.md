# Codex 一行安裝：現在可用的範圍

2026-10-07 核對。cairn-memory 基準 `0c7aa20a9cb490bac4d15eca28b2036823a5f48e`，plugin 0.3.1、protocol 0.3.0、installer 0.1.0。cairn-wiki 使用本機 `origin/main` 的 `5b972d53289a04df3b116613554cf7fccf58cc29`。能力研究只讀本機 binary 與既有 repo refs，沒有更新 remote refs、讀取真實 transcript、執行模型或驗證 production 部署。第一輪的 `mcp list` 可能觸發 unauthenticated OAuth discovery；本輪移除此查詢，真實 binary 回歸僅使用 loopback URL。

## 先講結論

本機 `codex --version` 是 **codex-cli 0.160.0**。Codex 已支援 hooks、lifecycle events、plugin marketplace 安裝與 HTTP MCP；不能再把「等 Codex upstream 提供 hooks」當成未開工的理由。

現在可以交付 Codex 的一行 **MCP 安裝**。要做到 Claude Code 那樣的自動擷取與自動回憶，仍需完成我們的 CX-5 接線，以及目前 Codex 版本的 transcript、hook 執行與 context 注入驗收。這次安裝器會清楚顯示「自動記憶尚未接線」。

## 本機證據

以下都來自安裝的 binary/help 或 binary 產生的 schema，沒有查網路：

| 能力 | 本機證據 | 能證明的範圍 |
| --- | --- | --- |
| Hooks | `codex features list`：`hooks stable true`；`codex --help` 有 hook trust bypass 選項 | 功能已存在；安裝器不使用 trust bypass |
| Lifecycle | `codex app-server generate-json-schema --out <隔離目錄>`，`v2.HookEventName` | 列出 `sessionStart`、`sessionEnd`、`userPromptSubmit`、`stop`、`preCompact`，另有 `postCompact`、tool、subagent、interrupt events；這是介面定義，沒有宣稱逐事件的實際執行已驗收 |
| Plugin 安裝 | `codex plugin --help`、`codex plugin add --help`、`codex plugin marketplace add --help` | 有 add/list/remove 與 local/Git marketplace；我們尚未交付可啟用 Cairn 自動記憶的 Codex plugin package |
| HTTP MCP | `codex mcp add --help`、`codex mcp get --help`、`codex mcp list --help` | 支援 `--url`、`--bearer-token-env-var`、JSON 狀態 |
| OAuth | `codex mcp login --help` | Cairn MCP 支援 OAuth，可用此命令把授權與 token 保存交給 Codex，避免在 config.toml 保存明文 PAT；與另一分支的 Cairn browser authorization 是不同協定 |
| PAT 的原生設定 | 隔離 `CODEX_HOME` 寫入 `mcp_servers.cairn.http_headers.Authorization`，再用真正 binary 執行 `mcp get cairn --json` | 0.160.0 原生讀到 HTTP URL 與 Authorization header；沒有連線遠端 |

舊 [Codex 設計契約](plans/codex-client.md#evidence-and-version-boundary) 記錄的 `hooks.json`／inline hooks、developer context 與 trust 流程，是 0.157.1 時的研究基準。這次沒有把舊版格式或 F0 的實測結果直接延伸成 0.160.0 的相容性承諾。

## 使用方式

這次新增的 Codex 流程尚未發布，從 source checkout 執行：

```sh
node packages/setup/bin/memory.mjs setup --client codex
node packages/setup/bin/memory.mjs setup --client codex --dry-run
node packages/setup/bin/memory.mjs status --client codex
```

包含這份改動的 installer 發布後，可使用：

```sh
npx @cairn-ink/memory setup --client codex
npx @cairn-ink/memory setup --client codex --dry-run
npx @cairn-ink/memory status --client codex
```

Node 需 ≥22.16。省略 `--client` 時，PATH 只有 Codex 就選 Codex；兩者都有則保留 Claude 的既有預設。`--client claude` 可明確選 Claude，`--no-browser` 可手動開啟 PAT 頁面。

沒有 user-level Cairn entry 時，互動安裝會詢問 endpoint，再以隱藏輸入取得 PAT。已有 user-level 裸 HTTP entry 時，先顯示該 endpoint，預設保留 OAuth 路徑並提供 `codex mcp login cairn`；只有明確輸入 `pat` 才補入 header。登入指令應從沒有專案覆寫的中立目錄執行。預設連線為 `https://cairn.ink/api/mcp`。遠端 endpoint 需 HTTPS，本機 HTTP 只接受 localhost／127.0.0.1／[::1]；不接受 URL 帳密、query 或 fragment。

安裝器寫入 `$CODEX_HOME/config.toml`，未設定 CODEX_HOME 時使用 `~/.codex/config.toml`：

```toml
[mcp_servers.cairn]
url = "https://cairn.ink/api/mcp"
[mcp_servers.cairn.http_headers]
Authorization = "Bearer <PAT>"
```

**PAT 是明文，檔案權限為 0600，並非 keyring。** 安裝前會告知保存方式。PAT 不放在 argv、安裝器設定的環境變數或 logs；所有 Codex 子程序輸出只在記憶體解析，不轉印，因為 `mcp get --json` 本身可能含 token。判定只讀此 user config 的私有 0600 副本，透過原生 TOML parser 解析；不使用 trusted project 的有效設定。候選設定與保存後驗證都以中立 cwd 執行 `mcp get cairn --json`；暫存目錄的祖先有 `.codex/config.toml` 或存在系統管理設定時拒絕自動安裝。驗證成功後原子替換正式設定；正常結束會於 finally 清除私有暫存副本與候選檔。

已有可用 endpoint 與 header／已載入環境變數憑證時，重跑不重寫、不重新詢問 PAT。沒有 header 的既有 user-level HTTP entry 可在明確選擇 `pat` 後補入 header；若原生 parser 拒絕合併，原檔保留。安裝器不查詢 `auth_status`，也不因 `not_logged_in` 或 `unknown` 而跳過此選擇。OAuth token 可能已由 Codex 保存，因此預設不新增 PAT。有其他 header、helper、未載入的憑證環境變數、停用或衝突的 entry 時，保留原設定並提示修復。安裝器不移除其他 MCP，不安裝 Claude plugin 到 Codex。

無關設定與註解保留。拒絕 symlink／非一般檔案、hardlink、其他 owner 與 group/world 可寫設定。Setup lock 阻止同一安裝器同時保存，保存前重新比較 user config 的內容與檔案身份；Codex 本身不使用這個 lock，這不是跨所有外部編輯器的交易鎖。

Dry-run 和 status 不改 user config、不收 token、不開瀏覽器，但會建立私有暫存目錄；Codex 本身也可能建立 `tmp/arg0` 等 runtime 檔案，不能宣稱完全不建立目錄。所有解析改用中立 cwd 的 `mcp get`，不再使用會對 endpoint 發送 OAuth discovery GET 的 `mcp list`，不驗證 PAT、服務端或 hooks。15 秒 timeout 現在只限制本機解析，不等待 endpoint discovery。非互動、舊 CLI 或 Windows 未驗證檔案權限時，會顯示待設定與 fallback，不收 PAT。fallback 的 `--bearer-token-env-var CAIRN_MCP_TOKEN` 只保存變數名稱，需由使用者的安全環境在每次啟動 Codex 時提供值；安裝器不把真實 token 拼進 shell 命令。

CLI 失敗傳回實際非零退出碼，未知選項回傳 2，先決條件／狀態解析失敗回傳 1。完成後重啟 Codex，用 `/mcp` 檢查工具，再明確要求 remember／recall。

## 還卡在哪裡，誰負責解除

| 項目 | 目前狀態與責任 | 精確解除條件 |
| --- | --- | --- |
| CX-4 public protocol | **已完成這一層，屬於我們的工作。** [CHANGELOG 0.2.0](../CHANGELOG.md) 與 [protocol](protocol.md) 已有 Codex discriminator、quota/reset、session-start、pause/generation；目前協定為 0.3.0 | 不需再等 CX-4 提供 hooks 或 discriminator；指定 endpoint 的相容性仍需驗證 |
| H5 hosted server | **source 已合併，部署驗收屬 cairn-wiki／coordinator。** wiki `docs/plans/h6-cutover.md` 記載 H5 在 pin `7467aebc`；`lib/memory/contracts.ts` 接受 codex，`tests/helpers/hosted-protocol-conformance.ts` 有 Codex、quota、pause conformance | 在欲支援的部署 SHA／endpoint 上完成 authenticated protocol、pause、quota 與 rollout 驗收；離線 source inspection 不能代替它 |
| 0.160.0 capture source | **我們的 CX-3／qualification 工作。** [parser](../integrations/codex/parser.mjs) 嚴格要求 metadata `cli_version === '0.157.1'`，且只接受指定 flat paginated cli/exec layout | 取得 0.160.0 primary types/schema pin 與 synthetic fixtures，驗證格式、flush、resume writer、fork／subagent 拒絕與安全讀取；重新驗收 A1/A4/A5/A9。不可只放寬版本字串 |
| CX-5 installed lifecycle | **我們尚未完成。** [Codex README](../integrations/codex/README.md) 明確說 uninstalled、disabled；UserPromptSubmit 是 `context_unavailable`，SessionStart 只有 pause-boundary building block | 可分發 launcher／worker 與 host registration；串接 credential、target/project identity、shared pause/quota guard、session-start／session-end 與 resume EOF barrier；通過 A7、hook trust 與真實兩 client 驗收，包含 developer context 注入。不能用 MCP 成功代替自動記憶驗收 |
| LAC／HMA local target | **我們尚未完成，repo 沒有這兩個 production adapter 目錄。** 不是 hosted MCP 安裝的前置條件 | 若要本機自動記憶，需 model-capable local transport、host-model isolation/termination、同意與 shared budget，加上 reviewed episode deadline configuration、A6/A9；若先交付 hosted 自動記憶，可依 CX-5 契約明確 defer LAC |
| 完整 CX-7 distribution | **我們的整合／發布工作。** 這次是 packages/setup 的可獨立交付切片 | 上述 automatic-memory gates 完成後再開啟 hooks；browser auth 另分支整合，npm 發布另行核准。本次不升版、不發布 |

上述沒有一項需要等 Codex upstream「新增 hooks／plugin install／MCP」。Upstream transcript 格式仍會變動，這是我們需要按版本 qualification 的原因，不是可以一直不做安裝器的理由。

wiki 的規劃以 `git -C /home/chichieh/Github/cairn-wiki show origin/main:<path>` 讀取，主要交叉核對 `docs/plans/one-brain-v1.md` 的 CX/HMA/LAC 順序、`docs/plans/one-brain-hosted.md` 的 H5 ownership、`docs/plans/h6-cutover.md` 的 deployed client gates，以及 `docs/plans/cli-browser-auth.md`。前述 source 狀態以此處記錄的 SHA 為準，沒有宣稱是 production 狀態。

## 與 browser authorization 分支整合

Codex 的 routing、狀態、檔案 transaction 與 CLI runner 都在 [lib/codex.mjs](../packages/setup/lib/codex.mjs)。`setup.mjs` 只新增 import 與一個 dispatch hook；client parsing、help 補充、Codex 的 Node／flags 驗證都在本模組，不改 Claude 的 help、credential block 或共用 execute。`setup.test.mjs` 只新增一個測試 import。不修改 browser-auth 正在重寫的 packages/setup README 與 package manifest，版本保持 0.1.0。

已讀取 `feat/setup-browser-auth` 的工作目錄：它正在新增 auth/errors/transport 模組與 `--manual-token`／`--reauthorize`。合併時保留雙方的 flags/help，Codex 仍走本模組的 PAT 路徑，直到 browser-auth 的 save callback 接到 Codex transaction。Cairn browser auth 會在保存成功後送 ack，因此不能只把它當成「取得 token」函式，先 ack 再寫檔。未接完前不可宣稱 Codex 支援 browser authorization 或 reauthorize；新的 client flags 應由各 client 明確驗證。

## 建議與驗證

對支援 OAuth 的 Cairn MCP，優先建議 Codex 原生 `mcp add cairn --url https://cairn.ink/api/mcp` 與 `mcp login cairn`：登入由 Codex 管理，可避免 config.toml 的明文 PAT，但需要互動 browser／服務端 OAuth 與 Codex 的 token storage，這輪未執行真實帳號登入。PAT 路徑適合不支援 OAuth 的 self-hosted endpoint 或明確選擇 PAT 的使用者。

現在先交付「Codex 一行連上 Cairn MCP」，同時排 **0.160.0 qualification + hosted CX-5**。這條路不必等待 LAC；LAC/HMA 留給本機自動記憶。對外等 CX-5 驗收後才說 Codex 有 Claude Code 等級的自動記憶。

`npm run test:setup` 包含 fake codex／fake claude，驗證 hidden PAT、argv/output 不含 token、0600 原生設定、無關設定保留、idempotence、dry-run/status、fallback、client 選擇、CLI 失敗、symlink、lock 與 concurrent edit。另用真正 0.160.0，從 trusted project 啟動安裝，再從中立目錄執行 `mcp get` 與 `features list`，驗證完整 URL／header、重跑保留、OAuth 提示與 user URL。測試只使用 synthetic PAT 與 loopback URL，沒有模型呼叫；是否成功監聽 loopback、觀察到的 discovery request 數與實際退出碼記錄於交付 evidence。

交付的 manifest 記錄 Node 22.16.0／24.15.0、指定 TMPDIR 的 `test:setup` 與 `validate` 實際退出碼、patch groups、檔案清單交叉核對與 delivery commit。

## Round 2 review 處理

P1-1 已修正：只根據 user config 副本決定 full entry／header-only，兩次驗證使用中立目錄，收 PAT 前顯示 user endpoint。P2-1 已修正：移除 discovery 狀態判斷，裸 HTTP entry 提供原生 OAuth 登入指令與明確 PAT 選擇，fake 的預設 OAuth 狀態也改成 `not_logged_in`。P3-1 補上 OAuth／PAT 的取捨；P3-2 修正文案並移除 `mcp list`；P3-3 與 README 統一使用 `CAIRN_MCP_TOKEN`；P3-5 移除新設定檔開頭的空白行。Claude-only help 不再先印 Codex Client 行，這輪不另交付 tarball。

**剩餘 P3-4：中斷後的暫存檔與 lock 回收。** SIGKILL／斷電可能留下 `.cairn-validate-*/config.toml`、私有 `cairn-codex-inspect-*` 副本、stage 檔與 `.cairn-setup.lock`。副本可能含 PAT，模式為目錄 0700／檔案 0600；正常錯誤與捕捉到的輸入取消會清除。這不是一行可安全修正的問題：自動回收需要 owner／檔案身份、活躍程序與 generation 的判定，不能刪除另一個仍在設定的程序持有的資料。確認所有安裝程序已停止後，才能手動清除以上 leftovers，再重跑。

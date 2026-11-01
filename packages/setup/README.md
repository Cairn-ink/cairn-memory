# @cairn-ink/memory

Cairn Memory is Cairn.ink's AI memory toolkit for Claude Code and Codex, with
local MCP tools or cloud automatic memory.

[Cairn.ink](https://cairn.ink) ·
[npm package](https://www.npmjs.com/package/@cairn-ink/memory) ·
[GitHub repository](https://github.com/Cairn-ink/cairn-memory)

Requires Node ≥22.16 and the selected CLI on PATH. The installer itself has no
runtime dependencies.
This README describes **installer 0.6.3**. The Claude plugin is **0.3.3**.
0.6.3 requalifies Codex 0.164.0–0.166.0; the engine is unchanged from 0.6.2
except the Codex format qualification modules. Existing EOF boundaries,
pending batches and permanent format latches keep their behaviour.

## Setup / 安裝

```sh
npx @cairn-ink/memory setup
# Or run this checkout directly / 或直接執行這份原始碼
node packages/setup/bin/memory.mjs setup
```

On a fresh interactive install, setup asks once where memory should live:
**1. Local** keeps data on this computer, free and usable offline after
installation, without sync across computers; **2. Cloud** shares memory across
computers and tools with cairn.ink sign-in. Existing cloud users keep their
flow without a new question.
Use `setup --local` or `setup --cloud` to choose directly. A fresh
non-interactive run without either flag writes nothing and prints both rerun
commands.

第一次互動安裝會先問一次記憶要存在哪裡：**1. 本機**把資料留在這台電腦，
免費、安裝後可離線使用，無法跨電腦同步；**2. 雲端**透過 cairn.ink 登入，
跨電腦和工具共用記憶。既有雲端使用者維持原流程，不會多問一次。
也可以用 `setup --local` 或 `setup --cloud` 直接選擇；第一次在非互動終端機
執行時，若沒選模式，不會寫入設定，會顯示兩個重跑指令。

## Local mode / 本機模式

```sh
npx @cairn-ink/memory setup --local
npx @cairn-ink/memory status
npx @cairn-ink/memory status --verbose
npx @cairn-ink/memory uninstall --local
# Non-interactive confirmation / 非互動確認
npx @cairn-ink/memory uninstall --local --yes
```

No Cairn account or sign-in is needed. Local mode uses one private root,
`~/.cairn-memory`, or an absolute `CAIRN_MEMORY_HOME`. It keeps the installation
record in `installation.json`,
engine generations and the npm cache in `engine/`, and memory by default in
`data/memory.sqlite` (created on first engine use). Initial engine dependency
installation needs npm registry access unless its cache is already populated.
Setup registers a `cairn-local` stdio MCP server through each client's own CLI:
user scope for Claude Code, and `$CODEX_HOME/config.toml` (default `~/.codex`)
for Codex. Both use the same database and owner, with an absolute Node path.
Restart the tools after setup. If Node moves, rerun `setup --local`.

本機模式不需要 Cairn 帳號或登入，共用一個私有目錄，預設為
`~/.cairn-memory`，也可用絕對路徑的 `CAIRN_MEMORY_HOME` 指定。
`installation.json` 保存安裝紀錄，`engine/` 放引擎
版本與 npm 快取，預設在 `data/memory.sqlite` 保存記憶，第一次使用引擎時
才建立資料庫。
第一次安裝引擎相依套件需要連到 npm registry，除非快取已備妥。
安裝器透過各工具的 CLI 註冊 `cairn-local` stdio MCP server：Claude Code
使用 user scope，Codex 使用 `$CODEX_HOME/config.toml`，預設在 `~/.codex`。
兩個工具共用資料庫與 owner，並使用 Node 的絕對路徑。安裝後請重開工具；
Node 路徑變動時，重跑 `setup --local`。

**0.6.3 local mode has no automatic capture or automatic recall.** Use the five
explicit MCP tools: `remember_memory`, `recall_memory`, `inspect_memory`,
`correct_memory`, `forget_memory`. Saving, inspecting, correcting and forgetting
need no model key. Semantic recall needs a model key; without one it reports
`model_not_configured`. If `OPENAI_API_KEY` is in the tool's environment, the
engine will use it for recall and send selected text to that provider.
Local storage does not mean all processing is offline. Setup sends no user data;
it reads the Claude registration configuration file `~/.claude.json` with a
4 MiB bound and extracts only `type`/`command`/`args` from the named `cairn` and
`cairn-local` MCP registrations. It does not access credential stores or use
authentication fields. Unrelated entries and file contents are never printed.

**0.6.3 本機模式不會自動記下對話，也不會自動回想。** 請明確呼叫上面五個
MCP 工具。保存、查看、更正與遺忘不需要模型金鑰；語意回想需要模型金鑰，
沒有時回報 `model_not_configured`。若工具的環境已有 `OPENAI_API_KEY`，
引擎會用它回想，並把選取的文字傳給該模型供應商，本機儲存不代表所有處理
都離線。安裝器不會傳送你的資料；它會讀取上限 4 MiB 的 Claude 註冊設定檔
`~/.claude.json`，只取出 `cairn`、`cairn-local` MCP 項目的
`type`／`command`／`args`，不存取憑證儲存區，也不使用驗證欄位。
無關項目與檔案內容不會印出。

When both tools share the database, `storage_busy` is a retryable transient
result: retry the operation; it does not mean memory is empty. `status` reports
registration, engine and Node state without starting the local engine or testing
a live connection. `--verbose` adds private paths, owner, engine ID and retained
failed installations. Uninstall detaches selected registrations and removes
`engine/` only when all clients are proven detached; **memory data is kept**.
`--client claude|codex` limits registration or detachment, not conflict
detection.
`uninstall --local --purge-config` also removes the descriptor and `.npmrc`,
never data; it cannot be combined with `--client`. A pending setup must be
uninstalled without `--client`.

兩個工具共用資料庫時，`storage_busy` 是暫時忙碌，請重試該操作，不能當成
沒有記憶。`status` 顯示註冊、引擎與 Node 狀態，不啟動本機引擎或測試實際
連線；`--verbose` 會多顯示私有路徑、owner、引擎 ID 與保留的失敗安裝。
解除安裝會移除所選工具的連接，確認全部解除後才移除 `engine/`，**記憶資料
會保留**。`--client claude|codex` 只限制註冊或解除的工具，衝突仍檢查兩邊。
`uninstall --local --purge-config` 會加刪安裝紀錄與 `.npmrc`，不刪資料，
不能搭配 `--client`。尚未完成的安裝若要移除，不能只選單一工具。

### Local options / 本機選項

| Option | Local-mode behavior |
| --- | --- |
| `--owner ID` | `setup --local` only, with no descriptor. Otherwise setup generates and persists an owner. |
| `--db ABS` | `setup --local` only, with no descriptor. Requires an absolute path; supports an external database. Default: `~/.cairn-memory/data/memory.sqlite`, under the selected root's `data/`. |
| `--project ID` | `setup --local` only, with no descriptor or an `uninstalled` descriptor. Active/pending installations reject changes. |
| `--yes` | Confirms `uninstall --local` without a prompt; required for non-interactive uninstall. |
| `--purge-config` | With `uninstall --local`, removes the descriptor and `.npmrc` after detachment, keeping data. Cannot be used with `--client`. |
| `--dry-run` | With local setup, shows the plan without changing settings, starting the engine or resuming a pending operation. |
| Hosted setup options | `--endpoint`, `--reauthorize`, `--manual-token`, `--no-browser`, `--no-clipboard`, `--codex-daily-cap`, `--codex-capture-exec` are rejected with `local_option_invalid`. |
| Hosted controls | `disable`, `pause`, `resume`, `prompt-recall-on`, `prompt-recall-off`, `config` are rejected on local-only installations with `local_control_unsupported`. |

| 選項 | 本機模式行為 |
| --- | --- |
| `--owner ID` | 只用於 `setup --local`，且不能已有安裝紀錄；省略時會產生並保存 owner。 |
| `--db ABS` | 只用於 `setup --local`，且不能已有安裝紀錄；須為絕對路徑，可用外部資料庫。預設為所選根目錄下的 `data/memory.sqlite`，一般是 `~/.cairn-memory/data/memory.sqlite`。 |
| `--project ID` | 只用於 `setup --local`，沒有安裝紀錄或紀錄為 `uninstalled` 時才接受；安裝中或使用中不能改。 |
| `--yes` | 略過 `uninstall --local` 的確認問題，非互動移除時必須指定。 |
| `--purge-config` | 搭配 `uninstall --local`，解除連接後加刪安裝紀錄與 `.npmrc`，保留資料，不能搭配 `--client`。 |
| `--dry-run` | 本機安裝預演，不改設定、不啟動引擎，也不接續尚未完成的操作。 |
| 雲端安裝選項 | `--endpoint`、`--reauthorize`、`--manual-token`、`--no-browser`、`--no-clipboard`、`--codex-daily-cap`、`--codex-capture-exec` 會回報 `local_option_invalid`。 |
| 雲端控制 | 本機模式使用 `disable`、`pause`、`resume`、`prompt-recall-on`、`prompt-recall-off`、`config` 會回報 `local_control_unsupported`。 |

If `claude mcp` or `codex mcp` lacks the required subcommands, setup prints a
manual registration snippet, marks that client `manual`, and exits 1. Follow
the snippet; this result does not prove an active connection.

If setup is killed, it leaves `.setup.lock`. Recovery is blocked while setup
or its npm child is still running. Once both have stopped, the next run prints
the stale-lock check and exact `rm` command. Confirm no install is running,
then use that command to remove only the stale lock. Rerun `setup --local` to
resume the recorded operation. The lock is never auto-removed.

若 `claude mcp` 或 `codex mcp` 缺少所需子指令，安裝器會印出手動註冊片段，
把該工具標為 `manual`，並以 exit 1 結束。請依片段操作，這個結果不代表已連線。

若安裝程序被強制結束，會留下 `.setup.lock`。安裝程序或 npm 子程序仍在執行
時不能恢復；兩者都停止後，下次執行會顯示過期鎖檢查提示與完整 `rm` 指令。
先確認沒有安裝仍在執行，再用該指令移除過期鎖，之後重跑 `setup --local`
才會接續紀錄中的操作。安裝器不會自動刪鎖。

Local and cloud cannot be mixed across these clients. A conflict or unreadable
configuration refuses setup without writes. To switch from cloud, follow the
printed commands in order, only for entries that exist:

1. Codex: `npx @cairn-ink/memory uninstall --client codex`, then
   `codex mcp remove cairn` (hosted uninstall keeps the MCP table).
2. Claude Code: `claude plugin uninstall cairn-memory@cairn-memory --scope user`
   for user scope; repeat with each scope printed by setup. If the legacy
   user-scope server exists, run `claude mcp remove --scope user cairn`.
3. Run `npx @cairn-ink/memory setup --local`.

To switch to cloud, run `npx @cairn-ink/memory uninstall --local`, then
`npx @cairn-ink/memory setup --cloud`. There is no data migration between modes.
If Claude shows two `cairn-local` servers, check `claude mcp list`:
project/local
scope can shadow user scope, which setup does not detect. Linux/WSL are
tested;
macOS uses the same path but is untested; native Windows local setup is refused
(use WSL). Engine opt-in features are not enabled by setup.

這兩個工具之間不能混用本機與雲端；遇到衝突或讀不到設定時，安裝器不改動設定。
從雲端切換時，依畫面指令順序操作，只移除實際存在的項目：

1. Codex：先執行 `npx @cairn-ink/memory uninstall --client codex`，
   再執行 `codex mcp remove cairn`，因為雲端解除安裝會保留 MCP 項目。
2. Claude Code：user scope 使用
   `claude plugin uninstall cairn-memory@cairn-memory --scope user`，
   其他 scope 依安裝器列出的指令逐一移除；有舊 user-scope MCP server 時，
   再執行 `claude mcp remove --scope user cairn`。
3. 執行 `npx @cairn-ink/memory setup --local`。

切回雲端則先執行 `npx @cairn-ink/memory uninstall --local`，再執行
`npx @cairn-ink/memory setup --cloud`，兩種模式不會搬移資料。
Claude 若出現兩個 `cairn-local`，請用 `claude mcp list` 檢查；project／local
scope 可能蓋過 user scope，安裝器不會偵測這種情況。Linux／WSL 已測試，
macOS 走相同程式但尚未測試；Windows 原生環境會拒絕本機安裝，請用 WSL。
安裝器不會開啟引擎的選用功能。

## Cloud mode / 雲端模式

Setup finds both tools, asks about new connections, and updates tools already
connected. Claude defaults to yes; Codex requires yes. When sharing memory,
close both tools and wait for background work to finish, then confirm once.
The default server is cairn.ink, shown on the browser sign-in line. There is no
endpoint or daily-cap question. `--endpoint https://your-server` remains supported.

安裝器會找出兩個工具，只詢問尚未連接的工具；已連接的工具直接更新。
Claude 預設同意，Codex 需要明確同意。共用記憶前，請完全關閉兩個工具、
等背景工作結束，再回答「都關好了嗎？」。預設連到 cairn.ink，登入時會顯示；
不用回答伺服器或每日上限的問題。需要自架伺服器時可用 `--endpoint`。

A memory ID connects the same project across tools. Setup retains existing IDs
and never silently switches them. Conflicting servers offer two choices. Codex
MCP URL changes are allowed only for verified URL-bound OAuth storage (0.160.1)
and configurations without explicit authentication fields; otherwise sign out
and remove its MCP entry before retrying. Two independent IDs require a choice.
The other key is renamed to a unique backup only after sign-in and validation
succeed, under the existing setup lock. It is never deleted. This preserves the
local key; old projects may no longer automatically match it. Setup does not
promise that all old account memories remain recallable with the selected ID.
Non-interactive conflict handling writes nothing and prints the rerun command.

「記憶身分」讓兩個工具認得同一個專案。既有身分會保留，不會默默切換。
兩邊連到不同伺服器時可選其中一邊；無法確認 Codex 憑證會依網址隔離時，
會請你先登出並移除 MCP 設定。兩份獨立身分需要選擇，另一把 key 只在登入
與驗證成功後才於鎖內改名備份，永不刪除。備份保留本機 key，但舊專案可能
不再自動對上原來的記憶。非互動終端機遇到衝突不會改設定，會顯示重跑指令。

One browser grant connects both tools. Adding Claude after Codex validates and
reuses the installer-owned credential. Adding Codex after Claude needs a browser
grant using the same account; Claude's sign-in is kept. Setup never reads Claude
native secret files. Enter the displayed one-time code on the device page;
press Enter to open it, or use `--no-browser` to open it on another device.

兩個工具第一次一起設定只需登入一次。先裝 Codex、後加 Claude，會驗證並
沿用安裝器保存的登入；先裝 Claude、後加 Codex，需要用同一帳號登入一次。
Claude 原有登入會保留。安裝器不讀取 Claude 原生秘密檔案。

To stop prompt recall while keeping automatic capture, run
`npx @cairn-ink/memory prompt-recall-off --client codex`.
Use `prompt-recall-on --client codex` to enable it again. This does not change MCP.

要關閉提問回想、保留自動保存，請執行
`npx @cairn-ink/memory prompt-recall-off --client codex`。
用 `prompt-recall-on --client codex` 重新開啟；MCP 不受影響。

## Cloud privacy / 雲端隱私

Conversations are saved after best-effort local masking. Each prompt sends a
masked, length-limited copy for recall. Claude plugin usage stats are on by
default and can be turned off. Codex's sign-in is an unencrypted file readable
only by its owner. Details and controls: [privacy](https://cairn.ink/memory/privacy).

對話會先在本機盡力遮蔽敏感內容，再保存。每次提問也會傳送遮蔽、限制長度的
副本來找相關記憶。Claude 外掛預設傳送使用統計，可以關閉；Codex 登入存於
未加密、僅使用者可讀的檔案。詳情與控制方式見上方隱私頁。

## Cloud commands / 雲端指令

```sh
npx @cairn-ink/memory setup --client claude
npx @cairn-ink/memory setup --client codex
npx @cairn-ink/memory setup --reauthorize
npx @cairn-ink/memory setup --no-browser --no-clipboard
npx @cairn-ink/memory setup --dry-run
npx @cairn-ink/memory status
npx @cairn-ink/memory prompt-recall-off --client codex
npx @cairn-ink/memory pause
npx @cairn-ink/memory resume
npx @cairn-ink/memory config --codex-daily-cap 300
npx @cairn-ink/memory uninstall --client codex
```

Automated `codex exec` runs are not saved or given prompt-recall context by
default. Opt in with `npx @cairn-ink/memory config --codex-capture-exec on`
(or add `--codex-capture-exec on` during setup); `off` restores the default.
The setting enables both capture and recall for exec. Setup preserves it and
`status` shows it only when on. The signal is the verified, session-bound
`session_meta.payload.source` in the transcript header, plus a native exec
ancestor for `exec resume` of a thread originally created interactively. Missing, partial or
unverifiable headers skip capture and recall. Interactive CLI sessions continue
normally once their header is available. App-server threads (the TUI since Codex
0.160, the VS Code extension and the desktop app) count as interactive only when
their header `originator` names one of those clients; any other app-server client
is treated like exec and needs the same opt-in. Older frozen runtimes need a setup
update first; config prints the exact setup command before changing anything.

Codex 只會記下你自己的對話。`codex exec` 和其他由程式自動跑的
Codex 工作預設不會記下，也不會注入提問回想。
若需要，可用 `npx @cairn-ink/memory config --codex-capture-exec on` 開啟，
或安裝時加上同名選項；改成 `off` 就能關閉。這個設定同時開啟保存與回想。
重跑安裝會保留設定；只有開啟時，`status` 才會顯示。
來源以 transcript 首筆經驗證、符合本次 session ID 的
`session_meta.payload.source` 判斷；也檢查原生程序的 exec 指令，
避免自動續跑互動對話時漏判。無法確認 transcript 時，略過保存與回想。
走 app-server 的對話（Codex 0.160 起的 TUI、VS Code extension、桌面 app）
只有 header 的 `originator` 是這三種用戶端之一時才算互動；
其他 app-server 用戶端視同 exec，同樣要先開啟上面的設定。

Codex defaults to 200 automatic captures per day. Existing installs keep their
stored cap. Use `setup --codex-daily-cap N` or `config --codex-daily-cap N` to change
it (integer 1–100000). With an existing daily counter, cap changes apply at the next daily reset.
Status shows today's effective cap and any pending change; reaching the cap pauses
Codex automatic capture until the next day. Claude's quota remains independent.
`pause` and `resume` select installed Codex automatically; a paired installation
shares the pause with Claude. A Claude-only installation prints its plugin command.
Pausing does not backfill conversations. `disable --client codex` removes hooks
and retains settings. Uninstall preserves memories, keys and MCP settings.

Codex 預設每天自動保存 200 次，既有安裝保留原上限。可用上方 `config` 指令，
或安裝時加 `--codex-daily-cap N` 修改。已有當日計數時，新上限在下次每日重置套用，不會重設已用次數。
`status` 顯示「今日 12 / 200」這類計數與待套用的變更；
用完後停止自動保存，隔天重新計數。Claude 的額度獨立計算。
省略 `--client` 的暫停、恢復指令會使用已安裝的 Codex；共用身分時也暫停 Claude。
只有 Claude 時會顯示外掛指令。暫停期間的對話不會事後補存。

`--verbose` shows technical diagnostics without tokens. `status` reads local
state; it does not verify remote service or hooks. Review the four Cairn hooks
in Codex `/hooks` after setup. Unqualified formats do not enable automatic memory;
Codex-only setup can offer manual MCP tools. `--manual-token` is a single-client
MCP/Claude fallback; shared automatic hooks require browser authorization.
Legacy Claude MCP removal asks explicitly before writes.

`--verbose` 顯示技術診斷，不會印出 token。`status` 只讀本機狀態，不驗證遠端或
hooks。安裝後請在 Codex `/hooks` 檢查並允許四項 Cairn 設定。

[Format qualification and runtime safeguards](../../docs/codex-setup.md) ·
[0.5.0 investigation and safe copy decisions](../../docs/setup-v05-investigation.md)

## Verification

```sh
TMPDIR=/absolute/dedicated/test-tmp npm run test:setup
node packages/setup/build-runtime.mjs --check
npm pack --dry-run --prefix packages/setup
```

Tests use synthetic CLIs, authorization and credentials. No personal memories
or native credentials are read. Run suites serially in a dedicated TMPDIR.

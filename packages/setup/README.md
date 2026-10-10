# @cairn-ink/memory

Set up Cairn automatic memory for Claude Code and qualified Codex hosts.
Requires Node ≥22.16 and the selected CLI on PATH; no runtime dependencies.
This checkout prepares **installer 0.5.0**. The Claude plugin stays **0.3.2**.
The release must be published before `npx` can use these new flows.

## Setup / 安裝

```sh
npx @cairn-ink/memory setup
# Use this checkout before publication / 發布前執行這份原始碼
node packages/setup/bin/memory.mjs setup
```

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

## Privacy / 隱私

Conversations are saved after best-effort local masking. Each prompt sends a
masked, length-limited copy for recall. Claude plugin usage stats are on by
default and can be turned off. Codex's sign-in is an unencrypted file readable
only by its owner. Details and controls: [privacy](https://cairn.ink/memory/privacy).

對話會先在本機盡力遮蔽敏感內容，再保存。每次提問也會傳送遮蔽、限制長度的
副本來找相關記憶。Claude 外掛預設傳送使用統計，可以關閉；Codex 登入存於
未加密、僅使用者可讀的檔案。詳情與控制方式見上方隱私頁。

## Commands / 指令

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
normally once their header is available. Older frozen runtimes need a setup
update first; config prints the exact setup command before changing anything.

Codex 用 exec 自動執行的工作預設不會記下，也不會注入提問回想。
若需要，可用 `npx @cairn-ink/memory config --codex-capture-exec on` 開啟，
或安裝時加上同名選項；改成 `off` 就能關閉。這個設定同時開啟保存與回想。
重跑安裝會保留設定；只有開啟時，`status` 才會顯示。
來源以 transcript 首筆經驗證、符合本次 session ID 的
`session_meta.payload.source` 判斷；也檢查原生程序的 exec 指令，
避免自動續跑互動對話時漏判。無法確認 transcript 時，略過保存與回想。

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

# @cairn-ink/memory

Dependency-free setup of the Cairn Memory **Claude Code plugin**, including this
repo's SessionStart, UserPromptSubmit recall and Stop/PreCompact capture hooks.
Other clients use the MCP connector.

安裝 Claude Code plugin 與此 repo 的 hooks，沒有 runtime dependencies。
其他工具使用 MCP connector。

## Setup / 安裝

**Prepared for release; not published yet.** After chichi approves publication:

**目前僅完成建置，尚未發布。** chichi 核准發布後，執行：

```sh
npx @cairn-ink/memory setup
npx @cairn-ink/memory setup --dry-run
npx @cairn-ink/memory status
```

Requires **Node ≥22.16** and `claude` on PATH. The unscoped npm package
`cairn-memory` belongs to another project; use `@cairn-ink/memory`.

需要 **Node ≥22.16**，以及 PATH 裡的 `claude`。npm 上未加 scope 的
`cairn-memory` 屬於別人，請使用 `@cairn-ink/memory`。

From the unpublished source checkout / 尚未發布時，從 repo 執行：

```sh
node packages/setup/bin/memory.mjs setup
node packages/setup/bin/memory.mjs setup --dry-run
node packages/setup/bin/memory.mjs status
```

Setup checks CLI capabilities, adds the marketplace if missing, and installs
`cairn-memory@cairn-memory` at user scope. It installs the plugin and hooks
together; automatic capture and recall are on by default. Existing configured
endpoint/token values are preserved. A disabled plugin stays disabled, with
instructions to enable it in `/plugin`.

安裝器會檢查 CLI 功能、加入 marketplace，並以 user scope 安裝 plugin 與
hooks，自動擷取與回憶預設開啟。既有的 endpoint/token 設定會保留；若 plugin
已停用，會提示到 `/plugin` 啟用。

In an interactive terminal, enter an endpoint, create a PAT at
<https://cairn.ink/settings/tokens>, and paste it once into the hidden prompt.
`--no-browser` leaves browser opening to you. This opens the PAT settings page;
it does not implement an OAuth/device-code pairing service. The helper does not
verify the PAT or call the hosted API.

在互動終端機填入 endpoint，到上方網址建立 PAT，再貼入一次，輸入不會顯示。
`--no-browser` 可改成手動開啟。這是開啟 PAT 設定頁，不是 OAuth 或 device-code
配對服務；安裝器不驗證 PAT，也不呼叫 hosted API。

Claude Code **2.1.285+** supports `plugin configure --values-stdin`. Setup checks
actual help output, then sends an in-memory JSON object through stdin. Tokens
never go in argv, logs, environment variables or installer-owned files. All child
output is suppressed. Claude Code owns storage of `api_endpoint` and sensitive
`api_token`; storage security depends on Claude Code and the host.

Claude Code **2.1.285+** 支援經 stdin 設定 userConfig。安裝器先偵測，再把
endpoint/PAT 以記憶體中的 JSON 交給 Claude Code，不把 token 放進命令參數、
log、環境變數或安裝器建立的檔案，也不轉印子程序輸出。
保存方式由 Claude Code 與作業系統負責。

On older CLIs or without an interactive terminal, installation completes with
configuration explicitly pending. No token is collected if it cannot be securely
forwarded. Open `/plugin` → Installed → Cairn.ink Memory → Configure options, or:

舊版 CLI 或非互動終端機可完成安裝，但會提示尚待設定；不能安全傳送時不收 token。
開啟 `/plugin` → Installed → Cairn.ink Memory → Configure options，或執行：

```text
/plugin configure cairn-memory@cairn-memory
```

Enter `api_endpoint` (default `https://cairn.ink`) and `api_token` there. Remote
endpoints need HTTPS; HTTP is allowed only for `localhost`, `127.0.0.1`, `[::1]`.
URL credentials, queries and fragments are rejected.

填入 `api_endpoint`（預設 `https://cairn.ink`）與 `api_token`。遠端需使用 HTTPS，
HTTP 只接受上述 loopback hosts，URL 不接受帳密、query 或 fragment。

Legacy MCP `cairn` removal requires affirmative confirmation and completed plugin
configuration in an interactive terminal. Otherwise the old MCP is kept, with a
manual command. Claude's default scope resolution applies; inspect duplicate
registrations at several scopes and repeat as needed. Restart Claude Code, then
run `/cairn-memory:status`.

舊 MCP `cairn` 只會在確認 plugin 已設定、且使用互動終端機時詢問移除，其他情況
保留並提示手動指令。移除使用 Claude CLI 的 scope 判定；若多個 scope 各有一份，
檢查後重跑。最後重啟 Claude Code，以 `/cairn-memory:status` 確認。

## Dry run and status / 預演與狀態

Dry run lists every step and uses only capability/state queries: no install,
browser, prompt, config write or removal. Status shows marketplace, plugin
scope/enabled state, endpoint/token presence when supported, and legacy MCP
presence. Neither command prints credentials. `claude mcp get` may health-check
an existing connector; these queries can contact it. Status does not verify the
PAT, server compatibility or hook execution.

預演列出每一步，只執行功能與狀態查詢，不安裝、開瀏覽器、提示輸入、寫設定或移除。
狀態顯示 marketplace、plugin scope 與啟用狀態、endpoint/token 是否已設定，
以及舊 MCP 是否存在，都不印出憑證。`mcp get` 可能進行連線健康檢查；狀態不代表
驗證了 PAT、服務相容性或 hooks。

Failures return the child exit code. Unknown arguments return 2; prerequisite
and parse failures return 1; Ctrl+C at a prompt returns 130. Child errors are
not printed because they may contain credentials.

CLI 失敗回傳其非零 exit code；未知選項回傳 2、先決條件或解析失敗回傳 1，
輸入時按 Ctrl+C 回傳 130。不轉印可能含憑證的子程序錯誤。

## Manual fallback / 手動安裝

If shell installation is unavailable, run inside Claude Code, then configure:

CLI 不支援非互動安裝時，在 Claude Code 執行，再依上方步驟設定：

```text
/plugin marketplace add Cairn-ink/cairn-memory
/plugin install cairn-memory@cairn-memory
```

## Maintainer checks / 維護檢查

From the repo root / 從 repo 根目錄：

```sh
npm run test:setup
```

Build from `packages/setup` using `npm pack --ignore-scripts --pack-destination
/tmp`. See [chichi's release checklist](../../docs/npx-setup-release.md).
Syntax was checked against local Claude Code 2.1.289 and the official
[CLI reference](https://code.claude.com/docs/en/plugins/cli-reference).
This does not establish production PAT/browser/storage behavior.

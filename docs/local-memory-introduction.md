# Introduction draft — not published

Use only after the owner approves the channel and release. Re-check the linked
candidate, install command and quality status before posting. No star request,
benchmark superiority or time/token savings claim is supported by this draft.

## Installer 0.6.0 local mode / 本機模式

```sh
npx @cairn-ink/memory setup --local
npx @cairn-ink/memory status
npx @cairn-ink/memory uninstall --local
```

Installer 0.6.1 was published on 2026-10-28; a checkout can also run
`node packages/setup/bin/memory.mjs setup --local`. A fresh interactive `setup`
asks once for local or cloud storage; non-interactive runs need `--local` or
`--cloud`. Existing cloud users keep their flow. Local mode registers
`cairn-local` stdio MCP for Claude Code and Codex, sharing a database by default
at `~/.cairn-memory/data/memory.sqlite` (or an absolute `CAIRN_MEMORY_HOME`
root). For an external database, use `setup --local --db <absolute path>` on
the first installation. Initial engine installation needs npm registry access
or a populated cache.
It exposes the five explicit memory tools, with no automatic capture or recall
and no engine opt-ins enabled. Without a model key, semantic recall returns
`model_not_configured`; if the tool environment has `OPENAI_API_KEY`, the engine
uses it and sends selected text to the provider. Setup reads a bounded Claude
registration configuration file and extracts only the named MCP registration
fields; it does not access credential stores or use authentication fields.
`status` does not start the local engine; local uninstall keeps memory data
(use `--yes` for non-interactive confirmation). `storage_busy` means retry when
the tools share the database. Conflicts require ordered detachment, with no
cloud/local data migration. Linux/WSL are tested, macOS is untested, and native
Windows local setup is refused. See the [installer guide](../packages/setup/README.md).

Installer 0.6.1 已於 2026-10-28 發布，也可用上方原始碼指令。第一次互動安裝會問一次
本機或雲端，非互動時需用 `--local`／`--cloud`，既有雲端使用者維持原流程。
本機模式為 Claude Code、Codex 註冊 `cairn-local` stdio MCP，預設共用上述
SQLite 路徑，也能用絕對路徑的 `CAIRN_MEMORY_HOME` 指定根目錄；外部資料庫
可在首次安裝時用 `setup --local --db <absolute path>` 指定。第一次安裝引擎
需要 npm registry 或已備妥的快取，不會開啟引擎選用功能、自動保存或回想。
語意回想沒有金鑰時回報 `model_not_configured`；若工具
環境已有 `OPENAI_API_KEY`，引擎會使用它，並把選取的文字傳給模型供應商。
安裝器讀取有大小上限的 Claude 註冊設定，只取出指定 MCP 註冊欄位，
不存取憑證儲存區或使用驗證欄位。`status` 不啟動本機引擎，解除安裝保留
資料，非互動確認請加 `--yes`。共用資料庫遇到 `storage_busy` 請重試；
衝突要依畫面順序解除連接，兩種模式不會搬移資料。Linux／WSL 已測試，
macOS 尚未測試，Windows 原生環境會拒絕本機安裝。

## Shared quickstart

For the separate source-preview operator path, choose a final target that
does not exist yet, under an already existing real parent directory you control:

```sh
npm run install:preview -- --directory /absolute/existing-parent/cairn-local --owner local-user
```

The installer creates private `app/` and `data/` directories and writes
`/absolute/existing-parent/cairn-local/installation-receipt.json`. The receipt
contains local paths, owner/project identity and generic `stdio.command` /
`stdio.args` settings; keep it private and copy those settings only into a
local MCP configuration. Follow the [installed no-key walkthrough](local-memory-demo.md)
for the SDK command and its separate paid `--with-recall` path. Do not send API
keys, raw conversations or private memory databases when requesting feedback.

## Short English introduction

Cairn Memory is a local memory layer for AI agents, with inspectable Source
Receipts. Its thin MCP server exposes explicit tools to remember, recall, inspect,
correct and forget over an open-source SQLite core; no Cairn account is
required. A useful scenario is to explicitly record a project decision or
personal preference, inspect its receipt in a later session, correct it when it
changes, and forget it when it should no longer be active.
Semantic recall requires a configured cloud model and sends selected memory
context to that provider; local storage does not mean all processing is offline.

`remember_memory` is direct MCP admission of caller-supplied content: it does not
read a transcript, run an extractor or automatically capture local chat. The
programmatic capture API is separate and can admit inferred items with source
receipts. The [default extractor's retained evaluation](semantic-evaluation.md)
still has unsupported source details; an explicitly selected [experimental
profile](plans/extraction-model-profile.md) passed a fixed small synthetic corpus
after review. Neither result is a quality score for MCP recall or the Hermes loop.

Installed persistence and scripted Hermes dispatch have been tested. A fixed
three-trial [real-model explicit lifecycle](evidence/reliable-memory-loop.md)
accepted all18 Cairn steps after review, but its combined no-memory control gate
did not pass. This is not broad recall quality or a human study. See the demo's [evidence boundaries](local-memory-demo.md#evidence-boundaries)
for the separate test modes and historical paid probe. The released hosted Claude
plugin is a separate mode with its own automatic capture and privacy behavior.

## 中文簡介

Cairn Memory 是讓 AI agent 跨對話使用的開源本機記憶層。資料存在自己的
SQLite，透過 MCP 儲存、檢索、查看、更正與遺忘，不需要 Cairn 帳號。你可以
記下一項專案決策或偏好，下次對話查看來源，內容改變時更正。語意檢索需要
設定雲端模型，會把選定的記憶內容送往供應商；本機儲存不代表所有處理都離線。

MCP 的 `remember_memory` 直接存入呼叫者指定的內容，不會自動讀取或摘要整段
對話。程式化的記憶抽取是另一條路徑：[預設模型仍有加入無根據細節的失敗紀錄](semantic-evaluation.md)，
[實驗配置](plans/extraction-model-profile.md)則在固定的小型合成資料評測通過審查。
這些抽取結果不能當作 MCP 檢索或 Hermes 對話的品質分數。

目前是開發者預覽：安裝與 Hermes 工具派送已有測試；另一次事先固定的
[三次真實模型閉環](evidence/reliable-memory-loop.md)，18 個 Cairn 步驟均通過複核，
但包含無記憶對照組的整批門檻未通過。這不是一般檢索品質或真人使用研究。
本機 MCP 尚未實作自動
記錄對話；已發布的託管 Claude plugin 是另一種安裝模式，有自己的資料流與
隱私設定。

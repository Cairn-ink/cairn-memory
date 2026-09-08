# Introduction draft — not published

Use only after the owner approves the channel and release. Re-check the linked
candidate, install command and quality status before posting. No star request,
benchmark superiority or time/token savings claim is supported by this draft.

## Shared quickstart

From a source checkout, run the one-command installer with a final target that
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

The installed SDK lifecycle is protocol/persistence evidence, not a general
quality guarantee. Pinned Hermes checks exercise the actual AIAgent loop and real
tool dispatch with scripted completion decisions, not a real model. A separate
historical paid native `MemoryManager` probe used a real model for a bounded
provider lifecycle, but it is not combined with that scripted loop or proof of
real-model full-chat. Autonomous real-model tool selection remains unverified;
automatic transcript capture is not implemented in this local MCP preview.
The released hosted Claude plugin is a separate mode with its own implemented
automatic capture and service/privacy behavior.

## 中文簡介

Cairn Memory 是讓 AI agent 跨對話使用的開源本機記憶層。資料存在自己的
SQLite，透過 MCP 儲存、檢索、查看、更正與遺忘，不需要 Cairn 帳號。你可以
記下一項專案決策或偏好，下次對話查看來源，內容改變時更正。語意檢索需要
設定雲端模型，會把選定的記憶內容送往供應商；本機儲存不代表所有處理都離線。

MCP 的 `remember_memory` 直接存入呼叫者指定的內容，不會自動讀取或摘要整段
對話。程式化的記憶抽取是另一條路徑：[預設模型仍有加入無根據細節的失敗紀錄](semantic-evaluation.md)，
[實驗配置](plans/extraction-model-profile.md)則在固定的小型合成資料評測通過審查。
這些抽取結果不能當作 MCP 檢索或 Hermes 對話的品質分數。

目前是開發者預覽：安裝後的保存與修正流程已有實測，Hermes 也跑過真正的
對話迴圈與工具派送，但工具選擇由模擬模型決定。另一次真實模型測試只驗證了
有限的記憶召回，兩者不能合稱完整真實模型對話測試。本機 MCP 尚未實作自動
記錄對話；已發布的託管 Claude plugin 是另一種安裝模式，有自己的資料流與
隱私設定。

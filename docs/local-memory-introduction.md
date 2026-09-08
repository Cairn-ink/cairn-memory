# Introduction draft — not published

Use only after the owner approves the channel and release. Re-check the linked
candidate, install command and quality status before posting. No star request,
benchmark superiority or time/token savings claim is supported by this draft.

## Short English introduction

Cairn Memory is a local memory layer for AI agents, with Source Receipts you can
inspect. A thin MCP server exposes explicit remember, recall, inspect, correct
and forget tools over the same open-source SQLite core. You do not need a Cairn
account; model-guided recall uses your explicitly configured provider.

The developer preview has a reproducible installed-process memory loop and
revision/isolation tests. It is not yet a general accuracy guarantee: our frozen
evaluation still catches unsupported details in inferred memories. We retain
those failures alongside the results. MCP alone does not automatically capture
your conversations, and local storage does not mean configured cloud-model
processing stays on-device.

If you are evaluating a small, inspectable memory layer, start with the
[README](../README.md) and [walkthrough](local-memory-demo.md). Feedback on setup,
useful sourced recall and incorrect memories is more valuable than a star.
Please do not send API keys, raw conversations or private memory databases.

## 中文簡介

Cairn Memory 是讓 AI agent 跨 session 使用的本機記憶層。記憶存在自己的
SQLite，透過 MCP 明確呼叫儲存、檢索、查看、更正與刪除；每筆記憶都有可以
查看的來源紀錄，不需要 Cairn 帳號。需要模型的檢索則使用你明確設定的供應商。

目前是開發者預覽：安裝後的跨程序記憶流程已有實測，但推論記憶仍可能加上
原文沒有的細節，完整評測與失敗都保留公開。它不是裝好就自動記錄全部對話，
使用雲端模型時，處理內容也不會全部留在本機。

想評估輕量、可檢查的 memory layer，可以從 README 的無 key walkthrough
開始。歡迎回報安裝卡點、來源是否有用，以及記錯的情況；不需要提供原始
對話、資料庫或 API key。

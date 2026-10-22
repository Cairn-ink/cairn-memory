# Cairn 下一階段記憶研究：目標與工作章程

狀態：**進行中**。最後更新：2026-10-23。主控：Claude（統籌與驗收）。
這份文件是本研究的目標、邊界、決定與進度的**唯一來源**。每次有新決定或到達里程碑，
主控就更新本文件並 commit。每個 Codex 派工的第一步都是先讀本文件。
目前位於研究分支，只在本機 commit；推上公開 repo 前要先跟使用者確認。

## 1. 最終目標（使用者原話）

- 做一個**輕量、可靠的 memory layer**，可以透過 MCP、Claude Code／Codex hooks 和其他
  harness 使用。
- 使用者在意的是**記得準、找得回，資訊改變後能交代新舊決策與原因**，而不是只把文字
  存下來。
- 架構：Raw 是原始證據，Memory 是記憶單元，Card 是整理後的知識。三者由同一個引擎
  負責，產品負責呈現與授權。現有機制包括 MOC、來源鏈、修正、忘記、刪除，以及明確
  建立 Card；並不是所有 Memory 都會自動變成 Card。

## 2. 這一輪要做什麼

- 研究使用者帶來的新方向：《Cairn 統一記憶架構整合 v1 實作規格草案》v0.2，吸收了
  MemPalace 與 OpenViking 的思路。
  - 原檔：`/mnt/c/Users/User/Downloads/cairn-unified-memory-integration-v1-draft (1).md`
  - 本機固定副本（不進 git）：`.research-private/unified-memory-integration-v1-draft-v0.2.md`，
    SHA-256 `9e895b33ab5d1224e11bbf93ce763ec5e867e7e6b9786215cb30a81290986c08`
  - 草案建議的正式位置：私有 `cairn-wiki/docs/plans/unified-memory-integration-v1.md`
- **角色**：Claude 是主控，統籌這個新方向。實作與審查一律派 Codex（見 §5）。
- **交付**：可重現的比較、失敗原因，以及每個方法「值得繼續／暫不採用」的建議。
  第一輪不做成完整產品。
- **不能先假定新方法比較好**；也可以挑戰 MOC，或加入向量、關聯檢索，不必維護既有
  架構的面子。

### 成功的樣子

每個研究問題都有一份凍結協議、一份固定的語料、可一鍵重跑的結果和明確的建議。
建議要能直接回填草案 §5.4（檢索配置）與 §10（評測後再決定預設）。

## 3. 不可違反的邊界

- **不接手、不干擾**另一個 session 的 V1 交付：PR #453–#469 這條鏈，以及其後的
  E1-C／E1-M。不改它的檔案，不合併、發布或部署。
- **維持 V1 對外接口**；新能力只能是明示、選配的新接口。
- **先用合成資料。** 付費 API、真實對話和金鑰都要另外確認；不沿用另一個 session 的
  預算或帳本。
- **實驗原則**：
  - 固定資料、模型和資源條件。
  - 分開報告流程完成率、找回證據的能力、答案正確性、成本／延遲。
  - 保留失敗結果。
  - 小樣本只用來判斷方向，不宣稱產品全面可靠。
- **規格不等於已實作。** 文件裡的提案、歷史紀錄和已通過的驗收要分開看。
- **授權**：OpenViking 是 AGPL-3.0，只能借設計、不能抄程式碼；MemPalace 是 MIT，
  可以引用但要標註；Cairn 是 Apache-2.0。

## 4. 固定基準

| 項目 | 值 |
| --- | --- |
| 研究基準 | PR #468 head `3f6590584e746cc596c7859c9b0a00ae808941b6`（未合併）。檢索與排序邏輯和 main `cd6d1ad` 相同 |
| 研究分支 | `experiment/hybrid-retrieval-hr1`，worktree `/home/chichieh/cairn-memory-hr1`（本機，未推送） |
| 上游參考 | MemPalace `f41e8e75ddaadf5588d5127715fa531d79eadb45`；OpenViking `824e9c7ff5e7cebbc36f55257c39f8bbe75d5a24` |
| 參考機器 | AMD Ryzen 9 9950X（32 執行緒）、47 GB RAM、WSL2、Node 22.16.0 |

已核對的關鍵事實（2026-10-23）：
- **現行 `selectEvidence` 不是挑全庫最相關的。** 它依隨機 UUID 的 id 順序掃描，預設
  128 筆，收前 12 筆至少有一個詞重疊的再排序；連續中文被當成一個詞。
- **MemPalace 的數字全是自家報告**，而且是以整段 session 為單位的檢索召回率，不是
  答題正確率。用 LLM 主題路由當硬過濾時，R@5 只剩 34.2%。
- **OpenViking 在指定版本已拿掉目錄遞迴檢索（#5450）和 relation 邊（#3956）**，兩個
  PR 都沒有附品質評估。它 README 上的 LoCoMo 成績是 v0.3.22 測的。
- **9 月的兩個實驗分支**（candidate-retrieval-ablation、incremental-candidate-index）
  沒看到 MOC 路由帶來好處；中文切分與改寫說法仍是未解的假設。

## 5. 已做的決定

| 日期 | 決定 |
| --- | --- |
| 2026-10-23 | 向量通路的「接口與停用、降級回報」是 v1 必過；要不要**預設開啟**，依 HR-1 的結果決定 |
| 2026-10-23 | HR-1 加入 A5「索引原文片段」選配組（MemPalace 的核心主張），只用合成資料，不改 v1 契約 |
| 2026-10-23 | 向量模型同時測本機開源模型（multilingual-e5-small、bge-m3）和產品預計用的 API。API 組要等使用者確認供應商、模型、額度與金鑰才跑 |
| 2026-10-23 | 派工結構：Claude 主控、寫派工紀錄、做驗收；每個任務一位 Codex worker；每個固定 commit 由兩位非作者 Codex 審查（Standards、Spec） |
| 2026-10-23 | Codex 一律用 `codex exec -m gpt-6.1-sol -c model_reasoning_effort="xhigh" --ignore-user-config --disable hooks`。已實測：實際模型 gpt-6.1-sol／xhigh，沒有觸發 Cairn 擷取 hook，也沒載入 cairn.ink MCP |
| 2026-10-23 | 同時執行的 Codex 數量不設上限（與另一個 session 共用帳號額度） |

## 6. 研究問題與順序

| ID | 問題 | 狀態 |
| --- | --- | --- |
| HR-1 | 向量加中文字面融合，能否比強中文字面檢索找回更多必要證據，且精確詞不倒退？另附 A5 原文片段對照 | 協議已凍結：[hybrid-retrieval-hr1.md](hybrid-retrieval-hr1.md)（`d1a64f5`）；下一步是 Codex 設計審查 |
| HR-2 | 在固定 token 預算下，「分層表示＋先覆蓋再加深」能否比 top-k 全文放進更多必要證據？不需要模型 | 候選 |
| HR-3 | 分類型更新政策能否提高「目前決定、舊決定、改變原因」的正確率？需要真模型抽取，付費 | 候選，需另批預算 |
| 之後 | 一跳 typed 關聯、MOC 通路的名次定義、LLM 或 cross-encoder rerank | 未排 |

## 7. 工程軌（草案 M1–M8）

- P0 盤點（reuse／extend／new，以及與另一個 session 的衝突）：待派 Codex 唯讀處理。
- 方法包、素材等新能力，以及介面版本化，排在 P0 之後；和另一個 session 正在改的
  檔案與 schema 要先釐清再動。

## 8. 進度與下一步

- **已完成**
  - 基準核對、上游核對
  - HR-1 協議凍結（`d1a64f5`）
  - Codex 隔離驗證
- **下一步**
  1. 派 Codex 唯讀審查 HR-1 協議，並修正協議。
  2. 平行派語料作者和測試框架兩位互相獨立的 worker。
  3. 標註稽核後凍結語料，接著執行、驗收、報告。
  4. 平行派工程軌 P0 盤點。
- **待使用者確認**：產品 embedding API 的供應商、模型、額度與金鑰提供方式。

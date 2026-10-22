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
| 工程整合分支 | `integration/unified-memory-v1`，worktree `/home/chichieh/cairn-memory-umv1`，基準 #469 `b8fa224`（本機，未推送） |
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
| 2026-10-23 | 產品 embedding API 選定 OpenAI，模型由主控決定。HR-1 的 API 組：`text-embedding-3-large`（主要候選，3072 維，另在本機截成 1024 維並重新正規化，看儲存成本取捨）與 `text-embedding-3-small`（成本對照）。理由：官方公布的多語檢索 MIRACL 平均 54.9 vs 44.0，英文為主的 MTEB 64.6 vs 62.3；每百萬 token 約 US$0.13 vs US$0.02 |
| 2026-10-23 | **分支策略**（使用者授權主控以 DRI 身分決定；另一個 session 目前已停下）：研究與工程分成兩條分支。研究留在 `experiment/hybrid-retrieval-hr1`（只動 `evaluation/` 和文件，結論用來回填，本身不併入產品）。改 `core/` 的工程放在新的 `integration/unified-memory-v1`（worktree `/home/chichieh/cairn-memory-umv1`），基準是那串未合併 PR 的最新一個，#469 `b8fa224d5ba6fe8007e6d80fe64fae74d89aa78b` |
| 2026-10-23 | **整合 owner**：另一個 session 停下期間，由本研究的主控擔任新方向 `core/` 變更的唯一整合者，並保留 schema **v30** 給第一批新資料表。那串 PR 合併或被修改時，本分支 rebase 到它上面。另一個 session 若恢復，先協調再動共用檔案（`database.mjs`、`runtime.mjs`、`contract.mjs`）。對外的 issue 或 PR 留言要先問使用者 |
| 2026-10-23 | **工程順序**：先做不必等 HR-1 的部分。P0 契約凍結（typed refs、`context-read-v1` 的邊界、採用語義、v30 配置）→ M4 方法包（不可覆寫版本、採用綁定、變更原因）→ M5 素材。M6／M7 的預設值等 HR-1／HR-2，但它們的接口與降級契約可以先做。每一包照派工規則：Codex 實作、兩位非作者審查、主控驗收。推上遠端或開 PR 前先問使用者 |
| 2026-10-23 | HR-1 的 API 呼叫上限 **US$1**，自己記帳，不用 repo 共用帳本，也不用另一個 session 的額度（估計實際花費不到 US$0.10）。金鑰放在使用者提供的 `~/.config/cairn-hr1/openai.env`（權限 600）。Codex worker 只用假的 HTTP 實作和測試 API 組，**不給金鑰**；付費執行由主控做 |

## 6. 研究問題與順序

| ID | 問題 | 狀態 |
| --- | --- | --- |
| HR-1 | 向量加中文字面融合，能否比強中文字面檢索找回更多必要證據，且精確詞不倒退？另附 A5 原文片段對照 | 協議已凍結：[hybrid-retrieval-hr1.md](hybrid-retrieval-hr1.md)（`d1a64f5`）；下一步是 Codex 設計審查 |
| HR-2 | 在固定 token 預算下，「分層表示＋先覆蓋再加深」能否比 top-k 全文放進更多必要證據？不需要模型 | 候選 |
| HR-3 | 分類型更新政策能否提高「目前決定、舊決定、改變原因」的正確率？需要真模型抽取，付費 | 候選，需另批預算 |
| 之後 | 一跳 typed 關聯、MOC 通路的名次定義、LLM 或 cross-encoder rerank | 未排 |

## 7. 工程軌（草案 M1–M8）

**進度（2026-10-23）**：P0 契約經兩輪非作者審查後為 v0.3（整合分支 `docs/plans/unified-memory-v1-contract.md`，`2b2e3cf`）。U2 拆成 U2a 與 U2b：U2a 已派 Codex 實作，U2b（綁定、解析、pin）在 U2a 驗收後由同一位 worker 接續。分包順序：U2 方法包 core → U3 方法包 host（匯入器、TTY 核准、MCP 唯讀工具）→ U4 素材 → U5 共同讀取與檢索（等 HR-1／HR-2）。

P0 盤點已完成（2026-10-23，Codex `p0_inventory`；完整報告在
`.research-private/dispatch/p0_inventory/last.md`，因引用私有產品檔案而不進 git）。
主控抽查了 schema 版本、session context 預算，以及 #469 有沒有改 `core/`，三項都屬實。

- **可直接沿用**：M1 擷取與封存、M2 修正／忘記／取代、M3 Card 與 typed organization。
  - Raw 本機機制已實作，草案寫「RL-0 尚未實作」已過時。
- **要擴充**：
  - M6 檢索：現在只有 Memory／Card 的字面選取，而且是先掃到的前幾筆，不是全庫 top-k。
  - M7 組裝：只有 `model-packing`、`session-context` 這些零件。session context 預設
    1,500、上限 2,000 tokens，草案的 4,000 是新契約。
  - M8 交付：需要 `context-read-v1`、跨 namespace 預算與任務快照。
- **全新**：M4 方法包、M5 素材與衍生文字。下一個可用的 schema 版本是 **v30**，要由單一
  owner 統一配發。
- **與另一個 session 的衝突**：
  - #469 動到本機 hook、安裝流程和 installed 測試；
  - E1-C 動到 topic reader 的 Worker 與 journal mode；
  - E1-M 動到 MOC 成員分頁。
  - 這三處要等它們定案後再擴充；`database.mjs`、`runtime.mjs`、`contract.mjs` 這類
    共用檔案只能有一個整合 owner。
- **現在就能開始**：
  - 凍結 typed refs、採用語義、fixture 判準與預算；
  - 設計 M4／M5 的契約；
  - 做 M7 決定性組裝的實驗（即 HR-2）。
- **要等 HR-1**：M6 的預設 embedder、權重與資源配置。
- **要等外部關卡**：hosted（加密、容量、G1／G2／H6）。
- **待定義才能凍結的契約**：MOC 通路的名次、採用綁定的投影、素材儲存 port、跨 namespace
  預算、表示降階、關聯的端點型別、持久工作的 lease。
- 動到 `core/` 的工程實作會碰到另一個 session 的共用檔案，開工前先跟使用者確認
  owner 與順序。

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
- **金鑰已就緒（2026-10-23）**：`~/.config/cairn-hr1/openai.env` 權限 600。原檔尾端誤帶「空白＋│」兩個字元，主控去掉後，用不計費的 `GET /v1/models/{model}` 確認 3-small 與 3-large 都回 200，才寫回檔案。內容從未印出。API 組會在測試框架驗收後，由主控在 US$1 上限內執行。

## 9. 派工紀錄

所有 Codex 都用 `codex exec --ignore-user-config --disable hooks`，指示、事件與結果放在
`.research-private/dispatch/<名稱>/`。

| 名稱 | 任務 | 要求 → 實際 | 沙箱 | 基準 | 期間（UTC） | 結果 |
| --- | --- | --- | --- | --- | --- | --- |
| `isolation_probe` | 隔離驗證 | gpt-6.1-sol/xhigh → 同 | read-only | `d1a64f5` | 2026-10-22T19:20 | exit 0，沒有觸發 hook |
| `p0_inventory` | 工程軌 P0 盤點 | gpt-6.1-sol/xhigh → 同 | read-only | `645b100`（core 等同 #468） | 19:24–19:29 | exit 0；見 §7 |
| `hr1_protocol_audit` | HR-1 協議的非作者設計審查 | gpt-6.1-sol/xhigh → 同 | read-only | `645b100` | 19:24–19:35 | exit 0；6 項 P0 → v2（`ed7c763`） |
| `hr1_protocol_audit`（複查） | 檢查 v2 | gpt-6.1-sol/xhigh → 同 | read-only | `ed7c763` | 19:39–19:44 | exit 0；新增 2 項 P0 → v2.1（`994d912`） |
| `hr1_protocol_audit`（確認） | 確認 v2.1 | gpt-6.1-sol/xhigh → 同 | read-only | `e1aa7da` | 2026-10-22T19:47–19:49 | exit 0；v2.1 可以進行；3 項配套文件 P1 已修（`5c1c90f`） |
| `hr1_world_author`（W1） | 寫語料：家族、事實、記憶、原文片段 | gpt-6.1-sol/xhigh | workspace-write，無網路 | `e1aa7da` | 2026-10-22T19:47– | 執行中 |
| `hr1_tooling`（W4a） | 語料工具、指標、統計、報告 | gpt-6.1-sol/xhigh | workspace-write，無網路 | `e1aa7da` | 2026-10-22T19:47– | 執行中 |
| `hr1_arms`（W4b） | 各組檢索方法、embedding、融合、計時 | gpt-6.1-sol/xhigh | workspace-write，只開放安裝套件與下載模型的網路 | `e1aa7da` | 2026-10-22T19:47– | 執行中 |
| `umv1_contract_audit` | 工程軌 P0 契約的非作者設計審查 | gpt-6.1-sol/xhigh → 同 | read-only | 整合分支 `81e0f21` | 19:51–19:58 | exit 0；7 項 P0 → v0.2（`91a7825`） |
| `umv1_contract_audit`（複查） | 檢查 v0.2 | gpt-6.1-sol/xhigh | read-only | `91a7825` | 19:59–20:02 | exit 0；3 項 P0 → v0.3（`2b2e3cf`） |
| `umv1_contract_audit`（確認） | 確認 v0.3 | gpt-6.1-sol/xhigh | read-only | `2b2e3cf` | 20:03– | 執行中 |
| `umv1_u2_impl`（U2a） | 方法包 core：schema v30 與升級程式、匯入、讀取、比較、刪除 | gpt-6.1-sol/xhigh | workspace-write，無網路 | 整合分支 `2b2e3cf` | 20:03– | 執行中 |

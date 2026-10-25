# Cairn 下一階段記憶研究：目標與工作章程

狀態：**進行中**。最後更新：2026-10-23。主控：Claude（統籌與驗收）。
這份文件是本研究的目標、邊界、決定與進度的**唯一來源**。每次有新決定或到達里程碑，
主控就更新本文件並 commit。每個 Codex 派工的第一步都是先讀本文件。
研究分支已推上 origin（`experiment/hybrid-retrieval-hr1`，使用者授權主控決定分支與 PR，2026-10-23）。

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
  - 原檔：使用者提供的本機檔案（私有，未納入 repo）
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
| 2026-10-23 | **Embedding 模型**（使用者確認用 OpenAI，選型交給主控）：產品預設 `text-embedding-3-small`。理由：它是 HR-1 事先登記的提名組合，測試集上 +16.9 分（CI 10.2–23.5），而且成本約為 3-large 的 1/6。`3-large` 可以用設定切換；HR-1 探索結果中它較佳，要用更大、新的題組再確認。本機模型（bge-m3 約需 2.2 GB RSS）不列入第一版預設 |
| 2026-10-23 | **分支與 PR**（使用者授權主控決定）：(1) 整合分支在 CI 等效驗收全綠後推上 origin，開 **draft PR**，base 疊在 #469 的 `feat/local-v1-closeout`，讓 PR 只顯示我們的變更；(2) U5a 分支另開 draft PR，疊在整合分支上；(3) 研究分支照 repo 慣例推為 `experiment/*`，不開 PR；(4) repo 是公開的，推之前先清掉文件裡的本機絕對路徑和私有草案位置，並掃描金鑰；(5) 不合併、不發布、不在別人的 PR 留言 |
| 2026-10-23 | **加速方案**（使用者批准方案一與方案二）：(1) 從 `389512d` 打 **v1 預覽版**：穩定介面是 context-read-v1 與方法包；素材標為實驗中。用 git tag 加 GitHub pre-release，不上 npm，說明裡寫明它含尚未合併的 #453–#469；(2) 開 4 條並行工作線：U4a 修正／補測、U4b、預覽版打包與文件、U5b；長時間的工作一律用 `setsid` 脫離 session 執行；(3) **U5b 線（含 HR-2）交給第二個協調 session**，交接說明見 `docs/plans/u5b-track-brief.md`。主控仍是整合分支唯一的合併者 |
| 2026-10-23 | **HR-2 偏離核可**（U5b 協調 session 提出）：凍結的 HR-1 語料每筆記憶本文最長只有 82 字、一個事實，所以 1,500／2,000／4,000 的預算都不會發生作用。核可 D1–D6：確認性預算改為 256／512／768（探索性 128–1,536）；用完整排名（≤24 筆）；不做 span 標註；P-prefix 與 P-window 記錄為退化、不跑；新增 P-top-s1、P-cover-s1、P-top+tail；主要比較與決策規則照提案。附三個條件：(1) 預先寫明結論只適用短、單一事實的項目，只用來決定 U5b 的**初始**預設；(2) U5b 契約不等 HR-2，先以「依名次放整筆」為暫定預設，組裝策略做成可替換的版本化 policy；(3) 可選做不阻塞的「長度壓力」探索組 |
| 2026-10-24 | **U5b 預設與後續**：依 HR-2 的結果，`read_memory_context` 預設採 `rank-first-whole-v1`，`coverage-first-v1` 留作可選 policy。主控對已安裝的 tgz 做實測時發現：HR-2 的預算是在**零表示開銷（O=0）**下量的，但實際 host 輸出每筆記憶的開銷約 300 tokens（JSON ref、metadata，以及和內文重複的來源摘錄）。一則 19 tokens 的記憶，在 256／384 的預算下都放不進去。→ 把**縮小表示開銷**列為 U5b 的後續優化（候選做法：直接寫入的記憶不重複放來源摘錄、縮短 ref／metadata），並用 O≠0 重跑 HR-2 的探索性預算曲線。P-top-s1 列為下一個候選 policy |
| 2026-10-24 | **HR-2 v1.1 收錄**（U5b session 的 packet B，`experiment/hr2-assembly` `8ed4dadb`）：用 representation-v2 公布的常數（envelope 43、第一筆 +58、之後每筆 +57）重跑探索性曲線。確認性結論不變，`rank-first-whole-v1` 仍是預設；`rank-first-first-source-v1` 繼續當非預設候選。要不要改預設，等長項目 fixture 的研究再說 |
| 2026-10-24 | **Codex 派工設定**（使用者）：實作用 `model_reasoning_effort="high"`＋`service_tier="fast"`；審查／稽核維持 xhigh＋fast。已在 rollout 確認 fast＝`priority` |
| 2026-10-24 | **U5c 產品決定**（使用者）：(1) agent 可**直接建立並生效**角色說明，不需使用者確認；保留不可覆寫版本、建立者紀錄、CAS 防並行覆寫、可撤回，角色名稱不給任何權限；(2) 任務快照是**回傳給呼叫端的收據**，由 agent／host 保存，Cairn 不存；(3) 必填欄位是**職責與應交付成果**，方法與相關記憶選填，必填項放不進預算時回 `budget_insufficient`。主控決定：角色說明存成 schema v32 的不可覆寫版本紀錄（類似方法版本），不放在 Memory／Card 本文，因為 Card 確認需要使用者授權，而 Memory 修正會原地覆寫，無法支援「當時」讀取。U5c 分三包：U5c-1 角色與任務讀取、U5c-2 一跳關聯與 MOC 通路、U5c-3 採用切換的失效傳遞。MOC 摘要新鮮度（A14）要等 E1 的接點，先回報 unavailable |
| 2026-10-24 | **HR-2b 協議 v1.1 核可**（主控）：凍結前修兩個結構性缺陷：guard 改成合併各類別的 pooled 對比（測試集每層 ≥30 組、≥12 族），每篇記憶的來源數上限改為 4（`core.admit` 單次最多 4 筆）。門檻與判定規則不變；要寫明修訂時看過哪些數字，各類別差值只做描述性報告 |
| 2026-10-24 | **HR-2b 結果：Keep**（`experiment/hr2-assembly` `8d9a51f5`）。長項目（本文 120–400 tokens、每篇 ≤4 筆來源）下，「只帶第一筆來源」反而比「依名次整筆」差：確認性結果 −11.5 分，CI [−23.8, −0.15]；後段來源的 guard −38.8 分。`rank-first-whole-v1` 維持 §15 預設，`rank-first-first-source-v1` 維持可選、非預設，不開 §15 修訂。主控抽查報告第 157 列，數字相符 |
| 2026-10-24 | **U5c 在 `.4` 標為實驗中**（主控）：角色說明、關聯／MOC、Card 依附三項的名稱與形狀在轉成穩定前都可能改；`.3` 的穩定介面不動。U5c-3 的 MCP 依附工具一律回 `approval_required`，核准只走終端機 `review-card --dependencies` |
| 2026-10-25 | **合進 main**（使用者：「現在就可以做」）：#469（本機 V1 Raw 鏈 #449–#469）以 merge commit 合進 main `9c0c2e9c`；#470（統一記憶 V1，含 U2–U5c）合進 main `b2513501`，tree 與驗收過的 `c53c84d9` 相同。CodeQL 兩則（#6 正規式、#7 測試用 shell）經主控檢查是誤報，以理由關閉；main 上 #469 帶進的 #14（雜湊的是環境變數名稱）也是誤報，未處理。#454（獨立 hook 修正）與 #457（內容已經由 #468 進 main）維持開啟，未動 |
| 2026-10-25 | **npm 發布方式**（使用者）：本機模式**接進同一個** `npx @cairn-ink/memory setup`，安裝時**問一次**「記憶存在這台電腦，還是 cairn.ink 雲端？」，非互動用 `--local`／`--cloud`；已連雲端的使用者不受影響。發布前需要使用者 `npm login`（目前 E401） |
| 2026-10-25 | **付費研究預算**（使用者）：**US$500** 以內，主控先估費用、自己記帳 |
| 2026-10-25 | **bge-m3**（使用者）：做成**可選**的本機搜尋模型，預設維持 OpenAI `text-embedding-3-small` |
| 2026-10-25 | **WAL 評估**：使用者交由主控判斷；先量測比較，確定有益且無副作用才換 |
| 2026-10-25 | **WAL 先擱置**（主控，依盤點 `wal_inventory`）：切換要改 11 個檔裡的 18 處 journal_mode 設定、審查用的 store fence、context sidecar、契約 §11.2／12.6／13／14／16 和十多個測試；換來的只是持續寫入時讀取要重試（§16），目前沒有實際使用者遇到。本機模式上線後如果出現 `storage_busy` 再依盤點的量測協議做（成對 DELETE／WAL、60 秒固定壓力、門檻事先凍結） |
| 2026-10-25 | **bge-m3 選配設計**（主控，依盤點 `bge_m3_inventory`）：Cairn 自己的**模型包**，用明確指令安裝，鎖定 `Xenova/bge-m3@4de13258…`，每個檔驗 sha256；推論在**子程序**；主套件不加推論相依。FP32（約 3 GB 安裝、2.2 GB RSS）；首發驗證 Linux x64（含 WSL2）與 macOS arm64，其他平台標「未驗證」。身分 `local:bge-m3:dense`＋manifest 雜湊，向量不混用；超過 8,192 tokens 拒絕、不截斷。契約 §20 起草中（`feat/local-embedder-bge-m3`） |
| 2026-10-25 | **HR-3 修訂方向**（主控）：協議 v0.1（設計 T 分類型 vs U 統一版本，預估 US$110）改成 v0.2，加入**現行產品組 P**（main `b2513501` 的公開介面，`read_memory_context`＋3-small），P 的 C／O／R／J 絕對分數當主要描述結果，回答「現在幾分」；T − U 仍是唯一確認性比較。盤點發現：`correct_memory` 會覆蓋內容並刪除舊來源，修正過的記憶答不出「以前是什麼」，只有 supersede 會保留舊版。開放問題由主控定：被修正的錯誤紀錄在歷史中標「錯誤」保留；過期且無新決定時，現況回 `no_active_decision`，最後已知決定只在歷史中出現 |
| 2026-10-25 | **更正 WAL 擱置：E1-C／E1-M 優先**（主控）。查產品交接 issue `wsxqaza12/cairn-wiki#453` 發現產品端 10/21–22 已實測：rollback journal 下 `readTopicOverview` 在同檔公開寫入時回 `storage_busy`（WAL 通過），並列 **E1-C（併發契約）與 E1-M（MOC 成員分頁）為重新開放記憶世界的阻擋項**；引擎 10/22 承諾「先 E1-C 再 E1-M」後未執行。主控先前說「沒有使用者遇到」是錯的。新順序：E1-C → E1-M 優先於 bge-m3 實作；HR-3 平行。E1-C 第一步只量測（DELETE 現行／DELETE＋有界等待／WAL），線索是 overview reader 的 `busy_timeout=0`（`core/topic-overview-worker.mjs:26`）；換 journal mode 需使用者另案核可 |
| 2026-10-25 | **E1-C 量測結果與 WAL 核可**（使用者核可，由產品端執行）。190 次 × 30 秒（schema 18／29，同 owner／不同 owner／Raw 寫入）：現行 DELETE＋`busy_timeout=0` 讀取 `storage_busy` **81–88%**；候選「期限內最多等 250 ms」平均 0.5–5.9%、最差 21.7%，且最差幾次把寫入吞吐量拖到 42–73%，未過事先固定的門檻，不採用；**WAL 全部 0%**、讀取 p95 2–5 ms、寫入不受影響。決定：產品正式資料庫改用 WAL（產品端照 #453 的切換步驟執行，comment 6389088145）；引擎不改任何預設。仍拒絕 WAL 的新功能（Card 終端機審查、context-read sidecar、方法包審查）等產品要在 WAL 上啟用時再做。結果文件 `feat/e1c-overview-contention` `ce94468d` |
| 2026-10-25 | **HR-3 第一次付費工程試跑**（`experiment/hr3-update-policy` `cf24810f`，實際花費 **US$0.84**，另診斷 US$0.0007）。付費前關卡：協議凍結後又補 E-1（過期觸發可作原因）、E-2（Card 寫入路徑照產品）、A-1（試跑先於校準、只做機械評分上下界）、A-2（輸出上限 768/1,024 → 2,176/4,352，經壓力題認證）；第一次送出被 OpenAI 以 schema 缺 `type` 拒絕（未計費），修正後重跑完成 480/480。結果：四組 J 都約 0%，原因不是記憶系統而是**評測工具的抽取驗證：240 次抽取 239 次整批作廢**（模型算錯引用字元位置，但 605/608 引用文字逐字存在），證據沒送到回答端。另發現提示詞殘留已撤回的舊 E-1 文字。修正 A-3（引用改由工具定位、以事件為單位驗證、提示詞對齊）實作中，之後重跑試跑。這次的分數**不能**當系統表現 |
| 2026-10-25 | **工程收尾**：E1-M（成員分頁）三輪雙審查 yes，PR #473；bge-m3 選配（§20）雙審查 yes，PR #472（GitHub 的 Node 24 是浮動版 24.21，測試假模型包原本寫死 24.15.0，已改成跟隨執行版本）。**待辦（發布模型資料時）**：正式模型清單的 Node 版本政策建議改成「主版本＋最低 N-API 6」，另外記錄實測過的小版本，否則新版 Node 使用者會被拒；需另改契約。HR-3 A-3 稽核又抓到**私有題組標籤（如 `pilot-scope_change-…`）出現在給回答模型的證據裡**，等於洩漏題目類型，正改為匿名代號並加自動掃描；第一次試跑的分數本來就不採用 |
| 2026-10-25 | **合進 main**：bge-m3 選配 PR #472 → `a55b128e`；RP4 測試時限修正 PR #474 → `5e8ca7b0`（GitHub 上 RP4 跑 24–26 秒卻只有 30 秒時限，改成和 RP2／RP3 一樣的 180 秒）；**E1-M 成員分頁 PR #473 → `7053397e`**，已通知產品端（#453 comment 6392381438）。產品的兩個阻擋項 E1-C（改用 WAL，使用者已核可、產品端執行）與 E1-M（已合併）都已處理 |

## 6. 研究問題與順序

| ID | 問題 | 狀態 |
| --- | --- | --- |
| HR-1 | 向量加中文字面融合，能否比強中文字面檢索找回更多必要證據，且精確詞不倒退？另附 A5 原文片段對照 | **已完成**（[結果](hybrid-retrieval-hr1-results.md)）：本機 bge-m3＋A3 +18.9（CI 11.6–26.6）、產品端 openai-3-small＋F-RRF10 +16.9（CI 10.2–23.5），兩者都判「繼續」，可列為預設開啟的候選；A5 未達門檻；現行 `selectEvidence` 在 S1000 只有 0.03 |
| HR-2 | 在固定 token 預算下，「分層表示＋先覆蓋再加深」能否比 top-k 全文放進更多必要證據？不需要模型 | **已完成**（協議 v1.1 `c863e9d6`；[結果](https://github.com/Cairn-ink/cairn-memory/blob/experiment/hr2-assembly/docs/plans/budgeted-assembly-hr2-results.md)，`experiment/hr2-assembly` `14ff5dc7`）：主要比較 P-cover − P-top（bge-m3＋A3、512 tokens、O=0）＝ **−2.5 分，CI [−6.6, +1.5]**，29 個題組 → **依名次放整筆仍是 U5b 的初始預設**。探索性結果：預算 128–384 時，先覆蓋落後 16–29 分；只加深第一筆來源（P-top-s1）從沒輸過，128 時 +3–4。只適用於短的單一事實項目。**v1.1 探索性補充**（`8ed4dadb`，§7）：在已出貨的 representation-v2 開銷下，反對先覆蓋的證據更強，而且延伸到 192–1,536 tokens 全段（先覆蓋 − 依名次：192–512 落後 4–15 分，768–1,536 落後 12–27 分，768 以上每個 CI 都不含零）；只加深第一筆來源從沒變差（+0.3 到 +2.3，bge-m3＠256 為 +1.7 [+0.3, +3.4]）。預算低於完整 24 筆的成本（約 1,800 tokens）時一定會卡住；1,500 tokens 約放得下 15–20 則短記憶各帶一筆來源。下一步研究仍是長項目 fixture |
| HR-2b | 長項目（本文 120–400 tokens、2–4 個事實、≤4 筆來源）下，「只帶第一筆來源」是否該改成預設？ | **已完成，Keep**（協議 v1.1 `d3a6e24f`；結果 `8d9a51f5`，`experiment/hr2-assembly`）：主要比較 P-top-s1 − P-top（bge-m3＋A3、host-v2、1,500 tokens）＝ **−11.5 分，CI [−23.8, −0.15]**，28 個題組；後段來源 guard −38.8 分。16 格探索性結果全落後（−5 到 −25），預算越大差距越大，和 HR-2 短項目相反。限制：140 題中 137 題有本文以外的必要群組；每篇 ≤4 筆來源；host-v2 是加法近似 |
| HR-3 | 分類型更新政策能否提高「目前決定、舊決定、改變原因」的正確率？另量**現行產品（P 組）的端到端絕對分數** | **協議 v0.3.4 已凍結**（[協議](hr3-update-policy-protocol.md)，六輪非作者稽核）。預算上限 US$500（預估約 US$130，試跑上限 US$24、60 題組）。下一步：可執行的產生器、有型別的評分器、雙語挑戰集與模型評審校準（都不花 API 費用），通過後才跑付費試跑 |
| 之後 | 一跳 typed 關聯、MOC 通路的名次定義、LLM 或 cross-encoder rerank | 未排 |

### HR-2 計畫草案（2026-10-23，待使用者對齊後才做原型）

- **問題**：同一份候選清單、同一個 token 預算（1,500／2,000／4,000），把哪種組裝方式放進
  context，能裝進最多必要證據？
- **不用模型、不花錢**：沿用 HR-1 凍結的語料與測試集排名（A1、bge-m3＋A3、
  3-small＋F-RRF10），每題取前 30 名候選。
- **比較的組裝方式**：
  - P-top：依名次放全文，放到預算用完為止。
  - P-prefix：現行 `packRank` 的做法，每筆先放 120 字，再一起加寬。
  - P-cover：每筆先放短版，再依名次加深到全文。
  - P-window：每筆先放查詢詞附近的視窗，再加深。
- **要補的標註**：記憶本文裡，每個必要事實所在的確切字元區間。由一位 Codex 標註，另一位
  抽查，再機械驗證確實是子字串。原文片段已經有區間。
- **指標**：
  - 必要證據完整落在 context 裡的群組比例（巨集平均）；
  - token 使用率；
  - 依預算分開報告。
  - 小樣本只看方向。
- **限制**：短版是確定性截取，不是模型摘要，所以結果是分層表示的下限。

## 7. 工程軌（草案 M1–M8）

**進度（2026-10-23 上午）**：
- **P0 契約**經兩輪非作者審查後為 v0.3（`2b2e3cf`）。
- **U2 已完成**：U2a 在 `d8eaba8`、U2b 在 `a8323cb`，都經過主控驗收與雙審查（皆判 Yes）。
- **U3 已實作**。主控在沙箱外驗收時抓到三個問題：
  - 打包閉包回歸；
  - 打錯核准口令，仍會先建立或升級資料庫；
  - 讀寫鎖競爭。

  契約因此升為 v0.4.2（`26ad5ef`）。修正輪進行中，修完提交後再派雙審查。
- **U4**（素材、衍生文字、方法包二進位附件，schema v31）已完成盤點，契約草稿 §12 v0.5（`d148a34`）審查中。
- **U5a**（候選檢索接口）已完成盤點，契約草稿撰寫中。內容：中文 BM25、選配的向量通路、RRF 融合、分種類回報降級。是選配接口，不改 V1 現有行為。
- 另開後續包 **U2c**：讀取時不在寫入鎖裡驗證整個版本。

分包順序：U2 → U3 → U4 與 U5a（實作先後待定，主控建議 U5a 先）→ U5b 組裝（等 HR-2）→ U5c 角色與關聯。

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

## 8. 進度與下一步（2026-10-24 更新）

- **已完成並併入整合分支**（`integration/unified-memory-v1` `b096e043`，已推；draft PR #470）：
  - U2／U3／U2c 方法包；
  - U4a 素材 core（含 U4a-1 修正與 U4a-2 驗收補強）、U4b 素材 CLI／MCP；
  - U5a 檢索（候選與證據）；
  - U5b 組裝（`read_memory_context`）與 U5b-2 packet A（representation-v2、精簡 ref 帶 fence 前綴）；
  - 契約 §16（rollback-journal 的並行門檻）；
  - **U5c 全部**：U5c-1 角色說明與任務收據（§18，schema v32）、U5c-2 關聯一跳＋MOC（§17）、U5c-3 Card 依附目前採用版本（§19，schema v33）。

  每一包都經雙審查判 Yes。
- **已發布**（都是 GitHub pre-release，附 tgz 與 sha256，不上 npm）：`v1-preview.0`（`80daca28`）、`v1-preview.1`（`924d7658`，素材）、`v1-preview.2`（`4e53d1dc`，`read_memory_context` 實驗性）、**`v1-preview.3`**（`7197d800`，`read_memory_context` v2 列為穩定；每筆開銷約 250 → 82 tokens）、**`v1-preview.4`**（`70db0fa4`，U5c 三項皆實驗中）。
- **研究**：HR-1、HR-2（v1.0、v1.1）、HR-2b（Keep，`8d9a51f5`）都已完成，見 §6。組裝預設維持 `rank-first-whole-v1`。
- **下一步候選**：
  1. WAL 模式評估（§16，全庫決策）。
  2. HR-3（分類型更新政策），需付費，要另外批預算。
  3. 後續：R10 測試改用 rendezvous 點去掉時間依賴；MOC 新鮮度的 E1 seam（A14）；MOC 在預設上限下約 1 萬筆記憶開始降級，要不要放寬上限或改索引。
- **使用者已決定（10/25）**：已合進 main；npm 走「同一個 setup、安裝時問一次」；付費上限 US$500；bge-m3 做成選配。
- **等使用者**：發布 npm 前執行 `npm login`。

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
| `hr1_world_author`（W1） | 寫語料：家族、事實、記憶、原文片段 | gpt-6.1-sol/xhigh → 同 | workspace-write，無網路 | `e1aa7da` | 19:47–20:30 | exit 0；40 個目標家族、1,095 個事實；S300＝300、額外 700、外部 100；40% 只寫在原文片段 |
| 主控抽查 W1 | 洩漏與品質 | — | — | — | 20:3x | 事實陳述與記憶本文：沒有照抄，用詞重疊度中位數 0.36。事實清單：目標 namespace 零洩漏；80 段外部範本與陳述相同（只影響不計分的 FOREIGN 控制）。**S300 有 20 組本文完全相同 → A0 無法建資料**，交回 W1 修正 |
| `hr1_world_author`（修正 1） | 讓重複本文措辭自然不同 | gpt-6.1-sol/xhigh | workspace-write | — | 20:3x | 完成：20 組相同本文已改寫，A0 可建資料 |
| `hr1_query_author`（W2） | 只看事實清單寫查詢（隔離在 `/home/chichieh/cairn-hr1-w2`） | gpt-6.1-sol/xhigh | workspace-write，無網路 | 事實清單 | 20:31– | 完成，見下方結果列 |
| `hr1_arms`／`hr1_tooling`（修正 1） | 修正雙審查指出的問題 | gpt-6.1-sol/xhigh | workspace-write | `a424c23` | 20:24– | 完成，見下方結果列 |
| `hr1_query_author`（W2） | 結果 | gpt-6.1-sol/xhigh → 同（cwd＝隔離資料夾） | — | 事實清單 | 20:31–20:42 | exit 0；160 題；每類 20 個家族；只寫在原文片段的證據占 39.8%。主控稽核 38 個指令，沒有碰過資料夾外的任何東西 |
| 主控（標註） | 分組、標註、驗證器 | — | — | `f029055` | 20:5x | 分組符合配額與家族下限（開發集 32.1%）。驗證器：15 個缺席事實被誤判 → W4a 修正 2；C6 有 9 題問的是沒改過的決策 → 協議 v2.2 澄清，交 W2 修正 1 |
| `hr1_tooling`（W4a 修正 1）／`hr1_arms`（W4b 修正 1） | 雙審查的修正 | gpt-6.1-sol/xhigh → 同 | workspace-write | `a424c23` | 20:24–20:48 | exit 0；主控在沙箱外驗收：兩個 Node 版本各 124 項、123 通過、0 失敗、1 略過；commit `f029055`；兩位審查者複查中 |
| `umv1_u2_impl`（U2a） | 結果 | gpt-6.1-sol/xhigh → 同 | workspace-write | `2b2e3cf` | 20:03–20:50 | exit 0；30 個檔案；新寫的 46 項測試全過；完整測試在沙箱內因子程序管線被擋而失敗。另需補 v0.3.1 的完整 v30 schema → 修正 1 執行中 |
| 主控（U2a 的比較基準） | 在未修改的 b8fa224 上跑 `npm run test:core` | — | 沙箱外 | `b8fa224` | 20:5x–21:0x | Node 22.16：1,848 項全過，exit 0。Node 24.15：exit 1，失敗 1、取消 1，都是 `E4/E5 lock beyond budget` 時序測試，當時機器同時跑 bge-m3 暖機和多個 Codex。負載低時單獨重跑 9 項全過，exit 0 → **負載造成的偶發失敗，原本的程式就會發生** |
| `hr1_label_audit`（W3） | 獨立標註稽核 | gpt-6.1-sol/xhigh → 同 | workspace-write | `e93c6fe` | 20:54–21:13 | exit 0；11 項修正（補 9、刪 2），沒有刪題也沒有改分類；主控套用後，驗證器在兩個 Node 版本都 ok |
| 主控（凍結） | 凍結語料 | — | — | `46b9691` | 21:1x | `FROZEN.md` 記錄 7 個檔案的 SHA-256 |
| 主控（開發集選擇） | 開發集 S1000 | — | — | `1a200af` | 21:1x | L*＝A1（0.845，A1+ 為 0.798）；本機提名 bge-m3＋A3（0.954）；產品端提名 openai-3-small＋F-RRF10（0.973）；沒有飽和；API 花費 US$0.0035 |
| 主控（測試集排名） | 從固定在 `1a200af` 的獨立 worktree 跑 | — | — | `1a200af` | 21:21–21:2x | 本機、OpenAI、A5、字面基準在兩種規模都 exit 0。**A0 失敗**（`a0_core_error`）：原始錯誤是 `supersession_limit`，因為 W4b 的建資料程式讓 20 筆歷史記憶都由同一筆記憶取代，超過 core 上限 5 → 交 W4b 修正 3。尚未計分 |
| `hr1_arms`（修正 2） | 產生「拿掉外部 namespace」的配對排名參數 | gpt-6.1-sol/xhigh | workspace-write | `1a200af` | 21:2x– | 完成，見下方結果列 |
| 主控（U2a 驗收） | 沙箱外的完整測試矩陣 | — | — | `b9eb2a6` | 21:3x–22:00 | Node 22.16 全部 exit 0（core 1,904／1,904、整體 635／635）；Node 24.15 全部 exit 0，打包測試是第 3 次才 exit 0（前兩次的失敗證實是負載：R29 單獨跑時與 b8fa224 一樣 6.9 秒）→ commit `b9eb2a6` |
| `u2a_review_spec`／`u2a_review_standards` | U2a 的非作者雙審查 | gpt-6.1-sol/xhigh → 同 | read-only | `b9eb2a6` | 22:0x–22:1x | 兩邊都判 No：淺層 CI 拿不到歷史 commit（P1）；schema 驗證只看觸發器名稱（P2）；缺少真正同時搶寫的程序測試（P2）→ U2a 修正 2 執行中 |
| `umv1_u2_impl`（U2a 修正 2） | 淺層 CI、schema 驗證、多程序搶寫測試 | gpt-6.1-sol/xhigh → 同 | workspace-write | `b9eb2a6` | 22:1x–22:34 | exit 0；13 個檔案 |
| 主控（U2a 修正驗收） | 機器空閒時重跑完整矩陣 | — | — | `d8eaba8` | 22:3x–23:0x | 兩個 Node 版本每一項都 exit 0：core 1,934／1,934、整體 635／635、打包 153 通過 1 略過、local、mcp、示範程式、驗證、歷史資料檔驗證 |
| `u2a_review_spec`／`u2a_review_standards`（複查） | U2a 修正 | gpt-6.1-sol/xhigh → 同 | read-only | `d8eaba8` | 23:0x | **兩邊都判 Yes**，沒有新問題 → **U2a 完成** |
| `umv1_u2_impl`（U2b） | 綁定、解析、pin、綁定事件 | gpt-6.1-sol/xhigh → 同 | workspace-write | `d8eaba8` | 23:01–23:45 | exit 0；24 個檔案，沒有改 schema；主控驗收兩個 Node 版本全部 exit 0（core 1,959／1,959、整體 635、打包 153 通過 1 略過）→ commit `811b251` |
| `u2b_review_spec`／`u2b_review_standards` | U2b 雙審查 | gpt-6.1-sol/xhigh → 同 | read-only | `811b251` | 00:1x | Standards：**Yes**（零問題）；Spec：No，只有 1 項 P2（`resolveMethodsForRole` 漏列只綁給其他角色的方法包）→ 修正 1 執行中。改過的 5 個既有測試，兩位都確認合理 |
| `umv1_u2_impl`（U2b 修正 1）＋Spec 複查 | 列出所有有綁定的方法包 | gpt-6.1-sol/xhigh → 同 | — | `811b251` | 00:1x–00:4x | 2 個檔案；主控驗收兩個 Node 版本 core 1,961／1,961、示範程式 exit 0 → commit `a8323cb`；Spec 複查判 **Yes** → **U2 方法包 core 完成** |
| 主控（U3 契約） | 方法包的 host 端：匯入器、TTY 核准、MCP 唯讀工具 | — | — | 整合分支 `fc5b9ea` | 00:5x | 先量測本機 21 個真實 skill 套件（只看大小）：1–122 個檔案、最大 1.85 MB、單檔最大 321 KB、5 個含二進位檔 → 提高文字上限 |
| `umv1_contract_audit`（U3） | U3 契約的非作者審查 | gpt-6.1-sol/xhigh → 同 | read-only | `fc5b9ea` | 01:0x | 4 項 P0（隔離擋不住上層目錄被換、常數寫死在多處、要用方法包專屬授權、MCP 範圍與參數格式）→ 契約 v0.4（`69e22b3`），用 `/proc/self/fd` 逐層開啟取代 openat2；審查者確認中 |
| `umv1_contract_audit`（U3 確認） | v0.4 與 /proc 隔離做法 | gpt-6.1-sol/xhigh → 同 | read-only | `69e22b3` | 01:1x | 方向正確，但要補 `O_PATH` 先檢查再讀、明確拒絕 `..`、說明隔離跟的是釘住的 handle → 契約 v0.4.1（`1265b4b`）；審查者表示修完即可實作 |
| `umv1_u2_impl`（U3） | 方法包 host 端實作 | gpt-6.1-sol/xhigh → 同 | workspace-write | `1265b4b` | 00:57–02:09 | exit 0；27 個檔案；worker 自報沙箱內的打包失敗屬於沙箱限制（主控驗收證實其中有真回歸，見下方） |
| `hr1_arms`（修正 2／3）＋`hr1_tooling`（修正 3） | 隔離參數；A0 建資料的 bug；A0 容量預檢 | gpt-6.1-sol/xhigh → 同 | workspace-write | `1a200af` | 21:2x–21:39 | 主控驗收：兩個 Node 版本各 136 項、135 通過、0 失敗、1 略過 → commit `4fcec31`；Spec 判定：隔離參數符合，另提 A0 容量前提應加入預檢（P1）→ W4a 修正 3 |
| 主控（HR-1 最終執行） | 從固定在 `4fcec31` 的 worktree 跑測試集兩種版本（有／沒有外部 namespace）、延遲與計分 | — | — | `4fcec31` | 22:0x–22:2x | 16 個批次全部 exit 0；66 個非 A0 排名檔和 `1a200af` 逐筆相同；**兩個情境都判「繼續」**；A5 未達門檻；API 累計 US$0.0050 → commit `34f6ea9` |
| `hr1_review_spec`（最終） | 確認 `51dbdf6` 與程序揭露 | gpt-6.1-sol/xhigh → 同 | read-only | `51dbdf6` | 22:2x | 框架判 **Yes**；接受證據保留的推理，但不接受「程序完全合規」的說法 → 結果報告已加註爭議與限縮的說法（`9ce7328`） |
| `hr1_tooling`（W4a） | 語料工具、指標、統計、報告 | gpt-6.1-sol/xhigh → 同 | workspace-write，無網路 | `e1aa7da` | 19:47–20:14 | exit 0；16 個檔案 |
| `hr1_arms`（W4b） | 各組檢索方法、embedding、融合、計時 | gpt-6.1-sol/xhigh → 同 | workspace-write，只開放安裝套件與下載模型的網路 | `e1aa7da` | 19:47–20:12 | exit 0；21 個檔案；transformers.js 3.7.6；e5-small `761b726`、bge-m3 `4de1325`（fp32） |
| 主控驗收 | W4a＋W4b 的測試框架 | — | — | `a424c23` | 20:15 | 兩種方式核對檔案清單，都是 37 個；Node 22.16／24.15 各 84 項測試、83 通過、0 失敗、1 項需手動開啟的測試略過，exit 皆 0；真實模型冒煙測試 exit 0 |
| `hr1_review_spec`／`hr1_review_standards` | 測試框架的非作者雙審查 | gpt-6.1-sol/xhigh → 同 | read-only | `a424c23` → `f029055` | 20:15–20:22；複查 20:5x | 第一輪兩邊都判「No」（Spec 3 P0＋3 P1；Standards 3 P1＋3 P2）。修正後複查：**兩邊都判 Yes**，12 項全部解決，沒有新問題 |
| `umv1_contract_audit` | 工程軌 P0 契約的非作者設計審查 | gpt-6.1-sol/xhigh → 同 | read-only | 整合分支 `81e0f21` | 19:51–19:58 | exit 0；7 項 P0 → v0.2（`91a7825`） |
| `umv1_contract_audit`（複查） | 檢查 v0.2 | gpt-6.1-sol/xhigh | read-only | `91a7825` | 19:59–20:02 | exit 0；3 項 P0 → v0.3（`2b2e3cf`） |
| `umv1_contract_audit`（確認） | 確認 v0.3 | gpt-6.1-sol/xhigh | read-only | `2b2e3cf` | 20:03– | 完成：兩項澄清 → v0.3.1 |
| `umv1_u2_impl`（U2a） | 方法包 core：schema v30 與升級程式、匯入、讀取、比較、刪除 | gpt-6.1-sol/xhigh | workspace-write，無網路 | 整合分支 `2b2e3cf` | 20:03– | 完成，見上方結果列 |
| 主控（U3 驗收） | 沙箱外完整矩陣＋真 PTY 手動試用 | — | 沙箱外 | `1265b4b`＋U3 工作目錄 | 02:10–02:40 | 兩個 Node 版本：core 1,964／1,964、local 37、mcp 178（含新的 PTY、競態、bind mount 測試）、整體 635、示範、驗證、歷史資料檔都 exit 0。**打包測試 exit 1**：6 項已安裝生命週期測試失敗，原因是新模組在閉包內卻沒被載入，屬於真回歸。**Node 24 量測 exit 1**：讀取者遇到 `storage_busy`；Node 22 的寫入者 14 次中 10 次逾時。手動試用：打錯口令仍會留下新建的 v30 資料庫 → 契約 v0.4.2（`26ad5ef`） |
| `umv1_u2_impl`（U3 修正 1） | 打包閉包、核准前不動資料庫、量測把 busy 當資料 | gpt-6.1-sol/xhigh → 同 | workspace-write | `26ad5ef` | 02:42–03:06 | exit 0；8 個檔案（主控用兩種方式核對一致）。主控驗收兩個 Node 版本：打包、整體、local、workspace-lifecycle、示範、驗證、量測都 exit 0；**mcp 177／178**：另一個 session 的測試要求 CLI 在檢查執行環境前不載入 SQLite，靜態 import 違反了這條 → 修正 2 |
| `u4_inventory` | U4 素材的設計盤點 | gpt-6.1-sol/xhigh → 同 | read-only | `1265b4b`＋U3 工作目錄 | 02:14–02:21 | exit 0：建議 SQLite 分塊 BLOB，列出六項待決設計 |
| `u5_inventory` | U5a 檢索接口的設計盤點 | gpt-6.1-sol/xhigh → 同 | read-only | 同上 | 02:24–02:37 | exit 0：建議附屬索引檔、BM25-T1、非同步 embedder、授權先於排名 |
| `u4_contract_author` | 依主控決定起草 §12 | gpt-6.1-sol/xhigh → 同 | read-only | 同上 | 02:25–02:38 | exit 0；主控改 3 處後併入契約（`d148a34`，v0.5 草稿） |
| `u5_contract_author` | 依主控決定起草 §13 | gpt-6.1-sol/xhigh → 同 | read-only | 同上 | 02:38–02:50 | exit 0：提出異議，指出 T1 會漏掉嵌在詞中的單一漢字 → 主控決定凍結 T1，列為明確的已知漏抓，另開 HR-1b 研究；主控也調高向量掃描上限並補維護政策 → 契約 §13 v0.6（`2669a3c`） |
| `umv1_contract_audit`（U4） | §12 的非作者審查 | gpt-6.1-sol/xhigh → 同 | read-only | `d148a34` | 02:44–02:55 | 第一次因模型滿載失敗，接續原對話重試後 exit 0。**判 No**：7 項 P0、4 項 P1、1 項 P2，主控全部接受。重點有四：<br>• 擁有權與配額釋放要有唯一寫入者；<br>• 讀取不可重蹈整版驗證與寫入鎖 → **U2c 要排在 U4a 之前**；<br>• 核准前的「存在檢查」不足以當圍欄 → U3 契約加上 store 圍欄 v0.4.3（`bf61a02`）；<br>• 匯出時暫存檔的名稱會被調包、發布後的失敗處理。<br>已交原作者修訂 |
| 主控（U2c 契約） | 方法包讀取不拿寫入鎖 | — | — | `63678be` | 02:5x | 契約 §14 v0.7：讀取改用延遲的只讀交易，以 `query_only` 防寫；`readMethodFile` 只驗清單身分和被讀的檔案，其他讀取保留整版驗證，既有測試不改；量測門檻是寫入者 p95 ≤250 ms、零逾時 |
| `u5_contract_audit` | §13 的非作者審查（全新審查者） | gpt-6.1-sol/xhigh → 同 | read-only | `2669a3c` | 02:51–03:01 | **判 No**：沒有 P0，4 項 P1、3 項 P2，主控全部接受。內容包括：<br>• 未完成的索引不可搜尋；<br>• 要有真正唯讀的建構器；<br>• 游標要綁定語意設定；<br>• `semantic` 預設關閉、旗標要寫明；<br>• 向量轉成 float32 後再驗；<br>• 覆蓋不足時不付錢嵌入查詢。<br>主控另外決定做增量對齊（比對 id 與 revision）。已交原作者修訂 |
| `u4_contract_author`（修訂 1） | 依審查意見修訂 §12 | gpt-6.1-sol/xhigh → 同 | read-only | `bf61a02` | 02:58–03:08 | exit 0 → §12 v0.5.1（`837c6a6`）；主控獨立重算兩個已知答案向量，結果相符 |
| `u5_contract_author`（修訂 1） | 依審查意見修訂 §13 | gpt-6.1-sol/xhigh → 同 | read-only | `63678be` | 03:03–03:12 | exit 0 → §13 v0.6.1（`3e73a18`）；主控裁定掃描方式：用索引查中繼資料，不新增正式索引 |
| `umv1_contract_audit`（U4 複查＋U2c） | §12 v0.5.1、§14、store 圍欄 | gpt-6.1-sol/xhigh → 同 | read-only | `837c6a6` | 03:1x–03:18 | 3 項新 P0：分塊要驗總長度、C05 要保留 U2 的 `cursor_stale`、唯讀 SQLite 仍可能產生 WAL/SHM 檔。主控照替換文字套用 → `23514ec` |
| `u5_contract_audit`（複查） | §13 v0.6.1 | gpt-6.1-sol/xhigh → 同 | read-only | `3e73a18` | 03:1x–03:2x | 沒有 P0；2 項 P1、3 項 P2（快取隔離、可寫入時的日誌復原、檢查點的原子性等）。主控照替換文字套用 → `3d061b0` |
| 兩位審查者（確認） | 最終確認 | gpt-6.1-sol/xhigh → 同 | read-only | `3d061b0` | 03:2x | **§12 U4（排在 U2c 之後）、§13 U5a、§14 U2c 都判可以實作**。§11.2 的圍欄再補兩點：「不建立」是強制的、審查期間要維持 rollback 模式 → v0.4.5（`517a71d`） |
| `umv1_u2_impl`（U3 修正 2） | SQLite 不可在環境檢查前載入（不改對方測試）、store 圍欄 v0.4.5、量測有限期限 | gpt-6.1-sol/xhigh → 同 | workspace-write | `517a71d` | 03:24–04:06 | exit 0。這輪改 14 個檔，累計 34 個；core 新增 `storeFence` 選項，預設行為不變。`mode=rw` 探測：已消失的資料庫不會被重新建立。主控正在沙箱外跑完整矩陣 |
| `umv1_u5a_impl`（U5a 第一部分） | 只新增模組：T1 移植、BM25、RRF、embedder 驗證、附屬索引與增量對齊，加上測試與量測 | gpt-6.1-sol/xhigh → 同 | workspace-write | 新 worktree `/home/chichieh/cairn-memory-u5a`，分支 `integration/unified-memory-v1-u5a`，基準 `517a71d` | 03:24–04:07 | exit 0；新增 15 個檔，沒改既有檔案，新測試在兩個 Node 版本都 exit 0。量測（10⁴ 筆）：建索引 6.3 秒、中繼資料掃描約 60 ms，**但改一筆後的增量更新要 2.2 秒**，超過 `findCandidates` 1 秒的預設期限 → 等 U3 驗收結束後交回 worker 拆解並優化。主控尚未在沙箱外驗收 |
| 主控（U3 修正 2 驗收） | 沙箱外的完整矩陣 | — | 沙箱外 | U3 工作目錄 | 04:0x–04:3x | 兩個 Node 版本：core 1,977、local 37、mcp 180、整體 635、workspace-lifecycle 31 全過，示範、驗證、歷史資料檔驗證、量測都 exit 0。打包測試在 Node 24 exit 0（182 通過、1 略過）；Node 22 有 1 項 R29 在負載 7.7 時逾時，單獨重跑 3／3 通過（與 b8fa224 基準相同） → **提交 U3 為 `7124a8d`**，兩種方式核對都是 34 個檔案 |
| `u3_review_spec`／`u3_review_standards` | U3 的非作者雙審查 | gpt-6.1-sol/xhigh → 同 | read-only | `7124a8d` | 04:40–04:49 | 第一次啟動後隨即停止：U2c 正在改同一個 worktree，審查者會讀到未提交的內容。改在固定於 `7124a8d` 的乾淨 worktree 重跑。**Spec 判 Yes**，有 1 項 P2：bind mount 測試在子程序失敗時會被略過。**Standards 判 No**，有 1 項 P2：排除用的 glob 會嚴重回溯，實測超過 2 秒；另有新檔尾端多一個空行。主控驗收的 `git diff --check` 沒有檢查尚未追蹤的新檔，這是流程盲點 → 修正 3，排在 U2c 之後 |
| `umv1_u2_impl`（U2c） | 讀取不拿寫入鎖（§14） | gpt-6.1-sol/xhigh → 同 | workspace-write | `7124a8d` | 04:39–05:2x | exit 0；12 個檔案，沒有改既有測試。沙箱內 C04 量測：寫入者 p95 從 3.4 秒降到 27 ms，零 busy；讀取每頁從約 46 ms 降到約 6.5 ms；完整讀一遍從約 62 秒降到約 9.6 秒。主控正在沙箱外跑完整矩陣 |
| `umv1_u5a_impl`（U5a 第一部分，效能） | 改一筆後的增量更新：拆解耗時，降到隨變動量成長（目標 10⁴ p95 ≤250 ms） | gpt-6.1-sol/xhigh → 同 | workspace-write | U5a worktree | 04:39–05:2x | exit 0；**目標全部達成**：p95 在 1 千筆時 25 ms、1 萬筆時 62–76 ms。舊做法連沒變的文件也寫，每次要 162 個交易、648 次同步；現在是 1 個交易、4 次同步。待處理：(1) 沙箱內並行跑時復原測試曾失敗一次，主控要在沙箱外重複跑來確認；(2) 新增的 C 原始檔量測工具不該進產品樹 |
| 主控（U2c 驗收） | 沙箱外的完整矩陣 | — | 沙箱外 | U2c 工作目錄 | 05:3x–06:1x | 兩個 Node 版本**全部 exit 0**：core 2,010、local 37、mcp 180、整體 635、打包 182＋1 略過、workspace-lifecycle 45，另有示範、驗證、歷史資料檔驗證；空白檢查連 4 個新檔都 exit 0。C04 門檻通過：零 busy，寫入者 p95 19.4／15.1 ms，讀取每頁 p95 約 7.5 ms。觀察：重疊期間讀取者只讀了 2 頁，有一頁等了 1.34 秒 → 加強門檻，併入 U3 修正 3 → **提交 U2c 為 `5b1202d`**（12 個檔案，兩種方式核對一致） |
| `umv1_u2_impl`（U3 修正 3） | glob 改用不會回溯的比對、bind mount 測試不再藏住失敗、修掉尾端空行、拆開 H03、讓寫入分散在讀取全程以加強 C04 的重疊 | gpt-6.1-sol/xhigh → 同 | workspace-write | `5b1202d` | 05:51–06:17 | exit 0，10 個檔案。主控在沙箱外驗收：兩個 Node 版本全部 exit 0（core 2,010、mcp 182、打包 184＋1 略過、workspace-lifecycle 49），負載到 11 也沒有偶發失敗。C04：寫入 103–104 次、零 busy、寫入者 p95 24–29 ms；約 1,250 頁讀取幾乎全程與寫入重疊，每頁 p95 約 26 ms → **提交為 `e9d7c58`**；兩位審查者在乾淨的 worktree 複查中 |
| 主控（U5a 第一部分驗收） | 沙箱外重複跑新測試 | — | 沙箱外 | U5a worktree | 06:1x | 兩個 Node 版本各跑 3 次，每次 40／40、exit 0（負載 3–4）；空白檢查連 16 個新檔都 exit 0。worker 在沙箱內看到的那次失敗沒有重現。主控把 U5a 分支快轉到 `5b1202d`：worker 的沙箱無法寫入 git 資料 |
| `umv1_u5a_impl`（U5a 第二部分） | core 接線：改用 U2c 的讀取輔助函式、facade、`openContextReader`、`findCandidates`（自動做有界的字面維護）、`refreshContextIndex`、`fetchCandidateEvidence`、游標與診斷，以及 core 層級的 R02–R12；同時刪掉那個 C 檔 | gpt-6.1-sol/xhigh → 同 | workspace-write | U5a worktree，`5b1202d`＋第一部分 | 05:53–07:25 | exit 0；共 27 個檔案（改 5 個既有 core 檔、新增 22 個）。改一筆後的增量更新 p95：1 千筆 21–35 ms、1 萬筆 74–82 ms。主控發現它用 `createRequire` 延遲載入，會繞過另一個 session 的安裝閉包檢查 → 修正 1 改成靜態 import（完成） |
| 主控（U5a 第二部分驗收） | U5a worktree 沙箱外的完整矩陣 | — | 沙箱外 | U5a worktree | 07:3x–08:1x | 第一次跑時 local、mcp、打包、workspace-lifecycle 大量失敗：新 worktree 少裝了 `adapters/openai` 的依賴（`tiktoken`），屬於環境問題 → 補裝後重跑中。core 在 Node 22 是 2,076／2,076；Node 24 有 1 項 U2b 競態測試出現 `database is locked`，根因是 `core/testing/method-package-fixtures.mjs:54` 的測試連線沒有設 busy timeout，U2c 改成延遲讀交易後才暴露出來 → 排給 U2/U3 worker 修 |
| `u3_review_spec`／`u3_review_standards`（複查） | 複查修正 3（`e9d7c58`） | gpt-6.1-sol/xhigh → 同 | read-only | `e9d7c58` | 06:3x–06:5x | Spec 第一次因模型滿載失敗，重試成功。兩邊都判 **No**，但都只剩 P2：(1) bind mount 工具會把「寫標記檔失敗（78）」轉成「略過（77）」，兩位審查者各自發現；(2) `**`、`*`、`?` 不匹配換行，這是從舊正規表示式繼承的毛病，新比對器為了跟舊行為一致而保留了它。原本的問題都已解決 → 修正 4 |
| `umv1_u2_impl`（U3 修正 4） | 保留狀態碼 78；glob 依 POSIX 把換行當一般字元 | gpt-6.1-sol/xhigh → 同 | workspace-write | `e9d7c58` | 06:53–07:04 | exit 0，5 個檔案。主控驗收兩個 Node 版本全部 exit 0（負載一度到 44）→ 提交為 `e63b24c` |
| `u3_review_spec`／`u3_review_standards`（最終確認） | `e63b24c` | gpt-6.1-sol/xhigh → 同 | read-only | `e63b24c` | 07:1x–07:20 | **兩邊都判 Yes**，沒有剩下任何問題 → **U3 完成** |
| `umv1_u2_impl`（U4a 第一部分） | 完整 v31 schema（11 張表與觸發器）、遷移與開啟器、正規編碼與已知答案向量、獨立素材的匯入／讀取／刪除、分塊 MAC、配額、K01–K07、K09、K12、K13 門檻 | gpt-6.1-sol/xhigh → 同 | workspace-write | `e63b24c` | 07:21–09:08 | exit 0，38 個檔案。沙箱內的 K13：匯入 32 MiB 的寫入交易 122–593 ms（門檻 2,000）、RSS 增長約 40 MiB（門檻 128）、寫入者 p95 22–63 ms、零 busy。注意：Node 24 校準時讀取者出現過一次 busy，worker 隨後放慢了寫入節奏 → 主控要在沙箱外確認 |
| `umv1_u2_impl`（競態測試修正） | 測試連線加上 busy timeout，修掉 U2c 暴露出來的偶發失敗 | gpt-6.1-sol/xhigh → 同 | workspace-write | U4a-1 工作目錄 | 09:1x–09:2x | exit 0；競態測試在兩個 Node 版本各連跑 10 次都通過 → 提交為 `2d20a52` |
| 主控（U4a-1 驗收） | 沙箱外的完整矩陣，含 `measure:assets` | — | 沙箱外 | 整合分支工作目錄 | 09:2x–10:0x | 兩個 Node 版本**全部 exit 0**：core 2,080、mcp 187、整體 635、打包 185＋1 略過、workspace-lifecycle 52。沙箱外的 K13：匯入 32 MiB 的寫入交易 51–55 ms（門檻 2,000）、RSS 增長約 40 MiB（門檻 128）、寫入者 p95 16–17 ms、零 busy、重疊讀取超過 10,000 頁 → **提交 U4a-1 為 `74956b5`**（38 個檔案；連同修正共 40 個，兩種方式核對一致） |
| `u4a_review_spec`／`u4a_review_standards` | U4a-1 的非作者雙審查 | gpt-6.1-sol/xhigh → 同 | read-only | `74956b5`，在乾淨的 worktree `/home/chichieh/cairn-memory-review-u4a` | 09:44–09:55 | **兩邊都判 No**。Spec 有 1 項 P1：`INSERT OR REPLACE` 能讓已刪除的版本復活，審查者實際讀回了原始位元組。另有 3 項 P2：多出來的觸發器能通過驗證、偵測過早出現的資料表時分大小寫、snapshot 接受正規編碼會拒絕的物件原型。Standards 有 1 項 P2：並行門檻把寫入者暫停期間也算成重疊，所以輕易過關，證實了主控先前的疑慮 → 修正輪排在 U4a-2 之後；另請 worker 檢查 v30 的方法包資料表有沒有同樣的漏洞 |
| `umv1_u2_impl`（U4a 第二部分） | 衍生文字、方法包二進位附件（mixed-v1）、K04／K08–K12，以及 64 MiB 混合匯入的 K13 門檻；不改 DDL | gpt-6.1-sol/xhigh | workspace-write | `74956b5` | 10:0x– | 執行中 |
| `umv1_u5a_impl`（修正 2）＋主控重跑 | 打包清單加入 9 個新的執行期模組 | gpt-6.1-sol/xhigh → 同 | workspace-write | U5a worktree | 08:1x–08:3x | 兩種方式核對：從 import 圖走到的 198 個檔案都在清單內，差異 0。補裝依賴後主控重跑：local、mcp、workspace-lifecycle 在兩個 Node 版本都過；Node 24 的 core 2,076／2,076（競態偶發失敗沒有重現）；打包在 Node 24 是 182＋1 略過；Node 22 有 3 個試點測試在負載 39 時逾時，單獨重跑 14／14 通過 → **在 U5a 分支提交 `54259bf`**（28 個檔案） |
| `u5a_review_spec`／`u5a_review_standards` | U5a 第一＋二部分（core）的非作者雙審查 | gpt-6.1-sol/xhigh → 同 | read-only | `54259bf`，在乾淨的 worktree `/home/chichieh/cairn-memory-review-u5a` | 08:16–08:27 | **兩邊都判 No**。Spec 有 1 項 P1：預算帳本的鍵包含並行上限，改了上限，累計花費就歸零，審查者實測在 $1 的上限下花掉 $2。另有 4 項 P2：診斷沒有回報重建原因、檔案監看漏掉 `-journal/-wal/-shm`、R10 沒有用獨立程序驗證寫入者、R06 少了索引存取的監看與「預留後撤權」。Standards 有 4 項 P2：建構失敗時沒有關閉連線、檔案系統錯誤會帶出路徑、測試等待沒有上限、缺少 CHANGELOG 與限制說明 → 9 項全部交給修正輪 |
| `umv1_u5a_impl`（U5a 審查修正） | 上述 9 項，每項都附回歸測試 | gpt-6.1-sol/xhigh → 同 | workspace-write | `54259bf` | 08:27–08:49 | exit 0，12 個檔案。主控在沙箱外驗收，兩個 Node 版本全部 exit 0（core 2,090、mcp 180、整體 635、打包 182＋1 略過）→ **在 U5a 分支提交 `c798695`**；兩位審查者在乾淨的 worktree 複查中 |
| `u5a_review_spec`／`u5a_review_standards`（複查） | 複查 `c798695` | gpt-6.1-sol/xhigh → 同 | read-only | `c798695` | 09:1x–09:22 | **兩邊都判 Yes**：9 項逐一確認解決，沒有新問題 → **U5a 第一＋二部分（core）完成** |
| `umv1_u5a_impl`（U5a 第三部分） | host 端：MCP 旗標與兩個工具、`cairn-memory context refresh`、OpenAI embedding adapter（預設 3-small，可設定；測試只用假的 HTTP 伺服器，真實付費的 smoke 預設不跑）、已安裝測試 R01／R12／R13、`docs/context-read-local.md` | gpt-6.1-sol/xhigh | workspace-write | U5a 分支 `c798695` | 09:2x– | 執行中；完成後在 U4b 開工前合併回整合分支 |
| `umv1_u5a_impl`（U5a 第三部分） | （結果） | gpt-6.1-sol/xhigh → 同 | workspace-write | U5a 分支 `c798695` | 09:23–10:09 | exit 0；24 個檔案（改 9 個、新增 15 個）。CLI 的靜態圖有 25 個檔案，沒有任何一個連到 SQLite；閉包 205 個檔案全在清單內。沙箱裡因為 `listen EPERM`，假 HTTP 伺服器的測試無法執行 → 等主控在沙箱外驗收 |
| 主控（**驗收流程修正**） | 對照 CI 檢查驗收範圍 | — | — | — | 10:1x | **發現缺口**：主控先前的驗收矩陣只是 CI 的一部分。`.github/workflows/ci.yml` 另外還跑 openai、codex、client、raw-producer、pairing、local-transport／worker／host、longmemeval、experiment-budget、experiment-request-guard、live-evidence-offline、windows-preview、plugin-validation 等。U4a-1 改過 local-host-permission 與 local setup 的版本檢查，但相關測試從沒跑過。改用照 ci.yml 重建的 CI 等效腳本 `ci-matrix.sh`；先在固定於 `74956b5` 的乾淨 worktree（`/home/chichieh/cairn-memory-ci`）上，替所有已提交的工作補驗。本機沒有 Node 20，CI 的 `test` job 有用到，這是已知缺口 |
| `umv1_u2_impl`（U4a 第二部分） | （結果） | gpt-6.1-sol/xhigh → 同 | workspace-write | `74956b5` | 09:44–10:45 | exit 0；25 個檔案，沒有改 DDL。沙箱內 K13：64 MiB 混合匯入的交易時間 120–252 ms、RSS 增長 80–88 MiB、零 busy。等待沙箱外驗收 |
| 主控（CI 等效補驗 `74956b5`，Node 22 部分） | 照 ci.yml 跑 | — | 沙箱外 | `/home/chichieh/cairn-memory-ci` | 10:2x– | **抓到真回歸**：`test:local-transport-import`／`test:local-host-import` 回報 eager SQLite。二分法定位在 **`d8eaba8`（U2a 修正輪）**：`core/method-package-schema.mjs` 靜態 import 了 `node:sqlite`，這條路徑會被本機 transport／host 的設定模組帶進來；U4a-1 的 `core/asset-schema.mjs` 也一樣。實際載入的 import 鏈已追到。這個回歸從 U2a 修正一路帶到現在，因為主控先前的驗收沒跑這兩個 CI job。pairing 有 1 項在負載 28 時 EPIPE，待重跑 → 交給修正 |
| `umv1_u2_impl`（eager SQLite 修正） | 兩個 schema 模組在連結時不載入 SQLite，並加入不改動對方 fixture 的回歸測試 | gpt-6.1-sol/xhigh → 同 | workspace-write | U4a-2 工作目錄（改的是不同檔案） | 10:5x–11:01 | exit 0；3 個檔案，改用 `new db.constructor(':memory:')`。新測試在獨立程序裡檢查 8 個入口。兩個 Node 版本的守門測試都 exit 0；U4a-2 的 25 個檔案沒有任何改動 |
| 主控（CI 等效補驗 `74956b5`，完成） | 照 ci.yml 跑全部 job | — | 沙箱外 | `/home/chichieh/cairn-memory-ci` | 10:2x–11:0x | 95 項 exit 0。失敗：(1) local-transport／host-import，兩個 Node 版本都失敗，就是上面那個回歸，修正已完成；(2) pairing 在 Node 22 負載 28 時 EPIPE，Node 24 通過，屬於負載偶發；(3) plugin-validation，原因是用 `--ignore-scripts` 安裝，沒有 claude 原生執行檔。兩條分支自 b8fa224 以來在 plugin 路徑上的變更都是 0 個檔案，這項判定為不適用，腳本已改成會自動判斷。openai、local-host、codex、client、raw-producer、longmemeval、實驗預算、打包快取在兩個 Node 版本都 exit 0。U5a 分支只帶著同一條已知的鏈，沒有新增 eager 路徑 |
| 主控（CI 等效：整合分支修正＋U4a-2；U5a 第三部分） | 兩條分支同時跑 | — | 沙箱外 | umv1、u5a worktree | 11:1x– | 執行中 |
| 主控（推送與 draft PR） | 依使用者授權決定 | — | — | — | 12:3x | 推送前先掃描公開內容：整合分支新增的部分沒有本機路徑、私有參照或金鑰（5 個 `sk-` 字串都是遮罩測試用的假值）。研究分支只清掉一個個人下載路徑（`2345a4c`）；`cairn-wiki` 和 `/home/...` 路徑在公開主線本來就有。已推 `experiment/hybrid-retrieval-hr1`（`2345a4c`，不開 PR）與 `integration/unified-memory-v1`（`71377c9`），並開 **draft PR #470**，base 為 #469 的 `feat/local-v1-closeout`，內文列出未完成的審查（U4a-1 的 P1 修正中、U4a-2 審查中） |
| `u4a2_review_spec`／`u4a2_review_standards` | U4a-2（`71377c9`）的非作者雙審查 | gpt-6.1-sol/xhigh → 同 | read-only | `71377c9`，乾淨的 worktree | 11:5x–12:19 | **Standards 判 Yes**，沒有問題。**Spec 判 No**：沒有實作缺陷，但有 3 項 P2 驗收缺口：K13 沒有在並行寫入時測最大的混合附件讀取、K04 缺混合附件擁有權違規的負向 SQL 測試、K09 缺「重建期間刪除後不會復活」的情境 → 排在 U4a-1 修正之後補 |
| `umv1_u5a_impl`（U5a 第三部分修正）＋主控驗收 | 測試改用正規化後的儲存內容比對 | gpt-6.1-sol/xhigh → 同 | workspace-write | U5a 分支 | 12:0x–12:3x | 3 個測試檔。主控重跑：打包在兩個 Node 版本都 exit 0（184＋1 略過），Node 24 單獨量測 C04 exit 0、零 busy。CI 等效其他項都通過，只有本機 import 守門失敗，這是從 `d8eaba8` 繼承的，整合分支 `88881df` 已修 → **在 U5a 分支提交 `966e107`**；雙審查進行中 |
| （session 中斷） | 主控程序重啟 | — | — | — | 約 12:20–13:59 | U4a-1 修正輪與 U5a 第三部分雙審查都在中途被中斷，沒有產出結果。已接續原 thread 重新跑；U4a-1 修正輪先檢查工作目錄裡改到一半的 7 個檔案再繼續 |
| `u5a_review_spec`／`u5a_review_standards`（第三部分） | U5a host（`966e107`） | gpt-6.1-sol/xhigh → 同 | read-only | `966e107` | 14:0x | **兩邊都判 Yes，零問題 → U5a 三部分全部完成** |
| 主控（U5a 合併整合分支） | 把 `71377c9` 合併進 U5a 分支 | — | — | U5a worktree | 14:1x | 4 處衝突，都是兩邊各自新增的內容（`database.mjs` 版本清單、`read-database.mjs` 驗證、打包清單、CHANGELOG），已合成兩邊。快速檢查：本機 import 守門恢復 exit 0，context-read＋assets 的 core 測試 191／191。CI 等效完整矩陣跑中 |
| 主控（加速啟動） | 方案一與方案二 | — | — | — | 14:4x | U5a 的合併提交為 `389512d`（快篩通過，完整 CI 跑中：Node 22 53／53 全過）。新開兩個 worktree：`/home/chichieh/cairn-memory-u4b`（`integration/unified-memory-v1-u4b`）、`/home/chichieh/cairn-memory-preview`（`release/v1-preview`）。改用 `setsid` 脫離 session 執行並派出：`umv1_u4b_impl`（U4b）、`umv1_preview_docs`（產品接入指南）。另寫 `TRAPS.md`，列出 10 條已知陷阱，附進每份派工單 |
| 主控（OpenAI 真實煙霧測試） | 1 次請求、上限 US$0.01 | — | 沙箱外 | preview | 14:5x | **抓到 P1**：真實 OpenAI 向量的範數約 1.000225，核心要求誤差 ≤1e-5，所以每一個真實向量都被拒（`provider_error`，經過預算層後變成 `timeout`）。也就是說，託管語意檢索在真實 API 上完全不能用；假的 HTTP 伺服器回傳完美的單位向量，所以測試看不到。網路與 Node fetch 都正常，費用約 US$0.0000002 → 交給 `umv1_u5a_impl` 在 preview worktree 修：由 adapter 先把向量正規化，並把假伺服器改得更接近真實回應 |
| 主控（正規化修正驗證＋U5a 推送） | — | — | 沙箱外 | preview、u5a | 15:0x–15:2x | 正規化修正（7 個檔）通過：真實 OpenAI 煙霧測試 exit 0、1,536 維；兩個 Node 版本的 adapter 與已安裝 HTTP 測試都 exit 0。接入指南已校正。U5a 合併後的完整 CI：Node 22 全過；Node 24 在負載 34–40 時有兩項失敗，單獨重跑都通過（59／59、4／4）。推送 `integration/unified-memory-v1-u5a`，開 **draft PR #471**（base 為 #470）。另外，`uptime` 顯示晚上 20:2x 機器重開過，就是前面 session 中斷的原因 |
| 使用者 | 已派第二個 session 負責 U5b 線（HR-2 加分層組裝） | — | — | — | 15:3x | 依照 `docs/plans/u5b-track-brief.md`。它的紀錄在 `docs/plans/u5b-track-log.md`；主控仍是整合分支唯一的合併者；改動共用檔案前要先經使用者協調 |
| 主控（**v1-preview.0 發布**） | 方案一 | — | 沙箱外 | preview | 15:3x | 預覽版提交為 `80daca28`（包含向量正規化修正與產品接入指南）。驗收：openai 317、mcp 193、validate、local import 守門在兩個 Node 版本都 exit 0。core 在 Node 24 是 2,202／2,202；Node 22 有 1 項 E3/E5 在負載 26 時被取消，單獨重跑兩個 Node 版本都 40／40。打包測試在負載 31–46 時逾時，負載約 8 時重跑兩個 Node 版本都 187／187。真實 OpenAI 煙霧測試通過。安裝包 sha256 `7b0442d1…88319`，用 tarball 實裝後 `--help`、`--check-config` 都正常。已推 `release/v1-preview`、tag `v1-preview.0`，並建立 **GitHub pre-release**（附 tgz 與 sha256），說明含未合併的 #453–#469。U4b 審查兩邊判 No（2 項 P1：assets 與 contextRead 不能同時設定、匯出回執會帶出路徑；另有 3 項 P2）→ 修正中。另新增全機器共用的重型測試鎖 `cairn-heavy` 和負載閘門 |
| `umv1_u4b_impl`（修正）＋主控 | U4b 的 2 項 P1、3 項 P2 | gpt-6.1-sol/xhigh → 同 | workspace-write | `8742e4b` | 23:3x–00:xx | 12 個檔案。worker 只跑自己改到的測試（175／175）。主控在 cairn-heavy 佇列下跑完整 CI：100 項全部 exit 0 → 提交 `96a47882`。雙審查複查**兩邊都判 Yes** → **U4b 完成** |
| `umv1_u2_impl`（U4a-1 修正）＋主控量測 | 5 項（含 P1：刪除後復活） | gpt-6.1-sol/xhigh → 同 | workspace-write | `71377c9` | 至 00:xx | 16 個檔案，新增 28 個 v31 防護觸發器。沙箱外量測：有節奏的情境全數通過；**不放慢的寫入者會讓讀取者餓死**（讀取者 94 秒只讀了 157 頁，之後 storage_busy），這是 rollback-journal 本身的特性 → 契約新增 **§16**：門檻只套用在有節奏的情境，不放慢的情境改為壓力觀察；把限制寫進文件；WAL 模式列為之後的全庫決策。腳本調整已交 worker |
| 主控 | U4a-2 驗收補強＋整合＋**v1-preview.1** | gpt-6.1-sol/xhigh | — | `ce472f25` | 至 04:xx | U4a-2（K13 混合讀取、K04、K09）：主控驗收 146/146，measure 兩版本都 exit 0，規格軸審查 Yes，提交 `1d32bf75`。合併後整體 CI 100/100 → 整合分支在 `1d32bf75`，已推。預覽分支在 `924d7658`，已打 tag `v1-preview.1` 並發 pre-release（tgz sha256 `23f18229…ee55`）。從 tgz 安裝實測：素材＋檢索 12 個工具都正常 |
| 主控＋U5b session | U5b-2 packet A 合併＋**v1-preview.3** | gpt-6.1-sol/xhigh | — | `0a38a991` | 至 10/24 | §15.8 v0.10→v0.10.4，經四輪非作者審查，確認版是 `ccc9602a`。實作經兩輪修正後雙審查 Yes（`7a3ad58e`），CI 100/100，在 `b18dabe0` 刪掉 worker 報告。主控補跑檢查：validate、import guards、test:artifact 兩個 Node 版本都是 253/253 → 整合分支 fast-forward 到 `b18dabe0`。預覽分支在 `7197d800`，打 tag **v1-preview.3**：`read_memory_context` 的 v2 格式和精簡 ref 取回列為**穩定介面**。每筆開銷約 250→82 tokens，一筆記憶 488→126 tokens。tgz 實測：256 tokens 的預算放得下 2 筆；f 錯一個字元回 snapshot_stale；修正後用舊 ref 取回回 revision_conflict。主控的決定：精簡 ref 帶 fence 前綴 f；MOC 換分類只在 snapshot 取回時報錯，並寫進文件 |
| U5b session＋主控 | U5b-2 packet B：**HR-2 v1.1**（host-v2 重跑） | gpt-6.1-sol/xhigh → 同 | workspace-write | `14ff5dc7` | 10/24 | 協議 v1.2 §11 → 非作者稽核（0 P0、4 P1、2 P2）→ v1.2.1 凍結 `4fb90832`；harness `5d0a344b`＋修正 `14fdacb5`（雙審 yes）；120 格一次跑完，各階段 exit 0；轉錄檢查修 4 項 P1 → `8ed4dadb`。主控抽查 bge-m3＠256 的 P-top-s1 − P-top（+1.6667 [+0.3401, +3.4091]）與 report.md 一致 |
| `u5c_inventory`、`u5c2_contract_author`、`u5c2_contract_audit`、`u5c1_contract_author` | U5c 盤點、§17 起草與稽核、§18 起草 | gpt-6.1-sol/xhigh＋fast → 同 | read-only | `b18dabe0`／`6151fcb6` | 10/24 | 盤點：分三包、需要 v32；§17 草稿 v0.11 已提交在 `integration/unified-memory-v1-u5c` `6151fcb6`，稽核中；§18 起草中 |
| `umv1_u5c1_impl`、`umv1_u5c2_impl`、`umv1_u5c3_impl`、`u5c{1,2,3}_review_{spec,standards}`、`u5c{1,3}_contract_*`、`umv1_preview_docs` | U5c-1／2／3 實作、雙審查、§18／§19 稽核；**v1-preview.4** 指南 | 實作 gpt-6.1-sol/high＋fast；審查與稽核 xhigh＋fast | workspace-write／read-only | `ef38da4a`／`70db0fa4` | 10/24 | U5c-1：part 1＋2＋兩輪修正，雙審 Yes；並行門檻移到 `measure:role-profiles`（TRAPS 第 12 條）。U5c-2：三輪修正，誠實計算後 MOC 約 1 萬筆降級並寫進文件。合併時 U5c-1 的 flag-off fixture 重新從 `4aa9327b` 產生（`6a3c660c`）。U5c-3：§19 經稽核到 v0.13.2，實作兩輪修正後雙審 Yes（`ef38da4a`）。CI 等效矩陣 104/104（含 tokenizer 步驟與兩個 measure）。整合分支 fast-forward 到 `ef38da4a`，再補一個角色指南用語修正 `b096e043`。預覽 `70db0fa4`：validate、test:artifact 259/259 兩版本都過；安裝後實測 check-config、無 flag 時工具清單與 `.3` 逐位元相同、角色 CAS／重放／then／refresh、來源診斷與逐次關閉、依附工具回 approval_required、store 為 v33、`.3` 拒開且資料庫完整。打 tag **v1-preview.4** |

# Cairn.ink Memory GitHub 宣傳計畫與驗證標準

本計畫以增加 GitHub 曝光與自然新增 stars 為主。Cairn.ink Memory 的 Local 模式 Show HN 與廣泛宣傳依 P4 的限定範圍及 11 項條件判斷；抽取或 recall 品質主張仍須通過完整 E01 至 E09。

狀態（2026-11-13）：45 stars；安裝器以 0.6.6 release 為本次查核版本，README 已改寫成單一安裝入口。2026-10-03 的 P1 理解檢查與 P2 真人安裝條件一直沒有完成，正式 D0 尚未開始。Cairn.ink Memory 的廣泛宣傳仍未放行，Local 模式公告改依下方 P4；抽取或 recall 品質主張仍須通過 [E01 至 E09](semantic-evaluation.md)。45 stars 不是正式發布前的完整量測起點；本文的數字目標是首輪試驗設定，不是成效預測。既有 [local memory PLG 計畫](local-memory-plg.md) 的真人採用實驗繼續依自己的起跑條件。

## 目標受眾與主張

第一波受眾是使用 AI agent 與 MCP、經常開新 session、想掌控專案決策記憶的開發者。建議主張為「讓 AI 的跨對話記憶附上來源，並由你查看、修正與遺忘」。

每則 repo 宣傳聚焦一項具體能力：新 session 取回一項明確儲存的決策，能查看它的來源，並更正或遺忘。團隊知識地圖、Moss 與 hosted 服務可作為延伸連結。

宣傳應清楚區分本機儲存與雲端模型處理、明確工具操作與自動擷取、本機 preview 與 hosted plugin。Source Receipt 證明保留內容的來源，不保證其解讀正確。所有版本、client 與模型相容性主張都須連到對應證據。

## 目前基準與首輪目標

基準於 2026 年 10 月 2 日約 15:51 UTC 查詢，約為台北時間當日 23:51。來源為 GitHub API；檢查的 repo commit 是 `7467aebcb32563c9aab4356a8c3e04c0ebb1ecd4`。

| 項目 | 已查到的基準 | 解讀 |
| --- | --- | --- |
| Stars | 19 | 首則宣傳發布前再記錄一次，作為正式起點 |
| 頁面瀏覽 | 222 次 | 回傳日期為 2026 年 9 月 18 日至 10 月 1 日，共 14 天 |
| 不重複訪客 | 51 | 使用 API 的整個視窗 `uniques`，不加總每日 uniques |
| Clones | 6,767 次，616 個不重複來源 | 數量遠高於頁面訪客；來源未釐清，僅作輔助觀察 |
| 主要可見引薦 | GitHub、X、LinkedIn、Facebook、Threads | 引薦資料只有可見來源，不能完整歸因新增 stars |
| 最新已發布 prerelease | v0.2.0，2026 年 10 月 1 日發布 | 核對 README 的歷史 v0.1 說明與現行能力 |
| 自訂分享預覽圖 | 尚未設定 | 準備 GitHub social preview 圖 |

正式宣傳觀察窗為 14 天。首輪提議目標：淨新增至少 30 stars、至少 150 位不重複 repo 訪客，以及至少 5 位不同開發者提供具體回饋。若從當時 19 stars 起算，stars 目標為至少 49；正式計算以發布前的實際起點為準。

後續準備快照於 2026 年 10 月 2 日 17:14 UTC（台北 10 月 3 日 01:14）記錄 **20 stars**；API 回傳流量仍是上述 9 月 18 日至 10 月 1 日視窗。[原始快照與摘要](../promotion/metrics/20261002T171417.327267Z/summary.json)已保存。這不是 D0，也不把先前增加的 star 算成此次宣傳成果。

2026-10-03 的準備工作預估為 5 個工作天，並非 0.6.6 的放行時程。Local 模式廣泛宣傳依 P4；產品品質修復另計，不能靠預估工期視為完成。D0 是首則宣傳發布日，宣傳資料按 UTC 日期記錄；D0 至 D13 為首輪觀察，D14 結案。

## 階段與進入標準

| 階段 | 預估時段 | 交付物 | 驗證標準 | 未通過時的動作 |
| --- | --- | --- | --- | --- |
| P0 確認主張與量測 | 準備第 1 天，約半天 | 主張證據表、基準與量測欄位 | 每項產品主張都有對應版本與證據；流量、stars、未知來源可分開記錄 | 移除或縮小無證據的主張，補齊量測 |
| P1 改善 repo 入口 | 入口準備 | 單一入口 README、Local／Cloud 說明、支援表與分享圖 | 版本及連結核對；舊 5 人／30 秒／4 人答對條件已由 P4 條件 7 取代，不再是 Show HN 前提 | 保留未完成的舊真人檢查紀錄；依新條件記錄外部安裝嘗試 |
| P2 驗證入門與 demo | 發布前 | 公告版本的乾淨安裝、真實 client 紀錄與錄影 | 舊 source 安裝與 model-free demo 保留為歷史；Show HN 改依 P4 條件 5、6、9 | 保留每次失敗；補足公告版本、真實 client 與 macOS 證據 |
| P3 小規模分享 preview | 自行安排 D0 至 D6 | 渠道貼文、每日量測與回饋記錄 | 小規模試驗保留原流程；P3 的 D0 與第 7 天檢查不再是 Show HN 前提，中文貼文與 Show HN 可在同一週 | 依觸及、repo 瀏覽、stars 與回饋分別調整 |
| P4 決定是否擴大 | 11 項條件全部符合後 | Local 模式 Show HN 稿、創辦人首則留言、獨立審查與本人簽核 | 下方限定範圍及 11 項條件；品質、成本節省或 Cards／maps 主張恢復完整 E01 至 E09 | 尚未放行；缺證據就維持未完成，不改寫為通過 |
| P5 結案與下一輪 | D14 | 成效表、未達目標的原因假設、下一輪單一改動 | 資料視窗與起點明確；成功、失敗與缺資料均保留；決定可由數字追溯 | 資料不足時標記不確定，不補寫成效 |

## P0 主張與量測驗證

每項對外主張記錄「文字、適用版本與 profile、證據位置、仍有限制」。先核對 [README](../../README.md)、[readiness](preview-readiness.md)、[已留存 lifecycle 證據](../evidence/reliable-memory-loop.md)、[限制](../limitations.md) 與 [ROADMAP](../../ROADMAP.md)。

驗證標準：

- 本機與 hosted 安裝方式、帳號需求、資料位置及擷取行為分別說明。
- 明確寫出語意 recall 的模型需求；免 key walkthrough 不被描述成成功的語意 recall。
- 對於自動擷取、任意 client 支援、完全離線、模型可靠度及成本節省，只有對應證據支持時才加入文案。
- 單一 demo 的成功不被寫成一般準確率，實驗 profile 的成功不替代預設 profile 的失敗。
- 量測欄位至少包括 UTC 時間、當日版本、stars、逐日 views、整窗 unique visitors、發布渠道與 URL、具體回饋數，以及缺資料原因。

## P1 Repo 入口驗證

README 頂部依序呈現一句主張、具體使用例、developer preview 狀態、demo、清楚的安裝選擇與簡短追蹤邀請。詳細選項與歷史評測留在既有文件並提供連結。

準備 1280×640 的分享圖，使用產品名、主張與一筆記憶連到來源的示意。核對 release、README、marketplace 與支援表的版本說明。Topics 可補上實際適用的 `agent-memory`、`mcp-server`、`sqlite`、`local-first`。

以下保留 P1 的原始驗證清單。前兩項理解檢查未完成，作為 Show HN 前提已被 P4 條件 7 取代；其餘為文件準備工作，不增加 P4 條件。

- 5 位未參與開發的目標讀者看 README 頂部 30 秒後回答三題：它解決什麼問題、Source Receipt 有什麼用、自己應選哪個安裝入口。至少 4 位三題皆答對；Source Receipt 的答案須知道能查來源且不保證解讀正確。
- 所有 5 次閱讀嘗試都記錄；中止或未回答算未通過，不只統計完成者。
- 在 1440px 與 390px 寬度檢查 README 區域；主張、狀態與安裝選擇可辨識，圖片載入，重要文字不被裁掉。
- 檢查新增文件連結、範例路徑、必要 Node 版本與實際 installer 行為。沒有尚未發布的 registry 安裝捷徑。
- 分享圖於縮小後仍能辨識產品名與核心主張，檔案符合 GitHub 的格式及大小要求。

網站調整安排在這些 repo 工作之後：增加直接查看來源的例子、明顯的 OSS 入口，以及手機地圖的清單或導覽入口。若此次貼文直接連 GitHub，網站改版不是 P3 的必要條件。

若後續貼文導向網站，追加驗證：未登入訪客能在兩次點擊內從示例打開來源；390px 手機畫面能找到推薦內容與清單入口；5 位新讀者至少 4 位能不靠提示打開第一張卡片。先記錄實際操作，再決定是否把網站加入宣傳路徑。

## P2 入門與 demo 驗證

以下保留 2026-10-03 的操作模板與驗證標準。它們不是 0.6.6 的完成證據；舊安裝與 demo 放行條件已由 P4 條件 5、6、9 取代。新的無 key 流程包含 find，不把 `model_not_configured` 當成成功找回記憶。

使用同一個簡單的合成專案決策，呈現「儲存 → 重啟 → 查看來源 → 更正 → 查看目前版本 → 遺忘 → 確認沒有 active 記憶」。語意 recall 的錄製與無 key 檢查分別標示。

驗證標準：

- 依文件完成 3 次乾淨的安裝與無 key walkthrough，全部通過；覆蓋 Node 22.16 與 Node 24。至少一次由不熟悉實作的人只依文件操作，操作者種類如實記錄。
- 記錄版本、合成資料、實際工具結果、各步驟耗時與阻礙。3 次中任何一次中斷都保留在分母，不能挑成功次數代替整批結果。
- 工具探索、持久化、receipt、修訂、更正的舊 revision 拒絕，以及遺忘後的 active 列表都符合 [walkthrough](../local-memory-demo.md)。無 key recall 必須回報 `model_not_configured`。
- Demo 的 ID、revision、來源與結果可追溯到實際紀錄；縮短畫面時保留意思與步驟順序。前 10 秒能看懂一筆記憶及其來源。
- 使用已有的真實模型紀錄時，標示其版本與測試範圍；新的模型錄製需另外制定資料、配置與費用範圍。
- 展示語意 recall 時，須有實際取回對應記憶、目前 revision 與支持來源的紀錄；遺忘後的查詢須為空。`model_not_configured` 只代表無 key 檢查的預期結果。
- 宣傳版本若宣稱某 client 可以使用，須有對應已安裝 client 的證據，SDK walkthrough 成功不替代這項檢查。

P2 是入門與素材驗證；其通過不表示預設抽取品質通過，也不表示已有真人採用。

## P3 渠道與第七天檢查

第一輪選兩個已有可見引薦的渠道，建議英文 X 搭配中文 Threads 或維護者既有的開發者社群。每則內容直接連到 repo，單篇聚焦一項能力，提供 demo、preview 狀態與真實限制。

分工：Codex 準備文案、素材、文件修改、驗證結果與量測整理，並依已授權的帳號執行發布及招募。第一輪素材已完成，已沿用 Content 發文中心的 WSL 持久瀏覽器發布英文 X 與中文 Threads 招募稿；兩則貼文頁的完整文案均已核對，[發布紀錄](../promotion/publications.csv)保留網址及 UTC 時間。先完成真人招募與驗證，再啟動正式宣傳觀察窗。

真人招募以 X／Threads 原貼文直接回覆為入口，不要求 GitHub 帳號或 issue 留言；[issue 326](https://github.com/Cairn-ink/cairn-memory/issues/326) 只作可選的公開進度追蹤。使用中性招募稿，正式閱讀前不解釋產品用途，以保留第一印象測試的有效性。

每則發布前核對：

- 渠道、完整文案、素材與 repo 連結已具體確定。
- 文案的每項功能與版本主張符合 P0 證據表。
- 連結在未登入狀態可讀，demo 可看，試用步驟可找到。
- 發布前記錄 stars 起點；發布後記錄 URL 與 UTC 時間。
- 每日保存 GitHub 流量視窗與 stars；內容或入口若中途變更，記錄日期與原因。

第 7 天的方向性目標是淨新增至少 10 stars，且收到至少 3 位不同開發者的具體問題或回饋。這些是試驗目標，不是產品合格證明。未達目標時先檢查流量與讀者反應，下一輪只改主張、demo 或渠道其中一項。

## P4 擴大宣傳與產品品質標準

此門檻適用於 Show HN 或任何廣泛公告，且只能宣傳**已發布 npm 版本**在 Local 模式實際提供的能力：一個指令設定、本機 SQLite 儲存、不經模型自動保存對話原文，以及每筆記憶都附來源原文的明確工具。這裡的「自動保存」是逐字保存對話文字，不是模型抽取。Cairn.ink Memory 0.6.6 已於 2026-11-13 發布到 npm；以下各項仍須對這個已發布版本逐項核對。

貼文及創辦人的首則留言都必須寫明：我們不主張模型抽取品質、recall 準確率或成本節省；引擎預設的模型抽取仍未通過自己的來源支持標準，並連到[已知限制](../limitations.md)。公告一旦主張抽取品質、自動 recall 品質、成本節省，或 Cards 與 maps，完整 [E01 至 E09](semantic-evaluation.md) 就恢復適用，標準不變。公告若宣稱 current、history、why 或自動更新能力，仍須依 [reliability contract](memory-reliability-contract.md) 驗證對應狀態與來源，不能只檢查回答字串。

以下 11 項必須對**實際公告的同一版本**全部成立：

1. [主張證據表](../promotion-claims.md)已按該版本重新查核；README 與 HN 文案的每個事實句都有對應列。
2. 單一入口 README 已合併；README、ROADMAP 與本計畫的 gate 狀態一致。
3. 保留 E05 的硬安全條件：更正後接受舊 revision 為零、已遺忘記憶復活為零、接受偽造來源為零、跨 namespace 參照為零。逐項引用 `2238d2fc` 的測試或紀錄；若只有舊 engine build 的證據，條件 3 維持未完成，並標明版本。
4. [semantic-evaluation.md](semantic-evaluation.md#frozen-acceptance-e01e09) 定義的 E08、E09 照原文繼續適用於公告版本，沒有刪減項目：E08 的離線測試與 CI、兩個支援的 Node 版本、regression demos 與 plugin gates 都要通過；E09 的固定 commit 獨立審查、未達標照實記錄、作者不自行合併或放行。原文如下。

   E08: Ordinary tests/CI are offline. Test denominators, absent results, safety/relevance failures, budget exhaustion, malformed output and opt-in. Offline tests use fake model/HTTP and cannot establish semantic quality. Run both supported core Node versions, regression demos and plugin gates.

   E09: Primary DRI inspects synthetic evidence, records numeric outcomes and limitations, then obtains independent Standards/Spec reviews on fixed commit. An unmet gate is reported honestly and fixed in a separately scoped change, never by silently relaxing the rubric or dropping cases. No self merge, publication, deployment or competitor benchmark claims.

5. 已發布 npm 版本的三次乾淨安裝都通過 `setup --local` 及無 key walkthrough（save、new process、find、inspect、correct、forget），涵蓋 Linux 或 WSL、至少一台真正的 macOS，以及 Node 22.16 與 Node 24。每次嘗試都留在分母。
6. 已發布版本有真實 client 證據：一次真正的 Claude Code session、一次真正的 Codex session，各自保存一筆記憶、從新 session 找回並查看來源，另以 `raw list` 顯示自動保存的對話。
7. 至少三位專案外的人只依文件安裝並回報。每次嘗試都記錄，包含失敗；每筆都有平台、版本、花費時間及卡住的位置。
8. 揭露離開電腦的資料：README 的「Your data」與 setup 輸出說明有 key 時哪些內容會送到模型供應商、如何全部留在本機，並與 release notes 一致。
9. README 以已發布版本在真實 client 的錄影取代 2026-10-03 model-free demo，且能追溯到該 session。
10. HN 貼文讓讀者能直接試用，說明做法與限制，保留原有 Show HN 內容要求。創辦人首則留言已起草並經獨立審閱，回答五題：與 markdown files 加 grep 有何不同；與 mem0、Zep 有何不同；如何量測；哪部分可自架；README 有 AI 協助撰寫。創辦人發布後約三小時及隔天早上可回覆。
11. 發布前記錄基準（stars、14 天 views 與 unique visitors），之後每天保存快照。

### 2026-11-13 條件狀態

廣泛宣傳**尚未放行**。以下按文件與 `2238d2fc` 來源保守判斷；測試定義存在不等於本次執行或已發布版本驗收通過。

| 條件 | 狀態 | 證據與尚缺項目 |
| --- | --- | --- |
| 1 主張逐句對應 | 未完成 | [0.6.6 證據表](../promotion-claims.md)已按 README 重查；HN 稿尚未寫，逐句對應尚未完成。 |
| 2 單一入口及狀態一致 | 未完成 | 單一入口 [README](../../README.md)已於 2026-11-14 合併到 main（本列於同日更新）。本次的證據表與 gate 文件仍待簽核與合併，合併前不能把工作中的改寫當成已生效的 gate。 |
| 3 四項硬安全 | 未完成 | 下表列出 release 來源中的測試；引用的完整零違規評測紀錄來自較舊 `b05773f`，不是 0.6.6 的已發布 engine 驗收紀錄。 |
| 4 E08、E09 | 未完成 | [原始定義](semantic-evaluation.md#frozen-acceptance-e01e09)保留；尚未附上公告版本的 E08 紀錄（離線測試與 CI、兩個 Node 版本、regression demos、plugin gates），也還沒有固定 commit 的獨立審查紀錄。 |
| 5 三次乾淨安裝 | 未完成 | [舊三次紀錄](../promotion/install-validation/README.md)是 `7467aebc` 的 agent/source 安裝，不是已發布版本。0.6.6 的自動保存只在 Linux 與 WSL 執行（[capture host check](../../integrations/client/raw/local-host-profile.mjs)）：在 macOS 上 `setup --local` 會接上 client、記憶工具可用，但回報對話保存 OFF 並以代碼 2 結束，所以真實 macOS 這一項在自動保存支援 macOS 之前無法符合。Node 22.16 與 Node 24 的新版本紀錄也還沒有。 |
| 6 真實雙 client | 未完成 | [packed capture 測試](../../packages/setup/test/local-capture.test.mjs)使用合成 client／transcript，不能當成真正 Claude Code 與 Codex 跨 session 驗收。 |
| 7 三位外部安裝者 | 未完成 | [舊讀者記錄](../promotion/reader-test.csv)仍 pending；沒有三位外部人員依新文件安裝的完整回報。 |
| 8 資料外送揭露 | 未完成 | [README Your data](../../README.md#your-data)及[繁中版](../../README.zh-TW.md#你的資料)寫明：有 key 時 Memory 與搜尋文字會送到 OpenAI、保存的對話要另外開啟才送、不給 key 才全部留在本機，`--no-context-semantic` 只關 embeddings。`2238d2fc` 的 [release notes](../../CHANGELOG.md)、[CLI 說明](../../adapters/mcp/cli.mjs)、[installer README](../../packages/setup/README.md)、[defaults](../defaults.md)，以及 setup 印出的 `local_privacy`／`local_capture_notice`（[messages](../../packages/setup/lib/messages.mjs)）說法相同。0.6.6 已於 2026-11-13 發布、README 已於 2026-11-14 合併，0.6.6 的文字一致。實際公告的版本若是 0.6.6 之後的版本，須對該版本的 setup 輸出與 release notes 重新核對；公告版本確定並核對前維持未完成。詳見[證據表](../promotion-claims.md)。 |
| 9 真實 client 錄影 | 未完成 | README 仍連到 [2026-10-03 demo](../promotion/demo/README.md)，它是編輯過的 model-free 工具輸出，不是 0.6.6 真實 client 錄影。 |
| 10 HN 文案及回覆安排 | 未完成 | 尚無完整 HN 稿、五題首則留言及獨立審閱，也無創辦人的回覆時段紀錄。 |
| 11 發布量測 | 未完成 | [歷史快照](../promotion/metrics/20261002T171417.327267Z/summary.json)不是本次起點；45 stars 不含同窗 14 天 views／uniques，每日新快照尚未開始。 |

### 條件 3 的證據邊界

以下測試名稱與 assertions 均核對 `2238d2fc`，本次只讀來源，沒有執行測試。四項引用的完整零違規評測紀錄是[較舊 engine `b05773f` 的 source-faithful rerun](semantic-evaluation.md#source-faithful-instruction-rerun--complete-source-support-still-failed)。不能用舊 build 的零違規代替 0.6.6 驗收；該舊評測本身也因 source support 失敗。

| 硬安全條件 | `2238d2fc` 中的覆蓋 |
| --- | --- |
| 更正後接受舊 revision 為零 | [stdio.test.mjs](../../adapters/mcp/test/stdio.test.mjs)：`real stdio lists strict tools and persists revisions, receipts and forgetting across restart` 拒絕 stale correct／forget；[recall.test.mjs](../../core/test/recall.test.mjs)：`final authoritative read catches another connection deleting or correcting during ranking`。 |
| 已遺忘記憶復活為零 | [store.test.mjs](../../core/test/store.test.mjs)：`forget clears active content and receipts and cannot be replayed after restart`；[local-capture.test.mjs](../../packages/setup/test/local-capture.test.mjs)：`packed real Claude hook reaches MCP Raw search; forget by save time hides source` 及 re-sent copies fenced 測試。前者查 Memory suppression，後者查合成 hook 的 Raw 隱藏／刪除邊界。 |
| 接受偽造來源為零 | [capture.test.mjs](../../core/test/capture.test.mjs)：`C02: source selection and adapter mutation cannot rewrite trusted receipts`、`C04–C06: whole extraction rejects forged authority and malformed or oversized members`。這是可信來源綁定，不是模型文字的真實性保證。 |
| 跨 namespace 參照為零 | [stdio.test.mjs](../../adapters/mcp/test/stdio.test.mjs)：`shared SQLite isolates owners, projects and personal scope against get/correct/forget`；[recall.test.mjs](../../core/test/recall.test.mjs)：`selector and ranker cannot invent refs, revisions, namespaces or extra fields`。 |

時間建議，**不是條件**：週一至週四發布，避開 11/23 至 11/27、12/17 至 1/4。貼文若沒受到注意，可以依 [HN FAQ](https://news.ycombinator.com/newsfaq.html)在實質改版後重貼一次。

本人以批准 pull request 簽核，簽核前先完成獨立審閱。本次文件改寫不代表 gate 已通過，也不啟動 D0。

## P5 成效判讀與下一輪

淨新增 stars 等於結案總數減發布前總數，包含期間取消 star 的影響。GitHub 不提供每個渠道造成幾個 star 的直接證明；引薦與發布時間只作方向性判斷。

| 14 天結果 | 下一輪的優先檢查 |
| --- | --- |
| 新增 stars ≥30，訪客 ≥150，具體回饋 ≥5 位 | 延伸反應最佳的主題與渠道，保留同樣的品質驗證 |
| 訪客 ≥150，stars 未達 30 | 查看讀者理解、demo、使用價值與追蹤邀請，先修 repo 入口 |
| 訪客與 stars 都未達目標 | 檢查貼文是否觸及目標開發者、標題與渠道是否合適 |
| Stars 達目標，訪客未達或資料缺漏 | 核對統計視窗與來源缺漏，保留 stars 成果，暫不宣稱轉換改善 |
| 具體回饋不足 5 位 | 增加合適的讀者回饋，暫不宣稱已有穩定採用需求 |
| 出現可重現的來源、修訂、遺忘或隔離缺陷 | 修復並重新驗證受影響能力，依實際結果調整宣傳範圍 |

150 訪客與 30 新 stars 是這次制定的首輪觀察目標，沒有統計顯著性或因果保證。新增 stars 除以訪客也不是可驗證的使用者轉換率。

GitHub traffic 提供最近 14 天的資料，故需每日保存回傳視窗。結案的整窗 uniques 只有在 API 視窗與宣傳視窗對應時才能用於 150 訪客的驗證；每日 uniques 不能相加去補出 7 天或整月的獨立訪客。數據尚未更新或缺漏時標為待確認。UTC 與台北日期分別標明。

具體回饋指不同開發者提出可回答的使用問題、可重現的入門阻礙、功能需求或實際使用觀察；單純按讚不計入。只收集自願提供的非內容欄位，如 host、完成步驟、錯誤碼與有用程度。Clone 數不當作成功安裝、活躍使用者或品質證明。

## 執行清單

- [x] 確認本輪以 GitHub 曝光與 stars 為主。
- [x] 查詢 2026-10-03 準備期的 stars、流量、引薦與分享圖基準（歷史紀錄）。
- [x] 整理 P0 主張證據表與已知限制；2026-11-13 已按 0.6.6 重查，完整放行仍依 P4。
- [ ] 更新正式發布前的量測起點。
- [x] 完成 P1 README、安裝選擇與支援表的第一版草稿。
- [x] 製作並驗證 1280×640 分享圖與縮小預覽。
- [x] 補上 GitHub topics：`agent-memory`、`mcp-server`、`sqlite`、`local-first`。
- [ ] 將分享圖設定為 GitHub social preview。
- [ ] 舊 P1：5 位讀者／30 秒／至少 4 位理解檢查未完成；作為 Show HN 前提已由 P4 條件 7 取代。
- [x] 完成舊 P2 三次 agent 操作的乾淨 source 安裝與免 key walkthrough（歷史紀錄；新放行條件為 P4 的 5、6）。
- [x] 完成 2026-10-03 的 36 秒 model-free demo（歷史紀錄；P4 條件 9 要求替換）。
- [ ] 依 P4 條件 7 完成至少三位專案外的人只依文件安裝，保留所有嘗試。
- [x] 完成英文 X、中文 Threads 文案與招募、評分材料。
- [x] 接上既有發布帳號，發布英文 X 與中文 Threads 真人招募稿。
- [ ] 完成新 P4 的版本、真人安裝、真實 client、錄影、HN 文案與回覆安排，再經獨立審閱及本人批准 PR。
- [ ] 執行 P3 第 7 天檢查（保留小規模試驗；作為 Show HN 前提已取代，可與中文貼文同週）。
- [ ] 核對 P4 全部 11 項條件；廣泛宣傳尚未放行。任何抽取、自動 recall 品質、成本節省或 Cards／maps 主張仍核對完整 E01 至 E09。
- [ ] 完成 14 天結案與下一輪決策。

### 2026 年 10 月 3 日執行紀錄

- README 以可查看來源、修正與遺忘為主軸，分開本機與 hosted 入口，補上 Hermes 原生設定的差異。
- 主張證據表列出適用版本、已留存證據與 client 支援邊界，並連到本次新增的安裝紀錄；未執行新的語意模型測試。
- 文件內部連結與標題錨點檢查、`git diff --check` 與 `npm run validate` 通過。
- 使用本機 Markdown 預覽檢查 1440px 與 390px 寬度，未見整頁橫向溢出，demo GIF 正常載入。這不是已發布 GitHub 頁面的驗證。
- [三次乾淨安裝](../promotion/install-validation/README.md)均通過，涵蓋 Node 22.16.0 與 24.15.0，18/18 免 key lifecycle 階段通過，93 份安裝 runtime 檔案雜湊一致。這些測試使用本機 Git archive；未重測 public clone，操作者均為 agent。
- [新版 demo](../promotion/demo/README.md)為 36 秒、1280×720、30 fps 的 H.264 MP4，依其中一次新 tool transcript 製作；保留來源、編輯後的顯示時間與 model-free 標示。實際影片場景及轉場解碼檢查完成。
- 分享圖保留原始來源中的「prototype」限定；記憶與來源文字一致。縮小預覽可辨識主張，PNG 小於 1 MB；尚未上傳至 repo 設定。
- [量測腳本](../../tools/promotion/snapshot.py)已實際抓取 repo、views、clones 與 referrers，保留 UTC 視窗。另用控制案例確認寫入前的 Git 狀態與部分 API 失敗記錄；尚未設定定時工作。
- 已完成獨立的 agent 文件審閱；它不計入 5 位陌生讀者或真人安裝驗證。[五位讀者欄位](../promotion/reader-test.csv)全部 pending。
- 英文 X 與中文 Threads 招募稿於 2026-10-02 17:59 UTC 發布（台北 2026-10-03 01:59）；各貼文頁的完整文案均已核對。[發布紀錄](../promotion/publications.csv)及[文案雜湊與核對結果](../promotion/recruitment-publication.json)已保留。X 發布前量得 20 stars，Threads 未單獨重測發布前星數；真人測試尚未完成，正式 D0 尚未開始。

### 2026 年 11 月 13 日改寫紀錄

- 移除限定 Local 公告必須先通過 E01 至 E09 品質門檻的前提，包括 36/36 嘗試、recall 至少 90%、precision 至少 90%、擷取事實恢復至少 90%、擷取 claims 的來源支持及 MOC。它們仍是品質主張的完整門檻，不改數字或刪除失敗。
- 移除 Show HN 前必須先跑 P3 的 D0 與第 7 天檢查；中文貼文與 Show HN 可以同週進行，保留原試驗紀錄。
- 移除 P1 五位讀者看 30 秒、至少四位理解的發布前提，改由條件 7 的至少三位專案外安裝者及全部嘗試紀錄取代。舊 P1／P2 真人條件沒有補寫成完成。
- 取代舊 P2 的放行條件（三次乾淨 source 安裝與無 key walkthrough、demo 與來源紀錄一致）：改由條件 5、6、9 對已發布版本驗證。舊 P2 的紀錄保留為歷史，不算新條件的證據。
- P3 不再是 Show HN 前提後，P3 自己的進入條件（P0 至 P2 通過）也不再擋 Show HN；對應的檢查改由條件 1（P0）、條件 7（P1）、條件 5、6、9（P2）承擔。
- 保留舊 P4 的一條：公告若宣稱 current、history、why 或自動更新能力，仍依 reliability contract 驗證對應狀態與來源。
- 舊 P4 其餘的評測條款（評測版本與宣傳版本相符、holdout 與 historical 結果分開、不得把失敗案例重跑到成功）隨 E01 至 E09 一起只在品質主張時適用；「版本相符」的要求保留在「對實際公告的同一版本全部成立」這句。
- 新增 Cairn.ink Memory 公告的限定範圍：只宣傳已發布 npm 版本的 Local setup、SQLite、無模型保存對話原文及附來源的明確工具。貼文與首則留言須揭露不主張抽取品質、recall 準確率或省錢，並連到引擎預設抽取仍未過關的限制。品質、自動 recall 品質、成本節省或 Cards／maps 主張恢復完整 E01 至 E09。
- 新增條件 1：公告版本重查主張表，README 與 HN 的每個事實句逐列對應。
- 新增條件 2：單一入口 README 已合併，README、ROADMAP 與本計畫狀態一致。
- 保留 E05 為條件 3：舊 revision、遺忘復活、偽造來源、跨 namespace 四項都為零，列明 release 證據及舊 build 邊界；保留 E08、E09 為條件 4，照原文適用，沒有刪減項目。
- 新增條件 5：已發布版本三次乾淨安裝及無 key 的 save、new process、find、inspect、correct、forget，涵蓋 Linux／WSL 與真實 macOS，並保留舊 P2 對 Node 22.16 與 Node 24 的涵蓋要求，每次嘗試留在分母。
- 新增條件 6：真正的 Claude Code 與 Codex 跨 session 保存、找回、查看來源，並用 `raw list` 查自動保存的對話。
- 新增條件 7：至少三位外部人員只依文件安裝，記錄含失敗的每次平台、版本、耗時及卡點。
- 新增條件 8：README 與 setup 輸出揭露 key、模型供應商、外送資料及保持本機的方式，與 release notes 一致。
- 新增條件 9：以公告版本、可追溯 session 的真實 client 錄影替換 2026-10-03 model-free demo。
- 保留直接試用、做法及限制的 Show HN 內容要求，新增條件 10 的五題創辦人首則留言、獨立審閱與發布後約三小時及翌晨回覆安排。
- 新增條件 11：發布前記錄 stars、14 天 views／unique visitors，之後每日快照；歷史量測工具與紀錄繼續保留。
- 新增發布時間建議及實質改版後可以重貼一次的安排，它們不是 gate 條件；新增獨立審閱後由本人批准 pull request 簽核。11 項條件仍未全部完成，廣泛宣傳尚未放行。

## 量測與渠道參考

- [GitHub traffic API](https://docs.github.com/en/rest/metrics/traffic)：流量視窗、每日資料與可見引薦的定義。
- [GitHub social preview](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview)：分享圖的設定與格式。
- [Show HN guidelines](https://news.ycombinator.com/showhn.html)：試用入口與投稿內容要求。
- [Local memory launch kit](local-memory-launch-kit.md)：既有入門、證據與 release 邊界。
- [Local memory PLG](local-memory-plg.md)：後續真人採用試驗與原有起跑條件。

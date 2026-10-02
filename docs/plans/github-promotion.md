# Cairn Memory GitHub 宣傳計畫與驗證標準

本計畫以增加 GitHub 曝光與自然新增 stars 為主。先改善 repo 的介紹與試用入口，再用可查證的 demo 和技術內容做小規模分享；擴大產品宣傳須另外通過既有品質標準。

狀態：README、安裝分流、[主張證據表](../promotion-claims.md)、[分享圖與量測工具](../promotion/README.md)、[36 秒 demo](../promotion/demo/README.md)及[兩個渠道的文案與真人測試套件](../promotion/campaign-kit.md)已完成。三次 agent 操作的乾淨安裝均通過；P1／P2 的真人條件仍待驗證，正式 D0 尚未啟動。本文的數字目標是首輪試驗設定，不是成效預測。既有 [local memory PLG 計畫](local-memory-plg.md) 的真人採用與產品品質標準繼續保留。

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

正式宣傳觀察窗為 14 天。首輪提議目標：淨新增至少 30 stars、至少 150 位不重複 repo 訪客，以及至少 5 位不同開發者提供具體回饋。若從目前 19 stars 起算，stars 目標為至少 49；正式計算以發布前的實際起點為準。

後續準備快照於 2026 年 10 月 2 日 17:14 UTC（台北 10 月 3 日 01:14）記錄 **20 stars**；API 回傳流量仍是上述 9 月 18 日至 10 月 1 日視窗。[原始快照與摘要](../promotion/metrics/20261002T171417.327267Z/summary.json)已保存。這不是 D0，也不把先前增加的 star 算成此次宣傳成果。

準備工作預估 5 個工作天。產品品質修復另計，不能靠這個預估工期視為完成。D0 是首則宣傳發布日，宣傳資料按 UTC 日期記錄；D0 至 D13 為首輪觀察，D14 結案。

## 階段與進入標準

| 階段 | 預估時段 | 交付物 | 驗證標準 | 未通過時的動作 |
| --- | --- | --- | --- | --- |
| P0 確認主張與量測 | 準備第 1 天，約半天 | 主張證據表、基準與量測欄位 | 每項產品主張都有對應版本與證據；流量、stars、未知來源可分開記錄 | 移除或縮小無證據的主張，補齊量測 |
| P1 改善 repo 入口 | 準備第 1 至 2 天 | README 頂部、兩種安裝路徑、支援表、分享圖 | 5 位陌生目標讀者中至少 4 位通過理解檢查；文件與畫面檢查通過 | 修改讀者誤解最多的段落，再用新讀者檢查 |
| P2 驗證入門與 demo | 準備第 3 至 5 天 | 可重現操作紀錄、30 至 45 秒 demo、簡短試用步驟 | 3 次乾淨安裝與無 key walkthrough 全部通過；demo 與真實來源紀錄一致 | 修復最先阻斷入門的問題；保留失敗紀錄 |
| P3 小規模分享 preview | D0 至 D6 | 兩個渠道的貼文、每日量測與回饋記錄 | P0 至 P2 通過；每則文案與連結已核對；發布與量測紀錄完整 | 依觸及、repo 瀏覽、stars 與回饋分別調整 |
| P4 決定是否擴大 | D7 至 D13 | 技術文章、下一個渠道的具體稿件與連結 | 完成第 7 天檢查；擴大產品宣傳另須通過下述品質標準 | 品質未通過時維持工程進度與限定 preview 分享 |
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

驗證標準：

- 5 位未參與開發的目標讀者看 README 頂部 30 秒後回答三題：它解決什麼問題、Source Receipt 有什麼用、自己應選哪個安裝入口。至少 4 位三題皆答對；Source Receipt 的答案須知道能查來源且不保證解讀正確。
- 所有 5 次閱讀嘗試都記錄；中止或未回答算未通過，不只統計完成者。
- 在 1440px 與 390px 寬度檢查 README 區域；主張、狀態與安裝選擇可辨識，圖片載入，重要文字不被裁掉。
- 檢查新增文件連結、範例路徑、必要 Node 版本與實際 installer 行為。沒有尚未發布的 registry 安裝捷徑。
- 分享圖於縮小後仍能辨識產品名與核心主張，檔案符合 GitHub 的格式及大小要求。

網站調整安排在這些 repo 工作之後：增加直接查看來源的例子、明顯的 OSS 入口，以及手機地圖的清單或導覽入口。若此次貼文直接連 GitHub，網站改版不是 P3 的必要條件。

若後續貼文導向網站，追加驗證：未登入訪客能在兩次點擊內從示例打開來源；390px 手機畫面能找到推薦內容與清單入口；5 位新讀者至少 4 位能不靠提示打開第一張卡片。先記錄實際操作，再決定是否把網站加入宣傳路徑。

## P2 入門與 demo 驗證

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

分工：Codex 準備文案、素材、文件修改、驗證結果與量測整理，並依已授權的帳號執行發布及招募。第一輪素材已完成；目前可用瀏覽器未連上使用者提到的已登入 X／Threads，尚無發布或招募完成紀錄。先完成真人招募與驗證，再啟動正式宣傳觀察窗。

每則發布前核對：

- 渠道、完整文案、素材與 repo 連結已具體確定。
- 文案的每項功能與版本主張符合 P0 證據表。
- 連結在未登入狀態可讀，demo 可看，試用步驟可找到。
- 發布前記錄 stars 起點；發布後記錄 URL 與 UTC 時間。
- 每日保存 GitHub 流量視窗與 stars；內容或入口若中途變更，記錄日期與原因。

第 7 天的方向性目標是淨新增至少 10 stars，且收到至少 3 位不同開發者的具體問題或回饋。這些是試驗目標，不是產品合格證明。未達目標時先檢查流量與讀者反應，下一輪只改主張、demo 或渠道其中一項。

## P4 擴大宣傳與產品品質標準

第 7 天有上述反應時，可優先延伸同一主題寫技術文章、增加一個相關渠道。反應不足時，維持小規模試驗並修正一項假設；不足本身不使工程交付失敗。

Show HN 或面向廣泛使用者的產品發布，需另檢查實際宣傳版本的品質。沿用 [既有凍結評測 E01 至 E09](semantic-evaluation.md)，至少要求：

- 36/36 嘗試完成，失敗、逾時與未完成都留在固定分母。
- 必要事實 recall 至少 90%，回傳記憶 relevance precision 至少 90%，預期擷取事實恢復至少 90%。
- 所有被擷取的 claims 都有來源支持；無關與已遺忘查詢在全部重複中為空。
- 外部 namespace 參照、偽造來源、更正後舊 revision 與已遺忘記憶復活皆為零。
- 原有 MOC、資源、獨立證據審查及其他 E01 至 E09 標準一併通過；此表沒有放寬既有標準。
- 若宣稱 current、history、why 或自動更新能力，再依 [reliability contract](memory-reliability-contract.md) 驗證對應狀態與來源，不能只檢查回答字串。
- 評測版本與宣傳版本相符，新的 holdout 結果與 historical 結果分開，不能用已失敗案例重跑到成功來替代獨立驗證。

目前預設 source support 尚未通過，故 P4 的廣泛產品宣傳尚未就緒。工程設計、實際開發進度與限定範圍的 preview 可依 P3 分享；既有 PLG 真人採用實驗仍依其自己的起跑條件。

Show HN 稿件須讓人能直接試用、說明做法與限制、提供可跑的 repo 入口。使用者對外訊息以最終具體內容與渠道決定；本計畫不改變尚未通過的 release 狀態。

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
- [x] 查詢目前 stars、流量、引薦與分享圖基準。
- [x] 整理 P0 主張證據表與已知限制。
- [ ] 更新正式發布前的量測起點。
- [x] 完成 P1 README、安裝選擇與支援表的第一版草稿。
- [x] 製作並驗證 1280×640 分享圖與縮小預覽。
- [x] 補上 GitHub topics：`agent-memory`、`mcp-server`、`sqlite`、`local-first`。
- [ ] 將分享圖設定為 GitHub social preview。
- [ ] 執行 5 位讀者的理解檢查。
- [x] 完成 P2 三次 agent 操作的乾淨 source 安裝與免 key walkthrough。
- [x] 完成 36 秒可追溯到新 transcript 的 model-free demo。
- [ ] 完成陌生真人只依文件操作的安裝驗證。
- [x] 完成英文 X、中文 Threads 文案與招募、評分材料。
- [ ] 接上發布帳號，招募真人；驗證完成後確定 D0 並發布。
- [ ] 執行 7 天檢查並決定下一個改動。
- [ ] 核對 P4 品質標準及是否可以擴大產品宣傳。
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
- 已完成獨立的 agent 文件審閱；它不計入 5 位陌生讀者或真人安裝驗證。[五位讀者欄位](../promotion/reader-test.csv)全部 pending；[發布紀錄](../promotion/publications.csv)目前只有欄位標題。

## 量測與渠道參考

- [GitHub traffic API](https://docs.github.com/en/rest/metrics/traffic)：流量視窗、每日資料與可見引薦的定義。
- [GitHub social preview](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview)：分享圖的設定與格式。
- [Show HN guidelines](https://news.ycombinator.com/showhn.html)：試用入口與投稿內容要求。
- [Local memory launch kit](local-memory-launch-kit.md)：既有入門、證據與 release 邊界。
- [Local memory PLG](local-memory-plg.md)：後續真人採用試驗與原有起跑條件。

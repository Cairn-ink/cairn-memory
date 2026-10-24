# U5b 工作線日誌

負責：第二個 Claude Code session（U5b 協調者）。範圍與規則見
[u5b-track-brief.md](u5b-track-brief.md)；目標與邊界見
[memory-next-stage-charter.md](memory-next-stage-charter.md)（主控擁有，本線不改）。
本檔只記本線的進度、決定與派工；在 `experiment/hybrid-retrieval-hr1` 上只提交這一個檔案。

## 分支與 worktree

| 用途 | 分支 | worktree | 基準 |
| --- | --- | --- | --- |
| HR-2 研究 | `experiment/hr2-assembly` | `/home/chichieh/cairn-memory-u5b-hr2` | `43a8347`（hr1 分支） |
| U5b 契約與實作 | `integration/unified-memory-v1-u5b`（尚未建立） | `/home/chichieh/cairn-memory-u5b`（尚未建立） | U5a `389512d` 或之後 |

## 2026-10-23

- **開工。** 讀完簡報、憲章、契約 §1–2／§13、TRAPS、HR-1 協議與結果。
- **HR-2 可行性量測（未派工，協調者自己做）。** 用產品的 `o200k_base` 計數器量三個凍結
  排名（A1、bge-m3+A3、3-small+F-RRF10）在 test split 的前 24 名候選：本文加全部原文片段
  最多 1,128 token，低於憲章 §6 的最小預算 1,500。**依核准的預算跑會飽和，四種組裝方式輸出
  相同。** 另外：本文最長 82 字，低於 `packRank` 的 120 字下限，P-prefix 等於 P-top；
  每筆記憶恰好表達一個事實（1,100／1,100），span-only 事實都在第一段原文片段，
  所以不需要字元區間標註。
- **Dev split 設計探針（非結果）。** 在會綁住的預算（256／512／768）下，「先覆蓋本文再加深」
  在三個排名都低於「依名次放全文」，要到預算裝得下全部才追平；「先深後廣」沒有超過 P-top；
  只放第一段原文片段在小預算有 ≤1.8 點的小幅好處。腳本與輸出放在 HR-2 分支
  `evaluation/retrieval-research/results/hr2-design-probe/`。
- **協議草案 v0.1** 寫在 HR-2 分支 `docs/plans/budgeted-assembly-hr2.md`，列出六項與憲章 §6
  的偏離（D1 預算改 256／512／768；D2 候選用凍結的 ≤24 名；D3 取消標註；D4、D5 取消
  P-prefix、P-window；D6 加 s1 與 tail 變體）。**等使用者決定後才送非作者審計與凍結。**
- 使用者提醒：兩個 session 加起來有 11 個 Codex 在跑，負載偶爾超過 40，偶發失敗變多。
  本線規則：派 Codex 或跑驗收前先看 `uptime`，load 超過約 30 就延後，和主控的完整驗收錯開。
  HR-2 不跑模型，負載很輕。
- 待使用者決定：§2 的偏離 D1–D6 是否照提案；或改做新語料（放棄凍結排名，範圍更大）。
- **簡報更新（`6ac353a1`）已拉取並照做。** 新規則：重型測試一律 `~/.local/bin/cairn-heavy <指令>`
  排隊（共用 flock，等 load < 12），完整 CI 用 `cairn-heavy ~/.local/bin/cairn-ci-matrix <worktree> <outdir>`；
  Codex worker 只跑改到的測試檔，派工單寫明不跑完整套件；派工前讀 TRAPS.md（11 條）並附進派工單；
  推研究分支前 `git pull --rebase`。協議草案 §9 已改成同樣的規則。
- HR-2 分支提交：協議草案 v0.1 與設計探針（`experiment/hr2-assembly`，見該分支 `git log`）。
- **主控決定（經跨 session 訊息，`cairn-memory-70`）：D1–D6 全部核准**，附三個條件：
  (1) 協議與結果都要先寫明外部效度：只回答「短、單一事實、證據常在原文片段」的項目，結論是 U5b 的
  **初始**預設，等有長項目語料再檢討；(2) U5b 契約不等 HR-2，現在就並行開始，暫定預設為依名次放
  全文，策略做成有版本、可替換的 policy，HR-2 只翻預設不改介面；(3) 可選的探索臂「長度壓力」：用
  foreign namespace 的文字決定性填充本文與片段，只用 BM25 重排，純探索，會拖慢就略過。
  主控同時把決定記進憲章 §5。
- 協議改為 v0.2（`0a457afe`）納入三個條件；派 `hr2_protocol_audit`（gpt-6.1-sol/xhigh，read-only，
  附 11 條 TRAPS）審計，紀錄在 HR-2 worktree `.research-private/dispatch/hr2_protocol_audit/`。
- 建 U5b 工程分支 `integration/unified-memory-v1-u5b`（worktree `/home/chichieh/cairn-memory-u5b`，
  基準 U5a `389512d`）。開始讀 U5a 實作以寫契約 §15。
- **U5b 契約 §15 草稿 v0.8** 提交在 `integration/unified-memory-v1-u5b`（`f5ee8133`）。要點：`contextRead()` 成為
  `context-read-v1` 第四個方法；建構時可給信任的 `counter:{id,countTokens}`，沒有就拒絕，不用估計器；
  整個序列化 envelope 一起計量（和 `packRank`、session context 同一條規則）；表示層 `representation-v1`
  只有本文與 receipt 兩種整單位，沒有前綴或摘要；policy 有版本、可逐次指定，初始預設
  `rank-first-whole-v1`（HR-2 P-top），另提供 `coverage-first-v1`（P-cover）；receipt 依身分或逐位元相同去重；
  最後一次 canonical 重讀後不再有 callback；MCP 加一個 `read_memory_context` 工具，host 用既有的
  keyless `o200k_base` 計數器；驗收 A01–A12，含「研究等價」A02（核心的兩個 policy 要和 HR-2 harness 逐單位相同）。
- 派 `u5b_contract_audit`（gpt-6.1-sol/xhigh，read-only，附 TRAPS）審計 §15；紀錄在 U5b worktree
  `.research-private/dispatch/u5b_contract_audit/`。HR-2 協議審計仍在跑。
- **HR-2 協議審計與凍結。** `hr2_protocol_audit`（thread `01a16966-…`）對 v0.2 提出 3 P0／7 P1／1 P2，
  所有機械主張都獨立重現。v1（`2d7b7fe6`）套用全部；複查判 **Yes**，另提四項編輯性修正 → v1.1。
  關鍵規則：整單位允入、片段只在本文已允入後排程（與契約 §15 一致；探針改規則後覆蓋率全同、15 個
  token 中位數變動）、統計經 adapter 走 `lib/stats.mjs`（95% 端點、minimumFamilies 10）、輸入要重算 hash
  並凍結輸入清單、長度壓力臂 v1 略過。
- 派 `hr2_harness`（gpt-6.1-sol/xhigh，workspace-write，無網路，附 TRAPS，只跑自己的測試檔，不跑 test split）。
- **U5b 契約審計。** `u5b_contract_audit`（thread `01a1696c-…`）對 v0.8 提出 8 P0／4 P1／1 P2，機械檢查
  （打包閉包 213／225、CLI 靜態圖 73 個模組無 SQLite 連結）都 exit 0。v0.9（`2915ec8a`，已推送）全部套用：
  計量對象改成不含診斷的 `metered` payload，由核心單一序列化器產生的字串就是 MCP 工具文字（診斷只放
  `structuredContent`）；計數器呼叫上限 `2+2U+R ≤ 1,226`；不走公開 `findCandidates`，改用外層授權下的內部搜尋
  seam；`maxItems` 只限本文、兩個 policy 的訪問順序分開寫；去重以 canonical `(role, excerpt)` 位元相等為準，
  `sameAs` 只能往前指；A02 改成「訪問順序對協議、允入對獨立 oracle」並用 U5b 自有 fixture；競態結果寫死
  （`snapshot_stale`／`scope_changed`）；U5a 兩個「恰好 7 個工具」的斷言（`966e107`，主控的）豁免並交由
  測試擁有者更新，U5b worker 不碰。複查中。
- **要問使用者／主控的事**：(1) U5a 那兩個精確工具數斷言由主控更新的流程；(2) 共用檔案
  （`cli.mjs`、`server.mjs`、`artifact-files.json`、`CHANGELOG.md`、`docs/limitations.md`）的最小增量改法與順序。
- 契約複查一：v0.9 判 No，兩個新 P0（snapshot 要逐次試算推導；`structuredContent` 不能宣稱對模型不可見）
  加一個 P1（遺漏計數與競態邊界）→ v0.9.1（`0e92245d`）。複查二：**Yes，確認可實作**，無新發現。
- 分兩部分實作：**第一部分只動 core**（facade 的 `contextRead`、組裝模組、輸入驗證、capabilities、U5b 自有
  fixture 與 oracle 測試），不碰共用檔案；**第二部分 host 接線**等使用者／主控回覆共用檔案與 U5a 兩個斷言
  的處理方式後再派。

## 2026-10-24

- **主控答覆（使用者要求我直接問主控）U5b 第二部分**：(1) 共用檔案（`adapters/mcp/cli.mjs`、`server.mjs`、
  `packaging/artifact-files.json`、`CHANGELOG.md`、`docs/limitations.md`）由我的 worker 在 U5b 分支做增量修改，
  主控合併並處理衝突；條件：每處改動獨立成塊、緊鄰既有 context-read 接線、不重排不重排版鄰行（U4b 同時在改
  同批檔案）；TRAPS 2–3；o200k 計數器只在 `--check-config` 返回後的 context 啟用路徑建構；新模組與文件進
  manifest 並對靜態 import 圖交叉核對；`core/contract.mjs`、`core/database.mjs` 不動；另一個 session 的測試與
  fixture 不動。(2) U5a 兩個斷言選 **(b)**：我的 worker 改，但要斷言確切工具名稱清單（啟用時多 `read_memory_context`，
  flag-off 清單完全不變）。交接：第二部分驗收與審查完成後告知 commit，主控在 U4a-1 與 U4b 落地後合併並跑完整矩陣。
- 派工：`u5b_impl` 第一部分（core）執行中；第二部分等第一部分提交後再派。`hr2_harness` 執行中。
- **U5b 第一部分（core）提交 `4bfd576c`**：8 個檔案（facade、input、新 `context-read-assembly.mjs`、兩個測試、
  U5b 自有 fixture、兩個測試輔助）。worker `u5b_impl` 自報與協調者重跑：兩個 Node 版本 53／53、exit 0，
  空白檢查 0。未跑完整矩陣：第一部分未把新模組加進 artifact manifest，打包閉包測試必定要等第二部分；
  完整矩陣在第二部分後以 `cairn-heavy` 跑一次。
- 派 `u5b_review_spec`／`u5b_review_standards`（read-only，乾淨 detached worktree `/home/chichieh/cairn-memory-review-u5b`
  在 `4bfd576c`）；同時派 `u5b_impl2`（第二部分 host 接線，workspace-write，含主控的條件與兩個斷言改法）。
  協調者給審查者的待評估問題：`contextRead` 是否像 `fetchCandidateEvidence` 一樣處理 `:memory:`。
- **HR-2 harness 提交 `e3401643`**（`experiment/hr2-assembly`，17 個檔案：`assembly/` 的 run／score／report／
  arms／units／auth／counter、INPUTS.md、README、五個測試、研究套件釘 tiktoken 1.0.22）。worker `hr2_harness`
  在沙箱內驗證未完成（git spawnSync EPERM；用 cairn-heavy 排隊 30 分鐘沒拿到鎖後取消）。協調者沙箱外驗證：
  兩個 Node 版本 76／76、exit 0；dev 240 格 smoke（run→score→report）全部 exit 0，A1 與 bge-m3 的覆蓋率與
  設計探針逐格相同；dev 報告判 inconclusive（家族數不足，符合協議）。
- 派 `hr2_review_spec`／`hr2_review_standards`（read-only，detached worktree `/home/chichieh/cairn-memory-review-hr2`
  在 `e3401643`）。test split 要等雙審查與修正後由協調者跑一次。
- **U5b 第二部分（host）**：worker `u5b_impl2` 改 13 個檔案（`read_memory_context`、新 `adapters/openai/context-counter.mjs`
  惰性 o200k 計數器由 `server.mjs` 注入、transport 以 `meteredText` 當唯一文字塊、診斷放 `_meta`、manifest、
  文件、changelog、limitations、兩個 U5a 斷言改成精確工具名清單、兩個新測試）。沒動 `cli.mjs`（中央注入涵蓋 CLI 路徑）。
  worker 沙箱內 23 通過 1 失敗（loopback EPERM）；協調者沙箱外四個相關測試檔兩個 Node 版本全過（17／17）。
  提交、推送；開 `/home/chichieh/cairn-memory-review-u5b2`（審查）與 `/home/chichieh/cairn-memory-ci-u5b`（驗收）。
  給審查者的待評估問題：MCP adapter 靜態引入 plugin 的 `redact.mjs` 並對 query 做 redaction；`server.mjs` 靜態
  引入 counter 模組使 flag-off 啟動也載入 tiktoken。
- **審查結果（四份，都判 No，無運行期 P0）。** U5b 第一部分 Spec：P1×3（Card store 隔離、17 筆 receipt 順序與
  完整性、唯讀拒絕矩陣）＋P2；Standards：P0（測試用 `git show c863e9d6:…` 讀另一分支，乾淨 CI 會失敗）、P1（競態
  測試依賴子程序延遲 < 5 s deadline）、P2。兩位都確認 `:memory:` 回 `index_unavailable`、計數器呼叫 818 = 2+2U、
  manifest 只缺 `core/context-read-assembly.mjs`（第二部分已加）。HR-2 harness Spec：P0（report 不驗 provenance，
  壞輸入仍判 confirmatory）＋P2×2；Standards：P1×2（score 不重放排程；實作身分未比對）＋P2×3（含 480→240）。
- 派修正輪：`u5b_impl` fix1（resume，只動 core 測試與 fixture）、`hr2_harness` fix1（resume）。
  U5b 第二部分雙審查與完整矩陣仍在跑。
- **修正輪一提交。** U5b core `9b9e9d4c`（6 檔；協調者沙箱外 85／85 兩版本；協調者自己去掉 vendored 協議 fixture
  的檔尾空行並更新 hash）。HR-2 harness（14 檔；127／127 兩版本；dev 240 格重跑 exit 0；markdown 3.6 MB→254 KB，
  JSON 243 MB 正式跑時要 xz）。兩邊都已 resume 原審查者複查。U5b 第二部分雙審查與完整矩陣仍在跑。
- **U5b 第二部分審查（`1a589129`）**：Standards **yes**（共用檔案改動區塊化、manifest 215／227 閉包一致、CLI 靜態圖
  無 SQLite）；Spec **No**，三個 P0：(1) `server.mjs` 靜態引入 counter 模組使 flag-off 啟動載入 tiktoken／WASM，
  違反 A01 並與 `source-snapshot.test.mjs` 衝突；(2) 組裝工具對 query 做 redaction，排名與 `find_memory_candidates`
  不一致且會洗掉核心該拒絕的輸入；(3) 組裝錯誤的 `details.candidates` 診斷進了文字塊。派 `u5b_impl2` fix1（resume）。
  1a589129 的完整矩陣繼續跑作早期訊號，最終 commit 要再跑一次。
- **複查結果**：U5b 第一部分 `9b9e9d4c` Spec／Standards 都 **yes**；HR-2 harness `241fad89` Spec／Standards 都 **yes**
  （harness 通過雙審查，協調者可以跑 test grid）。U5b 第二部分 fix1 協調者沙箱外驗證：7 個測試檔兩版本 40／40
  （含 `source-snapshot`、`installed-import-closure`、`raw-installed-lifecycle`），提交、推送，派兩位審查者複查。
- **HR-2 test grid 由協調者執行**（`experiment/hr2-assembly` `241fad89`，乾淨工作樹）：run→score→report 寫到
  `evaluation/retrieval-research/results/hr2-final/`。
- **HR-2 完成。** test grid 一次跑完（240 格、run→score→report 都 exit 0）。主要比較 P-cover − P-top（bge-m3+A3、
  O=0、B=512）：**−2.5 點，95% CI [−6.6, +1.5]**，29 家族、每類 ≥12 → **依名次放全文維持 U5b 初始預設**。
  類別差 C3 −20、C5 +2.8。探索：小預算（128–384）coverage-first 落後 16–29 點、CI 不含 0；768 以上各臂相同；
  只放第一段 receipt 的 P-top-s1 從未落後、在 128 時多 3–4 點（CI 下界 >0）；P-top+tail 與 P-top 差 ≤1.2 點。
  機制：40% span-only 群組的本文是沒答案的指標。結果文件 `docs/plans/budgeted-assembly-hr2-results.md`、
  limitations 條目、壓縮結果（6.6 MB，含 SHA256SUMS.uncompressed）提交在 `experiment/hr2-assembly`。
  身分欄位 `dirty:true` 是 run 自己產生的未追蹤輸出造成，乾淨 checkout 的 source hash 相同。
- **U5b 第二部分複查**：Standards yes；Spec No，新 P0：`contextCounter` 變成必填，既有程式化呼叫
  `createCairnServer({path,namespace,contextRead})` 會壞。派 fix2：改選配、缺省時 server 自己非同步載入並注入
  惰性計數器（載好前組裝回 `token_count_unavailable`），CLI 照舊先 await。
- `1a589129` 矩陣（修正前）Node 22：mcp 1 失敗＝已修的 tokenizer 載入測試；artifact 2 失敗（B4c、H5，與 context
  無關，負載 9 時）要在最終 commit 的矩陣確認是否為 flake。Node 24 進行中。
- **U5b 第二部分 fix2 提交 `a5194967`**（`contextCounter` 改選配、server 惰性注入、`contextCounterReady`），
  協調者沙箱外 7 個測試檔兩版本 41／41。文件 commit `aeae00e8`：契約 §15 證據狀態、`docs/limitations.md`、
  `docs/context-read-local.md` 改記 HR-2 已跑、預設維持。**候選最終 commit：`aeae00e8`**（已推送）。
  派 Spec／Standards 第二次複查；完整矩陣以 `cairn-heavy` 排在 `/home/chichieh/cairn-memory-ci-u5b`（aeae00e8）。
- `1a589129` 矩陣結果：100 工作 97 通過；3 個失敗＝tokenizer 載入測試（兩版本，已修）＋Node 22 artifact 兩個
  （`local-host` B4c、`mcp-capture-deadline` H5），單獨重跑 8／8、1／1 通過，判為負載 9 時的 flake。
- **U5b 完成，交接 commit `aeae00e8`**（`integration/unified-memory-v1-u5b`，基準 U5a `389512d`）。第二部分第二次複查
  Spec／Standards 都 **yes**。完整矩陣（`cairn-heavy`，worktree `/home/chichieh/cairn-memory-ci-u5b`）：100 工作 99 通過；
  唯一失敗 Node 22 `test:artifact` 的 R29（`topic-overview-raw29.test.mjs`，另一 session 的 Worker closure 測試），
  單獨重跑 3／3 通過（負載 14.5），判 flake；Node 24 同套件全過。plugin-validation N/A（無 native claude binary，
  與主控矩陣相同）。本地無 Node 20，同 CI 缺口。
- 交接訊息（含 HR-2 結果與 U5b 最終 commit）發給主控，待放行。
- 2026-10-24 主控訊息送達（`docs/plans/primary-to-u5b.md` 7be03118 同文）：要求第二部分動 `cli.mjs`／`server.mjs` 前先合
  `integration/unified-memory-v1` 的 `1d32bf75`（含 U4a-1 修正、契約 §16、U4b `--assets local-v1` 五個資產工具、U5a、
  preview 修正），並在 `packaging/test/assets-host.test.mjs` 以確切名稱補 `read_memory_context`。訊息先前過期，第二部分已在
  U5a 基準完成，故由協調者自己合併：**merge commit `0a38a991`**（已推送）。四個衝突檔都是「兩邊保留」：`cli.mjs` 保留
  計數器注入並讓傳輸選擇／262144 緩衝也認 `config.assets`；`server.mjs` 同時接受 `contextCounter` 與 `assets`，assets 進
  `openMemoryCore` 與 `buildCairnServer`，組裝分支與 `ASSET_TOOL_NAMES` 並存；CHANGELOG 與契約 §15／§16 串接。
  `assets-host.test.mjs` L01 的 `contextTools` 加入 `read_memory_context`（四個 context 組合全為確切清單）。合併樹上
  adapters/mcp context-read 兩檔 17／17、packaging 三檔 68／68（exit 0）。完整矩陣以 `cairn-heavy` 排在
  `/home/chichieh/cairn-memory-ci-u5b`（0a38a991，乾淨 detached checkout，離線 `npm ci` adapters/mcp、adapters/openai）。
  已回覆主控（訊息待放行）。
- 主控煙霧測試 `0a38a991` 安裝包通過（13 工具、`read_memory_context` 正常），但報 P2：小記憶的表示法開銷過大
  （256 預算 0 筆、512 才 1 筆）。協調者以真實 o200k 計數器在合併樹實測（15 token 本文、一條等於本文的 receipt）：
  總計 488–497；信封 84、item 162–169（ref 55、metadata 32、sources 30、body 21）、**snapshot 236–251 且每多一筆 +90**
  （base64url 每筆一個 fence）。每多一筆約 250 token，本文只佔 15；snapshot 一項大於主控點名的三項總和。
- 提 U5b-2 範圍給主控（1 snapshot 移出計量文字＋壓縮、2 精簡 ref、3 metadata 只留非預設、4 `sameAsBody`、5 信封精簡、
  6 HR-2 以真實開銷模型重跑探索曲線、7 P-top-s1 政策非預設）。**主控核准**：A 包 1–5、B 包 6–7；條件：snapshot 只放
  `_meta`（不開第二個 content block）、先查是否有流程需模型回傳 snapshot、v2 取代 v1 不並存（`read_memory_context` 在
  `v1-preview.2` 標 experimental）、`sameAsBody` 不丟 receipt 且要有可讀性測試；分支待主控 fast-forward 並發 preview.2
  後再開。查證：唯一需模型回傳 snapshot 的流程是 `read_memory_context` → `fetch_memory_candidate_evidence({snapshot})`，
  v2 改由精簡 ref（`{ns,type,id,rev}`，fetch 工具在 MCP 層加收此形式並展開，core 不動）作為模型的重取路徑。
- §15.8 v0.10 修正案草稿完成（`.research-private/dispatch/u5b2_contract/amendment-v0.10-draft.md`，尚未提交），
  含 A13–A19 驗收與 HR-2 addendum（`--overhead-model host-v2`）。等主控給基準 commit 後開 `integration/unified-memory-v1-u5b2`、
  提交、派非作者稽核。`0a38a991` 矩陣仍在跑。
- **`0a38a991` 完整矩陣：100 工作全部 exit 0**（`cairn-heavy`，乾淨 detached worktree，Node 22.16.0／24.15.0 各 50，前後
  dirty=0，記錄的最高負載 6.78），無 flake、無需單獨重跑；plugin-validation N/A 同前。已回報主控。主控的合併解法審查
  （非作者）yes，無發現；主控要求 A15 再加兩案（精簡 ref 指到已變更修訂必須以 §13.6 的碼明顯失敗、`ns` 索引經主機
  read set 重新授權），已補進草稿。等主控 fast-forward 到 `0a38a991`、發 `v1-preview.2`、給基準 commit。
- 主控已將 `integration/unified-memory-v1` fast-forward 至 `0a38a991`（preview.2 只改 `release/v1-preview` 的指南）。
  開 `integration/unified-memory-v1-u5b2`（worktree `/home/chichieh/cairn-memory-u5b2`），**§15.8 v0.10 草稿提交 `fa94af58`**
  （僅契約 +233 行與一行狀態），已推送。派非作者稽核 `u5b2_contract_audit`（gpt-6.1-sol/xhigh，read-only，乾淨 detached
  worktree `/home/chichieh/cairn-memory-review-u5b2c`，派工單附 TRAPS 11 條），明列主控條件 (4)：精簡 ref 路徑必須與 snapshot
  路徑同等一致性（追 `fetchCandidateEvidence` 各變更類型的確切錯誤碼）、`ns` 經固定 read set 重新授權。派出時負載 0.4。
- **§15.8 稽核結果**（`u5b2_contract_audit`，exit 0）：3 P0、5 P1、1 P2。P0-1：精簡 ref 展開成完整 ref 後只有「精確修訂＋意圖
  資格」語意，同修訂的 receipt 刪除與 MOC 父節點搬移不會升修訂、完整 ref 路徑看不到（snapshot 路徑靠 generations＋fence
  才看得到）；稽核追出各變更類型的確切錯誤碼（修正／filing 變更→`revision_conflict`、supersession→`evidence_unavailable`
  （current）／`revision_conflict`（history）、forget／刪除→`evidence_unavailable`、Card 資格先於修訂）。P0-2：A16 要求診斷與
  fetch 回傳 receipt 全文，但 §13 fetch 只回 receipt 參照。P0-3：序列化缺規範（key 順序、巢狀排序、永遠輸出的欄位）。
  P1：授權順序與 read-set 映射生命週期、最終驗證接縫（既有程式用 wire ref 比對會變空）、A13 常數定義不足且 `arms.mjs` 的
  純量 O 無法表達 host-v2、A17–A19 遷移範圍（fixture 的 `reviewState:'not-required'` 錯誤；五個待改檔）、「becomes stable」
  越權；P2：fence 是 43 字元 base64url。
- 把 P0-1 兩個方案提給主控（1：精簡 ref 帶 48-bit fence 前綴 `f`，約 7 token／筆；2：接受較弱語意並寫明）。**主控選 1**，
  條件：mismatch 回既有 `snapshot_stale` 且不得退回無 fence 路徑；A15 加四個測試（同修訂刪 receipt、MOC 搬移、`f` 錯一字、
  缺 `f`→`invalid_input`）；寫明 `f` 是偵測用截斷 HMAC、48 bit、非授權、外洩無害；generations 留在主機端 snapshot。
  `v1-preview.2` 已發（`4e53d1dc`，`read_memory_context` 標 experimental）。
- **§15.8 v0.10.1 提交 `165d7f99`**（+176／−66，全在 §15.8）：套用全部稽核發現＋主控四條件；新增規範序列化、最終驗證接縫、
  不可變啟動 read-set 映射的授權順序、無 receipt 文字的診斷、A13 以 T0／T1／T2 差分定義常數、A15 逐變更類型×意圖的碼、
  A16 經工具描述證明可讀、A17–A19 遷移範圍（八個可改檔）、host-v2 獨立成本函數且以身分排除於 O=0 確認性比較。
  派複查（resume 同一 thread，worktree 移到 `165d7f99`），負載 0.5。已回報主控。
- **v0.10.1 複查**：未確認，三個阻斷項＋一個新 P1。(1) `f` 的驗證不能放在工具層：`bind`／`read`／`fetchInside` 都是 facade
  私有閉包，core 不動就無法在交易內比對；且 item fence 只涵蓋 canonical DTO（只有 `filing.status`，無 MOC 成員），filed→filed
  的父節點搬移只升 namespace epoch，fence 看不到。(5) host-v2 成本式重複計算本文。(7) A15 Card 變更矩陣的碼錯（history 下
  support 喪失是 `revision_conflict`／`snapshot_stale`）。另修正「`f` 外洩無害」為「穩定的帶鑰指紋，揭露相等／變更資訊，
  非明文或鑰匙；2⁻⁴⁸ 漏判、M/2⁴⁸ 聯集界；偵測意外變更，非對抗性完整性」。
- 提主控：父節點搬移 (1) 文件化為兩路徑的已知差異（精簡 ref fetch 位元相同成功、snapshot fetch `snapshot_stale`），
  (2) fence 納入 membership（需動 U5a 的 evidence reader），(3) 每個 ref 帶 namespace generation（太脆弱，我反對）。
  **主控選 (1)**，撤回「MOC 搬移→`snapshot_stale`」；核准 core `fetchCandidateEvidence` 加選配對齊的 `fences` 前綴向量，
  條件：無向量的呼叫位元相同且 U5a 既有測試不改、MCP 只能經精簡 ref 展開到達（呼叫端自帶向量或與完整 ref／snapshot
  並用→`invalid_input`）、向量納入授權 payload；兩處措辭修正照稽核者版本。
- **§15.8 v0.10.2 提交 `22a017f5`**（+80／−27）：fence 驗證移入 core（兩次 `fetchInside` 都比對）、父節點搬移寫成文件化差異
  （§15.8.3、§15.8.6、A15、limitations）、`refs` schema 保留原完整 ref 分支不變（SDK 先驗證，`server.mjs:226`）、相容性放寬
  為「合法輸入位元相同、不合法輸入同拒絕類別與碼、訊息文字差異需回報」、A15 Card 逐意圖的碼、host-v2 成本式改為
  `E + h1 + (n−1)·hN + Σ本文 + Σ具體 receipt (C−15+excerpt) + Σ alias A`、`score.mjs` 加 host-v2 重算驗證。派第二次複查
  （同 thread，worktree `22a017f5`），負載 0.2。
- **v0.10.2 第二次複查**：阻斷項 1、3、5、7 全部 resolved（core `fences` 機制、父節點搬移差異、`f` 指紋描述、schema 原分支
  保留與相容性放寬——稽核者確認 U5a 測試沒有鎖定驗證訊息位元、成本式、Card 矩陣）；新 P1：A15 對 snapshot 路徑一律期望
  `snapshot_stale` 太寬，canonical 重取本身失敗時既有 §13.6 錯誤優先（current 下同修訂 Card support 喪失→
  `evidence_unavailable`，history→`snapshot_stale`）。**v0.10.3 提交 `ccc9602a`**（只改 A15 那句與狀態行），派第三次短複查。
- **v0.10.3 第三次複查：confirmed，無阻斷項**。狀態改為已確認，**契約 commit `f6bc33f6`**（已推送，回報主控備查）。
  稽核軌跡：v0.10 `fa94af58` → v0.10.1 `165d7f99` → v0.10.2 `22a017f5` → v0.10.3 `ccc9602a` → 狀態 `f6bc33f6`。
- **派 A 包實作 worker `u5b2_impl`**（gpt-6.1-sol/xhigh，workspace-write，`/home/chichieh/cairn-memory-u5b2` at `f6bc33f6`，
  離線 `npm ci` adapters/mcp＋adapters/openai 已裝，zod 4.5.4）。派工單：主控預核的共用檔案清單、`cli.mjs`／`server.mjs`／
  `core/contract.mjs`／`core/database.mjs` 不動、U5a 必不改測試逐一點名、`fences` 向量是 fetch 唯一改動、zod 原分支不變、
  limitations 記父節點搬移差異、只跑改到的測試檔、TRAPS 11 條。派出時負載 2.8。
- **A 包 worker 完成（未提交，exit 0）**：15 個檔案（13 修改＋`overhead-host-v2.json`＋報告檔），共用檔案只有 tools／
  transport／docs／CHANGELOG／limitations，無新模組、manifest 不動；closure 220／manifest 233／missing 0；靜態 CLI 圖 82 模組
  無 `node:sqlite`。受影響測試兩版本各 69 過 1 敗：唯一失敗是 A13 門檻（實測 envelope 43、firstItem 83、furtherItem 82
  對估計上限 40／90／80；worker 依「規範序列化優先」不改框架也不放寬斷言，留給協調者）。協調者沙箱外重跑：assembly
  三檔＋MCP＋packaging 同結果；U5a 的 core context-read 十個測試檔、`adapters/mcp` 與 `packaging` 的 context-read、
  `assets-host` 全過（兩版本）。
- **契約 v0.10.4 提交 `c646c4cc`**：只改 A13 三個數字為實測值加約 10% 餘裕（48／96／90），理由寫在 A13；無規則變動，
  隨實作一起交雙審查。resume worker 做 fix1：只改 A13 斷言數字並重跑該檔。
- fix1 第一次 resume 因未先 `cd` 進 worktree（沙箱只允許寫 hr1）沒動任何檔；重跑後 worker 只改 A13 斷言為 48／96／90，
  該檔兩版本 19／19。協調者重驗同結果、whitespace 0。
- **A 包實作提交 `47099de0`**（15 檔、+827／−104，含 `overhead-host-v2.json` 與 worker 報告檔，報告檔合併前移除），
  再以 `c8014883` 把實作 commit 填進 `overhead-host-v2.json`。**候選 commit `c8014883`**，已推送。
  開審查 worktree `/home/chichieh/cairn-memory-review-u5b2c`（`c8014883`，離線 `npm ci`），派 Spec／Standards 雙審查
  （gpt-6.1-sol/xhigh，read-only；派工單含 §15.8 v0.10.4 歷程、主控條件、worker 宣告的決定、A13 上限調整是否合理）。
  完整矩陣以 `cairn-heavy` 排在 `/home/chichieh/cairn-memory-ci-u5b2`（`c8014883`）。派出時負載 0.7。
- **`c8014883` 雙審查：Spec no、Standards no**。共同 P0：(1) 只有繼承屬性的精簡 ref（`Object.create({...})`）繞過描述子
  守衛，zod 讀繼承欄位後進到 core（兩位都用 SDK `InMemoryTransport` 重現，繼承 getter 被執行）；(2) 外層無條件
  `types.isProxy` 守衛改變了舊完整 ref 的行為（透明 Proxy、非 enumerable 屬性原本接受、現在被拒）。Spec 另 P0：(3) 精簡 `id`
  沿用只檢長度的 schema，前置空白／NUL／未配對代理字元會先打一次 core 才被拒；P1：A16 的一位元差異 fixture 用尾端空白，
  非 canonical（會被正規化掉）；P2：文件錨點指到 `v0103`。Standards P2：A13 測試每次執行都覆寫已提交的
  `overhead-host-v2.json`。兩位都獨立重算 T0／T1／T2＝43／126／208，**接受 48／96／90 的上限調整**，確認 fence 核心實作、
  序列化（Spec 自建 812 bytes 期望字串位元相同）、closure 220／manifest 233、無 SQLite 連結、A19 範圍。
- 派 fix2（resume，六項），`c8014883` 的矩陣停掉（跑了 12 工作全 0，無意義留存），最終 commit 再跑完整矩陣。
- **fix2 完成**（worker 六項全修，core 20／20、MCP 43／43 兩版本）：精簡 ref 候選一律先以 `ownData()` 驗原始描述子（繼承資料
  ／繼承 accessor／own accessor 皆 `invalid_input`，零 getter、零 core 呼叫）；舊完整 ref 以鍵存在性分派到原分支（Proxy、
  非 enumerable 屬性維持原接受行為），移除 `types.isProxy`；精簡 `id` 加 core `identifier()` 精煉；A16 改 `Own body!`
  經 canonical 準備；文件錨點改 v0.10.4；A13 測試改為比對已提交常數檔，只有 `CAIRN_PUBLISH_ASSEMBLY_OVERHEAD=1` 才以
  temp＋rename 覆寫。協調者沙箱外八個測試檔兩版本全 exit 0、whitespace 0。
- **提交 `c9d2a486`（fix）＋`bd6e3880`（常數檔記 commit）＝新候選 `bd6e3880`**，已推送。審查 worktree 與 CI worktree 移到
  `bd6e3880`；Spec／Standards 以 resume 複查；完整矩陣以 `cairn-heavy` 排隊。派出時負載 1.3。
- **`bd6e3880` 複查：Spec no（2 P0）、Standards no（1 P0）**，其餘 round-1 發現皆 resolved（A13 不再覆寫、A16 canonical、
  精簡 id、繼承／accessor 拒絕）。剩下的都在 `context-read-tools.mjs:35–38` 的分派：Spec：(a) 用 `Object.keys` 分派，非
  enumerable 的 `ns/id/rev/f` 混進合法完整 ref 會走舊分支、`f` 被丟掉（成功、一次 core 呼叫、無 fences）；(b) `in` 檢查先觸發
  Proxy `has` trap，丟錯的 trap 讓 SDK 回原始錯誤文字而非 `invalid_input`。Standards：(c) `in` 預檢是原本舊解析器沒有的可觀察
  操作，兩個刁鑽的 Proxy／getter 舊輸入由接受變拒絕。三者方向相反，協調者定折衷設計派 fix3：舊 schema 原樣先跑（零前置
  檢查）→ 成功後以 `Reflect.ownKeys` 查保留的精簡鍵名（含非 enumerable）拒 hybrid → 失敗才走 `ownData()` 描述子驗證與精簡
  schema → 整個 preprocess try/catch 轉 `invalid_input`（唯一的舊輸入行為變更：原本會崩潰的 throwing trap 改為乾淨拒絕，
  需記錄）。`bd6e3880` 的矩陣停掉（跑了 3 工作全 0）。
- **fix3 完成**（折衷分派照設計實作：原舊 union `safeParse` 零前置檢查先跑；成功後 `Reflect.ownKeys` 查保留精簡鍵名拒
  hybrid；失敗才 `ownData()` 描述子驗證＋精簡 schema；整個 preprocess try/catch 轉 `invalid_input`；差異化 SDK 測試涵蓋兩位審查
  的案例與 trap 錯誤文字不外洩）。MCP 43／43 兩版本；協調者沙箱外六個測試檔兩版本全 exit 0、whitespace 0。
- **提交 `42627f60`（fix）＋`7a3ad58e`（常數檔記 commit）＝新候選 `7a3ad58e`**，已推送。審查／CI worktree 移到 `7a3ad58e`；
  Spec／Standards 第二次複查（resume）；完整矩陣以 `cairn-heavy` 排隊。派出時負載 1.6。
- **`7a3ad58e` 第二次複查：Spec yes、Standards yes**，無新 P0／P1。兩位都透過真實 SDK 在兩個 Node 版本重現全部案例：
  非 enumerable hybrid→`invalid_input` 零 core 呼叫；throwing `has`／`get`／`ownKeys` trap→乾淨 `invalid_input` 無錯誤文字
  外洩；get-enables-has Proxy 與 `type` getter 定義 `memoryId` 的舊輸入接受行為與 core 輸入位元不變；精簡 ref 全非
  enumerable 欄位仍正確展開並帶 fences。記錄在案的偏差（原本崩潰的 throwing trap 改為乾淨拒絕）兩軸都接受。
  已回報主控（含歷程、常數、共用檔案清單），並問 worker 報告檔要由我移除還是合併時由主控丟棄。矩陣仍在跑。
- **`7a3ad58e` 完整矩陣：100 工作全部 exit 0**（`cairn-heavy`，乾淨 detached worktree，Node 22.16.0／24.15.0 各 50，前後
  dirty=0，記錄最高負載 6.46，plugin-validation N/A 同前），無 flake。依主控要求移除根目錄的 worker 報告檔（內容保存在
  `.research-private/dispatch/u5b2_impl/report-final.txt`）：**A 包最終 commit `b18dabe0`**（＝`7a3ad58e` − 報告檔，
  `git diff --check` 0），已推送並交給主控；主控合併前會在最終 commit 跑 validate／test:artifact／import guards／diff --check。
- **A 包成果**：單筆 15-token 記憶的計量文字 488→126 token；每筆開銷約 250→82；U5a 測試零修改全過；契約 §15.8 v0.10.4。
  B 包（HR-2 `host-v2` 重跑、P-top-s1 已在 A 包以非預設政策落地）待主控合併後開始，只動研究分支。
- **A 包合併並發布**：主控 fast-forward 整合分支到 `b18dabe0`，`v1-preview.3` 發於 `7197d800`，`read_memory_context`（v2）與
  精簡 ref fetch 成為穩定的 preview 介面。主控安裝包煙霧測試四項皆符合規格（256 預算放進兩筆用 242 token；`f` 錯一字→
  `snapshot_stale`；缺 `f`→`invalid_input`；`correct_memory` 後舊 ref→`revision_conflict`、重讀得 revision 2）。
- **B 包開始**（研究分支 `experiment/hr2-assembly`）：複製 `overhead-host-v2.json`（sha256 `5eba1bd4…` 與 `b18dabe0` 一致）；
  寫協定 **v1.2 §11「host-v2 exploratory extension」**（只加 §11，§§1–10 不動、§4 不重開；成本模型 `E + Σ(body: tokens +
  h1／hN) + Σ(span: C−bodyTokens + tokens | alias A)`；120 cells；`run.overhead='host-v2'` 字串使之永遠進不了確認性比較；
  輸出 results v1.1、`results/hr2-host-v2/`、limitations 一句），草稿提交 **`2f69c7a5`** 已推送。派非作者稽核 `hr2_ext_audit`
  （read-only，乾淨 worktree `/home/chichieh/cairn-memory-review-hr2`），負載 0.2。
- **§11 稽核**（`hr2_ext_audit`，exit 0）：無 P0；P1：(1) 要兩條嚴格驗證分支（舊數值 O 分支不動；host-v2 分支驗 model 的
  commit／sha256／常數／bodyTokens，模型 digest 進比較身分，確認性選擇器維持數值 `overhead===0`，混模型拒絕）；(2) 舊結果
  回歸要定義為「去掉 scorer 身分後位元相同」＋報告統計精確相等，不得覆寫凍結產物；(3) 揭露近似模型的結構限制
  （`rank`／`sourcesComplete:false` 已含在校準中；C／A 含第一條 receipt 的完整性轉換；後續轉換、跨 item `sameAs`、非預設
  metadata、Card、UUID 變異未建模；稽核者量到雙 receipt 164 對模型 160）；(4) 定義 48 個配對對比、逐點未校正探索性 CI、
  飽和門檻與被拒單元計數。P2：`B<E` 先拒、「第一筆」跨 pass 定義、P-top+tail 試探性 bundle；檔名加 `@42627f60`、記
  `extensionCommit`。稽核者獨立驗證 sha256、C=22（加在 body-only 上）、C−15=7、A=10、h1=58、hN=57 皆正確。
- **協定 v1.2.1 提交 `598d6c53`**（六項全套用，只動 §11 與標頭註記），已推送；派複查（resume）。負載 0.1。
- **§11 複查：六項全 resolved，無新 P0／P1，「can be frozen: yes」**。**凍結 commit `4fb90832`**（只改狀態行；即
  `run.extensionCommit`），已推送。派 harness worker `hr2_ext_harness`（workspace-write，worktree
  `/home/chichieh/cairn-memory-u5b-hr2`，派工單：成本模型抽象＋host-v2、兩條嚴格驗證分支、report 排除與 48 對比／飽和／
  被拒計數、README／INPUTS、240 個封存 cell 的回歸測試、只跑改到的測試檔、不得跑 test split、TRAPS）。
- **host-v2 harness worker 完成**（12 檔：arms／cost／host-v2／run／score／provenance／report／README／INPUTS／報告檔＋兩個新
  測試檔）。worker 自測 55／55＋舊結果回歸 240／240 兩版本；協調者沙箱外全套 `test/assembly-*.test.mjs` **183／183 兩版本
  exit 0**、whitespace 0，dev split host-v2 煙霧 run→score→report 全 exit 0（45 cells、18 對比、outcome inconclusive 如預期）。
  **提交 `5d0a344b`**（已推送）；審查 worktree 移到 `5d0a344b`，派 Spec／Standards 雙審查（read-only）。
- **`5d0a344b` 雙審查：Spec yes（零發現，審查者手算 toy case 每個 arm 的 admission 與 used 皆符）；Standards no（1 P1）**：
  三個 stage 的輸出路徑未受保護——`score.mjs --out` 可覆寫常數檔、`report.mjs --markdown` 可覆寫 `results/hr2-final/report.md`；
  README 前段仍留著指向凍結結果的可執行舊指令。其餘（2,003 個受保護檔不變、常數 hash 一致、舊數值分支未放寬、回歸測試
  方法正確、測試品質）皆確認。派 fix1：共用輸出路徑守衛（realpath、拒常數檔／`hr2-final`／`test-final`／fixtures／既有檔）、
  README 舊指令標為歷史紀錄、每類拒絕測試含位元不變斷言。
- **fix1 完成**（共用 `output-paths.mjs` 實體路徑守衛；三個 stage 寫入前預檢；README 舊指令標歷史；33 個拒絕／位元不變測試）。
  協調者沙箱外全套 assembly 測試兩版本 exit 0。**提交 `14fdacb5`**（已推送），審查 worktree 移到 `14fdacb5`，派 Spec／Standards 複查。
- **`14fdacb5` 複查：Spec yes、Standards yes**，無新 P0／P1（守衛涵蓋三個 stage 全部寫入路徑、實體路徑解析正確、2,003 個受保護
  檔不變、常數 hash 一致、數值分支與回歸測試未動）。**啟動 §11 正式跑**：乾淨 checkout `14fdacb5`（主 worktree，status 乾淨，
  Node 22.16.0），照 README 協調者指令（preflight → extract → run → score → report → hashes → 封存，各 stage 經 `cairn-heavy`、
  記實際 exit code）。派出時負載 0.7。
- **§11 正式跑完成**（乾淨 checkout `14fdacb5`，九個 stage 全 exit 0，`cells:120`、`comparisons:48`、host-only 報告 outcome
  `inconclusive (primary_cell_absent)` 如規格）。結果：host-v2 下 coverage-first 在 192–512 落後 rank-first 4–15 點、768–1536
  落後 **12–27 點**（三個 ranking 的 CI 都不含 0），因每筆 57–58 的表示開銷讓 bodies-first 永遠擠不出 receipt 的空間；
  P-top-s1 從未更差、+0.3–2.3 點（只有 bge-m3@256 的 CI 不含 0）；**三個 ranking 到 1536 都未飽和**（每個 cell 有 89–94／160
  題至少一個單元被拒）；body-equal span 0。§1 確認性結論不變。
- **results v1.1 §7＋limitations 一句＋`results/hr2-host-v2/` 封存（壓縮 cells／scores／report、report.md、兩個 hash 檔、各
  stage command／exit／log、preflight）提交 `a442215d`**，已推送。派 Spec 審查者做數字轉錄核對（非作者）後再交主控。
- **results v1.1 轉錄核對**（非作者，Spec 審查者）：15 列 120 個 macro 值、48 個對比與 CI、McNemar、飽和、hash（3／3 封存、
  123／123 未壓縮）全部正確；§§1–6 位元不變。四個 P1 轉錄錯誤：test split 是 94 題非 160；token use p50 範圍 0.74–1.00；
  1536 的 s1 例外只在 bge-m3；preflight 與九個 stage log 被 `.log` ignore 規則擋掉未進 commit，且只有 run／score／report
  經 cairn-heavy。兩個 P2：機制措辭、limitations 句子要與 §11.4 字面相同。全部修正，log 以 `git add -f` 補進，
  **results v1.1 最終 commit `8ed4dadb`**，已推送。
- **B 包完成並交接**：results v1.1 `8ed4dadb` 連同歷程、結論摘要與章程 §6 建議句送給主控；審查／CI worktree 保留待主控
  驗證後移除。U5b-2 A、B 兩包在協調者這邊全部結束。
- **主控新派工：HR-2b**（長項目 fixture，決定 `rank-first-first-source-v1` 是否在 host-v2 下成為預設；離線、合成、只動研究
  分支、不付費）。主控已接受 HR-2 v1.1 並更新章程（`6de7dd46`）；三個審查／CI worktree 已移除。**HR-2b 協定 v0.1 草稿提交
  `9b3095cb`**（`experiment/hr2-assembly`）：新 fixture `hr2b-fixture-v1`（沿用 HR-1 schema；本文 120–400 token、2–4 事實、1–6 筆
  receipt 各 40–200 token；證據位置 body／第一筆／之後 45／25／30；作者撰寫的無事實同領域填充句取代被否決的 §6.1 外部
  namespace 填充；160 目標＋320 干擾＋60 foreign；W1／W2／W3 獨立）；排名只用免費的 A1 與本機 bge-m3＋A3；預註冊規則：
  P-top-s1 − P-top 在 bge-m3＋A3／1,500／host-v2 ≥ +3 且 CI 下界 > 0、且 later-receipt 層 CI 下界 ≥ −5 才 Adopt。
  派非作者稽核 `hr2b_protocol_audit`。
- **HR-2b v0.1 稽核**：4 P0、6 P1、1 P2。P0：「schema 不變、一行改動」不成立（validator 寫死 300／700／100、1–3 spans、
  35–45% span-only，版本常數要傳遍工具）；排名只索引本文（A1／A2／A3 的 `includeForArm`）、`S-long` 會被拒、需預註冊固定
  配置；placement 要從 W3 審後的 eligible members 分類而非 builder 抽樣（`span:null`、receipt 依 eventTime 排序）；guard 層
  配額要符合 bootstrap 的每類別 ≥10 families。P1：guard 的數學意義（strict later-only 群 P-top-s1 覆蓋恆為 0）、生成器凍結細節、
  詞彙排除無法證明無事實（需凍結禁用詞典＋W3 語意審）、harness 耦合要以認證的 protocol profile 列舉、host-v2 常數對長
  receipt 是外推要先校準並公布誤差、凍結順序衝突。P2：成本算術（最小 5,420／中點約 16,300）與 maxItems 說明。
  **v0.2 提交 `b4c31dd3`**（全部套用），派複查（resume）。
- **HR-2b v0.2 複查**：11 項中 8 項 resolved、無新 P0；殘留 P1：§7 仍寫 placement 來自 builder 紀錄（與審後標籤規則矛盾）、
  生成器驗收同時要求讀 query 的配額又宣稱不讀 query（改為兩階段：W1 檢查只讀 facts／corpus，協調者配額驗證讀 query 與
  W3 後標籤，凍結候選 seed 序列）、§9 步驟 2 的 dev 檢查順序（改為只用 toy 或舊 dev 輸入）；P2：中點成本應約 13,300。
  **v0.3 提交 `58425923`**，派第二次複查。
- **HR-2b v0.3 第二次複查：全部 resolved，無新 P0／P1，「can be frozen: yes」。協定 v1 凍結 commit `c546bfc1`**（只改狀態行），
  已推送。派 §8 工具／harness worker `hr2b_tools`（版本化驗證 profile、排名 harness 接受新 fixture 並寫固定配置、認證的
  assembly protocol profile 與 §4 決策選擇器、host-v2 校準工具、240＋120 兩個回歸、HR-1 輸出位元不變測試）。
- **hr2b_tools worker 完成（未提交）**：33 檔；worker 自測 31／31＋240／240＋120／120。協調者沙箱外跑**整個研究測試目錄**
  （28 檔）兩版本：365 過 **19 敗**，全在 worker 沒跑的 HR-1 harness 測試：`arms-contracts`（13 敗：`frozen_selection_required`
  必須在讀 fixture 之前拋出，worker 的 `run.mjs` 先讀了 fixture）、`arms-isolation`（2 敗：`unsupported_fixture_version` 拒了
  HR-1 的 toy fixture）、`arms-runner`／`arms-security`（CLI 不再寫出 artifact）、`assembly-output-paths`（2 個正向 scratch 案例
  被新守衛誤拒）。乾淨凍結 commit 上同檔全過 → 確認是回歸。派 fix1（最小修正、HR-2b 行為放在既有 gate 之後、這輪必跑全部
  28 個研究測試檔）。
- **hr2b_tools fix1 完成**：19 個回歸全修（選擇 gate 回到讀 fixture 之前；無版本的舊 fixture 投影恢復；scratch 管線恢復），worker
  跑完 28 檔（沙箱內 15 個 loopback EPERM 屬沙箱）。協調者沙箱外全目錄兩版本 **386 過、0 敗、1 skip（opt-in 模型煙霧）**，
  含 240／120 兩個回歸。**提交 `c7ee6f9e`**（33 檔），已推送；審查 worktree 移到 `c7ee6f9e`，派 Spec／Standards 雙審查。
- **`c7ee6f9e` 雙審查：Spec no（1 P0、2 P1）、Standards no（3 P1、2 P2）**。Spec P0：W3 的 drop／recategorize 覆寫走不完
  HR-2b 管線（排名認證用原始題目集、runner 排除 dropped 題目→`rankings_query_set`；評分要求標籤類別等於題目類別→配對
  recategorize 被 `label_query_metadata` 拒）。Spec P1：absent 事實未納入禁用詞典掃描；「只在第一筆」允許後面 receipt 也支持。
  Standards P1：guard 層成員未經標籤認證（可修剪家族）；host 重播信任 cell 自帶的 `assemblyItems` 文字；receipt 排序比字串
  非時間點（時區偏移）。P2：固定配置淺凍結可被改、profile 常數多處重複。其餘（HR-1 位元不變、序列化 32 個 probe 與
  `b18dabe0` 一致、兩個回歸、選擇 gate）確認。派 fix2（八項，重跑 28 檔）。
- **hr2b_tools fix2 完成**（八項全修：審後題目投影、全事實詞典、混合支持拒絕、guard 層由認證標籤推導、host 重播綁定認證
  語料、時間點排序、深凍結、單一約束來源）。協調者沙箱外 28 檔兩版本 **399 過、0 敗、1 skip**。**提交 `025fe2ca`**（19 檔），
  已推送；審查 worktree 移到 `025fe2ca`，派 Spec／Standards 複查。
- **`025fe2ca` 複查：Spec yes、Standards yes**，無新 P0／P1（兩位都在記憶體重現原發現並確認修好；HR-1 位元不變、驗證輸出與
  凍結 `c546bfc1` 相同、搬動的指標函式逐字相同、舊 HR-2 分支與兩個回歸未動）。**HR-2b §8 工具完成於 `025fe2ca`**。
  §9 步驟 3 開始：派 **W1 `hr2b_world_author`**（workspace-write，只寫 `fixtures-hr2b/`；≥40 目標家族 7＋1 事實；長本文、1–6
  receipt、placement 45／25／30；填充句庫與禁用詞典；候選 seed 序列；`build-world.mjs`／`check-world.mjs`）。W2／W3 派工單
  已備（W2 只看 `body`／`span-only`／`absent`，不知 receipt 位置）。派出時負載 0.2。
- **W1 完成**（36 分鐘，exit 0）：90 家族（40 目標／40 干擾／10 foreign）、1,020 事實、540 記憶；本文平均約 217 token、receipt
  約 92；receipt 直方圖 32／40／40／24／16／8（目標）符合 20／25／25／15／10／5%；placement 126／70／84＝45／25／30 精確；填充
  1,080 句、3,840 個範圍、18,297 個禁用詞掃描 0 命中；與 HR-1 語句 0 重疊。協調者重跑 build --check／check-world 皆 0、
  whitespace 0、抽樽文字為合成中文筆記與對話。產生 facts view（無文字、無記憶 id）。**提交 W1 世界 `e3fd8dba`**（未凍結）。
- 使用者指示：之後 Codex 派工改用 **fast（`service_tier="fast"`，rollout 顯示 priority）**；worker 改 `high`、審查者維持 `xhigh`。自 W2 起套用。派 W2 `hr2b_query_author`。
- **W2 完成**（high＋fast，約 15 分鐘）：160 題（140 計分、10 C8、10 foreign），語言 96／46／18，123／140 計分題需要 span-only
  事實、涵蓋全部 40 個目標家族。協調者跑 split（`hr2b-split-v1`，dev 46／test 94 計分）與 labels（160）皆 0；提交 `48919651`
  （未凍結）。**審前驗證器失敗（35 錯）**：1 個 `audit:overrides`（尚無稽核檔，預期）、18 個類別機械檢查失敗（C1×6、C2×1、
  C3×7、C5×4，交 W3 裁定）、**16 個 placement 配額**：dev 兩層 groups<30／families<12；guard 每類別 ≥10 test families 只有 C3
  達標（later-receipt test 每類別 6／7／11／8／7／8／3 家族）。分析：每類別 14 題 test × 30% later 份額 ≈ 4–7 家族，七類各 ≥10
  需約 70 個 later 題家族，與 45／25／30 設計矛盾——配額本身是缺陷，換 seed 或加家族都救不了。提案 v1.1：guard 對比改為
  pooled（單一層、minimumFamilies 10）、test 層 ≥30 groups／≥12 families（已達：57／20、43／23）、dev 層 ≥4 families 無 group 下限、
  門檻與門不變。已送主控決定；派 W3（xhigh＋fast）同步稽核。

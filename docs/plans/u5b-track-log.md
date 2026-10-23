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

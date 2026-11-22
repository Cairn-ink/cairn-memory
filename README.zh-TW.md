<p align="center">
  <picture>
    <source media="(max-width: 600px)" srcset="docs/images/readme-hero-mobile.png">
    <img src="docs/images/readme-hero.png" alt="Cairn.ink Memory：可以查看與修改的 AI 記憶，Claude Code 和 Codex 共用一份。圖中是一座手繪小島，島上的石堆有三顆石頭，代表卡片、記憶、對話。開源專案。" width="1200">
  </picture>
</p>

<h1 align="center">Cairn.ink Memory</h1>

<p align="center"><strong>給 Claude Code 和 Codex 用的記憶，你可以查看、修改，也可以叫它忘記。</strong></p>

<p align="center">
  <a href="https://github.com/Cairn-ink/cairn-memory/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Cairn-ink/cairn-memory/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://www.npmjs.com/package/@cairn-ink/memory"><img alt="npm 版本" src="https://img.shields.io/npm/v/%40cairn-ink%2Fmemory"></a>
  <a href="LICENSE"><img alt="Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue"></a>
  <a href="https://cairn.ink"><img alt="Cairn.ink 雲端服務" src="https://img.shields.io/badge/hosted-cairn.ink-5b5147"></a>
</p>

<p align="center">
  <a href="README.md">English</a> · 繁體中文
</p>

Claude Code 和 Codex 開新對話時，常常不知道你之前講過的偏好和專案決定，只好一講
再講。Cairn.ink Memory 讓這兩個工具共用一份記憶。每筆記憶都留著存入時的原文，
哪天記錯了或過時了，你可以看它是怎麼來的，再修改它或叫它忘記。

- **每筆記憶都有來源。** 每筆都留著存入時的原文，要不要相信它，你可以先看過再決定。
- **可以改。** 事情變了就修改，不需要了就叫它忘記。
- **兩個工具共用一份。** Claude Code 和 Codex 讀寫的是同一份記憶。
- **放哪裡由你選。** 放在自己電腦上的資料庫，不用帳號；想在每台電腦都用同一份，
  就放 cairn.ink。

這是開發者預覽版，請先看[目前狀態](#目前狀態)和完整的
[已知限制（英文）](docs/limitations.md)。

## 安裝

```sh
npx @cairn-ink/memory setup
```

需要 Node 22.16 以上，以及 `PATH` 上找得到的 Claude Code 或 Codex。

> **已知問題：**Node.js 24.22.3 內建的 SQLite 是 3.54，部分搜尋會變慢，記憶很多時，回想可能找到比較少的結果。已存的資料不受影響。Node.js 22，或 Node.js 24 的 24.22.2 以前版本，都跟以前一樣。安裝程式會用執行它的那個 Node.js，所以換版本後要重新跑一次安裝。

安裝時先問：記憶要放在哪裡？

| | **本機** | **雲端** |
| --- | --- | --- |
| 帳號 | 不需要 | 需要 [cairn.ink](https://cairn.ink) 帳號，用瀏覽器登入一次 |
| 記憶放在哪 | 這台電腦上的 SQLite 資料庫 | cairn.ink |
| 自動保存什麼 | 你和 Claude Code、Codex 的對話，以明文保存（Linux 和 WSL；macOS 目前只有 Claude Code） | 你的對話，由 cairn.ink 整理成記憶 |
| 存一筆記憶 | 你開口，agent 才存 | 自動，也可以請 agent 存 |
| 怎麼找回來 | 你問，agent 才去查 | 每次提問自動帶入相關記憶 |
| 換一台電腦 | 不會同步 | 登入後是同一份記憶 |
| 費用 | 免費 | 見[方案與價格](https://cairn.ink/zh-Hant/pricing) |

想跳過這個問題，直接跑 `npx @cairn-ink/memory setup --local` 或
`npx @cairn-ink/memory setup --cloud`。裝完請重開 Claude Code 和 Codex；
Codex 還要到 `/hooks` 允許 Cairn 的設定。一台電腦一次只能用一種模式，
兩種模式之間不會搬移記憶。

套件名稱是 `@cairn-ink/memory`。npm 和 PyPI 上沒有 scope 的 `cairn-memory`
是別人的專案，跟這裡無關。

## 開始使用

裝好本機模式後，Claude Code 和 Codex 都會多一組記憶工具，來自名為
`cairn-local` 的 server。用平常說話的方式講就可以：

```text
記住：我的報告要簡短。
```

之後開新對話：

```text
你記得我喜歡怎樣的報告嗎？
這筆記憶是怎麼來的？
改一下：我現在需要詳細的報告。
忘記這筆記憶。
```

如果 agent 沒有去用記憶工具，直接點名：「用 cairn-local 的記憶工具」。

本機模式也會在你工作時把對話存下來，之後可以直接問（Linux、WSL，以及 macOS 上的
Claude Code；見[目前狀態](#目前狀態)）：

```text
上週我們對資料庫搬遷做了什麼決定？
```

已保存對話的搜尋是在背景補上的：剛講完的內容通常幾秒內就找得到，但剛安裝或升級後，較早的對話可能要過一陣子才找得到。

![概念示意：保存「報告要簡短」的偏好和存入時的原文；之後改成詳細報告，或忘記這筆記憶。](docs/images/memory-workflow.png)

| 你想做的事 | 工具 |
| --- | --- |
| 保存一筆記憶，連同存入時的原文 | `remember_memory` |
| 用關鍵字搜尋記憶和已保存的對話，不需要模型金鑰 | `find_memory_candidates`、`read_memory_context` |
| 讓模型挑出相關的記憶，需要你的 OpenAI 金鑰 | `recall_memory` |
| 查看一筆記憶、它的目前版本和原文 | `inspect_memory` |
| 修改一筆記憶的內容 | `correct_memory` |
| 讓一筆記憶不再被使用 | `forget_memory` |

跟著記憶保存的那段原文叫 **Source Receipt**。它讓你看到保存或修改這筆記憶時
送進來的文字，但不能證明這筆記憶是對的。
[所有工具與參數（英文）](docs/standalone-mcp.md#tools)

## 怎麼運作

Cairn.ink Memory 把 agent 學到的東西分成三層存放，就像一座石堆的三顆石頭。

| 層 | 放什麼 | 本機模式 | 雲端模式 |
| --- | --- | --- | --- |
| **對話** | 講過的內容，以可搜尋的文字保存 | 自動存在你的電腦上（Linux 和 WSL；macOS 上的 Claude Code） | 送到 cairn.ink |
| **記憶** | 值得留下的偏好、決定和事實，每筆都附 Source Receipt | 你或 agent 開口才存 | 從對話自動整理出來，也可以開口存 |
| **卡片** | 把相關記憶整理在一起的主題頁，連成一張地圖 | 預設不會建立 | 你在 cairn.ink 上瀏覽的地圖 |

在本機模式，查詢時會回傳記憶；背後的對話已經建好索引時，也會附上那些對話裡帶
日期的片段，讓答案可以帶著依據一起回來。

## 雲端模式

雲端模式會自動保存、自動回想，不用你開口。

- **保存。** 登入後，Claude Code 和 Codex 的對話文字會自動保存。送出前會先在
  你的電腦上遮蔽看起來像密碼或金鑰的內容，遮蔽是盡力而為，不保證全部遮到。
- **回想。** 每次提問會送一份遮蔽過、限制長度的副本到 cairn.ink，找到的相關
  記憶會帶進這次提問。
- **暫停。** 不想被記下的對話，開始前跑 `npx @cairn-ink/memory pause`，結束後跑
  `npx @cairn-ink/memory resume`。如果只接了 Claude Code，改在 Claude Code 裡用
  `/cairn-memory:pause` 和 `/cairn-memory:resume`。暫停期間的內容事後不會補存。
- **兩個工具。** 第一次一起設定只要用瀏覽器登入一次。先裝 Claude Code、後加
  Codex，需要用同一個帳號再登入一次。
- **Codex。** 只有安裝器驗證過的 Codex 版本會開啟自動記憶，
  `npx @cairn-ink/memory status` 會顯示你的版本有沒有通過。`codex exec`
  這類自動執行的工作預設不會保存，要另外開啟。

在工作對話上開啟之前，請先讀
[雲端會送出什麼、怎麼控制](https://cairn.ink/zh-Hant/memory/privacy)。
[雲端模式細節（英文）](docs/cloud-mode.md)說明手動安裝外掛、雲端 MCP 端點、
Codex 的規則，以及外掛的隱私約定。

## 你的資料

- **本機。** 你的記憶和已保存的對話放在一個明文的 SQLite 資料庫，預設是
  `~/.cairn-memory/data/memory.sqlite`；旁邊的資料夾 `memory.sqlite.raw-search`
  放搜尋用的索引，同樣是明文。不會傳任何東西給 Cairn，也不需要 Cairn 帳號。
  安裝時會從 npm 下載引擎需要的套件。
- **已保存的對話。** 在 Linux 和 WSL 上，本機模式會自動把你和 Claude Code、Codex 的對話文字存進
  這個資料庫，上限 200 MB。在 macOS 上會存 Claude Code 的對話。保存不需要帳號、不需要金鑰，也不呼叫模型。要關掉，跑
  `npx @cairn-ink/memory config --local-capture off`，或安裝時用
  `npx @cairn-ink/memory setup --local --no-capture`。
  `npx @cairn-ink/memory raw list` 會列出已保存的對話，不顯示內容。
  `npx @cairn-ink/memory raw delete <conversation-id>` 會先預覽要刪掉什麼，
  加上 `--yes` 才真的刪除。從那段對話存下來的記憶會留著，要另外叫它忘記。
- **模型金鑰。** 保存對話不會呼叫模型，關鍵字搜尋、查看、修改、忘記也都不呼叫
  模型。如果記憶 server 看得到 `OPENAI_API_KEY`，你的記憶和搜尋文字會送到 OpenAI
  做語意搜尋，這些 embedding 請求每個執行中的 Cairn server 每天預估上限約 US$1。`recall_memory`
  也會送出它挑選的文字，它呼叫模型的費用不算在這個估計裡。暫停或關閉保存，目前還
  不會停止這些請求。已保存的對話只有在你用
  `--raw-semantic` 選擇開啟、或自己設定 `--context-embedder` 時才會送出。要讓所有
  資料都留在電腦上，請不要給 server 金鑰。`--no-context-semantic` 會關掉語意搜尋和
  它的請求，但只要 server 看得到金鑰，agent 每次使用 `recall_memory` 仍會呼叫模型。
  細節見[預設功能、成本與開關（英文）](docs/defaults.md)。
- **雲端。** 對話文字和提問會在盡力遮蔽後送到 cairn.ink。Claude Code 外掛預設
  會傳不含內容的使用統計，可以關閉。Codex 的登入資訊存在未加密、只有你的
  使用者帳號讀得到的檔案裡。
- **忘記。** 忘記一筆記憶，是讓它不再被使用，同樣的文字也不能再存一次。這不是
  安全抹除：資料庫檔案和備份裡可能還留著那段文字，換個說法的內容也可能被存成
  新的記憶。在本機模式，忘記或修改一筆記憶時，也會把這筆記憶保存時間前後
  30 分鐘內有訊息的對話一起隱藏。這可能藏到無關的對話，也可能漏掉相關的對話，
  要刪掉特定一段對話請用 `raw delete`。
- **解除安裝。** `npx @cairn-ink/memory uninstall --local` 會斷開工具的連接，
  資料會留在硬碟上。在 Linux 上，完整解除安裝若會移除引擎，會先請這個資料庫
  還在執行的共用伺服器停止。
  解除雲端模式，你在 cairn.ink 上的記憶也會留著。

[本機資料、備份與刪除（英文）](docs/local-from-source.md#local-privacy-and-control) ·
[隱私與威脅模型（英文）](docs/privacy.md) ·
[預設功能、成本與開關（英文）](docs/defaults.md)

## 如果你在跑 agent harness

安裝器會把記憶伺服器註冊給這台電腦上所有的 Claude Code 和 Codex 對話。從安裝器
0.6.10 起，Linux 上使用同一份安裝且符合條件的對話會共用一個背景伺服器。第一個對話會啟動它，
最後一個對話關閉約 30 秒後，伺服器就會結束。伺服器使用的環境設定不同（例如
`PATH` 不同）時，對話會各自連到不同的伺服器。macOS 等其他平台，以及把資料庫放在
`/mnt/` 底下或網路檔案系統時，每個對話會各自啟動一個伺服器。共用伺服器如果
無法啟動，對話會自動啟動自己的伺服器。

`npx @cairn-ink/memory daemon status --local` 會列出這份安裝的資料庫所用的共用伺服器，
顯示資料庫短 ID、執行狀態、引擎 build，以及有幾個對話正在使用。`npx @cairn-ink/memory daemon stop --local`
會請這份安裝的資料庫所用、仍在執行的共用伺服器結束，不會強制終止，並回報還有幾個在執行。
請等對話閒置再執行。進行中的呼叫即使已經寫入資料，也可能收到 `daemon_outcome_unknown`。
這兩個指令只在 Linux 上運作，其他平台會回報 `daemon_platform`。

不想讓 worker 載入它，可以這樣做：

- **Claude Code。** 啟動 worker 時加 `--strict-mcp-config`，只載入你用
  `--mcp-config` 指定的 server。
- **Codex。** 用 `codex exec --ignore-user-config` 啟動 worker，略過註冊了這個
  server 的全域設定。

你自己開的互動對話照常使用記憶。

從 0.6.8 起，由腳本或 Agent SDK 啟動的 Claude Code 執行（例如 `claude -p`）不會被保存，
互動對話仍照常保存。0.6.6 與 0.6.7 仍會保存這些執行；使用這兩個版本時，
不想讓 harness 的執行存進來，可以用
`npx @cairn-ink/memory config --local-capture off --client claude` 關掉 Claude Code
的保存。這也會停止保存你自己的互動式 Claude Code 對話，直到你執行
`npx @cairn-ink/memory config --local-capture on --client claude`。

## 目前狀態

這是開發者預覽版。依賴它之前，請先知道這些限制：

- **保存之後，搜尋要一點時間才跟上。** 每一輪對話結束就會存下來。從 0.6.8 起，
  新存的內容會優先建索引，通常約 10 秒內就搜得到（很長的一輪可能要半分鐘左右，訊息非常多的一輪最多約兩分鐘）。
  較早對話的完整索引在 Claude Code 或 Codex 開著的時候於背景建立：一般電腦
  每 1,000 則訊息約 15 分鐘，較慢的電腦最多約 20 分鐘；資料越多，每則花的時間越少（10,000 則在一般電腦約
  1.5 小時，較慢的電腦約 3 小時）。從 0.6.7 升級後，這第一輪完整建索引會再跑一次。
  每存一則新訊息，會重新檢查整個索引（每 1,000 則約 5 分鐘），所以持續有新的
  保存時，完整索引可能要等保存停下來才跑得完；新存的內容仍會優先建索引。實際
  時間取決於你的對話。第一輪跑完之前，搜尋照樣會回結果，但還沒處理到的對話
  可能不在裡面，所以查不到不代表沒存到。大約 50,000 則以上的歷史可能永遠建不完。
- **本機模式要你開口才會回想。** 本機模式不會自己把記憶帶進提問，你問了，
  agent 才去查。
- **平台。** 自動保存在 Linux、WSL 上執行；macOS 從安裝器 0.6.7 起支援 Claude Code。
  Codex 在 macOS 還不支援自動保存，但記憶工具可以用；若只要設定 Claude Code，請執行
  `npx @cairn-ink/memory setup --local --client claude`。Windows 原生環境下 `setup --local` 會拒絕執行，請用 WSL，或照
  [PowerShell 原始碼安裝指南（英文）](docs/windows-install.md)操作。
- **macOS 上用 Homebrew 裝的 Node。** 安裝時會記下 Node 帶版本號的路徑，所以
  `brew upgrade` 更新 Node 之後請重新執行 setup。
- **設定資料夾。** 設定自動保存時，如果工具的設定資料夾是符號連結，本機安裝
  會在連接工具前停止。這適用於 `~/.claude`、`~/.codex`，以及透過
  `CLAUDE_CONFIG_DIR` 或 `CODEX_HOME` 指定的路徑。如果 Claude Code 把 MCP 項目寫到
  自訂的 `CLAUDE_CONFIG_DIR`，本機安裝會檢查 `~/.claude.json`，可能因為無法確認
  該項目而停止。
- **刪除的文字與搜尋索引。** 刪除對話或忘記記憶時，那段文字會立刻從 Cairn 的
  資料庫移除，之後不會再出現；只是因「忘記」而隱藏的對話仍然保存著，要刪除才會
  移除。搜尋不會回傳被刪除的文字，但本機搜尋索引檔可能還留著被刪內容的詞彙清單
  （開啟語意搜尋時還有向量），要等背景清理移除。清理只在 Cairn 執行時進行，資料
  多時可能要一段時間，而不再使用的搜尋設定留下的索引檔不會被清理。和多數資料庫
  一樣，刪掉的文字也可能留在檔案未使用的空間，直到被覆寫。
- **忘記之後。** 忘記或更正記憶之後，要求附上來源或理由的回想可能被拒絕（`source_unavailable`），直到被隱藏對話所產生的其他記憶都被更正或忘記為止。這需要設定模型金鑰，行為和 0.6.7 相同；一般回想照常可用。忘記某些內容之後，它原本所在的對話，以及這個對話被接續或分支出的副本（例如 `claude --resume`），從那之後都不會被保存。任何對話只要有訊息的時間落在被忘記訊息前後 30 分鐘內，從那之後也不會被保存，包括忘記之後馬上開的新對話。要恢復保存，請在被忘記的那則訊息寫下 30 分鐘之後再開新對話。在本機忘記、更正、刪除對話或忘記 Episode 之後，訊息時間不明的對話會從 Raw 搜尋中隱藏，而且從那之後，只要對話裡有沒有時間的訊息，整段對話就不會被保存，新對話也一樣。記憶會保留。Claude Code 和 Codex 平常都會記錄訊息時間，所以這只影響逐字稿裡沒有時間戳記的訊息。
- **直接呼叫引擎的整合。** 若你的整合直接呼叫引擎，或用 `--retained-raw-profile` 啟動 MCP 伺服器：依 id 讀取已保存的對話、列出已保存的對話，目前還不會因「忘記」而停止。沒有用離線安全遷移升級過的資料庫，仍會回傳被忘記或更正所隱藏的對話及其文字；升級過的資料庫會回傳不含文字的隱藏對話，而且忘記之後，列出已保存的對話與已保存文字的用量摘要會被拒絕（`evidence_unavailable`、`source_unavailable`）。搜尋、回想與記憶來源不會回傳隱藏的對話。`cairn-memory raw delete --conversation ID --yes` 可以移除隱藏對話的已保存文字。安裝好的設定不會開放這些讀取端。其他只有直接整合才會碰到的限制（忘記之後的 session start 與摘要讀取、清理前的索引詞彙統計）列在 [Changelog](CHANGELOG.md)。
- **語意回想需要金鑰。** 沒有 OpenAI 金鑰時，`recall_memory` 會回報
  `model_not_configured`，關鍵字搜尋照常可用。完全在本機跑模型的路徑還沒有驗證。
- **抽取品質。** 引擎預設用模型抽取記憶的品質，還沒通過我們自己訂的來源支持
  標準。證據和保留下來的失敗案例都在[已知限制（英文）](docs/limitations.md)。

[Roadmap](ROADMAP.md) · [Changelog](CHANGELOG.md) ·
[每項主張的依據（英文）](docs/promotion-claims.md)

想追蹤新版本，可以幫這個 repo 按星。

## Cairn.ink Memory 和 Cairn.ink

**Cairn.ink Memory** 是這個 repo 裡的開源記憶層。**[Cairn.ink](https://cairn.ink)**
是雲端產品，一張人和 AI 工具共用的記憶地圖，用來整理、審閱和分享知識。
雲端模式把 Claude Code 和 Codex 接到你的 Cairn.ink 帳號，本機模式完全不會連到它。

## 這個 repo 裡有什麼

- 安裝器 `@cairn-ink/memory`，以及 Claude Code 外掛和它的 marketplace 設定；
- 本機的 SQLite 記憶引擎，包含來源原文、修改、忘記與搜尋，還有一個精簡的
  本機 MCP server；
- 在本機過濾對話、遮蔽敏感內容、推導專案識別的程式；
- 公開的 HTTP 與 MCP 通訊規格，附 JSON Schema；
- 選用的 OpenAI adapter；
- 相容性測試與自架說明。

Cairn.ink 雲端的抽取服務、使用者資料庫、登入、計費、濫用防護與營運，放在另一個
不公開的 repo。請見[架構（英文）](docs/architecture.md)和
[自架（英文）](docs/self-hosting.md)。

## 更多文件

除了安裝器說明是中英對照，以下文件目前都是英文。

| 你想做的事 | 文件 |
| --- | --- |
| 看所有安裝選項、切換模式、處理卡住的安裝 | [安裝器說明](packages/setup/README.md) |
| 手動連接雲端，或讀它的規則與隱私約定 | [雲端模式細節](docs/cloud-mode.md) |
| 從原始碼建置，或手動設定 client | [從原始碼安裝本機預覽版](docs/local-from-source.md)、[Windows 指南](docs/windows-install.md) |
| 安裝前先看它怎麼跑 | [36 秒操作錄影（MP4）](docs/promotion/demo/cairn-memory-preview.mp4) |
| 在引擎上開發 | [架構](docs/architecture.md)、[MCP 工具](docs/standalone-mcp.md) |
| 搭配 Hermes 使用 | [Hermes 設定](docs/hermes-first-use.md) |
| 回報安全問題 | [SECURITY.md](SECURITY.md) |

## 給 AI agent

如果使用者請你安裝 Cairn.ink Memory：

- 從 npm 安裝 `@cairn-ink/memory`，原始碼在 `github.com/Cairn-ink/cairn-memory`。
  不要安裝 npm 或 PyPI 上沒有 scope 的 `cairn-memory`。
- 執行任何指令前，先請使用者選本機或雲端。雲端會把對話文字上傳到 cairn.ink，
  而且要由使用者自己登入。本機預設會把對話文字存在這台電腦上，使用者不想要
  的話，加上 `--no-capture`。
- 在非互動的 shell 裡，請跑 `npx @cairn-ink/memory setup --local` 或
  `npx @cairn-ink/memory setup --cloud`。第一次安裝時，非互動執行如果沒有加模式
  旗標，不會寫入任何設定。
- 安裝完成後，請使用者重開 Claude Code 和 Codex。

## 開發

外掛的執行環境與測試不依賴其他套件，需要 Node.js 20 以上。只有維護者會用到的
Claude 外掛驗證需要 Node.js 22，獨立放在 `tools/plugin-validation`，不會跟著
外掛一起安裝。

```bash
npm test
npm run test:setup
npm run validate
npm ci --prefix tools/plugin-validation
npm run validate --prefix tools/plugin-validation
```

本機儲存引擎需要 Node >=22.16，不用另外安裝相依套件：

```bash
npm run test:core
npm run demo:store
```

歡迎貢獻，請先讀 [CONTRIBUTING.md](CONTRIBUTING.md) 和
[docs/protocol.md](docs/protocol.md) 裡的隱私規則。程式碼以
[Apache-2.0](LICENSE) 授權。

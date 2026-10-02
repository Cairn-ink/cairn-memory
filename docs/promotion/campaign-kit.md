# Cairn Memory 首輪宣傳執行稿

這份執行稿包含英文 X、中文 Threads 的讀者招募與產品宣傳文案。讀者招募以原貼文直接回覆為入口；產品宣傳則連到 GitHub，讓開發者試用可查看來源、修正與遺忘的本機 memory preview。產品主張依 [證據表](../promotion-claims.md) 限定範圍；發布順序與成效目標沿用 [宣傳計畫](../plans/github-promotion.md)。

先招募並完成真人檢查。P1 的 5 位陌生讀者與 P2 的陌生真人安裝仍待實際執行；文案完成、agent 審閱或自動安裝成功都不能代替這些結果。下方產品宣傳稿安排在 P0 至 P2 通過後發布，記錄貼文 URL、UTC 時間與當時的 stars 起點。

## 讀者招募貼文

報名方式是直接回覆 X 或 Threads 的招募貼文。維護者在同一渠道確認參與意願與資格，再提供測試安排。[GitHub issue 326](https://github.com/Cairn-ink/cairn-memory/issues/326) 僅作可選的公開進度追蹤，參加者不需要前往 issue 留言。測試答案仍依下方方式匿名記錄。

英文 X 可直接使用，247 個 ASCII 字元，低於標準 280 字元上限：

```text
Looking for 5 AI coding agent users who haven't worked on Cairn or read its README.

Read it for 30 seconds, answer 3 questions (~3 minutes total). No install needed; answers recorded anonymously.

Interested? Reply here and I'll send the details.
```

中文 Threads 可直接使用，157 個字元，低於一般貼文的 500 字元格式：

```text
想找 5 位平常使用 AI coding agent 的開發者，幫忙看一份開源專案 README。希望你沒參與 Cairn 開發，也還沒讀過這版 README。

看 30 秒，再回答 3 題，大約 3 分鐘。不需要安裝；我們只記錄匿名答案，想知道文件哪裡不清楚。

願意幫忙的話，直接回覆這則貼文，我再提供方式。
```

正式閱讀前只確認資格與安排，不先解釋產品用途、來源收據或安裝入口，以保留理解測試的有效性。招募貼文的回覆數不算測試完成數；仍需下方 5 位真人的完整紀錄。

## 英文 X 產品宣傳稿

以下區塊是完整貼文；搭配本輪驗證通過的 demo，連結直接指向 repo。

```text
Keep a project decision across AI sessions, with its source attached.

Cairn is open-source SQLite + MCP memory you can inspect, correct and forget. Try the no-key walkthrough.

Developer preview. Semantic recall needs an OpenAI key.
https://github.com/Cairn-ink/cairn-memory
```

可選的技術回覆，用於補充免 key demo 的驗證範圍：

```text
Local MCP uses explicit tools. The no-key demo checks persistence, receipts, revision conflicts and forgetting; recall returns model_not_configured. Semantic recall uses OpenAI. Receipts expose provenance, not guaranteed truth. Known limits:
https://github.com/Cairn-ink/cairn-memory/blob/main/docs/limitations.md
```

首則為 257 個 X 計數字元，回覆為 265 個，均採 ASCII 文字且每個 URL 計 23 個字元；含完整 URL 的原始長度分別為 275、313。標準貼文上限為 280，依 [X 發文說明](https://help.x.com/en/using-x/how-to-post) 與 [X 連結計數規則](https://help.x.com/en/using-twitter/how-to-tweet-a-link.html) 核對。修改文案後須重新計數。

## 中文 Threads 產品宣傳稿

```text
換一個 AI session，上一輪的專案決策還在嗎？

我們在做 Cairn Memory：把你明確儲存的記憶放進自己的 SQLite，附上可查看的來源文字。可以修正，也可以讓後續 recall 不再返回它。

repo 裡有免模型 key 的實際流程：儲存 → 重啟 → 查看來源 → 更正 → 遺忘。語意 recall 需要自己提供 OpenAI key。

目前是 developer preview；來源收據不保證解讀正確，預設抽取品質仍在改善。想試 MCP 記憶層，可以從 README 的 Local preview 開始。

https://github.com/Cairn-ink/cairn-memory
```

原始文字為 312 個字元，包含換行與完整 URL，低於一般貼文的 500 字元格式；使用普通貼文即可。格式依 [Meta 的 Threads 說明](https://about.fb.com/news/2023/07/introducing-threads-new-app-text-sharing/) 核對。

兩則產品宣傳稿使用相同的 [MP4 demo](demo/cairn-memory-preview.mp4)，[重製方式](demo/README.md) 與 [實際 transcript](demo/transcript.txt) 隨檔保留。保留畫面的免模型 key 標示，語意 recall 的錯誤結果不可剪成成功搜尋。短文無法展開的版本、忘記後資料保留與 client 支援範圍，由 README 的證據與限制連結承接。

## 五位讀者的三十秒檢查

邀請 5 位未參與開發、未讀過這版 README，且平常使用 AI agent 的開發者。先固定要看的 README 版本及呈現方式；用 `sha256sum README.md` 記錄完整檔案雜湊。若使用未發布的預覽，記錄為 `local_preview`；正式 GitHub 頁面記錄為 `github`。五人看同一版本，記錄視窗寬度。

使用上方中性的招募貼文收集參與意願，確認資格後再安排閱讀。

主持人逐字說明：

> 我們在測文件是否清楚，不是在考你。不知道也可以直接說不知道。請從 README 開頭看到安裝選擇，可以捲動，先不要打開其他連結。30 秒後我會關閉畫面，再請你回答三題。

計時到 30 秒就關閉畫面，依序問以下三題。記下原意後才評分，三題完成前不補充、提示或糾正答案。

| 題目 | 1 分標準 | 0 分情況 |
| --- | --- | --- |
| 1. 這個專案幫你解決什麼問題？ | 說出跨 session 保存或取用 AI 的記憶／專案決策；不必使用產品術語。 | 只說一般聊天、文件搜尋或其他用途；不知道或未回答。 |
| 2. Source Receipt 有什麼用？它能證明什麼、不能保證什麼？ | 同時說出能查看記憶附帶的來源文字，以及不能保證推論／解讀正確。 | 只提到來源卻聲稱記憶必然正確，或未理解來源用途。 |
| 3. 如果要在自己的電腦試用開源 memory layer，你會從哪個安裝入口開始？它需要 Cairn 帳號嗎？ | 選擇 Local preview／Try local，知道不需要 Cairn 帳號。 | 選 hosted plugin、誤認本機需要 Cairn 帳號，或找不到入口。 |

三題都 1 分才算該讀者通過，至少 4/5 通過才達 P1 理解標準。開始閱讀後中止、未回答或跳題，該題計 0，保留在五人分母；答題本身不另設倒數。邀請尚未接受、尚未開始閱讀的欄位維持 `pending`。真人尚未完成時不能填 0 分當作已測，也不能由 agent 代答。

使用 [reader-test.csv](reader-test.csv) 記錄，預先保留 R01 至 R05 五個匿名 ID。`q1_score` 至 `q3_score` 只填 `0` 或 `1`；`result` 填 `pass` 或 `fail`，未測全部留白。`status` 為 `pending`、`completed` 或 `aborted`。只記簡短匿名答案與卡住之處，避免姓名、帳號與公司資料。若修改 README，保留舊批次完整結果，另建新批次並找新讀者，不覆寫失敗答案。

## 乾淨安裝與陌生真人操作

三次自動安裝的版本、指令、耗時與結果放在 [安裝驗證紀錄](install-validation/README.md)。既定技術批次為 Node 22.16.0、24.15.0、22.16.0，三次均由 AI agent 操作；即使全數通過，陌生真人條件仍待完成。

以下說明交給一位不熟悉實作的開發者。使用 Linux x64、Git、Node 22.16 或 Node 24、npm 與 `tar`。本輪固定 source commit 為 `7467aebcb32563c9aab4356a8c3e04c0ebb1ecd4`，另保留使用的 README 雜湊；所有操作只用新 checkout、新安裝目錄與 walkthrough 的合成資料庫。若要改 source commit，先記錄新一批的版本，保留舊批次結果。

1. **按 README 安裝。** 從 [Local preview 的第 1 步](../../README.md#try-the-local-memory-layer) clone 後，在 checkout 內執行 `git checkout --detach 7467aebcb32563c9aab4356a8c3e04c0ebb1ecd4`，再依提供的 README 安裝。選一個不存在的絕對路徑作為安裝目標，例如既有私人目錄下的 `cairn-trial-h01`。記錄 Node/npm 版本、開始 UTC 時間，以及 clone 和安裝各花多久。
2. **按 README 執行第 2 步。** 安裝 isolated MCP SDK，將相同安裝路徑帶入 `walkthrough.mjs --executable`。使用預設無 key 模式，不加 `--with-recall`。預期整體為 `status: "passed"`，六個階段皆通過，包含重啟後 receipt 相同、舊 revision 更正遭拒、`model_not_configured` 與遺忘後空列表。這一步不需要先設定聊天 client。
3. **回報結果與卡住位置。** 回報匿名操作者 ID、固定 commit、Node/npm 版本、各步驟耗時、整體及階段 status、阻礙與是否需要人幫忙。安裝輸出含私人路徑，先移除路徑和識別資料再分享；不要公開原始 installation receipt。任何中斷或失敗都保留，先記錄原結果才開始修正或重試。

主持人只給 README 與任務，不代打指令或即時解釋程式。需要協助就記錄第一個阻礙；協助後完成可以記為修復結果，不能改寫成原先獨立完成。額外真人嘗試加入 P2 的完整紀錄，保留原有三次 agent 嘗試及所有失敗；它不會把 agent 操作改算成人類操作。

P2 的陌生真人操作目前為 **pending**。三次技術結果、陌生人依文件完成結果及 demo 追溯均核對後，才更新宣傳計畫的 P2 狀態。這些結果不宣稱已有人持續採用，也不取代既有 source-support 品質標準。

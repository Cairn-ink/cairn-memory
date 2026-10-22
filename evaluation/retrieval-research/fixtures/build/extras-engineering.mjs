// Each substantive canonical fact and chat excerpt below was individually authored.
export default {
'fam-001': `
月報庫測試器只產生空白附件，不產生帳款資料。 | 月報庫測試器只吐空白附件就好，帳款資料不要在這裡造。
月報庫的 PostgreSQL 教材由阿岑校對指令。 | 月報庫 PostgreSQL 教材指令給阿岑校，這是教材，不是正式遷移。
小林負責月報庫測試器的種子檔命名。 | 月報庫測試器 seed 檔名字小林定，這項跟正式 schema 分開。
月報庫舊版匯入器遇到空白日期時會留下警告。 | 月報庫舊匯入器碰空白日期要留 warning，不能默默跳過。
月報庫壓測帳的虛擬額度為 NT$1,800。 | 月報庫壓測帳放 NT$1,800 假額度，不是 hosting 預算。
月報庫命令列的診斷輸出寫到標準錯誤。 | 月報庫 CLI 診斷走 stderr，別混進資料輸出。
月報庫範例快照不含來源附件。 | 月報庫範例 snapshot 不包原附件，只留測試需要的空架子。
月報庫測試器的失敗重播檔採逐行格式。 | 月報庫測試器失敗 replay 檔用逐行格式，比較好截一筆出來看。
月報庫內訓的 Redis 章節由阿岑示範。 | 月報庫內訓 Redis 那章阿岑示範，教學不是採用寫入緩衝喔。
`,
'fam-002': `
RelayCart's screenshot-test runner waits 15 seconds before capture. | The RelayCart screenshot runner waits 15 seconds before capture. That's test timing, not response TTL.
Mina owns RelayCart's image-fixture checksum file. | Give Mina the RelayCart image-fixture checksums. This is test data maintenance.
RelayCart's load-test wallet contains a fictional US$48 credit. | Put US$48 fake credit in the RelayCart load-test wallet, separate from any cache budget.
RelayCart's stale-image test uses six sample images. | Use six sample images for the RelayCart stale-image test, please.
RelayCart's CLI suppresses color when output is redirected. | RelayCart CLI should drop color when redirected. It makes logs readable.
RelayCart's mock stock feed emits one correction per replay file. | One correction per RelayCart mock stock replay file so we isolate failures.
RelayCart's CloudHeron adapter test uses example.invalid endpoints. | RelayCart CloudHeron adapter tests should use example.invalid, never a live vendor endpoint.
RelayCart's image fixture files carry a SHA-256 manifest. | Add a SHA-256 manifest for RelayCart image fixtures so we catch accidental edits.
RelayCart's RC-24 regression covers empty product names. | RelayCart RC-24 covers an empty product name, not a cache-expiry boundary.
`,
'fam-003': `
霧港測試通知的收件人一律使用合成代號。 | 霧港測試通知都填合成代號，不要放真的聯絡人。
霧港通知課程的模擬鈴聲長兩秒。 | 霧港通知課程鈴聲放兩秒，是模擬音長度，不是服務延遲。
霧港壓測錢包的假額度是 NT$2,400。 | 霧港壓測錢包放 NT$2,400 假額度，這不是通知月費。
霧港測試器把雲鷺字樣放在來源欄。 | 霧港測試器來源欄寫雲鷺，是假資料的標籤，不代表重新選商。
小葉負責霧港錯字回歸測試。 | 霧港錯字 regression 給小葉接，測試訊息那塊。
霧港重送測試只檢查訊息識別碼。 | 霧港重送測試這次只驗識別碼，其他屬性另測。
霧港的診斷紀錄會遮住收件地址。 | 霧港診斷紀錄地址遮掉，排查錯誤不用整串地址。
霧港簡訊教材保留未發送的範例檔。 | 霧港簡訊教材留範例檔就好，不會真的送，跟備援提案分開。
霧港錯誤碼表由阿岑維護。 | 霧港錯誤碼表阿岑維護，變更時順便看範例。
`,
'fam-004': `
TracePond's INC-0621 replay fixture contains only synthetic logs. | Keep TracePond INC-0621 replay logs fully synthetic. This is a regression fixture.
Evan owns TracePond's stack-trace redaction rule. | Evan should own the TracePond stack-trace redaction rule, please.
TracePond's parser test uses a timestamp 47 minutes ahead. | Set the TracePond parser test timestamp 47 minutes ahead. That's clock-skew input, not alert delay.
TracePond's pager mock writes messages to an in-memory list. | TracePond pager mock should write to an in-memory list. No real pages in tests.
TracePond's diagnostic endpoint returns JSON only. | TracePond diagnostic endpoint should return JSON only, so scripts can parse it.
TracePond's test service binds to a randomly allocated port. | Let the OS allocate the TracePond test-service port. Fixed ports keep colliding.
TracePond's log replay rejects truncated final records. | Reject a truncated last record in TracePond replay. Don't silently count it complete.
TracePond's practice email addresses end in example.invalid. | Keep TracePond test mail under example.invalid, please.
Iris owns TracePond's empty-log regression fixture. | Iris should own the TracePond empty-log fixture. That's the test assignment.
`,
'fam-005': `
杉橋 PR #128 的教學重播使用合成差異檔。 | 杉橋 PR #128 教學 replay 用合成 diff，別把正式改動整份搬來。
杉橋 PR #182 的測試副本由阿岑建立。 | 杉橋 PR #182 測試副本給阿岑建，這不是小周的校文案工作。
杉橋合併測試器可同時模擬兩個分支。 | 杉橋合併測試器模擬兩分支，是測試能力，不是審查人數。
杉橋文件連結檢查遇到重新導向會顯示警告。 | 杉橋文件連結遇到 redirect 警告一下，讓寫文件的人知道。
杉橋回滾教材的按鈕不連接正式服務。 | 杉橋回滾教材按鈕只在本機演練，不接正式服務。
杉橋測試器的模擬額度是 NT$1,280。 | 杉橋測試器帳上 NT$1,280 是假額度，不是審查費。
杉橋空白提交訊息會被格式檢查拒絕。 | 杉橋 commit message 空白就擋，這是格式規則。
杉橋差異檔預覽預設折疊產生的檔案。 | 杉橋 diff 預覽把 generated 檔先折起來，比較看得到手寫部分。
杉橋教學機的設定檔只放假權杖。 | 杉橋教學機 config 全部假 token，這份是課程設備。
`,
'fam-006': `
ByteOrchard's queue visualizer groups paperless trace rows in sixes. | Group ByteOrchard queue-visualizer trace rows in sixes. That's display grouping, not worker count.
Noah owns ByteOrchard's empty-queue test fixture. | Noah should own ByteOrchard's empty-queue fixture, please.
ByteOrchard Q-240's training replay contains 24 fake jobs. | The ByteOrchard Q-240 training replay has 24 fake jobs, separate from the live intake threshold.
ByteOrchard's disk-capacity fixture declares a fake 700 MB volume. | Declare a 700 MB fake volume in the ByteOrchard disk fixture. That's not measured worker memory.
ByteOrchard's diagnostic export sorts job IDs lexically. | Sort ByteOrchard diagnostic job IDs lexically, so diffs are stable.
ByteOrchard's failed-job samples omit payload contents. | Leave payload content out of ByteOrchard failed-job samples; IDs are enough for this test.
ByteOrchard's sample invoice import does not create ledger entries. | ByteOrchard sample invoice import must not create ledger entries. It's a dry-run tool.
Zoe reviews ByteOrchard's queue error messages. | Give Zoe the ByteOrchard queue error-message review. That's a wording task.
ByteOrchard's replay seed is stored with the test report. | Save the ByteOrchard replay seed alongside the test report, please.
`,
'fam-007': `
石澗還原教材的練習檔只有空白索引。 | 石澗還原教材練習檔索引留白，是測試輸入，不是六月那份備份。
石澗壓測錢包的假餘額為 NT$320。 | 石澗壓測錢包 NT$320 是假值，跟還原驗證資源費不同。
阿哲負責石澗備份檔名的錯字檢查。 | 石澗備份檔名錯字給阿哲抓，這跟整理還原紀錄分開。
石澗測試器會拒絕沒有校驗碼的樣本。 | 石澗測試器沒 checksum 就拒絕，別默默當有效樣本。
石澗週三課程的沙盒最多放十六個假附件。 | 石澗週三課程沙盒十六個假附件就夠，這不是正式容量限制。
石澗測試資料的城市欄使用大阪作為假值。 | 石澗測試資料城市填大阪，假欄位值，不是備份目的地。
石澗診斷模式不輸出原始附件名稱。 | 石澗 diagnostic 模式不要印原附件名，留代號就好。
石澗備份檔清單的排序採檔名順序。 | 石澗備份清單按檔名排，方便比對兩次輸出。
石澗空附件回歸測試由小葉維護。 | 石澗空附件 regression 給小葉維護，這個測試要留。
`,
'fam-008': `
HarborLint's PR #206 training replay uses a fabricated lockfile. | Use a fabricated lockfile in the HarborLint PR #206 training replay, not the actual review data.
Zoe owns HarborLint's dependency error-message glossary. | Zoe should own HarborLint's dependency error-message glossary, please.
HarborLint's license-header fixture uses IDs 260 through 269. | Use IDs 260 through 269 in HarborLint's license-header fixture. Those are synthetic row IDs.
HarborLint's Friday classroom sandbox starts at 13:00 Taipei time. | HarborLint classroom sandbox starts at 13:00 Taipei time on Friday, separate from dependency review.
HarborLint's formatter ignores blank comment lines. | HarborLint formatter can ignore blank comment lines. We don't need them counted as findings.
HarborLint's dependency-tree preview folds leaf nodes by default. | Fold leaf nodes in HarborLint's dependency-tree preview by default, please.
HarborLint's test alert bell is muted during recordings. | Mute the HarborLint test bell while recording. This doesn't mute real security notices.
HarborLint's fixture manifest records SHA-256 hashes. | Record SHA-256 hashes in the HarborLint fixture manifest so we notice drift.
HarborLint's sample license scan never calls external services. | HarborLint sample license scan should stay local; don't call external services in that exercise.
`,
'fam-009': `
竹浪測試課程的分支名稱使用四種動物代號。 | 竹浪測試課程 branch 名用四種動物，不要帶真分支名。
小許負責竹浪的空資料庫啟動測試。 | 竹浪空資料庫啟動測試給小許接，這跟清理排程不同。
竹浪示範時鐘每四小時重播一次測試動畫。 | 竹浪示範時鐘四小時重播，是教材動畫，不是測試庫保留期限。
竹浪範例環境不允許對外寄信。 | 竹浪範例環境外寄先封掉，演練別寄到外面。
竹浪九月教材的範例表名使用小寫。 | 竹浪九月教材範例表名都小寫，先統一這個。
小周負責竹浪診斷頁的文字校對。 | 竹浪診斷頁文案小周看，這次不是錄影功能。
竹浪啟動失敗時會輸出設定檔路徑。 | 竹浪啟動失敗把 config 路徑印出來，才知道在看哪份。
竹浪測試錢包的假餘額為 NT$480。 | 竹浪測試錢包 NT$480 是假餘額，不會扣真錢。
竹浪的空白容量報表保留欄位名稱。 | 竹浪容量表沒資料也留欄名，別只輸出一張空頁。
`,
'fam-010': `
CedarGate's AUD-031 teaching replay contains fabricated actors. | CedarGate AUD-031 teaching replay should use fabricated actors. It's a test fixture.
Iris owns CedarGate's missing-user regression test. | Iris should own CedarGate's missing-user regression, please.
CedarGate's mock hardware key is an inert USB shell. | CedarGate mock hardware key is just an inert shell, not a selected device manufacturer.
CedarGate's test account locale defaults to Taiwan. | Set CedarGate test-account locale to Taiwan. That's fixture configuration.
CedarGate's sample administrator cards carry no credentials. | CedarGate sample admin cards must have no credentials. They're for the exercise.
CedarGate's audit preview masks session identifiers. | Mask session identifiers in the CedarGate audit preview, please.
CedarGate's 031-B regression covers deleted roles. | CedarGate 031-B should cover a deleted role, rather than a settings-change attribution case.
CedarGate's mock authority expires after eight simulated requests. | CedarGate mock authority expires after eight simulated requests. It's test behavior only.
Noah maintains CedarGate's empty-export fixture. | Give Noah the CedarGate empty-export fixture. That's the maintenance task.
`,
};

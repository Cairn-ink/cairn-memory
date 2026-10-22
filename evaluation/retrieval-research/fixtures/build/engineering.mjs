import { family } from './source.mjs';
export default [
family('fam-001','engineering','mixed','月報庫的資料庫改選與成本邊界',['月報庫','小林','PostgreSQL'],true,`
B | 月報庫三月原定使用 SQLite。 | 使用者三月把月報庫的資料庫定為 SQLite。 | 月報庫先用 SQLite 就好，三月這版不用再挑了。
B | 月報庫八月改用 PostgreSQL。 | 使用者八月決定讓月報庫改用 PostgreSQL。 | 月報庫這次定 PostgreSQL，八月的新寫入都走這個。
S | 月報庫改選的原因是三位 AI 助理同時寫入時出現鎖定衝突。 | 使用者補充月報庫換資料庫的原因。 | 月報庫換掉是因為三個 AI 助理同時寫就撞鎖，不是查詢跑太慢。
S | 月報庫託管費上限為每月 NT$1,800。 | 使用者為月報庫設定每月 hosting 預算。 | 月報庫 hosting 一個月最多 NT$1,800，超過就先別開。
B | 小林負責月報庫的 schema migration。 | 使用者指定小林負責月報庫的 schema migration。 | 月報庫的 schema migration 給小林接，這塊他負責。
B | 小林在月報庫只審查備份排程，不負責執行備份。 | 使用者讓小林審查月報庫 backup 排程，執行另派。 | 月報庫 backup 排程給小林看，但不要把執行也算給他喔。
S | 月報庫的 Redis 寫入緩衝方案被否決。 | 使用者記錄月報庫另一個 buffer 選項的評估結果。 | 月報庫的 Redis 寫入緩衝先否決，別當成已採用。
`, '月報庫正式切換的確切停機分鐘數為十二分鐘。'),
family('fam-002','engineering','en','RelayCart response cache trade-off',['RelayCart','Mina','CloudHeron'],true,`
B | In March RelayCart selected a 60-second response cache. | The user originally chose a 60-second response cache for RelayCart. | For RelayCart let's settle on sixty seconds of response caching for now.
S | In August RelayCart changed its response-cache TTL to 15 seconds. | The user shortened RelayCart's response-cache lifetime. | RelayCart response cache is 15 seconds now. Please record the number; the edge cache is separate.
S | RelayCart shortened the TTL because stock corrections remained invisible for nearly a minute. | The user explained the RelayCart response-cache change. | The reason for changing RelayCart's TTL is stock corrections sitting invisible for almost a minute. That's the pain.
B | RelayCart may spend at most US$48 per month on response caching. | The user capped RelayCart response caching at US$48 a month. | RelayCart can spend forty-eight US dollars monthly on response caching, tops.
B | Mina owns RelayCart's cache invalidation tests. | Mina is responsible for RelayCart cache invalidation tests. | Give Mina the RelayCart invalidation tests; she owns that part.
B | RelayCart's image edge cache retains objects for 24 hours. | RelayCart image objects stay in the edge cache for 24 hours. | RelayCart images still get a full day at the edge. That's not the response-cache TTL.
S | RelayCart's per-user cache-key proposal remains proposed. | The user retained a RelayCart cache-key idea for later review. | RelayCart per-user cache keys are only a proposal, okay, no approval yet.
`),
family('fam-003','engineering','zh','霧港通知服務的供應商與延遲',['霧港','陳經理','雲鷺'],true,`
B | 霧港通知在三月選用雲鷺供應商。 | 使用者三月選定雲鷺承接霧港通知。 | 霧港通知三月這段先給雲鷺，選好了。
B | 霧港通知在八月改用青禾供應商。 | 使用者八月將霧港通知供應商改為青禾。 | 霧港通知換青禾，八月開始的新通知走他們。
S | 霧港更換通知供應商是因為雲鷺的晚間延遲超過兩秒。 | 使用者補充霧港通知換商的原因。 | 霧港換掉雲鷺是晚上會拖超過兩秒，白天的數字其實沒問題。
S | 霧港通知每月費用上限為 NT$2,400。 | 使用者訂出霧港通知的月費上限。 | 霧港通知一個月最多 NT$2,400，這個上限要守住。
B | 陳經理負責霧港通知的合約續簽。 | 使用者指定陳經理處理霧港通知續約。 | 霧港通知續簽找陳經理，他對窗口。
B | 陳經理在霧港只收每週延遲摘要，不處理值班。 | 使用者讓陳經理收霧港每週延遲摘要，值班另排。 | 霧港每週延遲摘要寄陳經理就好，值班不要排他。
S | 霧港的簡訊備援方案仍在提案階段。 | 使用者保留霧港另一種通知備援構想。 | 霧港簡訊備援還只是提案，先別接到正式流程。
`, '霧港青禾合約的提前解約費為 NT$6,000。'),
family('fam-004','engineering','en','TracePond incident escalation',['TracePond','Evan','INC-0621'],true,`
B | TracePond originally routed incident alerts to email in March. | The user initially routed TracePond incident alerts through email. | TracePond incident alerts can go by email for March. Let's use that route.
S | TracePond changed incident alerts to a pager channel in August. | The user changed TracePond's incident alert destination. | Put TracePond incident alerts on the pager channel from August onward.
S | TracePond changed channels because INC-0621 email was read 47 minutes late. | The user recorded why TracePond incident escalation changed. | TracePond's INC-0621 mail sat unread for 47 minutes. That's why we're changing the channel.
B | TracePond's pager may wake the on-call engineer only for failed writes. | The user limited TracePond wake-up pages to failed writes. | TracePond pager wake-ups are for failed writes only. Slow dashboards can wait.
B | Evan owns TracePond's INC-0621 follow-up. | Evan is responsible for the TracePond INC-0621 follow-up. | Evan should own the TracePond INC-0621 follow-up, please.
B | Evan reviews TracePond's dashboard palette but does not own dashboard uptime. | Evan reviews TracePond dashboard colors, with uptime assigned elsewhere. | TracePond dashboard colors go through Evan; dashboard uptime isn't his assignment.
S | TracePond's automatic incident closure option was rejected. | The user recorded a rejected TracePond incident option. | Reject automatic closure for TracePond incidents. Silence doesn't mean it's fixed.
`),
family('fam-005','engineering','zh','杉橋 PR 合併規則',['杉橋','小周','PR #128'],true,`
B | 杉橋三月允許單人核可後合併。 | 使用者三月允許杉橋經一人核可就合併。 | 杉橋先一個人看過就能合，三月照這樣。
B | 杉橋八月改為兩位審查者核可才可合併。 | 使用者八月把杉橋合併門檻改為兩位審查者。 | 杉橋從八月起要兩個審查者都點頭才能合。
S | 杉橋提高審查門檻是因為 PR #128 漏看回滾路徑。 | 使用者補充杉橋調整審查門檻的原因。 | 杉橋這次改是 PR #128 漏掉回滾路徑，一個人看真的沒抓到。
S | 杉橋文件變更可免第二位審查者，但不得包含設定檔。 | 使用者記下杉橋審查規則的例外條件。 | 杉橋純文件可以不用第二人，但混到設定檔就不行喔。
B | 小周負責杉橋 PR #128 的回滾演練。 | 使用者指定小周處理杉橋 PR #128 回滾演練。 | 杉橋 PR #128 回滾演練給小周做。
B | 小周只替杉橋 PR #182 校對文案。 | 使用者讓小周僅校對杉橋 PR #182 的文字。 | 杉橋 PR #182 小周只看文案，別跟一二八的任務混了。
S | 杉橋自動合併功能仍未獲核准。 | 使用者保留杉橋自動化合併提案。 | 杉橋自動合併還沒核准，先停在提案。
`, '杉橋第二位固定審查者的姓名是小唐。'),
family('fam-006','engineering','en','ByteOrchard queue capacity',['ByteOrchard','Noah','Q-240'],false,`
B | ByteOrchard rejected a single unbounded worker queue. | The user rejected an unbounded single queue for ByteOrchard. | No unbounded worker queue for ByteOrchard. Mark that option rejected.
S | ByteOrchard selected a worker concurrency limit of six. | The user fixed ByteOrchard's worker concurrency. | ByteOrchard workers should run six at a time. That's the selected limit.
S | ByteOrchard selected its limit because invoice imports consume 700 MB per worker. | The user recorded ByteOrchard's concurrency rationale. | ByteOrchard invoice imports eat 700 MB per worker, which is why we picked that limit.
B | ByteOrchard pauses intake when queue Q-240 reaches 240 jobs. | The user set ByteOrchard Q-240 intake to pause at 240 jobs. | Pause ByteOrchard intake when Q-240 hits two hundred forty jobs, please.
B | Noah owns ByteOrchard queue capacity alerts. | Noah owns the ByteOrchard queue capacity alerts. | ByteOrchard capacity alerts go to Noah; he's the owner.
B | ByteOrchard's preview queue runs only two workers. | ByteOrchard preview processing uses two workers. | The ByteOrchard preview queue stays at two workers, separate from invoice imports.
S | ByteOrchard's disk-spill queue remains a proposal. | The user retained another ByteOrchard queue option for review. | ByteOrchard disk spill is still proposed. We haven't agreed to build it.
`),
family('fam-007','engineering','zh','石澗備份驗證',['石澗','阿哲','六月'],false,`
B | 石澗否決只看備份檔存在的驗證方式。 | 使用者否決石澗僅檢查備份檔存在的方案。 | 石澗不能只看檔案有沒有在，這種驗證不要用。
B | 石澗採用每週三還原一份備份的驗證方式。 | 使用者決定石澗每週三實際還原一份備份。 | 石澗就每週三抽一份真的還原，定這個。
S | 石澗採用還原驗證是因為六月的備份缺少附件索引。 | 使用者記錄石澗採用還原驗證的理由。 | 石澗六月那份少了附件索引，檔案明明在，所以才要真的還原。
S | 石澗每次驗證最多可占用 NT$320 的暫存資源。 | 使用者限制石澗驗證的資源費。 | 石澗一次驗證暫存最多 NT$320，別放著跑整晚。
B | 阿哲負責石澗還原驗證紀錄。 | 使用者指定阿哲整理石澗還原驗證紀錄。 | 石澗還原驗證紀錄讓阿哲收好。
B | 阿哲只檢查石澗附件容量，不替附件決定保留期限。 | 使用者讓阿哲只檢查石澗附件容量，不決定保留期限。 | 石澗附件容量阿哲看，保留多久不是他決定。
S | 石澗跨區備份仍在提案階段。 | 使用者保留石澗另一個備份選項。 | 石澗跨區備份先放提案，現在還沒採用。
`, '石澗跨區備份目的地城市為大阪。'),
family('fam-008','engineering','en','HarborLint dependency review',['HarborLint','Zoe','PR #206'],false,`
B | HarborLint rejected automatic major-version upgrades. | The user rejected automatic major upgrades in HarborLint. | HarborLint major versions shouldn't upgrade automatically. Reject that setting.
S | HarborLint selected a fortnightly dependency review. | The user set HarborLint's dependency review cadence. | Review HarborLint dependencies every other Friday. A fortnightly review is what we're adopting.
S | HarborLint chose this cadence because daily update alerts obscured security notices. | The user explained HarborLint's review cadence. | HarborLint daily update noise was burying the security notices. That's why the cadence is changing.
B | HarborLint allows emergency patch review outside the regular cycle. | HarborLint emergency patches may be reviewed outside the normal cycle. | HarborLint security patches can get an emergency review; don't make them wait for Friday.
B | Zoe owns HarborLint's PR #206 dependency audit. | Zoe owns the HarborLint dependency audit on PR #206. | Assign Zoe the HarborLint PR #206 dependency audit.
B | HarborLint PR #260 concerns license headers rather than dependencies. | HarborLint PR #260 changes license headers rather than dependencies. | HarborLint PR #260 is license headers, by the way. Not the dependency audit.
S | HarborLint's dependency dashboard remains proposed. | The user kept a HarborLint dashboard idea open for review. | HarborLint dependency dashboard is still just a proposal. No build approval.
`),
family('fam-009','engineering','zh','竹浪測試環境',['竹浪','小許','九月'],false,`
B | 竹浪拒絕共用正式環境的測試資料庫。 | 使用者拒絕讓竹浪測試資料庫與正式環境共用。 | 竹浪測試不要接正式資料庫，這個選項先劃掉。
B | 竹浪決定每個分支使用獨立測試資料庫。 | 使用者為竹浪每個分支配置獨立測試資料庫。 | 竹浪就一個分支一個測試庫，這樣定了。
S | 竹浪採用分支測試庫是因為九月兩次測試互相清掉資料。 | 使用者記錄竹浪隔離測試庫的原因。 | 竹浪九月有兩次測試互刪資料，所以才要一個分支一份。
S | 竹浪測試資料庫在分支關閉後保留四小時。 | 使用者設定竹浪測試庫清理條件。 | 竹浪分支關掉後測試庫留四小時就清，方便查錯。
B | 小許負責竹浪測試庫清理排程。 | 使用者指定小許負責竹浪測試庫清理。 | 竹浪測試庫清理排程讓小許接。
B | 小許負責竹浪正式庫的容量報表，不負責正式庫清理。 | 使用者讓小許整理竹浪正式庫容量報表，不負責正式庫清理。 | 竹浪正式庫小許只出容量表，別叫他去清資料。
S | 竹浪預覽環境自動錄影仍是提案。 | 使用者保留竹浪預覽環境的一項功能提案。 | 竹浪預覽自動錄影先當提案，還沒排進去。
`),
family('fam-010','engineering','en','CedarGate access audit',['CedarGate','Iris','AUD-031'],false,`
B | CedarGate rejected shared administrator accounts. | The user rejected shared admin accounts for CedarGate. | CedarGate shared admin logins are out. Please mark that rejected.
S | CedarGate selected individual administrator accounts with weekly access review. | The user selected CedarGate's administrator access policy. | CedarGate admins each get their own account, with access reviewed weekly. That's the plan we're using.
S | CedarGate chose individual accounts because AUD-031 could not attribute a settings change. | The user recorded the rationale for CedarGate's account policy. | In CedarGate AUD-031 we couldn't tell who changed the setting. That's why we chose individual accounts.
B | CedarGate audit exports must remain inside the Taiwan workspace. | CedarGate audit exports are restricted to the Taiwan workspace. | Keep CedarGate audit exports in the Taiwan workspace, please.
B | Iris owns CedarGate access review reminders. | Iris owns CedarGate's access review reminders. | Iris should own CedarGate access-review reminders.
B | Iris only proofreads CedarGate's public status page. | Iris only proofreads CedarGate's public status copy. | Iris just proofreads the CedarGate public status page; that isn't access administration.
S | CedarGate's hardware-key pilot remains proposed. | The user retained a CedarGate access-security proposal. | CedarGate hardware-key pilot stays proposed. We haven't authorized that pilot.
`, 'CedarGate selected the fictional KestrelKey company as its hardware-key manufacturer.'),
];

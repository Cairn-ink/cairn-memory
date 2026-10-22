import { family } from './source.mjs';
export default [
family('fam-018','operations','zh','青禾印務交貨安排',['青禾印務','陳經理','九月單'],true,`
B | 青禾印務三月訂單採週五到貨。 | 使用者三月選定青禾印務週五到貨。 | 青禾印務三月的單就週五到，先照這樣。
B | 青禾印務八月起改為週三到貨。 | 使用者八月把青禾印務到貨日改為週三。 | 青禾印務八月開始改週三到，這個決定了。
S | 青禾印務改交貨日是因為週四要組裝活動資料袋。 | 使用者補充青禾印務交貨日變更的原因。 | 青禾印務要週三到是因為我們週四裝資料袋，週五來根本來不及。
S | 青禾印務九月單的運費上限為 NT$360。 | 使用者設定青禾印務九月單運費上限。 | 青禾印務九月單運費最多 NT$360，超過先回來問。
B | 陳經理負責青禾印務收貨點交。 | 使用者指定陳經理處理青禾印務收貨。 | 青禾印務收貨點交找陳經理。
B | 青禾印務樣本冊仍在週五寄出。 | 使用者保留青禾印務樣本冊週五寄出的安排。 | 青禾印務樣本冊還是週五寄，不是正式訂單到貨那件事。
S | 青禾印務的急件包月方案被拒絕。 | 使用者記下青禾印務一項未採用的方案。 | 青禾印務急件包月先拒絕，不能把它當已簽。
`, '青禾印務九月單指定的貨車車牌為合成牌號 TST-062。'),
family('fam-019','operations','en','MapleDesk onboarding cadence',['MapleDesk','Evan','H-084'],true,`
B | MapleDesk originally held onboarding once a month in March. | The user originally chose monthly MapleDesk onboarding. | MapleDesk onboarding once a month is the March plan.
S | MapleDesk changed onboarding to every second Tuesday in August. | The user changed MapleDesk's onboarding cadence. | MapleDesk onboarding moves to every second Tuesday from August. That's the new cadence.
S | MapleDesk changed cadence because new hires were waiting up to 23 days for access briefings. | The user recorded why MapleDesk onboarding changed. | MapleDesk new hires were waiting as long as 23 days for access briefings. That's why we changed it.
B | MapleDesk onboarding groups may contain at most four new hires. | The user capped each MapleDesk onboarding group at four people. | Keep MapleDesk onboarding groups to four new hires maximum.
B | Evan owns MapleDesk's H-084 onboarding checklist. | Evan owns the MapleDesk H-084 onboarding checklist. | Evan should own the MapleDesk H-084 onboarding checklist, please.
B | MapleDesk's equipment inventory remains monthly. | MapleDesk equipment inventory still runs once a month. | MapleDesk equipment inventory is still monthly; only onboarding moved.
S | MapleDesk's fully recorded onboarding option remains proposed. | The user retained another MapleDesk onboarding format for review. | MapleDesk all-recorded onboarding is only proposed. Nobody approved replacing the sessions.
`),
family('fam-020','operations','mixed','海杏客服輪班',['海杏客服','小葉','roster'],true,`
B | 海杏客服三月採每週換一次值班人。 | 使用者三月為海杏客服採週輪班 roster。 | 海杏客服三月 roster 先一週換一個人。
B | 海杏客服八月改為每天中午交班。 | 使用者八月讓海杏客服改為每日中午 handoff。 | 海杏客服八月起每天中午 handoff，新的排法就這個。
S | 海杏客服改班是因為週輪班讓未結案件累積七天。 | 使用者記錄海杏客服改班的原因。 | 海杏客服週輪班會讓未結案件卡七天，所以才改 handoff 節奏。
S | 海杏客服交班時必須留下下一步與案件編號。 | 使用者為海杏客服 handoff 設定必要內容。 | 海杏客服 handoff 一定留下一步跟 ticket 編號，少一個都不行。
B | 小葉負責海杏客服的交班表。 | 使用者指定小葉維護海杏客服 handoff 表。 | 海杏客服 handoff 表給小葉整理。
B | 小葉只替海杏客服新人班確認教室。 | 使用者讓小葉只確認海杏客服新人班 room。 | 海杏客服新人班小葉只確認 room，別把講課也排給他。
S | 海杏客服外包夜班方案仍是提案。 | 使用者保留海杏客服夜班 outsource 選項。 | 海杏客服夜班 outsource 先留提案，沒有批准。
`),
family('fam-021','operations','zh','柏舟面試安排',['柏舟招募','小林','七二'],false,`
B | 柏舟招募拒絕以免費試做作為第一關。 | 使用者拒絕柏舟招募第一關免費試做。 | 柏舟招募第一關別叫人免費做東西，這個方案不要。
B | 柏舟招募第一關採二十分鐘案例討論。 | 使用者決定柏舟招募先做二十分鐘案例討論。 | 柏舟招募第一關就二十分鐘案例討論，這樣定。
S | 柏舟招募採討論是因為候選人多半仍有正職。 | 使用者記錄柏舟招募第一關形式的理由。 | 柏舟招募來的人多半還有正職，所以第一關才選討論，別塞回家作業。
S | 柏舟招募不得安排週六面試。 | 使用者設定柏舟招募的面試日期限制。 | 柏舟招募週六不要排面試，其他天再找空檔。
B | 小林負責柏舟招募的案例題維護。 | 使用者指定小林維護柏舟招募案例題。 | 柏舟招募案例題讓小林維護。
B | 柏舟招募編號七二的場地費為 NT$1,200。 | 使用者記下柏舟招募七二場地費一千二。 | 柏舟招募七二那場場地是一千二，不是給候選人的費用。
S | 柏舟招募增加人格測驗的選項被拒絕。 | 使用者記錄柏舟招募一項未採用的測驗。 | 柏舟招募人格測驗那個選項拒絕，不用安排。
`, '柏舟招募錄取通知的寄件人全名為林映秋。'),
family('fam-022','operations','en','DockPetal vendor check-in',['DockPetal','Iris','V-360'],false,`
B | DockPetal rejected daily supplier calls. | The user rejected daily supplier calls for DockPetal. | DockPetal suppliers don't need a call every day. Reject that option.
S | DockPetal selected a vendor check-in on the third Thursday each month. | The user set DockPetal's vendor check-in schedule. | DockPetal vendor check-in is the third Thursday each month. That's the slot we selected.
S | DockPetal selected monthly calls because order changes arrive in a single monthly batch. | The user explained DockPetal's vendor check-in cadence. | DockPetal order changes come as one monthly batch, which is why monthly calls make sense here.
B | DockPetal supplier calls must use an agenda sent one day earlier. | DockPetal supplier-call agendas must be sent a day in advance. | Send the DockPetal supplier agenda a day before the call, please.
B | Iris owns DockPetal's V-360 supplier contact list. | Iris owns the DockPetal V-360 supplier contact list. | Iris should own DockPetal's V-360 supplier contacts.
B | DockPetal delivery tracking is reviewed daily. | DockPetal delivery tracking still receives a daily review. | DockPetal delivery tracking is a daily review. That isn't the supplier call schedule.
S | DockPetal's joint supplier chat room remains proposed. | The user retained a DockPetal communication proposal. | DockPetal joint supplier chat stays proposed. Don't create the room yet.
`),
family('fam-023','operations','zh','南隅辦公室採購',['南隅辦公室','陳經理','九月'],false,`
B | 南隅辦公室拒絕自動續訂文具箱。 | 使用者拒絕南隅辦公室文具箱自動續訂。 | 南隅辦公室文具箱不要自動續，這方案我不要。
B | 南隅辦公室每月盤點後按缺項採購。 | 使用者決定南隅辦公室先月盤點再補缺項。 | 南隅辦公室每月先點，再照缺的買，採這個方式。
S | 南隅辦公室按缺項買是因為倉庫已有六箱未拆原子筆。 | 使用者記錄南隅辦公室調整採購方式的原因。 | 南隅辦公室倉庫還有六箱原子筆沒拆，所以不要再整箱自動寄。
S | 南隅辦公室單筆文具採購上限為 NT$2,200。 | 使用者為南隅辦公室文具採購設上限。 | 南隅辦公室文具一筆最多 NT$2,200，超過另提。
B | 陳經理負責南隅辦公室文具盤點。 | 使用者指定陳經理盤點南隅辦公室文具。 | 南隅辦公室文具盤點讓陳經理接。
B | 南隅辦公室九月飲水機保養費為 NT$2,200。 | 使用者記下南隅辦公室九月飲水機保養費。 | 南隅辦公室九月飲水機保養也是兩千二，別算進文具額度。
S | 南隅辦公室租用印表機的選項仍是提案。 | 使用者保留南隅辦公室設備租用提案。 | 南隅辦公室租印表機還是提案，沒核可喔。
`),
family('fam-024','operations','zh','松汀活動出席確認',['松汀活動','小周','八月場'],false,`
B | 松汀活動拒絕把未回覆者當成出席。 | 使用者拒絕松汀活動默認出席的方式。 | 松汀活動沒回的別當會來，這方案不採用。
B | 松汀活動以明確回覆出席才保留座位。 | 使用者決定松汀活動只為明確回覆者留位。 | 松汀活動要明確說會來才留位，定這個規則。
S | 松汀活動採此規則是因為八月場空了十八個預留座。 | 使用者補充松汀活動留位規則的理由。 | 松汀活動八月那場空十八個保留位，所以才要真的確認。
S | 松汀活動的出席回覆截止時間是前一日中午。 | 使用者記下松汀活動出席確認期限。 | 松汀活動前一天中午截止回覆，餐點得抓數量。
B | 小周負責松汀活動座位名單。 | 使用者指定小周整理松汀活動座位名單。 | 松汀活動座位名單讓小周整理。
B | 小周只替松汀活動候補名單校正錯字。 | 使用者讓小周只校正松汀活動候補名單錯字。 | 松汀活動候補名單小周只改錯字，別直接替人轉正。
S | 松汀活動收取保留金的選項仍是提案。 | 使用者保留松汀活動保留金方案。 | 松汀活動保留金還在提案，先不要收。
`),
];

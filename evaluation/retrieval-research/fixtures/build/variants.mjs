// Only the owner fact changes rendering language. Canonical statements stay in
// the family's main language, enabling cross-language authoring in both directions.
export const crossLanguage = {
'fam-002': ['zh','使用者指定 Mina 負責 RelayCart 快取失效測試。','RelayCart 快取失效測試讓 Mina 接，她負責這塊。'],
'fam-004': ['zh','使用者指定 Evan 處理 TracePond 的 INC-0621 後續追蹤。','TracePond 的 INC-0621 後續給 Evan 接，他負責追完。'],
'fam-006': ['zh','使用者指定 Noah 負責 ByteOrchard 佇列容量警報。','ByteOrchard 佇列容量警報給 Noah 負責。'],
'fam-008': ['zh','使用者指定 Zoe 負責 HarborLint PR #206 相依套件稽核。','HarborLint PR #206 的相依套件稽核讓 Zoe 接。'],
'fam-010': ['zh','使用者指定 Iris 負責 CedarGate 權限審查提醒。','CedarGate 權限審查提醒讓 Iris 負責。'],
'fam-012': ['zh','使用者指定 Mina 準備 OpsSync 創辦人會議議程。','OpsSync 創辦人會議議程給 Mina 準備。'],
'fam-019': ['zh','使用者指定 Evan 負責 MapleDesk H-084 新人到職清單。','MapleDesk H-084 新人清單讓 Evan 負責。'],
'fam-022': ['zh','使用者指定 Iris 負責 DockPetal V-360 供應商聯絡名單。','DockPetal V-360 供應商聯絡名單給 Iris 接。'],
'fam-026': ['zh','使用者指定 Mina 負責 BlueReed 發票核可紀錄。','BlueReed 發票核可紀錄讓 Mina 負責。'],
'fam-030': ['zh','使用者指定 Evan 負責 AmberBooks 例外項目表。','AmberBooks 例外項目表給 Evan 接，他負責這份。'],
'fam-003': ['en','The user assigned 陳經理 to renew the 霧港 notification contract.','Please give the 霧港 notification contract renewal to 陳經理. He owns the vendor contact.'],
'fam-005': ['en','The user assigned 小周 to the 杉橋 PR #128 rollback drill.','Have 小周 handle the 杉橋 PR #128 rollback drill, please.'],
'fam-007': ['en','The user assigned 阿哲 to maintain the 石澗 restore-verification records.','阿哲 should maintain the 石澗 restore-verification records. Please give him that task.'],
'fam-009': ['en','The user assigned 小許 to the 竹浪 test-database cleanup schedule.','Give 小許 the 竹浪 test-database cleanup schedule. He owns that schedule.'],
'fam-011': ['en','The user assigned 小林 to consolidate the 營運週報 pending decisions.','Have 小林 consolidate the pending decisions for 營運週報, please.'],
'fam-013': ['en','The user assigned 小周 to the first proofreading round of 投資人信.','Please have 小周 do the first proofreading pass on 投資人信.'],
'fam-015': ['en','The user assigned 小許 to organize the 澄清卡 assumptions list.','小許 should organize the 澄清卡 assumptions list, please.'],
'fam-016': ['en','The user assigned 陳經理 to fill in the 錯誤小報 operations-impact field.','Give 陳經理 the operations-impact field on 錯誤小報. He should fill that in.'],
'fam-017': ['en','The user assigned 小葉 to check 月底提醒 delivery.','Please have 小葉 check whether 月底提醒 was delivered.'],
'fam-018': ['en','The user assigned 陳經理 to the 青禾印務 goods receipt and count.','陳經理 should receive and count the 青禾印務 delivery. Give him that responsibility.'],
};

// A second independently dated utterance supports the related-attribute fact.
export const replays = {
'fam-001': '月報庫 backup 再確認，小林看排程就好，不要叫他執行。',
'fam-002': 'Just confirming RelayCart images: edge retention is still 24 hours, separate from response caching.',
'fam-003': '霧港再確認一下，陳經理收每週延遲摘要就好，值班另排。',
'fam-004': 'For TracePond, Evan reviews the dashboard palette only. Dashboard uptime belongs elsewhere.',
'fam-005': '杉橋再補一下，小周在 PR #182 只負責校文案。',
'fam-011': '營運週報小林還是只對財務數字，沒有付款核准權喔。',
'fam-012': 'OpsSync engineering office hours are still Monday 09:00 Taipei time. Confirming that separate slot.',
'fam-013': '投資人信周五版小周就檢查連結，這點幫我再記一下。',
'fam-015': '澄清卡教學影片小許只上字幕，沒有其他權限。',
'fam-018': '青禾印務樣本冊還是週五寄，這點再確認一次。',
'fam-020': '海杏客服新人班小葉只管 room 確認，不是講師。',
'fam-022': 'DockPetal delivery tracking is still reviewed daily, just to confirm the separate cadence.',
'fam-025': '財務月報附件還是每月五號收完，剛剛那個截止沒有動。',
'fam-026': 'Confirming BlueReed INV-260841 face amount: NT$16,800. This is the other invoice.',
'fam-027': '映川帳手續費歸類月底一次做，這個頻率再記一下。',
'fam-029': '拾禾發票八一四對的是第二批驗收，再提醒一次別用第一批。',
'fam-033': '潮頁進階設定還保留六步，這個另外記清楚。',
'fam-034': 'TideNote public preview stays HTML. Confirming that separately from exports.',
'fam-035': '砂岬 saved list 依舊只顯示標題，這塊沒一起調。',
'fam-039': '午餐單週五仍送二樓茶水間，再確認一次地點。',
};

// Independently extracted notes for the confirmation conversations. These
// preserve the same complete facts while avoiding admission deduplication.
export const replayBodies = {
'fam-001': '小林只審查月報庫 backup 排程，不負責執行。',
'fam-002': 'RelayCart keeps image objects in its edge cache for 24 hours.',
'fam-003': '陳經理只收霧港每週延遲摘要，不負責值班。',
'fam-004': 'Evan only reviews TracePond dashboard colors; uptime is assigned elsewhere.',
'fam-005': '小周在杉橋 PR #182 僅負責校對文字。',
'fam-011': '小林只校對營運週報財務數字，沒有付款核准權。',
'fam-012': 'OpsSync retains Monday 09:00 Taipei time for engineering office hours.',
'fam-013': '小周對投資人信周五版只做連結檢查。',
'fam-015': '小許在澄清卡教學影片只負責字幕。',
'fam-018': '青禾印務樣本冊仍安排週五寄出。',
'fam-020': '小葉在海杏客服新人班只負責確認 room。',
'fam-022': 'DockPetal continues to review delivery tracking daily.',
'fam-025': '財務月報附件仍須在每月五日收齊。',
'fam-026': 'BlueReed invoice INV-260841 has a face amount of NT$16,800.',
'fam-027': '映川帳手續費仍在月底一次歸類。',
'fam-029': '拾禾發票八一四對應的驗收批次是第二批。',
'fam-033': '潮頁進階設定仍採六步流程。',
'fam-034': 'TideNote continues to use HTML for public previews.',
'fam-035': '砂岬 saved list 仍維持只顯示標題。',
'fam-039': '午餐單週五的送達地點仍是二樓茶水間。',
};

// Foreign facts imitate target row 2, changing one answer-bearing attribute.
export const foreignPairs = [
['engineering', [
 ['fam-001','mixed','月報庫八月改用 MariaDB。','使用者八月決定月報庫改用 MariaDB。','月報庫八月這次定 MariaDB，就採這個。'],
 ['fam-003','zh','霧港通知八月改用赤榆供應商。','使用者八月將霧港通知改交赤榆。','霧港通知八月換赤榆，新通知就走這家。'],
]],
['engineering', [
 ['fam-002','en','RelayCart changed its response-cache TTL to 45 seconds in August.','The user changed RelayCart response-cache TTL to 45 seconds in August.','RelayCart response cache is 45 seconds from August. That is the adopted value.'],
 ['fam-004','en','TracePond changed incident alerts to SMS in August.','The user changed TracePond incident alerts to SMS in August.','TracePond incident alerts go to SMS from August onward. Use that channel.'],
]],
['work-preferences', [
 ['fam-011','zh','營運週報八月改為兩行摘要加待決事項。','使用者八月將營運週報改為兩行摘要與待決事項。','營運週報八月起兩行摘要接待決事項，定這版。'],
 ['fam-013','zh','投資人信八月改為冷靜的條列語氣。','使用者八月讓投資人信採冷靜條列語氣。','投資人信八月起冷靜條列，這版定了。'],
]],
['work-preferences', [
 ['fam-012','en','OpsSync founder meetings moved to Thursday 11:15 Taipei time in August.','The user moved OpsSync founder meetings to Thursday 11:15 Taipei time.','OpsSync founder meeting moves to Thursday 11:15 Taipei time from August.'],
 ['fam-014','mixed','決策便條八月改存在 PebbleDock 決策頁。','使用者八月把決策便條改存 PebbleDock 決策頁。','決策便條八月起放 PebbleDock 的決策頁，就這個。'],
]],
['operations', [
 ['fam-018','zh','青禾印務八月起改為週二到貨。','使用者八月將青禾印務到貨日改為週二。','青禾印務八月起週二到，這個新的日期定了。'],
 ['fam-020','mixed','海杏客服八月改為每天傍晚六點交班。','使用者八月讓海杏客服每日十八點 handoff。','海杏客服八月起每天十八點 handoff，照這個排。'],
]],
['operations', [
 ['fam-019','en','MapleDesk changed onboarding to every second Wednesday in August.','The user changed MapleDesk onboarding to every second Wednesday.','MapleDesk onboarding is every second Wednesday from August onward.'],
 ['fam-021','zh','柏舟招募第一關採三十分鐘案例討論。','使用者決定柏舟招募第一關先做三十分鐘案例討論。','柏舟招募第一關三十分鐘案例討論，這個採用了。'],
]],
['finance', [
 ['fam-025','zh','財務月報八月改為次月八日交付。','使用者八月將財務月報改為次月八日交。','財務月報八月起下個月八號交，這是新規則。'],
 ['fam-027','zh','映川帳八月改為每週四對帳。','使用者八月讓映川帳改為每週四對帳。','映川帳八月起每週四對，頻率定了。'],
]],
['finance', [
 ['fam-026','en','BlueReed selected oral-only invoice approval from August.','The user selected oral-only BlueReed invoice approval in August.',"BlueReed invoice approvals from August are oral only. That's the chosen method."],
 ['fam-028','mixed','雲鷺帳八月服務費月預算改為 NT$15,000。','使用者八月將雲鷺帳 monthly budget 改為 NT$15,000。','雲鷺帳八月 monthly budget 改 NT$15,000，核這個數。'],
]],
['product', [
 ['fam-033','zh','潮頁八月改為先做三個範例再設定。','使用者八月讓潮頁先做三個範例才設定。','潮頁八月起先做三個範例再設定，就定這樣。'],
 ['fam-035','mixed','砂岬八月改為顯示標題與修改日期。','使用者八月在砂岬 result list 顯示標題與修改日期。','砂岬八月 result list 放標題和 modified date，定了。'],
]],
['everyday', [
 ['fam-039','zh','午餐單八月改為週三送地下一樓接待桌。','使用者八月把週三午餐單改送地下一樓接待桌。','午餐單八月起週三送地下一樓接待桌，地點改這裡。'],
 ['fam-040','mixed','雨具卡只在步行日有降雨預報時提醒。','使用者決定雨具卡在 walking 日有雨預報時才提醒。','雨具卡就 walking 日有雨預報才 reminder，這個定了。'],
]],
];

// Ten foreign-only anchors, one per independent foreign family, not absent facts.
export const foreignAnchors = [
 ['zh','曜浦組的展示倉庫取件碼是 LANTERN-642。','曜浦組展示倉庫取件碼記 LANTERN-642，只有這邊會用。','曜浦組','LANTERN-642'],
 ['en','LanternDesk labels its prototype cabinet CAB-903.','LanternDesk prototype cabinet label is CAB-903. Please keep that exact code.','LanternDesk','CAB-903'],
 ['zh','雪庭組的紙本資料箱代碼為 SNOW-271。','雪庭組紙本箱記 SNOW-271，代碼別少一碼。','雪庭組','SNOW-271'],
 ['en','QuartzOffice calls its rehearsal room QR-518.',"QuartzOffice rehearsal room is QR-518. That's the room code.",'QuartzOffice','QR-518'],
 ['zh','榆燈組的寄物櫃識別碼為 ELM-806。','榆燈組寄物櫃識別碼 ELM-806，先記好。','榆燈組','ELM-806'],
 ['en','JuniperCrew marks its practice crate JC-374.','JuniperCrew practice crate code is JC-374. Put that on the label.','JuniperCrew','JC-374'],
 ['zh','汐舟組的練習帳冊封套代碼是 TIDE-953。','汐舟組練習帳冊封套 TIDE-953，別跟別組混。','汐舟組','TIDE-953'],
 ['mixed','霧島組的 sample folder 代碼為 MIST-428。','霧島組 sample folder 記 MIST-428，這組專用。','霧島組','MIST-428'],
 ['zh','鹿砂組的模型架代碼是 DEER-167。','鹿砂組模型架記 DEER-167，就這個代碼。','鹿砂組','DEER-167'],
 ['zh','星榕組的雨具展示箱代碼是 STAR-695。','星榕組雨具展示箱記 STAR-695，合成展示用的。','星榕組','STAR-695'],
];

import { family } from './source.mjs';
export default [
family('fam-011','work-preferences','zh','營運週報的格式',['營運週報','小林','三行摘要'],true,`
B | 營運週報三月使用完整逐日流水帳。 | 使用者三月採用營運週報逐日流水帳。 | 營運週報三月先把每天做的事列完，先用流水帳。
B | 營運週報八月改成三行摘要加待決事項。 | 使用者八月將營運週報改為三行摘要與待決事項。 | 營運週報改三行摘要再接待決事項，八月開始照這版。
S | 營運週報改版是因為使用者通常在搭捷運時用手機閱讀。 | 使用者說明營運週報縮短格式的原因。 | 營運週報我大多在捷運上拿手機看，流水帳根本滑不完，所以才縮。
S | 營運週報摘要不得超過一百八十個中文字。 | 使用者替營運週報摘要設定字數限制。 | 營運週報摘要最多一百八十個中文字，手機一眼能看完。
B | 小林負責營運週報的待決事項整理。 | 使用者指定小林整理營運週報待決事項。 | 營運週報待決事項給小林收斂一下。
B | 小林在營運週報只校對財務數字，不核准付款。 | 使用者讓小林只校對營運週報財務數字，不核准付款。 | 營運週報數字小林幫忙對，但不要把付款核准算進來。
S | 營運週報附上每日工時的方案已被拒絕。 | 使用者記錄營運週報另一個欄位方案的結果。 | 營運週報不要加每日工時，那個方案我不採用。
`, '營運週報指定的字體是思源黑體。'),
family('fam-012','work-preferences','en','Founder assistant meeting window',['OpsSync','Mina','Taipei'],true,`
B | OpsSync founder meetings originally used Monday at 09:00 Taipei time. | The user originally scheduled OpsSync founder meetings for Monday 09:00 in Taipei. | OpsSync founder meeting, Monday nine in Taipei for the March arrangement.
S | OpsSync founder meetings moved to Tuesday at 10:30 Taipei time in August. | The user changed the OpsSync founder meeting window. | OpsSync founder meetings are Tuesday at 10:30, Taipei time, from August. Put that down exactly.
S | OpsSync meetings moved because Monday mornings are reserved for customer follow-up. | The user explained the OpsSync scheduling change. | OpsSync had to move because Monday mornings are my customer follow-up block.
B | OpsSync founder meetings must finish within 25 minutes. | The user capped OpsSync founder meetings at 25 minutes. | Keep the OpsSync founder meeting under twenty-five minutes, please.
B | Mina prepares the OpsSync founder agenda. | Mina owns preparation of the OpsSync founder agenda. | Have Mina prepare the OpsSync founder agenda.
B | OpsSync engineering office hours remain Monday at 09:00 Taipei time. | OpsSync engineering office hours remain Monday 09:00 Taipei time. | The OpsSync engineering office hour is still Monday nine in Taipei. Different meeting.
S | OpsSync's Friday founder meeting option was rejected. | The user recorded a rejected OpsSync meeting slot. | Reject the OpsSync Friday founder slot; don't leave it looking confirmed.
`),
family('fam-013','work-preferences','zh','給投資人的更新語氣',['投資人信','小周','周五'],true,`
B | 投資人信三月使用正式公文語氣。 | 使用者三月讓投資人信採正式公文語氣。 | 投資人信三月先正式一點，公文那種口氣。
B | 投資人信八月改為直接且口語的語氣。 | 使用者八月決定投資人信採直接口語語氣。 | 投資人信八月起直接講重點，口語就好。
S | 投資人信改語氣是因為兩位讀者把客套話誤讀成承諾。 | 使用者補充投資人信改語氣的理由。 | 投資人信那兩位把客套話當成承諾了，所以才改成白話講清楚。
S | 投資人信不得使用保證成長的措辭。 | 使用者為投資人信設定措辭限制。 | 投資人信不要寫保證成長，這句再漂亮也不能放。
B | 小周負責投資人信的第一輪校對。 | 使用者指定小周先校對投資人信。 | 投資人信第一輪讓小周幫我看一下。
B | 小周在投資人信只檢查周五版本的連結。 | 使用者請小周只檢查投資人信周五版連結。 | 投資人信周五那版小周只查連結，不要順手重寫整封。
S | 投資人信加入大量表情符號的方案被拒絕。 | 使用者記下投資人信一項被拒絕的風格選項。 | 投資人信那個滿版表情符號版本不要，我拒絕那版。
`),
family('fam-014','work-preferences','mixed','決策便條的保存工具',['決策便條','阿哲','PaperNest'],true,`
B | 決策便條三月存在聊天置頂訊息。 | 使用者三月把決策便條保存在 chat 置頂。 | 決策便條先放 chat 置頂，三月這批照這個走。
B | 決策便條八月改存在 PaperNest 的決策頁。 | 使用者八月把決策便條改存 PaperNest 決策頁。 | 決策便條之後放 PaperNest 決策頁，八月開始就用這個。
S | 決策便條換工具是因為置頂訊息不能標示撤回原因。 | 使用者補充決策便條搬遷的原因。 | 決策便條換地方是因為 chat 置頂沒辦法記撤回原因，不是嫌它難找。
S | 決策便條頁面必須能匯出純文字。 | 使用者為決策便條設定 export 條件。 | 決策便條一定要能 export 純文字，別只有截圖。
B | 阿哲負責決策便條每週的連結檢查。 | 使用者指定阿哲每週檢查決策便條 links。 | 決策便條 links 每週讓阿哲點一遍。
B | 阿哲只替決策便條範例頁換封面。 | 使用者讓阿哲只調整決策便條 demo 頁封面。 | 決策便條 demo 頁阿哲只換封面，不是要他改正式決定。
S | 決策便條自動公開分享的選項被拒絕。 | 使用者記錄決策便條的一項分享選項。 | 決策便條 auto public 那個選項拒絕，不要開。
`, '決策便條頁面固定使用的標籤顏色是靛藍色。'),
family('fam-015','work-preferences','zh','助理提出澄清的節奏',['澄清卡','小許','三點'],false,`
B | 澄清卡拒絕每個小步驟都要求使用者確認的方式。 | 使用者拒絕澄清卡逐步確認模式。 | 澄清卡不要每做一步就來問我，這種流程不要。
B | 澄清卡採用先列假設再繼續可逆工作的方式。 | 使用者偏好澄清卡先列假設並繼續可逆工作。 | 澄清卡先把假設列出來，可逆的事繼續做，我選這個方式。
S | 澄清卡採此方式是因為使用者下午三點前常在訪談。 | 使用者說明澄清卡降低打斷的原因。 | 澄清卡少打斷是因為我下午三點前常在訪談，沒辦法一直回。
S | 澄清卡遇到付款金額未定時必須停止並詢問。 | 使用者記下澄清卡需要停下的例外。 | 澄清卡如果付款金額還沒定就停，這個一定要問我。
B | 小許負責澄清卡假設清單的整理。 | 使用者指定小許整理澄清卡假設清單。 | 澄清卡假設清單給小許整理。
B | 小許只替澄清卡教學影片上字幕。 | 使用者讓小許只處理澄清卡教學影片字幕。 | 澄清卡教學影片小許只上字幕，別把他當付款窗口。
S | 澄清卡每小時提醒一次的選項仍是提案。 | 使用者保留澄清卡提醒頻率提案。 | 澄清卡每小時提醒還只是提案，先別真的發。
`),
family('fam-016','work-preferences','zh','錯誤回報的排列',['錯誤小報','陳經理','編號四七'],false,`
B | 錯誤小報拒絕只貼完整執行紀錄。 | 使用者拒絕錯誤小報只附整份紀錄的格式。 | 錯誤小報別整包紀錄丟過來就結束，這種我不要。
B | 錯誤小報先寫影響再寫復原辦法。 | 使用者偏好錯誤小報先說影響、再說復原辦法。 | 錯誤小報先告訴我影響誰，再寫怎麼救，照這順序。
S | 錯誤小報採此順序是因為陳經理要先判斷是否停單。 | 使用者記錄錯誤小報排序的原因。 | 錯誤小報陳經理要先判斷停不停單，所以影響得擺前面。
S | 錯誤小報必須附上實際結束碼。 | 使用者為錯誤小報設定必要欄位。 | 錯誤小報記得放實際結束碼，不要只截最後兩行。
B | 陳經理負責錯誤小報的營運影響欄。 | 使用者指定陳經理填錯誤小報營運影響。 | 錯誤小報營運影響那格給陳經理填。
B | 錯誤小報編號四七只是版面範例，不代表真實事故。 | 使用者將錯誤小報編號四七標為版面範例，非真實事故。 | 錯誤小報四七是拿來試版面的，別當成真的事故。
S | 錯誤小報加上責任排名的提案被拒絕。 | 使用者記下錯誤小報一項被否決的欄位。 | 錯誤小報責任排名不要做，那個提案拒絕。
`),
family('fam-017','work-preferences','zh','月底提醒渠道',['月底提醒','小葉','晚間'],false,`
B | 月底提醒拒絕使用語音電話。 | 使用者拒絕月底提醒以語音電話通知。 | 月底提醒不要打電話，這個渠道我不採用。
B | 月底提醒使用文字訊息寄到營運收件匣。 | 使用者偏好月底提醒以文字寄到營運收件匣。 | 月底提醒就文字丟營運收件匣，我會看那裡。
S | 月底提醒使用文字是因為使用者晚間不方便接聽。 | 使用者記錄月底提醒採文字的理由。 | 月底提醒用文字是因為我晚間不方便接電話，不是訊號不好。
S | 月底提醒在台北時間晚上八點後不得發送。 | 使用者替月底提醒設定安靜時段。 | 月底提醒台北晚上八點後不要發，留到隔天。
B | 小葉負責月底提醒的發送檢查。 | 使用者指定小葉檢查月底提醒發送。 | 月底提醒有沒有送到讓小葉看一下。
B | 小葉只為月底提醒測試帳號重設密碼。 | 使用者讓小葉只重設月底提醒測試帳號密碼。 | 月底提醒測試帳號小葉只幫忙重設密碼，不管正式匣子。
S | 月底提醒的簡訊副本仍是提案。 | 使用者保留月底提醒副本渠道提案。 | 月底提醒簡訊副本先當提案，還沒同意啟用。
`),
];

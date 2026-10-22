import { family } from './source.mjs';
export default [
family('fam-025','finance','zh','九月月報交付日',['財務月報','陳會計','九月'],true,`
B | 財務月報三月原定次月十日交付。 | 使用者三月把財務月報交付日定為次月十日。 | 財務月報先每個月下個月十號交，三月照這樣。
B | 財務月報八月改為次月七日交付。 | 使用者八月把財務月報交付日改為次月七日。 | 財務月報八月開始改下個月七號交，這次定了。
S | 財務月報提前是因為陳會計需要三天檢查稅別。 | 使用者記錄財務月報提前的原因。 | 財務月報提早是陳會計要三天查稅別，不是銀行要我們提早。
S | 九月財務月報須在十月七日台北時間下午五點前交付。 | 使用者補充九月財務月報的確切截止時間。 | 九月財務月報十月七號台北下午五點前給我，時間記一下。
B | 陳會計負責財務月報稅別檢查。 | 使用者指定陳會計檢查財務月報稅別。 | 財務月報稅別讓陳會計看。
B | 財務月報附件收集仍在每月五日截止。 | 使用者保留財務月報附件每月五日的收件期限。 | 財務月報附件還是五號收完，那不是最後交付日。
S | 財務月報自動寄給投資人的方案被拒絕。 | 使用者記下財務月報一項未採用的寄送方案。 | 財務月報自動寄投資人那案拒絕，先別串發送。
`, '財務月報九月版的加密密碼為合成字串 PAPER-72。'),
family('fam-026','finance','en','BlueReed invoice approval',['BlueReed','Mina','INV-260814'],true,`
B | BlueReed originally allowed verbal invoice approval in March. | The user originally allowed spoken BlueReed invoice approval. | BlueReed invoice approval can be verbal for March. We'll use that arrangement.
S | BlueReed required written invoice approval from August. | The user changed BlueReed's invoice approval method. | BlueReed invoices need written approval from August onward. That's decided.
S | BlueReed changed approval because INV-260814 was paid twice after a verbal handoff. | The user explained BlueReed's invoice approval change. | BlueReed INV-260814 got paid twice after a verbal handoff. That's the reason we're changing approval.
B | BlueReed invoice INV-260814 has a face amount of NT$18,600. | BlueReed INV-260814 is an invoice for NT$18,600. | Record BlueReed INV-260814 at eighteen thousand six hundred Taiwan dollars, face amount.
B | Mina owns BlueReed invoice approval records. | Mina owns the BlueReed invoice approval records. | Assign Mina the BlueReed approval records, please.
B | BlueReed invoice INV-260841 has a face amount of NT$16,800. | BlueReed INV-260841 is an invoice for NT$16,800. | BlueReed INV-260841 is sixteen thousand eight hundred, different invoice from 260814.
S | BlueReed's automatic payment-release option remains proposed. | The user retained a BlueReed payment automation proposal. | BlueReed automatic payment release is still proposed. No approval to enable it.
`),
family('fam-027','finance','zh','映川對帳頻率',['映川帳','小葉','八月'],true,`
B | 映川帳三月採月底一次對帳。 | 使用者三月選擇映川帳月底集中對帳。 | 映川帳三月就月底一次對完，先用這個方式。
B | 映川帳八月改成每週二對帳。 | 使用者八月讓映川帳改為每週二對帳。 | 映川帳八月起每週二對，決定照這個頻率。
S | 映川帳增加頻率是因為七月有九筆退款跨月未配對。 | 使用者記錄映川帳調整對帳頻率的原因。 | 映川帳七月九筆退款拖到跨月還沒配上，所以才改每週。
S | 映川帳未配對差額超過 NT$500 時須通知使用者。 | 使用者設定映川帳差額的通報門檻。 | 映川帳差額超過 NT$500 就跟我說，不要等月底再翻。
B | 小葉負責映川帳退款配對。 | 使用者指定小葉處理映川帳退款配對。 | 映川帳退款配對給小葉接。
B | 映川帳手續費歸類仍在月底一次處理。 | 使用者保留映川帳手續費月底歸類的安排。 | 映川帳手續費歸類還是月底做，那個沒改每週。
S | 映川帳直接沖銷小額差額的選項被拒絕。 | 使用者記下映川帳一項未採用的沖帳方式。 | 映川帳小額直接沖銷拒絕，還是得查來源。
`),
family('fam-028','finance','mixed','雲鷺服務費預算',['雲鷺帳','陳經理','Q4'],true,`
B | 雲鷺帳三月的服務費月預算為 NT$9,000。 | 使用者三月為雲鷺帳設定 monthly budget NT$9,000。 | 雲鷺帳三月的 monthly budget 先九千。
B | 雲鷺帳八月把服務費月預算改為 NT$12,000。 | 使用者八月把雲鷺帳 monthly budget 調為 NT$12,000。 | 雲鷺帳八月起 monthly budget 一萬二，這個核了。
S | 雲鷺帳增加預算是因為新增兩個夜間批次。 | 使用者補充雲鷺帳調高 budget 的原因。 | 雲鷺帳多兩個夜間 batch 才加預算，別寫成單價上漲。
S | 雲鷺帳 Q4 預算不含一次性的資料搬遷費。 | 使用者記下雲鷺帳 Q4 budget 的排除條件。 | 雲鷺帳 Q4 budget 不含一次 migration，這筆要另外提。
B | 陳經理負責雲鷺帳費用預警。 | 使用者指定陳經理收雲鷺帳 cost alerts。 | 雲鷺帳 cost alerts 給陳經理，他先看。
B | 雲鷺帳一次性測試額度為 NT$1,200。 | 使用者為雲鷺帳保留一次性 test credit NT$1,200。 | 雲鷺帳 test credit 是一千二，一次性的，別看成月預算。
S | 雲鷺帳年繳折扣方案仍是提案。 | 使用者保留雲鷺帳 annual billing 選項。 | 雲鷺帳 annual billing 還是提案，沒有同意綁一年。
`, '雲鷺帳年繳方案的折扣百分比為百分之八。'),
family('fam-029','finance','zh','拾禾發票附件',['拾禾發票','陳會計','八一四'],false,`
B | 拾禾發票拒絕只有付款截圖的送審方式。 | 使用者拒絕拾禾發票僅附付款截圖送審。 | 拾禾發票不要只有付款截圖，這種送審我不收。
B | 拾禾發票送審須附電子發票與驗收紀錄。 | 使用者決定拾禾發票附電子發票及驗收紀錄送審。 | 拾禾發票就電子發票加驗收紀錄一起送，定這樣。
S | 拾禾發票要求驗收紀錄是因為設備曾分兩批到貨。 | 使用者說明拾禾發票附件要求的原因。 | 拾禾發票那批設備之前分兩次到，才要驗收紀錄一起對。
S | 拾禾發票附件需在入帳後保留五年。 | 使用者設定拾禾發票附件保留期限。 | 拾禾發票附件入帳後留五年，別月底清掉。
B | 陳會計負責拾禾發票稅額核對。 | 使用者指定陳會計核對拾禾發票稅額。 | 拾禾發票稅額讓陳會計核一下。
B | 拾禾發票八一四的驗收批次為第二批。 | 使用者記下拾禾發票八一四對應第二批驗收。 | 拾禾發票八一四是第二批驗收，不要套第一批的日期。
S | 拾禾發票改用紙本快遞送審仍是提案。 | 使用者保留拾禾發票另一種送審方式。 | 拾禾發票紙本快遞那個還是提案，先不要叫車。
`),
family('fam-030','finance','en','AmberBooks accountant handoff',['AmberBooks','Evan','OCT-07'],false,`
B | AmberBooks rejected sending the accountant unclassified bank rows. | The user rejected an unclassified bank export for AmberBooks. | Don't send AmberBooks bank rows raw and unclassified. Reject that handoff format.
S | AmberBooks selected a categorized ledger plus an exceptions sheet for accountant handoff. | The user selected AmberBooks' accountant handoff package. | AmberBooks accountant handoff should be the categorized ledger and an exceptions sheet. Use that package.
S | AmberBooks includes exceptions because the accountant cannot infer the owner of mixed personal charges. | The user explained AmberBooks' exceptions sheet. | AmberBooks mixed personal charges don't identify their owner, so the accountant needs the exceptions sheet.
B | AmberBooks OCT-07 handoff closes at 16:00 Taipei time on October 7. | AmberBooks OCT-07 must be handed off by October 7 at 16:00 Taipei time. | AmberBooks OCT-07 closes October seventh at four in the afternoon, Taipei time.
B | Evan owns the AmberBooks exceptions sheet. | Evan owns the AmberBooks exceptions sheet. | Evan should own AmberBooks exceptions, please.
B | AmberBooks' receipt scan batch is due October 6 at 16:00 Taipei time. | AmberBooks receipt scans are due October 6 at 16:00 Taipei time. | AmberBooks receipt scans are due on the sixth at four Taipei, one day before handoff.
S | AmberBooks' direct accountant bank access remains proposed. | The user kept an AmberBooks accountant-access proposal open. | AmberBooks direct bank access for the accountant is proposed only. No permission granted.
`),
family('fam-031','finance','zh','北汀報銷核可',['北汀報銷','小許','九月'],false,`
B | 北汀報銷拒絕由申請人自行核可。 | 使用者拒絕北汀報銷自行申請自行核可。 | 北汀報銷自己送自己批這個不要，不採用。
B | 北汀報銷由不同於申請人的營運負責人核可。 | 使用者決定北汀報銷由另一位營運負責人核可。 | 北汀報銷換一個營運負責人批，不能跟申請同一人。
S | 北汀報銷採雙人分工是因為九月曾重複報同一張車票。 | 使用者補充北汀報銷分工的理由。 | 北汀報銷九月同一張車票報兩次，才要分兩個人看。
S | 北汀報銷超過 NT$3,500 的單筆申請須使用者另簽。 | 使用者設定北汀報銷另簽門檻。 | 北汀報銷一筆超過 NT$3,500 再給我簽，記得是超過。
B | 小許負責北汀報銷的重複單據檢查。 | 使用者指定小許檢查北汀報銷重複單據。 | 北汀報銷重複單據小許幫忙抓。
B | 北汀報銷九月文具申請金額為 NT$350。 | 使用者記下北汀報銷九月文具申請三百五。 | 北汀報銷九月文具是三百五，別多打一個零。
S | 北汀報銷固定交通津貼的選項被拒絕。 | 使用者記錄北汀報銷一項被拒絕的替代方案。 | 北汀報銷改固定交通津貼那案拒絕，還是看單據。
`, '北汀報銷下一位代理核可者的姓名為阿岑。'),
family('fam-032','finance','zh','芒岸現金水位',['芒岸預備金','小葉','六月'],false,`
B | 芒岸預備金拒絕以營收預估替代現金餘額。 | 使用者拒絕芒岸預備金用營收預估當餘額。 | 芒岸預備金不要拿預估營收當現金，這種算法不要。
B | 芒岸預備金採銀行可用餘額作為監看基準。 | 使用者決定芒岸預備金以銀行可用餘額監看。 | 芒岸預備金就看銀行可用餘額，選這個基準。
S | 芒岸預備金採此基準是因為六月應收款延遲二十天。 | 使用者記錄芒岸預備金選擇基準的原因。 | 芒岸預備金六月應收拖二十天，所以不能看預估就當有錢。
S | 芒岸預備金低於 NT$420,000 時須暫停非必要採購。 | 使用者設定芒岸預備金的採購暫停門檻。 | 芒岸預備金低於 NT$420,000 就停非必要採購，先守現金。
B | 小葉負責芒岸預備金每週餘額摘要。 | 使用者指定小葉整理芒岸預備金每週餘額。 | 芒岸預備金週摘要給小葉整理。
B | 芒岸預備金的零用現金盒固定留 NT$4,200。 | 使用者為芒岸預備金零用盒固定保留 NT$4,200。 | 芒岸預備金那個零用盒固定留 NT$4,200，不是主帳門檻。
S | 芒岸預備金轉入定存的選項仍是提案。 | 使用者保留芒岸預備金另一種配置方案。 | 芒岸預備金定存先當提案，沒有批准轉。
`),
];

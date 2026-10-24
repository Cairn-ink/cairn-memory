import { family as f } from './source.mjs';
export default [
f('hr2b-t01','engineering','鎏砂','GildedDune','蘇苒','Su Ran',`
鎏砂的簽章索引原先逐筆寫入。| GildedDune originally wrote signature indexes individually. | 簽章索引~signature index~逐筆寫入~individually
鎏砂的簽章索引後來改為合併寫入。| GildedDune later adopted coalesced writes for signature indexes. | 合併寫入~coalesced writes
鎏砂改動的原因是重送會產生孤立索引。| Orphan indexes after redelivery caused the GildedDune change. | 孤立索引~orphan indexes~redelivery
鎏砂的壓測租機費上限是 NT$23,700。| GildedDune caps load-test machine rental at NT$23,700. | 23,700~23700~二萬三千七百~兩萬三千七百~load-test machine rental~壓測租機
蘇苒負責鎏砂的簽章索引回補。| Su Ran owns the GildedDune signature-index backfill. | 索引回補~index backfill
蘇苒在鎏砂的簽章展示頁只負責圖說。| Su Ran only owns captions on the GildedDune signature showcase. | 簽章展示頁~signature showcase~圖說~captions
鎏砂已否決把簽章原文寫進錯誤訊息。| GildedDune rejected embedding signature plaintext in error messages. | 簽章原文~signature plaintext
鎏砂的硬體保管櫃編號是 GD-873。| GildedDune's hardware locker is GD-873. | GD-873~gd873~硬體保管櫃~hardware locker
`),
f('hr2b-t02','engineering','赭苔','OchreMoss','林頌','Lin Song',`
赭苔原先以檔名判斷附件是否重複。| OchreMoss originally detected duplicate attachments by filename. | 檔名~filename~重複附件~duplicate attachments
赭苔後來改用內容指紋判斷附件是否重複。| OchreMoss later adopted content fingerprints for duplicate attachments. | 內容指紋~content fingerprints
赭苔改動的原因是手機會重複使用預設檔名。| Phones reusing default filenames caused the OchreMoss change. | 預設檔名~default filenames~手機~phones
赭苔的附件驗證費上限是 NT$24,900。| OchreMoss caps attachment verification spending at NT$24,900. | 24,900~24900~二萬四千九百~兩萬四千九百~附件驗證~attachment verification
林頌負責赭苔的指紋碰撞演練。| Lin Song owns the OchreMoss fingerprint-collision drill. | 指紋碰撞~fingerprint-collision
林頌在赭苔的附件說明卡只負責示意圖。| Lin Song only owns diagrams on the OchreMoss attachment help card. | 附件說明卡~attachment help card~示意圖~diagrams
赭苔的自動刪除同名附件仍是未核准提案。| Automatic deletion of same-name attachments remains an unapproved OchreMoss proposal. | 同名附件~same-name attachments~自動刪除~automatic deletion
赭苔的備援磁碟序號是 OM-926。| OchreMoss's spare disk serial is OM-926. | OM-926~om926~備援磁碟~spare disk
`),
f('hr2b-t03','engineering','砌燈','MasonLamp','徐澈','Xu Che',`
砌燈原先在啟動時載入完整字典。| MasonLamp originally loaded the full dictionary at startup. | 完整字典~full dictionary~startup
砌燈後來改為按語系載入字典。| MasonLamp later adopted dictionary loading by locale. | 按語系~by locale
砌燈改動的原因是冷啟動的尖峰記憶體過高。| Excessive peak memory during cold starts caused the MasonLamp change. | 尖峰記憶體~peak memory~冷啟動~cold starts
砌燈的字典整理工時上限是 137 小時。| MasonLamp caps dictionary cleanup at 137 hours. | 137~一百三十七~dictionary cleanup~字典整理
徐澈負責砌燈的語系缺字檢查。| Xu Che owns MasonLamp's missing-glyph checks by locale. | 語系缺字~missing-glyph
徐澈在砌燈的字典下載頁只負責排版。| Xu Che only owns layout on MasonLamp's dictionary download page. | 字典下載頁~dictionary download page~排版~layout
砌燈已否決開機時下載所有字型。| MasonLamp rejected downloading every font at boot. | 所有字型~every font~at boot
砌燈的字型授權到期日是十二月十七日。| MasonLamp's font license expires on December seventeenth. | 十二月十七~12月17~12/17~December seventeenth~December 17~font license~字型授權
`),
f('hr2b-t04','engineering','VellumArc','犢紙弧','葉苓','Ye Ling',`
VellumArc 原先由呼叫端重試失敗的簽收。| VellumArc originally retried failed acknowledgements at the caller. | 呼叫端~at the caller~簽收~acknowledgements
VellumArc 後來把簽收重試移到隔離佇列。| VellumArc later moved acknowledgement retries to an isolation queue. | 隔離佇列~isolation queue
VellumArc 改動的原因是重試會堵住互動請求。| Retries blocking interactive requests caused the VellumArc change. | 互動請求~interactive requests~blocking
VellumArc 的隔離演練費上限是 NT$26,300。| VellumArc caps isolation-drill spending at NT$26,300. | 26,300~26300~二萬六千三百~兩萬六千三百~隔離演練~isolation-drill
葉苓負責 VellumArc 的簽收重播腳本。| Ye Ling owns the VellumArc acknowledgement-replay script. | 簽收重播~acknowledgement-replay
葉苓在 VellumArc 的延遲海報只負責標題。| Ye Ling only owns the title on VellumArc's latency poster. | 延遲海報~latency poster~標題~title
VellumArc 的無限重試仍是未核准提案。| Unlimited retries remain an unapproved VellumArc proposal. | 無限重試~unlimited retries
VellumArc 的災備演習代號是 VA-584。| VellumArc's disaster drill code is VA-584. | VA-584~va584~災備演習~disaster drill
`),
f('hr2b-t05','engineering','葭灣','ReedCove','方湛','Fang Zhan',`
葭灣原先把預覽圖放在交易內生成。| ReedCove originally generated thumbnails inside the transaction. | 預覽圖~thumbnails~交易內~inside the transaction
葭灣後來改為提交後生成預覽圖。| ReedCove later adopted thumbnail generation after commit. | 提交後~after commit
葭灣改動的原因是大圖解碼拖住鎖定。| Large-image decoding holding locks caused the ReedCove change. | 大圖解碼~large-image decoding~holding locks
葭灣的圖像處理月費上限是 NT$28,600。| ReedCove caps monthly image-processing fees at NT$28,600. | 28,600~28600~二萬八千六百~兩萬八千六百~圖像處理~image-processing
方湛負責葭灣的預覽圖補建。| Fang Zhan owns the ReedCove thumbnail rebuild. | 預覽圖補建~thumbnail rebuild
方湛在葭灣的圖片教學頁只負責替代文字。| Fang Zhan only owns alt text on ReedCove's image tutorial page. | 圖片教學頁~image tutorial page~替代文字~alt text
葭灣已否決把原圖塞進工作訊息。| ReedCove rejected putting original images inside job messages. | 原圖~original images~工作訊息~job messages
葭灣的相機借用押金是 NT$8,450。| ReedCove's camera loan deposit is NT$8,450. | 8,450~8450~八千四百五十~相機借用~camera loan
`),
f('hr2b-t06','engineering','PrismSkein','稜絲','秦禾','Qin He',`
PrismSkein 原先用例外訊息識別解析失敗。| PrismSkein originally identified parse failures by exception message. | 例外訊息~exception message~解析失敗~parse failures
PrismSkein 後來改用具名錯誤碼識別解析失敗。| PrismSkein later adopted named error codes for parse failures. | 具名錯誤碼~named error codes
PrismSkein 改動的原因是翻譯後的錯誤文字無法穩定比對。| Translated error text preventing stable matching caused the PrismSkein change. | 翻譯後~translated error text~stable matching
PrismSkein 的錯誤案例整理上限是 143 小時。| PrismSkein caps error-case curation at 143 hours. | 143~一百四十三~錯誤案例整理~error-case curation
秦禾負責 PrismSkein 的錯誤碼對照表。| Qin He owns the PrismSkein error-code crosswalk. | 錯誤碼對照表~error-code crosswalk
秦禾在 PrismSkein 的語法小抄只負責插圖。| Qin He only owns illustrations on PrismSkein's syntax cheat sheet. | 語法小抄~syntax cheat sheet~插圖~illustrations
PrismSkein 的自動吞掉解析錯誤仍是未核准提案。| Silently swallowing parse errors remains an unapproved PrismSkein proposal. | 吞掉解析錯誤~swallowing parse errors
PrismSkein 的紙本手冊印量是 219 份。| PrismSkein's printed handbook run is 219 copies. | 219~二百一十九~兩百一十九~紙本手冊~printed handbook
`),
f('hr2b-t07','engineering','汀磚','ShoreBrick','袁沐','Yuan Mu',`
汀磚原先把刪除請求立即實體清除。| ShoreBrick originally physically purged deletion requests immediately. | 實體清除~physically purged~deletion requests
汀磚後來改為先寫刪除意圖再清除。| ShoreBrick later adopted deletion intents before purging. | 刪除意圖~deletion intents
汀磚改動的原因是中斷會留下失聯附件。| Interruptions leaving detached attachments caused the ShoreBrick change. | 失聯附件~detached attachments~interruptions
汀磚的清除演練費上限是 NT$31,800。| ShoreBrick caps purge-drill spending at NT$31,800. | 31,800~31800~三萬一千八百~清除演練~purge-drill
袁沐負責汀磚的刪除意圖稽查。| Yuan Mu owns ShoreBrick's deletion-intent inspection. | 刪除意圖稽查~deletion-intent inspection
袁沐在汀磚的檔案封面只負責配色。| Yuan Mu only owns colors on ShoreBrick's file cover. | 檔案封面~file cover~配色~colors
汀磚已否決跳過附件核對就清除。| ShoreBrick rejected purging without attachment reconciliation. | 附件核對~attachment reconciliation
汀磚的封存箱容量是 427 GB。| ShoreBrick's archive-box capacity is 427 GB. | 427~四百二十七~封存箱~archive-box
`),
f('hr2b-t08','engineering','FableSpool','寓線軸','姜羽','Jiang Yu',`
FableSpool 原先把測試時間綁在系統時鐘。| FableSpool originally tied test time to the system clock. | 系統時鐘~system clock~test time
FableSpool 後來改用可注入的測試時鐘。| FableSpool later adopted an injectable test clock. | 可注入~injectable test clock
FableSpool 改動的原因是跨午夜案例會偶發失敗。| Intermittent failures across midnight caused the FableSpool change. | 跨午夜~across midnight~intermittent failures
FableSpool 的時間案例維護上限是 157 小時。| FableSpool caps time-case maintenance at 157 hours. | 157~一百五十七~時間案例維護~time-case maintenance
姜羽負責 FableSpool 的跨日測試。| Jiang Yu owns FableSpool's date-rollover tests. | 跨日測試~date-rollover tests
姜羽在 FableSpool 的時間線說明頁只負責圖例。| Jiang Yu only owns legends on FableSpool's timeline help page. | 時間線說明頁~timeline help page~圖例~legends
FableSpool 的停用時區測試仍是未核准提案。| Disabling timezone tests remains an unapproved FableSpool proposal. | 停用時區測試~disabling timezone tests
FableSpool 的壁鐘採購單編號是 FS-692。| FableSpool's wall-clock purchase order is FS-692. | FS-692~fs692~壁鐘~wall-clock
`),
f('hr2b-t09','engineering','禾棘','GrainBriar','杜芮','Du Rui',`
禾棘原先每次查詢都重建路由表。| GrainBriar originally rebuilt its routing table on every lookup. | 路由表~routing table~every lookup
禾棘後來改為發布時建立路由快照。| GrainBriar later adopted routing snapshots built at publication. | 路由快照~routing snapshots~at publication
禾棘改動的原因是巢狀規則造成重複掃描。| Nested rules causing repeated scans prompted the GrainBriar change. | 巢狀規則~nested rules~repeated scans
禾棘的路由檢測月費上限是 NT$33,400。| GrainBriar caps monthly route-checking fees at NT$33,400. | 33,400~33400~三萬三千四百~路由檢測~route-checking
杜芮負責禾棘的快照差異檢查。| Du Rui owns GrainBriar's snapshot-difference checks. | 快照差異~snapshot-difference
杜芮在禾棘的路由海報只負責圖框。| Du Rui only owns frames on GrainBriar's route poster. | 路由海報~route poster~圖框~frames
禾棘已否決在查詢中修改路由規則。| GrainBriar rejected modifying routing rules during lookup. | 修改路由規則~modifying routing rules
禾棘的演示機資產標籤是 GB-845。| GrainBriar's demo machine asset tag is GB-845. | GB-845~gb845~演示機~demo machine
`),
f('hr2b-t10','engineering','NimbusLatch','層雲閂','溫蘅','Wen Heng',`
NimbusLatch 原先以共用密鑰簽署測試連結。| NimbusLatch originally signed test links with a shared secret. | 共用密鑰~shared secret~test links
NimbusLatch 後來改用每個環境各自的簽署密鑰。| NimbusLatch later adopted separate signing secrets per environment. | 各自的簽署密鑰~separate signing secrets
NimbusLatch 改動的原因是環境複製會沿用有效連結。| Environment clones retaining valid links caused the NimbusLatch change. | 環境複製~environment clones~valid links
NimbusLatch 的密鑰輪替工時上限是 163 小時。| NimbusLatch caps secret-rotation work at 163 hours. | 163~一百六十三~密鑰輪替~secret-rotation
溫蘅負責 NimbusLatch 的環境密鑰盤點。| Wen Heng owns NimbusLatch's environment-secret inventory. | 環境密鑰盤點~environment-secret inventory
溫蘅在 NimbusLatch 的設定導覽只負責螢幕截圖。| Wen Heng only owns screenshots in NimbusLatch's setup tour. | 設定導覽~setup tour~螢幕截圖~screenshots
NimbusLatch 的永久測試連結仍是未核准提案。| Permanent test links remain an unapproved NimbusLatch proposal. | 永久測試連結~permanent test links
NimbusLatch 的密封袋批號是 NL-738。| NimbusLatch's sealed-bag batch is NL-738. | NL-738~nl738~密封袋~sealed-bag
`),
f('hr2b-t11','work-preferences','槲札','OakSlip','蘇苒','Su Ran',`
槲札的討論摘要原先按發言順序排列。| OakSlip originally ordered discussion summaries by speaking order. | 發言順序~speaking order~discussion summaries
槲札的討論摘要後來改按待回答的疑問排列。| OakSlip later ordered discussion summaries by open questions. | 待回答的疑問~open questions
槲札改動的原因是接手的人找不到仍卡住的問題。| Successors being unable to find unresolved questions caused the OakSlip change. | 接手的人~successors~unresolved questions
槲札的摘要整理每月上限是 171 小時。| OakSlip caps monthly summary editing at 171 hours. | 171~一百七十一~摘要整理~summary editing
蘇苒負責槲札的疑問合併。| Su Ran owns OakSlip's question consolidation. | 疑問合併~question consolidation
蘇苒在槲札的讀書摘要只負責引文核對。| Su Ran only owns quote checks in OakSlip's reading digest. | 讀書摘要~reading digest~引文核對~quote checks
槲札已否決在摘要中標示發言次數。| OakSlip rejected displaying speaking counts in summaries. | 發言次數~speaking counts
槲札的紙張顏色定為陶紅色。| OakSlip's paper color is terracotta red. | 陶紅色~terracotta red~紙張顏色~paper color
`),
f('hr2b-t12','work-preferences','AsterMargin','紫菀邊','林頌','Lin Song',`
AsterMargin 的改稿回饋原先直接改正文。| AsterMargin originally gave editing feedback by replacing the prose. | 直接改正文~replacing the prose~editing feedback
AsterMargin 的改稿回饋後來改為先寫讀者困惑。| AsterMargin later began editing feedback with reader confusion. | 讀者困惑~reader confusion
AsterMargin 改動的原因是作者無法理解被刪段落的問題。| Authors not understanding the problem with deleted passages caused the AsterMargin change. | 被刪段落~deleted passages~authors
AsterMargin 的校稿支出上限是 NT$35,900。| AsterMargin caps proofreading spending at NT$35,900. | 35,900~35900~三萬五千九百~校稿支出~proofreading spending
林頌負責 AsterMargin 的困惑清單。| Lin Song owns AsterMargin's confusion list. | 困惑清單~confusion list
林頌在 AsterMargin 的訪談稿只負責人名拼字。| Lin Song only owns name spelling in AsterMargin's interview transcript. | 訪談稿~interview transcript~人名拼字~name spelling
AsterMargin 的公開改稿排行榜仍是未核准提案。| A public editing leaderboard remains an unapproved AsterMargin proposal. | 改稿排行榜~editing leaderboard
AsterMargin 的投稿信箱是 draftbox@aster.invalid。| AsterMargin's submission mailbox is draftbox@aster.invalid. | draftbox@aster.invalid~submission mailbox~投稿信箱
`),
f('hr2b-t13','work-preferences','葵箋','MallowLeaf','徐澈','Xu Che',`
葵箋的訪談筆記原先先列功能願望。| MallowLeaf originally began interview notes with feature wishes. | 功能願望~feature wishes~interview notes
葵箋的訪談筆記後來改為先列具體困擾。| MallowLeaf later began interview notes with concrete frustrations. | 具體困擾~concrete frustrations
葵箋改動的原因是願望清單掩蓋實際情境。| Wish lists obscuring actual circumstances caused the MallowLeaf change. | 實際情境~actual circumstances~wish lists
葵箋的訪談整理每月上限是 179 小時。| MallowLeaf caps monthly interview editing at 179 hours. | 179~一百七十九~訪談整理~interview editing
徐澈負責葵箋的困擾分類。| Xu Che owns MallowLeaf's frustration classification. | 困擾分類~frustration classification
徐澈在葵箋的受訪者邀請卡只負責署名。| Xu Che only owns the signature on MallowLeaf's interview invitation. | 受訪者邀請卡~interview invitation~署名~signature
葵箋已否決替受訪者猜測未說出的願望。| MallowLeaf rejected guessing wishes that interviewees never voiced. | 猜測未說出~never voiced~guessing wishes
葵箋的錄音收納盒編號是 ML-963。| MallowLeaf's recording case is ML-963. | ML-963~ml963~錄音收納盒~recording case
`),
f('hr2b-t14','work-preferences','CinderBrief','燼簡','葉苓','Ye Ling',`
CinderBrief 的進度回報原先按部門排列。| CinderBrief originally organized progress reports by department. | 按部門~by department~progress reports
CinderBrief 的進度回報後來改按阻礙排列。| CinderBrief later organized progress reports by blockers. | 按阻礙~by blockers
CinderBrief 改動的原因是跨部門依賴被拆散。| Fragmented cross-department dependencies caused the CinderBrief change. | 跨部門依賴~cross-department dependencies~fragmented
CinderBrief 的回報彙整上限是 187 小時。| CinderBrief caps report compilation at 187 hours. | 187~一百八十七~回報彙整~report compilation
葉苓負責 CinderBrief 的依賴關係整理。| Ye Ling owns CinderBrief's dependency mapping. | 依賴關係整理~dependency mapping
葉苓在 CinderBrief 的招募簡介只負責封面字樣。| Ye Ling only owns cover wording on CinderBrief's recruiting overview. | 招募簡介~recruiting overview~封面字樣~cover wording
CinderBrief 的逐人評分欄仍是未核准提案。| Individual scoring fields remain an unapproved CinderBrief proposal. | 逐人評分欄~individual scoring fields
CinderBrief 的簡報投影比例是 32 比 15。| CinderBrief's projection ratio is 32 to 15. | 32~15~三十二~十五~投影比例~projection ratio
`),
f('hr2b-t15','work-preferences','穗墨','EarInk','方湛','Fang Zhan',`
穗墨的非同步討論原先每則訊息即時提醒。| EarInk originally notified immediately for every asynchronous message. | 每則訊息~every asynchronous message~即時提醒~notified immediately
穗墨的非同步討論後來改為主題收尾才提醒。| EarInk later sent notifications only when a topic closed. | 主題收尾~a topic closed
穗墨改動的原因是片段提醒打斷寫作。| Fragmented notifications interrupting writing caused the EarInk change. | 打斷寫作~interrupting writing~fragmented notifications
穗墨的通知文字整理上限是 193 小時。| EarInk caps notification-copy editing at 193 hours. | 193~一百九十三~通知文字整理~notification-copy editing
方湛負責穗墨的主題收尾摘要。| Fang Zhan owns EarInk's topic-closing digest. | 主題收尾摘要~topic-closing digest
方湛在穗墨的社群邀請函只負責稱謂。| Fang Zhan only owns salutations in EarInk's community invitation. | 社群邀請函~community invitation~稱謂~salutations
穗墨已否決替未讀訊息加上羞辱標記。| EarInk rejected shaming labels for unread messages. | 羞辱標記~shaming labels
穗墨的寫作室門牌是 EI-826。| EarInk's writing-room door label is EI-826. | EI-826~ei826~寫作室~writing-room
`),
f('hr2b-t16','work-preferences','LinenPrompt','亞麻引','秦禾','Qin He',`
LinenPrompt 的協作問題原先附上解法選項。| LinenPrompt originally attached solution choices to collaboration questions. | 解法選項~solution choices~collaboration questions
LinenPrompt 的協作問題後來改為先描述觀察。| LinenPrompt later began collaboration questions with observations. | 先描述觀察~with observations
LinenPrompt 改動的原因是選項讓同事過早收斂。| Choices making colleagues converge too early caused the LinenPrompt change. | 過早收斂~converge too early~colleagues
LinenPrompt 的題目整理上限是 207 小時。| LinenPrompt caps question curation at 207 hours. | 207~二百零七~兩百零七~題目整理~question curation
秦禾負責 LinenPrompt 的觀察摘錄。| Qin He owns LinenPrompt's observation extracts. | 觀察摘錄~observation extracts
秦禾在 LinenPrompt 的教室告示只負責字距。| Qin He only owns letter spacing on LinenPrompt's classroom notice. | 教室告示~classroom notice~字距~letter spacing
LinenPrompt 的自動替同事選答案仍是未核准提案。| Automatically choosing colleagues' answers remains an unapproved LinenPrompt proposal. | 替同事選答案~choosing colleagues' answers
LinenPrompt 的便箋刀模代號是 LP-957。| LinenPrompt's note die-cut code is LP-957. | LP-957~lp957~便箋刀模~note die-cut
`),
f('hr2b-t17','work-preferences','蕨頁','FernFolio','袁沐','Yuan Mu',`
蕨頁的週末閱讀摘記原先記下金句。| FernFolio originally saved quotations in weekend reading notes. | 週末閱讀~weekend reading~金句~quotations
蕨頁的週末閱讀摘記後來改為記下反例。| FernFolio later saved counterexamples in weekend reading notes. | 反例~counterexamples
蕨頁改動的原因是金句無法指出適用邊界。| Quotations failing to show applicability limits caused the FernFolio change. | 適用邊界~applicability limits
蕨頁的書摘授權費上限是 NT$38,200。| FernFolio caps excerpt licensing fees at NT$38,200. | 38,200~38200~三萬八千二百~書摘授權~excerpt licensing
袁沐負責蕨頁的反例整理。| Yuan Mu owns FernFolio's counterexample collection. | 反例整理~counterexample collection
袁沐在蕨頁的書籍寄件單只負責地址格式。| Yuan Mu only owns address formatting on FernFolio's book dispatch form. | 書籍寄件單~book dispatch form~地址格式~address formatting
蕨頁已否決用摘記數量評估閱讀成效。| FernFolio rejected measuring reading outcomes by note count. | 閱讀成效~reading outcomes~note count
蕨頁的借書證號碼是 FF-684。| FernFolio's library-card number is FF-684. | FF-684~ff684~借書證~library-card
`),
f('hr2b-t18','operations','梔舍','GardeniaHouse','姜羽','Jiang Yu',`
梔舍的共享空間巡查原先在開門前做。| GardeniaHouse originally inspected shared space before opening. | 共享空間巡查~inspected shared space~開門前~before opening
梔舍的共享空間巡查後來改為關門後做。| GardeniaHouse later inspected shared space after closing. | 關門後~after closing
梔舍改動的原因是散場後才看得到遺留問題。| Problems becoming visible only after departures caused the GardeniaHouse change. | 散場後~after departures~遺留問題~problems becoming visible
梔舍的巡查耗材月費上限是 NT$4,730。| GardeniaHouse caps monthly inspection supplies at NT$4,730. | 4,730~4730~四千七百三十~巡查耗材~inspection supplies
姜羽負責梔舍的離場巡查。| Jiang Yu owns GardeniaHouse's departure inspection. | 離場巡查~departure inspection
姜羽在梔舍的迎賓立牌只負責字體。| Jiang Yu only owns fonts on GardeniaHouse's welcome stand. | 迎賓立牌~welcome stand~字體~fonts
梔舍的取消離場巡查仍是未核准提案。| Cancelling departure inspections remains an unapproved GardeniaHouse proposal. | 取消離場巡查~cancelling departure inspections
梔舍的清潔櫃鑰匙編號是 GH-927。| GardeniaHouse's cleaning-cabinet key is GH-927. | GH-927~gh927~清潔櫃~cleaning-cabinet
`),
f('hr2b-t19','operations','CopperQuay','銅碼頭','杜芮','Du Rui',`
CopperQuay 的借用品原先歸還時才貼標籤。| CopperQuay originally labelled loan equipment upon return. | 歸還時~upon return~借用品~loan equipment
CopperQuay 的借用品後來改在借出前貼標籤。| CopperQuay later labelled loan equipment before lending. | 借出前~before lending
CopperQuay 改動的原因是同款設備無法辨認借用紀錄。| Identical equipment obscuring loan records caused the CopperQuay change. | 同款設備~identical equipment~loan records
CopperQuay 的標籤耗材季費上限是 NT$5,870。| CopperQuay caps quarterly label supplies at NT$5,870. | 5,870~5870~五千八百七十~標籤耗材~label supplies
杜芮負責 CopperQuay 的借出標記。| Du Rui owns CopperQuay's lending marks. | 借出標記~lending marks
杜芮在 CopperQuay 的倉庫導覽圖只負責箭頭。| Du Rui only owns arrows on CopperQuay's warehouse guide map. | 倉庫導覽圖~warehouse guide map~箭頭~arrows
CopperQuay 已否決用外觀顏色取代借用標籤。| CopperQuay rejected replacing loan labels with appearance colors. | 外觀顏色~appearance colors~loan labels
CopperQuay 的手推車資產號碼是 CQ-853。| CopperQuay's trolley asset number is CQ-853. | CQ-853~cq853~手推車~trolley
`),
f('hr2b-t20','operations','漆棧','LacquerDepot','溫蘅','Wen Heng',`
漆棧的活動候補原先逐人電話通知。| LacquerDepot originally phoned standby participants individually. | 逐人電話~phoned~候補~standby participants
漆棧的活動候補後來改用可回覆的郵件通知。| LacquerDepot later notified standby participants through replyable email. | 可回覆的郵件~replyable email
漆棧改動的原因是未接電話的回覆無法追蹤。| Untraceable responses to missed calls caused the LacquerDepot change. | 未接電話~missed calls~untraceable responses
漆棧的候補聯絡費上限是 NT$6,410。| LacquerDepot caps standby-contact spending at NT$6,410. | 6,410~6410~六千四百一十~候補聯絡費~standby-contact
溫蘅負責漆棧的候補回覆彙整。| Wen Heng owns LacquerDepot's standby-response consolidation. | 候補回覆彙整~standby-response consolidation
溫蘅在漆棧的活動手冊只負責頁眉。| Wen Heng only owns running headers in LacquerDepot's event booklet. | 活動手冊~event booklet~頁眉~running headers
漆棧的自動接受所有候補仍是未核准提案。| Automatically accepting every standby participant remains an unapproved LacquerDepot proposal. | 接受所有候補~accepting every standby
漆棧的場地識別碼是 LD-796。| LacquerDepot's venue identifier is LD-796. | LD-796~ld796~場地識別碼~venue identifier
`),
f('hr2b-t21','operations','PetalFoundry','瓣鑄坊','蘇苒','Su Ran',`
PetalFoundry 原先口頭交接會場遺失物。| PetalFoundry originally handed over venue lost property orally. | 遺失物~lost property~口頭交接~orally
PetalFoundry 後來改用封袋清冊交接遺失物。| PetalFoundry later adopted bagged inventories for lost-property handover. | 封袋清冊~bagged inventories
PetalFoundry 改動的原因是物品描述在轉述時走樣。| Item descriptions becoming distorted in retelling caused the PetalFoundry change. | 物品描述~item descriptions~retelling
PetalFoundry 的保管用品月費上限是 NT$7,290。| PetalFoundry caps monthly safekeeping supplies at NT$7,290. | 7,290~7290~七千二百九十~保管用品~safekeeping supplies
蘇苒負責 PetalFoundry 的遺失物封袋。| Su Ran owns PetalFoundry's lost-property bagging. | 遺失物封袋~lost-property bagging
蘇苒在 PetalFoundry 的桌牌只負責裁邊。| Su Ran only owns edge trimming on PetalFoundry's table cards. | 桌牌~table cards~裁邊~edge trimming
PetalFoundry 已否決把無人認領物直接送人。| PetalFoundry rejected giving away unclaimed property directly. | 無人認領~unclaimed property~giving away
PetalFoundry 的保管室分機是 6842。| PetalFoundry's storeroom extension is 6842. | 6842~六八四二~storeroom extension~保管室分機
`),
f('hr2b-t22','operations','苔埠','MossWharf','林頌','Lin Song',`
苔埠的補貨原先等缺料才申請。| MossWharf originally requested replenishment after running out. | 缺料~running out~補貨~replenishment
苔埠的補貨後來改用消耗登記觸發。| MossWharf later triggered replenishment from usage records. | 消耗登記~usage records
苔埠改動的原因是臨時採買打亂工作坊準備。| Emergency purchases disrupting workshop preparation caused the MossWharf change. | 臨時採買~emergency purchases~workshop preparation
苔埠的工作坊補料費上限是 NT$8,930。| MossWharf caps workshop replenishment at NT$8,930. | 8,930~8930~八千九百三十~工作坊補料~workshop replenishment
林頌負責苔埠的消耗紀錄核對。| Lin Song owns MossWharf's usage-record reconciliation. | 消耗紀錄核對~usage-record reconciliation
林頌在苔埠的材料展示板只負責字卡。| Lin Song only owns text cards on MossWharf's material display board. | 材料展示板~material display board~字卡~text cards
苔埠的由訪客自行補料仍是未核准提案。| Visitor-managed replenishment remains an unapproved MossWharf proposal. | 訪客自行補料~visitor-managed replenishment
苔埠的紙箱供應商代號是 MW-478。| MossWharf's carton supplier code is MW-478. | MW-478~mw478~紙箱供應商~carton supplier
`),
f('hr2b-t23','operations','SaffronPier','番紅棧','徐澈','Xu Che',`
SaffronPier 的遠端報到原先要求開視訊。| SaffronPier originally required video calls for remote check-in. | 開視訊~video calls~遠端報到~remote check-in
SaffronPier 的遠端報到後來改用文字確認。| SaffronPier later adopted text confirmation for remote check-in. | 文字確認~text confirmation
SaffronPier 改動的原因是臨時網路無法穩定傳影像。| Unstable temporary connections failing to carry video caused the SaffronPier change. | 臨時網路~temporary connections~carry video
SaffronPier 的報到協助費上限是 NT$9,570。| SaffronPier caps check-in assistance at NT$9,570. | 9,570~9570~九千五百七十~報到協助~check-in assistance
徐澈負責 SaffronPier 的報到回覆。| Xu Che owns SaffronPier's check-in responses. | 報到回覆~check-in responses
徐澈在 SaffronPier 的遠端聚會海報只負責標點。| Xu Che only owns punctuation on SaffronPier's remote-gathering poster. | 遠端聚會海報~remote-gathering poster~標點~punctuation
SaffronPier 已否決截圖作為出席證明。| SaffronPier rejected screenshots as attendance proof. | 出席證明~attendance proof~截圖~screenshots
SaffronPier 的報到機編號是 SP-829。| SaffronPier's check-in terminal is SP-829. | SP-829~sp829~報到機~check-in terminal
`),
f('hr2b-t24','operations','荻窯','RushKiln','葉苓','Ye Ling',`
荻窯的講者簡介原先現場口頭核對。| RushKiln originally verified speaker biographies orally at the venue. | 講者簡介~speaker biographies~現場口頭~orally at the venue
荻窯的講者簡介後來改用預先回簽的文字稿。| RushKiln later adopted pre-signed text for speaker biographies. | 預先回簽~pre-signed text
荻窯改動的原因是現場改稱謂容易漏改投影稿。| Onsite title changes missing the projection copy caused the RushKiln change. | 稱謂~title changes~投影稿~projection copy
荻窯的簡介校對費上限是 NT$10,830。| RushKiln caps biography checking at NT$10,830. | 10,830~10830~一萬零八百三十~簡介校對~biography checking
葉苓負責荻窯的簡介回簽。| Ye Ling owns RushKiln's biography sign-off. | 簡介回簽~biography sign-off
葉苓在荻窯的場刊只負責圖片邊線。| Ye Ling only owns image borders in RushKiln's event program. | 場刊~event program~圖片邊線~image borders
荻窯的由主持人臨場補寫簡介仍是未核准提案。| Host-written impromptu biographies remain an unapproved RushKiln proposal. | 臨場補寫簡介~impromptu biographies
荻窯的舞台箱標籤是 RK-675。| RushKiln's stage crate label is RK-675. | RK-675~rk675~舞台箱~stage crate
`),
f('hr2b-t25','finance','鏽帆帳','RustSail','方湛','Fang Zhan',`
鏽帆帳原先按匯款日配對訂金。| RustSail originally matched deposits by transfer date. | 訂金~deposits~匯款日~transfer date
鏽帆帳後來改按預約代碼配對訂金。| RustSail later matched deposits by reservation code. | 預約代碼~reservation code
鏽帆帳改動的原因是合併匯款無法分清場次。| Combined transfers obscuring booked sessions caused the RustSail change. | 合併匯款~combined transfers~booked sessions
鏽帆帳的訂金調節差額上限是 NT$11,460。| RustSail caps deposit reconciliation differences at NT$11,460. | 11,460~11460~一萬一千四百六十~訂金調節差額~deposit reconciliation differences
方湛負責鏽帆帳的預約訂金核對。| Fang Zhan owns RustSail's reservation-deposit matching. | 預約訂金核對~reservation-deposit matching
方湛在鏽帆帳的租借價目單只負責註腳。| Fang Zhan only owns footnotes on RustSail's rental price sheet. | 租借價目單~rental price sheet~註腳~footnotes
鏽帆帳已否決把未辨識訂金直接認列收入。| RustSail rejected recognizing unidentified deposits as revenue. | 未辨識訂金~unidentified deposits~認列收入~recognizing
鏽帆帳的零用金箱代碼是 RS-786。| RustSail's petty-cash box code is RS-786. | RS-786~rs786~零用金箱~petty-cash box
`),
f('hr2b-t26','finance','MarbleWren','大理鷦','秦禾','Qin He',`
MarbleWren 原先把授權費併入設計費。| MarbleWren originally combined licensing fees with design fees. | 授權費~licensing fees~設計費~design fees
MarbleWren 後來把授權費獨立列帳。| MarbleWren later accounted for licensing fees separately. | 獨立列帳~accounted~separately
MarbleWren 改動的原因是續約費容易被專案結案掩蓋。| Renewals being obscured by project closure caused the MarbleWren change. | 續約費~renewals~專案結案~project closure
MarbleWren 的圖庫授權年費上限是 NT$42,700。| MarbleWren caps annual stock-image licensing at NT$42,700. | 42,700~42700~四萬二千七百~圖庫授權~stock-image licensing
秦禾負責 MarbleWren 的授權續約台帳。| Qin He owns MarbleWren's license-renewal ledger. | 授權續約台帳~license-renewal ledger
秦禾在 MarbleWren 的設計報價封面只負責頁碼。| Qin He only owns page numbers on MarbleWren's design-quote cover. | 設計報價封面~design-quote cover~頁碼~page numbers
MarbleWren 的把授權費全列設備資產仍是未核准提案。| Capitalizing all licensing fees as equipment remains an unapproved MarbleWren proposal. | 設備資產~capitalizing~equipment
MarbleWren 的支票簿尾碼是 8637。| MarbleWren's checkbook ends in 8637. | 8637~八六三七~支票簿~checkbook
`),
f('hr2b-t27','finance','榛算','HazelTally','袁沐','Yuan Mu',`
榛算原先把退款列為下一期折讓。| HazelTally originally recorded refunds as next-period discounts. | 下一期折讓~next-period discounts~退款~refunds
榛算後來改在原交易下記退款。| HazelTally later recorded refunds under their original transactions. | 原交易~original transactions
榛算改動的原因是跨期折讓無法回溯取消原因。| Cross-period discounts losing cancellation traceability caused the HazelTally change. | 跨期折讓~cross-period discounts~cancellation traceability
榛算的退款待核額上限是 NT$13,280。| HazelTally caps pending refund approvals at NT$13,280. | 13,280~13280~一萬三千二百八十~退款待核額~pending refund approvals
袁沐負責榛算的原單退款核對。| Yuan Mu owns HazelTally's original-order refund matching. | 原單退款核對~original-order refund matching
袁沐在榛算的客戶付款說明只負責圖示。| Yuan Mu only owns icons in HazelTally's customer payment guide. | 客戶付款說明~customer payment guide~圖示~icons
榛算已否決刪除已退款的原始訂單。| HazelTally rejected deleting original refunded orders. | 刪除已退款~deleting original refunded orders
榛算的備用帳冊封條號碼是 HT-937。| HazelTally's spare ledger seal is HT-937. | HT-937~ht937~備用帳冊~spare ledger seal
`),
f('hr2b-t28','finance','ThimbleLedger','頂針帳','姜羽','Jiang Yu',`
ThimbleLedger 原先把外幣匯差分攤到品項。| ThimbleLedger originally allocated currency differences to line items. | 外幣匯差~currency differences~品項~line items
ThimbleLedger 後來改為獨立記錄結算匯差。| ThimbleLedger later recorded settlement exchange differences separately. | 結算匯差~settlement exchange differences
ThimbleLedger 改動的原因是品項毛利被結匯時點扭曲。| Conversion timing distorting item margins caused the ThimbleLedger change. | 品項毛利~item margins~conversion timing
ThimbleLedger 的匯差覆核額上限是 NT$14,950。| ThimbleLedger caps exchange-difference reviews at NT$14,950. | 14,950~14950~一萬四千九百五十~匯差覆核~exchange-difference reviews
姜羽負責 ThimbleLedger 的結算匯差表。| Jiang Yu owns ThimbleLedger's settlement-difference schedule. | 結算匯差表~settlement-difference schedule
姜羽在 ThimbleLedger 的外幣報價通知只負責段落間距。| Jiang Yu only owns paragraph spacing in ThimbleLedger's currency-quote notice. | 外幣報價通知~currency-quote notice~段落間距~paragraph spacing
ThimbleLedger 的統一套用年底匯率仍是未核准提案。| Applying the year-end exchange rate everywhere remains an unapproved ThimbleLedger proposal. | 年底匯率~year-end exchange rate
ThimbleLedger 的銀行聯絡分機是 7593。| ThimbleLedger's bank contact extension is 7593. | 7593~七五九三~銀行聯絡分機~bank contact extension
`),
f('hr2b-t29','finance','蒲簿','ReedBooklet','杜芮','Du Rui',`
蒲簿原先在請款時估列運送成本。| ReedBooklet originally estimated delivery costs when billing. | 運送成本~delivery costs~請款時~when billing
蒲簿後來改按承運明細認列運送成本。| ReedBooklet later recognized delivery costs from carrier details. | 承運明細~carrier details
蒲簿改動的原因是併箱折扣讓估值持續偏高。| Consolidated-box discounts keeping estimates too high caused the ReedBooklet change. | 併箱折扣~consolidated-box discounts~estimates
蒲簿的承運差額容許上限是 NT$15,730。| ReedBooklet caps permitted carrier differences at NT$15,730. | 15,730~15730~一萬五千七百三十~承運差額~carrier differences
杜芮負責蒲簿的承運明細對照。| Du Rui owns ReedBooklet's carrier-detail crosscheck. | 承運明細對照~carrier-detail crosscheck
杜芮在蒲簿的寄件貼紙只負責留白。| Du Rui only owns whitespace on ReedBooklet's shipping stickers. | 寄件貼紙~shipping stickers~留白~whitespace
蒲簿已否決用最高單件價估所有運費。| ReedBooklet rejected estimating all freight at the highest single-item rate. | 最高單件價~highest single-item rate
蒲簿的郵資機識別碼是 RB-648。| ReedBooklet's postage meter identifier is RB-648. | RB-648~rb648~郵資機~postage meter
`),
f('hr2b-t30','finance','CobaltCoffer','鈷匣','溫蘅','Wen Heng',`
CobaltCoffer 原先把保證金列在一般預付。| CobaltCoffer originally classified security deposits as general prepayments. | 保證金~security deposits~一般預付~general prepayments
CobaltCoffer 後來把保證金獨立追蹤返還。| CobaltCoffer later tracked security-deposit returns separately. | 追蹤返還~deposit returns
CobaltCoffer 改動的原因是租約結束後仍留著未收款項。| Uncollected amounts remaining after lease endings caused the CobaltCoffer change. | 租約結束~lease endings~uncollected amounts
CobaltCoffer 的保證金催收費上限是 NT$16,490。| CobaltCoffer caps security-deposit collection spending at NT$16,490. | 16,490~16490~一萬六千四百九十~保證金催收~security-deposit collection
溫蘅負責 CobaltCoffer 的保證金返還追蹤。| Wen Heng owns CobaltCoffer's security-deposit return tracking. | 保證金返還追蹤~security-deposit return tracking
溫蘅在 CobaltCoffer 的租約索引只負責分隔頁。| Wen Heng only owns dividers in CobaltCoffer's lease index. | 租約索引~lease index~分隔頁~dividers
CobaltCoffer 的自動沖銷過期保證金仍是未核准提案。| Automatically writing off overdue deposits remains an unapproved CobaltCoffer proposal. | 沖銷過期保證金~writing off overdue deposits
CobaltCoffer 的收據印章代號是 CC-759。| CobaltCoffer's receipt stamp code is CC-759. | CC-759~cc759~收據印章~receipt stamp
`),
f('hr2b-t31','finance','棕籌','PalmCounter','蘇苒','Su Ran',`
棕籌原先把分期款全額列為已收。| PalmCounter originally recorded installments as fully received. | 分期款~installments~全額列為已收~fully received
棕籌後來改按實際入帳列已收分期款。| PalmCounter later recorded received installments by actual bank credits. | 實際入帳~actual bank credits
棕籌改動的原因是尚未扣款的分期被誤當現金。| Undebited installments being mistaken for cash caused the PalmCounter change. | 尚未扣款~undebited installments~mistaken for cash
棕籌的分期差額覆核上限是 NT$17,850。| PalmCounter caps installment-difference reviews at NT$17,850. | 17,850~17850~一萬七千八百五十~分期差額覆核~installment-difference reviews
蘇苒負責棕籌的分期入帳勾稽。| Su Ran owns PalmCounter's installment-credit matching. | 分期入帳勾稽~installment-credit matching
蘇苒在棕籌的繳款提醒卡只負責行距。| Su Ran only owns line spacing on PalmCounter's payment reminder card. | 繳款提醒卡~payment reminder card~行距~line spacing
棕籌已否決提前認列未扣款分期為現金。| PalmCounter rejected recognizing undebited installments as cash in advance. | 提前認列~recognizing undebited installments
棕籌的備用計算機型號是 PC-843。| PalmCounter's spare calculator model is PC-843. | PC-843~pc843~備用計算機~spare calculator
`),
f('hr2b-t32','finance','芹衡','CeleryBalance','林頌','Lin Song',`
芹衡原先把課程折價券當成現金退款。| CeleryBalance originally treated course vouchers as cash refunds. | 課程折價券~course vouchers~現金退款~cash refunds
芹衡後來改把折價券記成待抵用餘額。| CeleryBalance later recorded vouchers as balances awaiting redemption. | 待抵用餘額~balances awaiting redemption
芹衡改動的原因是抵用後又退款會重複減收。| Refunds after redemption reducing revenue twice caused the CeleryBalance change. | 重複減收~reducing revenue twice~after redemption
芹衡的折價券核對費上限是 NT$18,670。| CeleryBalance caps voucher-checking spending at NT$18,670. | 18,670~18670~一萬八千六百七十~折價券核對費~voucher-checking
林頌負責芹衡的抵用餘額核對。| Lin Song owns CeleryBalance's redemption-balance matching. | 抵用餘額核對~redemption-balance matching
林頌在芹衡的課程收據樣張只負責底紋。| Lin Song only owns background patterns on CeleryBalance's sample course receipt. | 課程收據樣張~sample course receipt~底紋~background patterns
芹衡的折價券過期自動轉現金仍是未核准提案。| Automatically converting expired vouchers to cash remains an unapproved CeleryBalance proposal. | 過期自動轉現金~expired vouchers to cash
芹衡的票券印刷批號是 CB-984。| CeleryBalance's voucher print batch is CB-984. | CB-984~cb984~票券印刷批號~voucher print batch
`),
f('hr2b-t33','product','瓷徑','PorcelainPath','徐澈','Xu Che',`
瓷徑的空白畫面原先顯示功能總覽。| PorcelainPath originally displayed a feature overview on empty screens. | 空白畫面~empty screens~功能總覽~feature overview
瓷徑的空白畫面後來改為顯示可開始的範例。| PorcelainPath later displayed actionable examples on empty screens. | 可開始的範例~actionable examples
瓷徑改動的原因是新手看完總覽仍不知從何下手。| Novices remaining unsure where to start after the overview caused the PorcelainPath change. | 新手~novices~where to start
瓷徑的空白頁設計費上限是 NT$44,300。| PorcelainPath caps empty-screen design spending at NT$44,300. | 44,300~44300~四萬四千三百~空白頁設計費~empty-screen design
徐澈負責瓷徑的起步範例。| Xu Che owns PorcelainPath's starter examples. | 起步範例~starter examples
徐澈在瓷徑的登入插畫只負責線稿。| Xu Che only owns line art in PorcelainPath's login illustration. | 登入插畫~login illustration~線稿~line art
瓷徑已否決自動建立假專案。| PorcelainPath rejected creating dummy projects automatically. | 假專案~dummy projects
瓷徑的圖示檔案夾代碼是 PP-875。| PorcelainPath's icon folder code is PP-875. | PP-875~pp875~圖示檔案夾~icon folder
`),
f('hr2b-t34','product','EmberAtlas','餘燼圖','葉苓','Ye Ling',`
EmberAtlas 原先以滿版視窗呈現修改紀錄。| EmberAtlas originally showed revision history in a full-screen view. | 滿版視窗~full-screen view~修改紀錄~revision history
EmberAtlas 後來改用側欄呈現修改紀錄。| EmberAtlas later showed revision history in a sidebar. | 側欄~sidebar
EmberAtlas 改動的原因是對照原稿時會失去編輯位置。| Losing editing position while comparing originals caused the EmberAtlas change. | 編輯位置~editing position~comparing originals
EmberAtlas 的紀錄介面設計費上限是 NT$46,100。| EmberAtlas caps history-interface design spending at NT$46,100. | 46,100~46100~四萬六千一百~紀錄介面設計費~history-interface design
葉苓負責 EmberAtlas 的側欄互動。| Ye Ling owns EmberAtlas's sidebar interactions. | 側欄互動~sidebar interactions
葉苓在 EmberAtlas 的匯入封面只負責底色。| Ye Ling only owns background color on EmberAtlas's import cover. | 匯入封面~import cover~底色~background color
EmberAtlas 的鎖住所有歷史版本仍是未核准提案。| Locking every historical version remains an unapproved EmberAtlas proposal. | 鎖住所有歷史版本~locking every historical version
EmberAtlas 的設計檔封存碼是 EA-946。| EmberAtlas's design archive code is EA-946. | EA-946~ea946~設計檔封存碼~design archive code
`),
f('hr2b-t35','product','茴格','FennelGrid','方湛','Fang Zhan',`
茴格的搜尋結果原先預設展開摘要。| FennelGrid originally expanded summaries in search results by default. | 展開摘要~expanded summaries~search results
茴格的搜尋結果後來改為點開才顯示摘要。| FennelGrid later showed result summaries only after opening. | 點開才~only after opening
茴格改動的原因是窄螢幕上無法快速比較標題。| Narrow screens preventing quick title comparisons caused the FennelGrid change. | 窄螢幕~narrow screens~title comparisons
茴格的搜尋介面改版費上限是 NT$47,900。| FennelGrid caps search-interface redesign spending at NT$47,900. | 47,900~47900~四萬七千九百~搜尋介面改版費~search-interface redesign
方湛負責茴格的摘要展開手勢。| Fang Zhan owns FennelGrid's summary-opening gestures. | 摘要展開手勢~summary-opening gestures
方湛在茴格的收藏插頁只負責紙感紋理。| Fang Zhan only owns paper textures on FennelGrid's bookmark insert. | 收藏插頁~bookmark insert~紙感紋理~paper textures
茴格已否決在標題旁顯示人氣分數。| FennelGrid rejected popularity scores beside titles. | 人氣分數~popularity scores
茴格的介面音效檔代碼是 FG-687。| FennelGrid's interface sound file code is FG-687. | FG-687~fg687~介面音效檔~interface sound file
`),
f('hr2b-t36','product','LarchCanvas','落葉松幕','秦禾','Qin He',`
LarchCanvas 原先在拖曳結束時才顯示落點。| LarchCanvas originally showed drop targets only after dragging ended. | 拖曳結束~dragging ended~落點~drop targets
LarchCanvas 後來改為拖曳途中預示落點。| LarchCanvas later previewed drop targets during dragging. | 拖曳途中~during dragging~預示~previewed
LarchCanvas 改動的原因是使用者常把卡片放進相鄰欄。| Users placing cards in adjacent columns caused the LarchCanvas change. | 相鄰欄~adjacent columns~placing cards
LarchCanvas 的拖曳互動設計費上限是 NT$49,600。| LarchCanvas caps drag-interaction design spending at NT$49,600. | 49,600~49600~四萬九千六百~拖曳互動設計費~drag-interaction design
秦禾負責 LarchCanvas 的落點預示。| Qin He owns LarchCanvas's drop-target previews. | 落點預示~drop-target previews
秦禾在 LarchCanvas 的完成提示卡只負責圓角。| Qin He only owns rounded corners on LarchCanvas's completion card. | 完成提示卡~completion card~圓角~rounded corners
LarchCanvas 的拖曳時自動跨欄仍是未核准提案。| Automatic cross-column moves while dragging remain an unapproved LarchCanvas proposal. | 自動跨欄~automatic cross-column moves
LarchCanvas 的展示平板編號是 LC-958。| LarchCanvas's display tablet number is LC-958. | LC-958~lc958~展示平板~display tablet
`),
f('hr2b-t37','product','芍窗','PeonyWindow','袁沐','Yuan Mu',`
芍窗的撤銷入口原先只放在選單。| PeonyWindow originally placed undo access only in the menu. | 撤銷入口~undo access~選單~menu
芍窗的撤銷入口後來改為操作後就地顯示。| PeonyWindow later displayed undo access beside the completed action. | 就地顯示~beside the completed action
芍窗改動的原因是使用者找入口時已忘記誤操作。| Users forgetting mistakes while hunting for undo caused the PeonyWindow change. | 忘記誤操作~forgetting mistakes~hunting for undo
芍窗的撤銷介面設計費上限是 NT$51,300。| PeonyWindow caps undo-interface design spending at NT$51,300. | 51,300~51300~五萬一千三百~撤銷介面設計費~undo-interface design
袁沐負責芍窗的就地撤銷提示。| Yuan Mu owns PeonyWindow's local undo prompts. | 就地撤銷提示~local undo prompts
袁沐在芍窗的偏好圖卡只負責陰影。| Yuan Mu only owns shadows on PeonyWindow's preference card. | 偏好圖卡~preference card~陰影~shadows
芍窗已否決用確認彈窗取代所有撤銷。| PeonyWindow rejected replacing all undo with confirmation dialogs. | 確認彈窗~confirmation dialogs~replacing all undo
芍窗的貼圖授權批次是 PW-769。| PeonyWindow's sticker-license batch is PW-769. | PW-769~pw769~貼圖授權批次~sticker-license batch
`),
f('hr2b-t38','product','蘚圖','LichenMap','姜羽','Jiang Yu',`
蘚圖的權限說明原先只列角色名稱。| LichenMap originally explained permissions with role names alone. | 權限說明~permissions~角色名稱~role names alone
蘚圖的權限說明後來改為列出可做的動作。| LichenMap later explained permissions with allowed actions. | 可做的動作~allowed actions
蘚圖改動的原因是外部協作者不理解內部職稱。| External collaborators not understanding internal titles caused the LichenMap change. | 外部協作者~external collaborators~internal titles
蘚圖的權限說明改版費上限是 NT$53,800。| LichenMap caps permission-guide redesign spending at NT$53,800. | 53,800~53800~五萬三千八百~權限說明改版費~permission-guide redesign
姜羽負責蘚圖的動作說明表。| Jiang Yu owns LichenMap's action explanation table. | 動作說明表~action explanation table
姜羽在蘚圖的邀請郵件只負責分隔線。| Jiang Yu only owns separators in LichenMap's invitation email. | 邀請郵件~invitation email~分隔線~separators
蘚圖的預設開啟全部動作仍是未核准提案。| Enabling every action by default remains an unapproved LichenMap proposal. | 開啟全部動作~enabling every action
蘚圖的展示帳戶代碼是 LM-894。| LichenMap's display account code is LM-894. | LM-894~lm894~展示帳戶~display account
`),
f('hr2b-t39','everyday','榧桌','TorreyaTable','杜芮','Du Rui',`
榧桌的共享茶點原先放在窗邊長桌。| TorreyaTable originally placed shared snacks on the window table. | 共享茶點~shared snacks~窗邊長桌~window table
榧桌的共享茶點後來改放入口矮櫃。| TorreyaTable later placed shared snacks on the low entrance cabinet. | 入口矮櫃~low entrance cabinet
榧桌改動的原因是午後日照讓包裝內起水氣。| Afternoon sunlight causing moisture inside wrappers prompted the TorreyaTable change. | 午後日照~afternoon sunlight~水氣~moisture
榧桌的共享茶點週費上限是 NT$2,870。| TorreyaTable caps weekly shared-snack spending at NT$2,870. | 2,870~2870~二千八百七十~兩千八百七十~共享茶點週費~weekly shared-snack
杜芮負責榧桌的茶點補位。| Du Rui owns TorreyaTable's snack replenishment. | 茶點補位~snack replenishment
杜芮在榧桌的茶葉禮盒只負責緞帶。| Du Rui only owns ribbons on TorreyaTable's tea gift box. | 茶葉禮盒~tea gift box~緞帶~ribbons
榧桌已否決把散裝茶點直接倒進公用杯。| TorreyaTable rejected pouring loose snacks into shared cups. | 散裝茶點~loose snacks~公用杯~shared cups
榧桌的茶壺型號是 TT-985。| TorreyaTable's teapot model is TT-985. | TT-985~tt985~茶壺型號~teapot model
`),
f('hr2b-t40','everyday','蕎袋','BuckwheatBag','溫蘅','Wen Heng',`
蕎袋的外出借物原先回來再整理。| BuckwheatBag originally sorted borrowed outing gear after returning. | 外出借物~borrowed outing gear~回來再整理~after returning
蕎袋的外出借物後來改為出發前分袋。| BuckwheatBag later packed borrowed outing gear into separate bags before departure. | 出發前分袋~separate bags before departure
蕎袋改動的原因是回程時相似小物容易混在一起。| Similar small items becoming mixed on return caused the BuckwheatBag change. | 相似小物~similar small items~mixed on return
蕎袋的收納用品季費上限是 NT$3,690。| BuckwheatBag caps quarterly packing supplies at NT$3,690. | 3,690~3690~三千六百九十~收納用品季費~quarterly packing supplies
溫蘅負責蕎袋的出發前分袋。| Wen Heng owns BuckwheatBag's pre-departure bagging. | 出發前分袋~pre-departure bagging
溫蘅在蕎袋的散步地圖只負責摺痕。| Wen Heng only owns fold lines on BuckwheatBag's walking map. | 散步地圖~walking map~摺痕~fold lines
蕎袋的借物一律共用收納袋仍是未核准提案。| A single shared bag for all borrowed gear remains an unapproved BuckwheatBag proposal. | 共用收納袋~single shared bag
蕎袋的登山杖資產號碼是 BB-876。| BuckwheatBag's walking-pole asset number is BB-876. | BB-876~bb876~登山杖~walking-pole
`),
];

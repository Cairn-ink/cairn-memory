import targets from './targets.mjs';
import { family } from './source.mjs';
// Each row below is an individually authored adjacent-artifact thread.
// Prefix substitution names its scope; the seven substantive clauses are hand
// authored. Four further episodes per family use disclosed numeric templates.
const stories = [
['簽章教具','signature teaching kit',`
教具原先用透明套展示封片。| The kit originally displayed seals in clear sleeves. | 透明套~clear sleeves
教具後來改用翻頁夾展示封片。| The kit later displayed seals in a flip binder. | 翻頁夾~flip binder
教具改動是因為透明套反光遮住筆跡。| Glare hiding handwriting caused the kit change. | 反光遮住筆跡~glare hiding handwriting
教具的裝訂支出上限是 NT$61,370。| The kit caps binding spending at NT$61,370. | 61,370~61370~六萬一千三百七十~裝訂支出~binding spending
排練助理負責教具的封片排序。| The rehearsal aide owns seal ordering for the kit. | 排練助理~rehearsal aide~封片排序~seal ordering
排練助理在教具外袋只負責扣環。| The rehearsal aide only owns clasps on the kit pouch. | 扣環~clasps~外袋~pouch
教具已否決用訂書針穿過封片。| The kit rejected stapling through seals. | 訂書針~stapling
教具的木箱代碼是 DK-491。| The kit's wooden crate code is DK-491. | DK-491~dk491~木箱~wooden crate
`],
['附件拼圖','attachment puzzle',`
拼圖原先用相同背紋。| The puzzle originally used identical reverse patterns. | 相同背紋~identical reverse patterns
拼圖後來改用分組背紋。| The puzzle later used grouped reverse patterns. | 分組背紋~grouped reverse patterns
拼圖改動是因為收攤時難以分盒。| Difficulty sorting boxes at pack-up caused the puzzle change. | 收攤~pack-up~分盒~sorting boxes
拼圖的刀模費上限是 NT$62,480。| The puzzle caps cutting-die spending at NT$62,480. | 62,480~62480~六萬二千四百八十~刀模費~cutting-die
工坊助理負責拼圖的背紋分類。| The workshop aide owns reverse-pattern grouping for the puzzle. | 工坊助理~workshop aide~背紋分類~reverse-pattern grouping
工坊助理在拼圖海報只負責邊飾。| The workshop aide only owns edging on the puzzle poster. | 邊飾~edging~拼圖海報~puzzle poster
拼圖的金屬拼片仍是未核准提案。| Metal pieces remain an unapproved puzzle proposal. | 金屬拼片~metal pieces
拼圖的掛架代碼是 DP-592。| The puzzle rack code is DP-592. | DP-592~dp592~掛架~rack
`],
['字典桌遊','dictionary board game',`
桌遊原先用薄紙卡。| The game originally used thin cards. | 薄紙卡~thin cards
桌遊後來改用覆膜卡。| The game later used laminated cards. | 覆膜卡~laminated cards
桌遊改動是因為擦拭會磨掉字面。| Wiping wearing away lettering caused the game change. | 磨掉字面~wearing away lettering
桌遊的覆膜費上限是 NT$63,590。| The game caps lamination spending at NT$63,590. | 63,590~63590~六萬三千五百九十~覆膜費~lamination spending
遊戲助理負責桌遊的卡面檢查。| The game aide owns face checks for the cards. | 遊戲助理~game aide~卡面檢查~face checks
遊戲助理在桌遊收納盒只負責絨布。| The game aide only owns felt in the storage box. | 絨布~felt~收納盒~storage box
桌遊已否決使用可溶性印墨。| The game rejected water-soluble ink. | 可溶性印墨~water-soluble ink
桌遊的外箱代碼是 DG-693。| The game's outer carton code is DG-693. | DG-693~dg693~外箱~outer carton
`],
['簽收模型','acknowledgement model',`
模型原先讓磁片自由移動。| The model originally allowed magnetic tiles to move freely. | 磁片自由移動~magnetic tiles to move freely
模型後來改用凹槽固定磁片。| The model later held magnetic tiles in grooves. | 凹槽固定磁片~tiles in grooves
模型改動是因為運送震動會打亂順序。| Transit vibration scrambling order caused the model change. | 運送震動~transit vibration~scrambling order
模型的開槽費上限是 NT$64,710。| The model caps groove-cutting spending at NT$64,710. | 64,710~64710~六萬四千七百一十~開槽費~groove-cutting
展示助理負責模型的磁片定位。| The display aide owns tile positioning for the model. | 展示助理~display aide~磁片定位~tile positioning
展示助理在模型介紹冊只負責書脊。| The display aide only owns the booklet spine. | 介紹冊~booklet spine~書脊
模型的玻璃磁片仍是未核准提案。| Glass tiles remain an unapproved model proposal. | 玻璃磁片~glass tiles
模型的支架代碼是 DM-794。| The model's support code is DM-794. | DM-794~dm794~支架代碼~support code
`],
['圖像色票冊','image swatch book',`
色票冊原先以顏色深淺排序。| The swatch book originally sorted by shade depth. | 顏色深淺~shade depth
色票冊後來改以紙材排序。| The swatch book later sorted by paper stock. | 紙材排序~paper stock
色票冊改動是因為不同紙材會改變觸感。| Different stock changing tactile feel caused the swatch-book change. | 觸感~tactile feel
色票冊的打樣費上限是 NT$65,820。| The swatch book caps proofing spending at NT$65,820. | 65,820~65820~六萬五千八百二十~打樣費~proofing spending
打樣助理負責色票冊的紙材歸類。| The proofing aide owns stock classification for the swatch book. | 打樣助理~proofing aide~紙材歸類~stock classification
打樣助理在色票冊書套只負責鬆緊帶。| The proofing aide only owns the elastic on the slipcase. | 書套~slipcase~鬆緊帶~elastic
色票冊已否決使用香味塗層。| The swatch book rejected scented coating. | 香味塗層~scented coating
色票冊的壓板代碼是 DS-895。| The swatch book's press-board code is DS-895. | DS-895~ds895~壓板~press-board
`],
['語法積木','syntax blocks',`
積木原先用貼紙標記接點。| The blocks originally marked joints with stickers. | 接點~joints~貼紙標記~with stickers
積木後來改用刻痕標記接點。| The blocks later marked joints with notches. | 刻痕~notches
積木改動是因為貼紙邊角容易翹起。| Peeling sticker corners caused the block change. | 邊角容易翹起~peeling sticker corners
積木的雕刻費上限是 NT$66,930。| The blocks cap engraving spending at NT$66,930. | 66,930~66930~六萬六千九百三十~雕刻費~engraving spending
木作助理負責積木的接點刻痕。| The woodwork aide owns joint notches for the blocks. | 木作助理~woodwork aide~接點刻痕~joint notches
木作助理在積木提袋只負責提繩。| The woodwork aide only owns the cord on the block bag. | 積木提袋~block bag~提繩~cord
積木的尖角造型仍是未核准提案。| Sharp corners remain an unapproved block proposal. | 尖角造型~sharp corners
積木的工具箱代碼是 DT-496。| The block toolbox code is DT-496. | DT-496~dt496~工具箱~toolbox
`],
['清除流程掛圖','purge process wall chart',`
掛圖原先以直線連接紙片。| The wall chart originally joined slips with straight lines. | 直線連接~straight lines~紙片~slips
掛圖後來改用曲線連接紙片。| The wall chart later joined slips with curves. | 曲線連接~with curves
掛圖改動是因為交叉線遮住紙片內容。| Crossing lines obscuring slip text caused the chart change. | 交叉線~crossing lines~slip text
掛圖的描線費上限是 NT$67,140。| The chart caps line-drawing spending at NT$67,140. | 67,140~67140~六萬七千一百四十~描線費~line-drawing
美術助理負責掛圖的曲線走向。| The art aide owns curve routing on the chart. | 美術助理~art aide~曲線走向~curve routing
美術助理在掛圖包裝只負責泡棉。| The art aide only owns foam in the chart packaging. | 掛圖包裝~chart packaging~泡棉~foam
掛圖已否決用細鐵線代替墨線。| The chart rejected wire in place of ink lines. | 細鐵線~wire~墨線~ink lines
掛圖的圖筒代碼是 DC-597。| The chart tube code is DC-597. | DC-597~dc597~圖筒~chart tube
`],
['時鐘演示盤','clock demonstration disk',`
演示盤原先讓指針固定不動。| The disk originally used fixed hands. | 指針固定~fixed hands
演示盤後來改用可旋轉指針。| The disk later used rotating hands. | 可旋轉指針~rotating hands
演示盤改動是因為靜態盤面無法演示跨日。| Static faces failing to show day rollover caused the disk change. | 靜態盤面~static faces~day rollover
演示盤的軸心加工費上限是 NT$68,250。| The disk caps hub machining at NT$68,250. | 68,250~68250~六萬八千二百五十~軸心加工~hub machining
教學助理負責演示盤的指針裝配。| The teaching aide owns hand assembly for the disk. | 教學助理~teaching aide~指針裝配~hand assembly
教學助理在演示盤布套只負責車縫。| The teaching aide only owns stitching on the disk sleeve. | 布套~disk sleeve~車縫~stitching
演示盤的電動馬達仍是未核准提案。| A motor remains an unapproved disk proposal. | 電動馬達~a motor
演示盤的底座代碼是 DD-698。| The disk's base code is DD-698. | DD-698~dd698~底座代碼~base code
`],
['路由迷宮','routing maze',`
迷宮原先以黏土圍出通道。| The maze originally built passages from clay. | 黏土~clay~通道~passages
迷宮後來改用可拆木條。| The maze later used removable wooden strips. | 可拆木條~removable wooden strips
迷宮改動是因為黏土乾裂會堵住入口。| Cracked clay blocking entrances caused the maze change. | 乾裂~cracked clay~堵住入口~blocking entrances
迷宮的木條加工費上限是 NT$69,360。| The maze caps strip machining at NT$69,360. | 69,360~69360~六萬九千三百六十~木條加工~strip machining
場佈助理負責迷宮的木條接合。| The staging aide owns strip joints in the maze. | 場佈助理~staging aide~木條接合~strip joints
場佈助理在迷宮告示只負責掛鉤。| The staging aide only owns hooks on the maze sign. | 迷宮告示~maze sign~掛鉤~hooks
迷宮已否決在通道鋪碎石。| The maze rejected gravel in the passages. | 碎石~gravel
迷宮的運送箱代碼是 DZ-799。| The maze's transport crate code is DZ-799. | DZ-799~dz799~運送箱~transport crate
`],
['密鑰桌牌','secret-key desk plaque',`
桌牌原先使用亮面金屬。| The plaque originally used polished metal. | 亮面金屬~polished metal
桌牌後來改用霧面木片。| The plaque later used matte wood. | 霧面木片~matte wood
桌牌改動是因為金屬反光影響拍攝。| Metal glare disrupting photographs caused the plaque change. | 金屬反光~metal glare~photographs
桌牌的磨砂費上限是 NT$70,470。| The plaque caps sanding spending at NT$70,470. | 70,470~70470~七萬零四百七十~磨砂費~sanding spending
攝影助理負責桌牌的消光處理。| The photo aide owns matte finishing for the plaque. | 攝影助理~photo aide~消光處理~matte finishing
攝影助理在桌牌支座只負責橡膠墊。| The photo aide only owns rubber pads on the stand. | 桌牌支座~stand~橡膠墊~rubber pads
桌牌的鏡面背板仍是未核准提案。| A mirrored backing remains an unapproved plaque proposal. | 鏡面背板~mirrored backing
桌牌的防塵罩代碼是 DL-481。| The plaque's dust-cover code is DL-481. | DL-481~dl481~防塵罩~dust-cover
`],
['討論練習冊','discussion exercise book',`
練習冊原先用連續文字示範對話。| The exercise book originally demonstrated dialogue in continuous prose. | 連續文字~continuous prose
練習冊後來改用對話泡泡。| The exercise book later used dialogue bubbles. | 對話泡泡~dialogue bubbles
練習冊改動是因為讀者分不清示範角色。| Readers confusing demonstration roles caused the exercise-book change. | 示範角色~demonstration roles
練習冊的排字費上限是 NT$71,580。| The exercise book caps typesetting at NT$71,580. | 71,580~71580~七萬一千五百八十~排字費~typesetting
編輯助理負責練習冊的泡泡順序。| The editorial aide owns bubble ordering in the exercise book. | 編輯助理~editorial aide~泡泡順序~bubble ordering
編輯助理在練習冊腰封只負責摺口。| The editorial aide only owns flaps on the belly band. | 腰封~belly band~摺口~flaps
練習冊已否決用手寫體塞滿整頁。| The exercise book rejected pages filled with cursive. | 手寫體~cursive
練習冊的樣書代碼是 DE-582。| The exercise book's sample copy code is DE-582. | DE-582~de582~樣書~sample copy
`],
['改稿明信片','editing postcard',`
明信片原先正反面同色。| The postcard originally used the same color on both sides. | 正反面同色~same color on both sides
明信片後來改用不同底色。| The postcard later used distinct background hues. | 不同底色~distinct background hues
明信片改動是因為收件人常把背面當封面。| Recipients mistaking backs for fronts caused the postcard change. | 背面當封面~backs for fronts~recipients
明信片的試印費上限是 NT$72,690。| The postcard caps trial printing at NT$72,690. | 72,690~72690~七萬二千六百九十~試印費~trial printing
印務助理負責明信片的雙面配色。| The print aide owns two-sided color choices for the postcard. | 印務助理~print aide~雙面配色~two-sided color choices
印務助理在明信片封套只負責封舌。| The print aide only owns the envelope flap. | 封舌~envelope flap~封套~envelope
明信片的金箔邊框仍是未核准提案。| Gold-foil borders remain an unapproved postcard proposal. | 金箔邊框~gold-foil borders
明信片的版號是 DP-683。| The postcard's plate code is DP-683. | DP-683~dp683~版號~plate code
`],
['訪談角色卡','interview role cards',`
角色卡原先在角落放角色標記。| The cards originally placed role marks in the corner. | 角落~corner~角色標記~role marks
角色卡後來改在頂端放角色標記。| The cards later placed role marks at the top. | 頂端~at the top
角色卡改動是因為拿牌時手會遮住角落。| Hands hiding corners while holding cards caused the role-card change. | 手會遮住~hands hiding
角色卡的燙印費上限是 NT$73,810。| The cards cap hot-stamping spending at NT$73,810. | 73,810~73810~七萬三千八百一十~燙印費~hot-stamping
帶領助理負責角色卡的標記位置。| The facilitation aide owns mark placement on the cards. | 帶領助理~facilitation aide~標記位置~mark placement
帶領助理在角色卡盒只負責海綿襯底。| The facilitation aide only owns sponge lining in the card box. | 海綿襯底~sponge lining~角色卡盒~card box
角色卡已否決在背面印出答案。| The cards rejected printing answers on their backs. | 背面印出答案~answers on their backs
角色卡的保護盒代碼是 DR-784。| The role cards' protective case code is DR-784. | DR-784~dr784~保護盒~protective case
`],
['阻礙牆示範板','blocker-wall demonstration board',`
示範板原先用大頭針固定紙張。| The board originally pinned sheets with tacks. | 大頭針~tacks
示範板後來改用黏扣帶固定紙張。| The board later held sheets with hook-and-loop strips. | 黏扣帶~hook-and-loop strips
示範板改動是因為大頭針會掉到走道。| Tacks falling into the aisle caused the board change. | 掉到走道~falling into the aisle
示範板的布面費上限是 NT$74,920。| The board caps fabric-surface spending at NT$74,920. | 74,920~74920~七萬四千九百二十~布面費~fabric-surface
布置助理負責示範板的黏扣排列。| The setup aide owns strip arrangement on the board. | 布置助理~setup aide~黏扣排列~strip arrangement
布置助理在示範板底框只負責防刮布。| The setup aide only owns scratch cloth on the lower frame. | 防刮布~scratch cloth~底框~lower frame
示範板的裸露磁鐵仍是未核准提案。| Exposed magnets remain an unapproved board proposal. | 裸露磁鐵~exposed magnets
示範板的護角批號是 DB-885。| The board's corner-guard batch is DB-885. | DB-885~db885~護角~corner-guard
`],
['提醒聲音樣本','notification sound sampler',`
樣本原先用尖銳鈴聲開場。| The sampler originally opened with a sharp bell. | 尖銳鈴聲~sharp bell
樣本後來改用低音木響開場。| The sampler later opened with a low wood tone. | 低音木響~low wood tone
樣本改動是因為鈴聲在耳機中刺耳。| The bell sounding harsh in headphones caused the sampler change. | 耳機中刺耳~harsh in headphones
樣本的收音費上限是 NT$75,130。| The sampler caps recording spending at NT$75,130. | 75,130~75130~七萬五千一百三十~收音費~recording spending
音訊助理負責樣本的木響剪輯。| The audio aide owns wood-tone cuts for the sampler. | 音訊助理~audio aide~木響剪輯~wood-tone cuts
音訊助理在樣本封面只負責色塊。| The audio aide only owns color blocks on the sampler cover. | 色塊~color blocks~樣本封面~sampler cover
樣本已否決加入突然的爆破聲。| The sampler rejected sudden blast sounds. | 爆破聲~blast sounds
樣本的音叉編號是 DN-486。| The sampler's tuning-fork number is DN-486. | DN-486~dn486~音叉~tuning-fork
`],
['觀察便條練習盒','observation-slip practice box',`
練習盒原先使用透明卡片。| The practice box originally used transparent cards. | 透明卡片~transparent cards
練習盒後來改用不透光卡片。| The practice box later used opaque cards. | 不透光卡片~opaque cards
練習盒改動是因為疊放時文字互相干擾。| Overlapping text in stacked cards caused the practice-box change. | 疊放~stacked cards~overlapping text
練習盒的紙卡費上限是 NT$76,240。| The practice box caps card-stock spending at NT$76,240. | 76,240~76240~七萬六千二百四十~紙卡費~card-stock
練習助理負責練習盒的卡片分色。| The practice aide owns card color grouping in the box. | 練習助理~practice aide~卡片分色~card color grouping
練習助理在練習盒外扣只負責皮帶。| The practice aide only owns the leather strap on the latch. | 外扣~latch~皮帶~leather strap
練習盒的發光卡片仍是未核准提案。| Luminous cards remain an unapproved practice-box proposal. | 發光卡片~luminous cards
練習盒的隔板代碼是 DO-587。| The practice box's partition code is DO-587. | DO-587~do587~隔板~partition
`],
['閱讀範例書籤','reading-example bookmark',`
書籤原先把說明放在末端。| The bookmark originally placed explanations at its tip. | 末端~at its tip
書籤後來改把說明放在中央。| The bookmark later placed explanations in the center. | 中央~in the center
書籤改動是因為末端被書頁夾住。| Book pages hiding the tip caused the bookmark change. | 書頁夾住~book pages hiding the tip
書籤的裁製費上限是 NT$77,350。| The bookmark caps cutting spending at NT$77,350. | 77,350~77350~七萬七千三百五十~裁製費~cutting spending
讀書會助理負責書籤的說明位置。| The reading-club aide owns explanation placement on the bookmark. | 讀書會助理~reading-club aide~說明位置~explanation placement
讀書會助理在書籤束帶只負責結頭。| The reading-club aide only owns knots on the bookmark band. | 束帶~bookmark band~結頭~knots
書籤已否決使用厚重石片。| The bookmark rejected heavy stone pieces. | 厚重石片~heavy stone pieces
書籤的木模代碼是 DB-688。| The bookmark's wooden mold code is DB-688. | DB-688~db688~木模~wooden mold
`],
['巡查訓練地墊','inspection training mat',`
地墊原先使用光滑表面。| The mat originally used a smooth surface. | 光滑表面~smooth surface
地墊後來改用止滑表面。| The mat later used a non-slip surface. | 止滑表面~non-slip surface
地墊改動是因為濕鞋底容易滑動。| Wet soles slipping caused the mat change. | 濕鞋底~wet soles
地墊的壓紋費上限是 NT$78,460。| The mat caps embossing spending at NT$78,460. | 78,460~78460~七萬八千四百六十~壓紋費~embossing
場務助理負責地墊的止滑檢查。| The floor aide owns slip checks on the mat. | 場務助理~floor aide~止滑檢查~slip checks
場務助理在地墊提套只負責拉鍊。| The floor aide only owns the zip on the mat carrier. | 地墊提套~mat carrier~拉鍊~zip
地墊的亮片表面仍是未核准提案。| A sequined surface remains an unapproved mat proposal. | 亮片表面~sequined surface
地墊的滾筒代碼是 DF-789。| The mat's roller code is DF-789. | DF-789~df789~滾筒~roller
`],
['借物沙盤','lending sand table',`
沙盤原先使用散砂標示區域。| The sand table originally marked zones with loose sand. | 散砂~loose sand~zones
沙盤後來改用軟木片標示區域。| The sand table later marked zones with cork pieces. | 軟木片~cork pieces
沙盤改動是因為搬運會讓散砂流動。| Loose sand shifting in transit caused the sand-table change. | 散砂流動~sand shifting in transit
沙盤的軟木費上限是 NT$79,570。| The sand table caps cork spending at NT$79,570. | 79,570~79570~七萬九千五百七十~軟木費~cork spending
沙盤助理負責沙盤的區域拼接。| The model-table aide owns zone joins on the sand table. | 沙盤助理~model-table aide~區域拼接~zone joins
沙盤助理在沙盤罩布只負責縫邊。| The model-table aide only owns hems on the table cloth. | 罩布~table cloth~縫邊~hems
沙盤已否決用水渠分區。| The sand table rejected water channels for zones. | 水渠~water channels
沙盤的量尺代碼是 DZ-891。| The sand table's measuring-rule code is DZ-891. | DZ-891~dz891~量尺~measuring-rule
`],
['候補流程手偶','standby-process hand puppet',`
手偶原先用固定嘴型。| The puppet originally used a fixed mouth. | 固定嘴型~fixed mouth
手偶後來改用可動嘴型。| The puppet later used a moving mouth. | 可動嘴型~moving mouth
手偶改動是因為示範回應時看不出輪替。| Invisible turn changes during demonstrations caused the puppet change. | 看不出輪替~invisible turn changes
手偶的縫製費上限是 NT$80,680。| The puppet caps sewing spending at NT$80,680. | 80,680~80680~八萬零六百八十~縫製費~sewing spending
劇場助理負責手偶的嘴部機關。| The theater aide owns the puppet's mouth mechanism. | 劇場助理~theater aide~嘴部機關~mouth mechanism
劇場助理在手偶旅行袋只負責把手。| The theater aide only owns handles on the puppet travel bag. | 手偶旅行袋~puppet travel bag~把手~handles
手偶的硬殼下顎仍是未核准提案。| A rigid jaw remains an unapproved puppet proposal. | 硬殼下顎~rigid jaw
手偶的展示盒代碼是 DU-492。| The puppet's display case code is DU-492. | DU-492~du492~展示盒~display case
`],
['失物演練小包','lost-property rehearsal pouch',`
小包原先用繩結封口。| The pouch originally closed with tied string. | 繩結封口~tied string
小包後來改用按扣封口。| The pouch later closed with snaps. | 按扣封口~with snaps
小包改動是因為反覆解繩拖慢示範。| Repeated untying slowing demonstrations caused the pouch change. | 反覆解繩~repeated untying
小包的扣具費上限是 NT$81,790。| The pouch caps fastener spending at NT$81,790. | 81,790~81790~八萬一千七百九十~扣具費~fastener spending
演練助理負責小包的扣具固定。| The drill aide owns fastener mounting on the pouch. | 演練助理~drill aide~扣具固定~fastener mounting
演練助理在小包襯裡只負責車線。| The drill aide only owns seams in the pouch lining. | 小包襯裡~pouch lining~車線~seams
小包已否決使用難拆鉛封。| The pouch rejected hard-to-remove lead seals. | 難拆鉛封~lead seals
小包的壓扣器代碼是 DP-593。| The pouch's snap press code is DP-593. | DP-593~dp593~壓扣器~snap press
`],
['補料模擬架','replenishment simulation rack',`
模擬架原先用固定隔板。| The rack originally used fixed partitions. | 固定隔板~fixed partitions
模擬架後來改用滑動隔板。| The rack later used sliding partitions. | 滑動隔板~sliding partitions
模擬架改動是因為示範物大小改變。| Changing demonstration-item sizes caused the rack change. | 示範物大小~demonstration-item sizes
模擬架的軌道費上限是 NT$82,910。| The rack caps rail spending at NT$82,910. | 82,910~82910~八萬二千九百一十~軌道費~rail spending
倉務助理負責模擬架的滑軌測試。| The stockroom aide owns rail tests on the rack. | 倉務助理~stockroom aide~滑軌測試~rail tests
倉務助理在模擬架護套只負責扣帶。| The stockroom aide only owns straps on the rack cover. | 模擬架護套~rack cover~扣帶~straps
模擬架的懸吊結構仍是未核准提案。| A suspended frame remains an unapproved rack proposal. | 懸吊結構~suspended frame
模擬架的輪座代碼是 DR-694。| The rack's caster base code is DR-694. | DR-694~dr694~輪座~caster base
`],
['報到角色徽章','check-in role badge',`
徽章原先使用別針。| The badge originally used a pin. | 別針~a pin
徽章後來改用繩環。| The badge later used a cord loop. | 繩環~cord loop
徽章改動是因為別針會勾住衣料。| Pins snagging fabric caused the badge change. | 勾住衣料~snagging fabric
徽章的織繩費上限是 NT$83,120。| The badge caps woven-cord spending at NT$83,120. | 83,120~83120~八萬三千一百二十~織繩費~woven-cord
接待助理負責徽章的繩環組裝。| The reception aide owns cord-loop assembly for the badge. | 接待助理~reception aide~繩環組裝~cord-loop assembly
接待助理在徽章背卡只負責倒角。| The reception aide only owns bevels on the backing card. | 徽章背卡~backing card~倒角~bevels
徽章已否決裸露尖銳扣件。| The badge rejected exposed sharp fasteners. | 尖銳扣件~sharp fasteners
徽章的收納盤代碼是 DB-795。| The badge's storage tray code is DB-795. | DB-795~db795~收納盤~storage tray
`],
['簡介排練翻牌','biography rehearsal flip cards',`
翻牌原先使用圓孔環扣。| The flip cards originally used rings through round holes. | 圓孔環扣~round holes
翻牌後來改用長孔扣帶。| The flip cards later used straps through slots. | 長孔扣帶~straps through slots
翻牌改動是因為環扣會卡住翻動。| Binding rings catching during flips caused the card change. | 卡住翻動~catching during flips
翻牌的沖孔費上限是 NT$84,230。| The flip cards cap punching spending at NT$84,230. | 84,230~84230~八萬四千二百三十~沖孔費~punching
排版助理負責翻牌的長孔位置。| The layout aide owns slot placement on the flip cards. | 排版助理~layout aide~長孔位置~slot placement
排版助理在翻牌封底只負責布紋。| The layout aide only owns cloth grain on the back cover. | 翻牌封底~back cover~布紋~cloth grain
翻牌的玻璃封面仍是未核准提案。| A glass cover remains an unapproved flip-card proposal. | 玻璃封面~glass cover
翻牌的打孔模代碼是 DF-896。| The flip cards' punch die code is DF-896. | DF-896~df896~打孔模~punch die
`],
['訂金演練籌碼','deposit rehearsal counters',`
籌碼原先使用扁平圓片。| The counters originally used flat disks. | 扁平圓片~flat disks
籌碼後來改用厚邊圓片。| The counters later used thick-rim disks. | 厚邊圓片~thick-rim disks
籌碼改動是因為扁平片不好拿起。| Flat pieces being hard to lift caused the counter change. | 不好拿起~hard to lift
籌碼的鑄模費上限是 NT$85,340。| The counters cap mold spending at NT$85,340. | 85,340~85340~八萬五千三百四十~鑄模費~mold spending
教具助理負責籌碼的厚邊打磨。| The prop aide owns rim smoothing on the counters. | 教具助理~prop aide~厚邊打磨~rim smoothing
教具助理在籌碼盒只負責鉸鏈。| The prop aide only owns hinges on the counter box. | 籌碼盒~counter box~鉸鏈~hinges
籌碼已否決使用易碎陶片。| The counters rejected fragile ceramic pieces. | 易碎陶片~fragile ceramic pieces
籌碼的樣模代碼是 DT-497。| The counters' sample mold code is DT-497. | DT-497~dt497~樣模~sample mold
`],
['授權教學卡冊','licensing teaching album',`
卡冊原先以膠黏固定卡片。| The album originally glued cards in place. | 膠黏~glued cards
卡冊後來改用插槽固定卡片。| The album later held cards in slots. | 插槽固定~cards in slots
卡冊改動是因為換版時會撕破底紙。| Revisions tearing backing paper caused the album change. | 撕破底紙~tearing backing paper
卡冊的插槽費上限是 NT$86,450。| The album caps slotting spending at NT$86,450. | 86,450~86450~八萬六千四百五十~插槽費~slotting spending
教材助理負責卡冊的插槽鬆緊。| The materials aide owns slot fit in the album. | 教材助理~materials aide~插槽鬆緊~slot fit
教材助理在卡冊外盒只負責吸鐵。| The materials aide only owns magnets on the outer case. | 卡冊外盒~outer case~吸鐵~magnets
卡冊的永久膠封仍是未核准提案。| Permanent glued seals remain an unapproved album proposal. | 永久膠封~permanent glued seals
卡冊的墊紙代碼是 DA-598。| The album's backing-sheet code is DA-598. | DA-598~da598~墊紙~backing-sheet
`],
['退款練習轉盤','refund practice wheel',`
轉盤原先使用透明指標。| The wheel originally used a clear pointer. | 透明指標~clear pointer
轉盤後來改用深色指標。| The wheel later used a dark pointer. | 深色指標~dark pointer
轉盤改動是因為透明指標在白底不易辨認。| Poor visibility on white caused the wheel change. | 白底不易辨認~poor visibility on white
轉盤的染色費上限是 NT$87,560。| The wheel caps dyeing spending at NT$87,560. | 87,560~87560~八萬七千五百六十~染色費~dyeing spending
訓練助理負責轉盤的指標染色。| The training aide owns pointer dyeing on the wheel. | 訓練助理~training aide~指標染色~pointer dyeing
訓練助理在轉盤袋只負責抽繩。| The training aide only owns drawstrings on the wheel bag. | 轉盤袋~wheel bag~抽繩~drawstrings
轉盤已否決鏡面指標。| The wheel rejected a mirrored pointer. | 鏡面指標~mirrored pointer
轉盤的軸套代碼是 DW-699。| The wheel's bushing code is DW-699. | DW-699~dw699~軸套~bushing
`],
['匯差情境布板','exchange-difference scenario board',`
布板原先用白線分區。| The fabric board originally used white dividing thread. | 白線分區~white dividing thread
布板後來改用褐線分區。| The fabric board later used brown dividing thread. | 褐線分區~brown dividing thread
布板改動是因為淺色布面看不清白線。| White thread disappearing on pale fabric caused the board change. | 淺色布面~pale fabric~white thread disappearing
布板的繡線費上限是 NT$88,670。| The fabric board caps embroidery-thread spending at NT$88,670. | 88,670~88670~八萬八千六百七十~繡線費~embroidery-thread
布藝助理負責布板的分區繡線。| The fabric aide owns divider embroidery on the board. | 布藝助理~fabric aide~分區繡線~divider embroidery
布藝助理在布板側袋只負責包邊。| The fabric aide only owns binding on the side pocket. | 布板側袋~side pocket~包邊~binding
布板的金屬線仍是未核准提案。| Metallic thread remains an unapproved fabric-board proposal. | 金屬線~metallic thread
布板的線軸代碼是 DT-891。| The fabric board's spool code is DT-891. | DT-891~dt891~線軸代碼~spool code
`],
['運費教學摺頁','freight teaching foldout',`
摺頁原先向內連續摺疊。| The foldout originally folded inward repeatedly. | 向內連續摺疊~folded inward repeatedly
摺頁後來改用手風琴摺法。| The foldout later used accordion folds. | 手風琴摺法~accordion folds
摺頁改動是因為中間頁難以攤平。| Middle panels resisting flattening caused the foldout change. | 中間頁~middle panels~flattening
摺頁的摺線費上限是 NT$89,780。| The foldout caps scoring spending at NT$89,780. | 89,780~89780~八萬九千七百八十~摺線費~scoring spending
裝訂助理負責摺頁的摺線方向。| The binding aide owns crease direction on the foldout. | 裝訂助理~binding aide~摺線方向~crease direction
裝訂助理在摺頁收套只負責圓孔。| The binding aide only owns round holes in the sleeve. | 摺頁收套~sleeve~圓孔~round holes
摺頁已否決用膠固定所有摺線。| The foldout rejected gluing every crease. | 膠固定所有摺線~gluing every crease
摺頁的壓線板代碼是 DF-492。| The foldout's scoring board code is DF-492. | DF-492~df492~壓線板~scoring board
`],
['保證金示範匣','security-deposit demonstration case',`
示範匣原先使用掀蓋。| The case originally used a lift lid. | 掀蓋~lift lid
示範匣後來改用抽拉蓋。| The case later used a sliding lid. | 抽拉蓋~sliding lid
示範匣改動是因為開蓋會碰到桌上展件。| Raised lids hitting table exhibits caused the case change. | 碰到桌上展件~hitting table exhibits
示範匣的木工費上限是 NT$90,890。| The case caps carpentry spending at NT$90,890. | 90,890~90890~九萬零八百九十~木工費~carpentry
展務助理負責示範匣的蓋板滑動。| The exhibit aide owns lid sliding on the case. | 展務助理~exhibit aide~蓋板滑動~lid sliding
展務助理在示範匣襯墊只負責絨面。| The exhibit aide only owns velvet on the case pad. | 示範匣襯墊~case pad~絨面~velvet
示範匣的自動彈蓋仍是未核准提案。| A spring lid remains an unapproved case proposal. | 自動彈蓋~spring lid
示範匣的定位銷代碼是 DC-593。| The case's locating-pin code is DC-593. | DC-593~dc593~定位銷~locating-pin
`],
['分期演算算盤','installment teaching abacus',`
算盤原先使用相同大小的珠子。| The abacus originally used equal-sized beads. | 相同大小的珠子~equal-sized beads
算盤後來改用大小交錯的珠子。| The abacus later used alternating bead sizes. | 大小交錯~alternating bead sizes
算盤改動是因為示範時難以辨認位值。| Hard-to-distinguish place values caused the abacus change. | 位值~place values
算盤的珠料費上限是 NT$91,210。| The abacus caps bead spending at NT$91,210. | 91,210~91210~九萬一千二百一十~珠料費~bead spending
算具助理負責算盤的珠序。| The counting-tool aide owns bead order on the abacus. | 算具助理~counting-tool aide~珠序~bead order
算具助理在算盤盒只負責銅扣。| The counting-tool aide only owns brass catches on the box. | 算盤盒~abacus box~銅扣~brass catches
算盤已否決全透明珠子。| The abacus rejected fully clear beads. | 全透明珠子~fully clear beads
算盤的橫桿代碼是 DA-694。| The abacus's crossbar code is DA-694. | DA-694~da694~橫桿~crossbar
`],
['抵用額教學票夾','redemption teaching wallet',`
票夾原先使用垂直插袋。| The wallet originally used vertical pockets. | 垂直插袋~vertical pockets
票夾後來改用橫向插袋。| The wallet later used horizontal pockets. | 橫向插袋~horizontal pockets
票夾改動是因為直插時票面容易折角。| Vertical insertion creasing ticket corners caused the wallet change. | 票面容易折角~creasing ticket corners
票夾的皮料費上限是 NT$92,320。| The wallet caps leather spending at NT$92,320. | 92,320~92320~九萬二千三百二十~皮料費~leather spending
皮件助理負責票夾的橫袋開口。| The leatherwork aide owns horizontal pocket openings on the wallet. | 皮件助理~leatherwork aide~橫袋開口~horizontal pocket openings
皮件助理在票夾束套只負責毛邊修整。| The leatherwork aide only owns edge cleanup on the wallet band. | 票夾束套~wallet band~毛邊修整~edge cleanup
票夾的外露鋸齒仍是未核准提案。| Exposed serrations remain an unapproved wallet proposal. | 外露鋸齒~exposed serrations
票夾的壓紋模代碼是 DV-795。| The wallet's embossing die code is DV-795. | DV-795~dv795~壓紋模~embossing die
`],
['起步範例模型冊','starter-example model book',`
模型冊原先使用黏貼式頁籤。| The model book originally used adhesive tabs. | 黏貼式頁籤~adhesive tabs
模型冊後來改用一體裁切頁籤。| The model book later used integral cut tabs. | 一體裁切頁籤~integral cut tabs
模型冊改動是因為黏貼頁籤會脫落。| Adhesive tabs falling off caused the model-book change. | 頁籤會脫落~tabs falling off
模型冊的裁切費上限是 NT$93,430。| The model book caps die cutting at NT$93,430. | 93,430~93430~九萬三千四百三十~裁切費~die cutting
模型助理負責模型冊的頁籤輪廓。| The model aide owns tab outlines in the book. | 模型助理~model aide~頁籤輪廓~tab outlines
模型助理在模型冊提盒只負責紙繩。| The model aide only owns paper cord on the carry box. | 模型冊提盒~carry box~紙繩~paper cord
模型冊已否決可拆式尖角頁籤。| The model book rejected detachable pointed tabs. | 尖角頁籤~pointed tabs
模型冊的襯板代碼是 DM-896。| The model book's stiffener code is DM-896. | DM-896~dm896~襯板~stiffener
`],
['版本歷史屏風','version-history screen',`
屏風原先只往外折。| The screen originally folded outward only. | 往外折~folded outward
屏風後來改為可雙向折。| The screen later folded both ways. | 雙向折~folded both ways
屏風改動是因為狹窄桌面無法展開。| Narrow tables preventing unfolding caused the screen change. | 狹窄桌面~narrow tables~unfolding
屏風的鉸接費上限是 NT$94,540。| The screen caps hinging spending at NT$94,540. | 94,540~94540~九萬四千五百四十~鉸接費~hinging
木工助理負責屏風的雙向鉸接。| The carpentry aide owns reversible hinges on the screen. | 木工助理~carpentry aide~雙向鉸接~reversible hinges
木工助理在屏風袋只負責止水布。| The carpentry aide only owns waterproof cloth on the screen bag. | 屏風袋~screen bag~止水布~waterproof cloth
屏風的落地重型底座仍是未核准提案。| A heavy floor base remains an unapproved screen proposal. | 落地重型底座~heavy floor base
屏風的扣座代碼是 DS-497。| The screen's catch-base code is DS-497. | DS-497~ds497~扣座~catch-base
`],
['摘要摺紙卡','summary origami card',`
摺紙卡原先朝左開啟。| The origami card originally opened leftward. | 朝左開啟~opened leftward
摺紙卡後來改朝上開啟。| The origami card later opened upward. | 朝上開啟~opened upward
摺紙卡改動是因為並排時會碰到旁卡。| Sideways openings hitting neighboring cards caused the origami change. | 碰到旁卡~hitting neighboring cards
摺紙卡的壓摺費上限是 NT$95,650。| The origami card caps folding spending at NT$95,650. | 95,650~95650~九萬五千六百五十~壓摺費~folding spending
紙藝助理負責摺紙卡的開啟方向。| The paper-art aide owns opening direction for the card. | 紙藝助理~paper-art aide~開啟方向~opening direction
紙藝助理在摺紙卡托盤只負責絨墊。| The paper-art aide only owns felt pads on the tray. | 摺紙卡托盤~origami tray~絨墊~felt pads
摺紙卡已否決使用黏住的開口。| The origami card rejected glued openings. | 黏住的開口~glued openings
摺紙卡的摺骨代碼是 DO-598。| The origami card's bone-folder code is DO-598. | DO-598~do598~摺骨~bone-folder
`],
['拖曳互動磁板','drag-interaction magnetic board',`
磁板原先使用厚磁片。| The magnetic board originally used thick tiles. | 厚磁片~thick tiles
磁板後來改用薄磁片。| The magnetic board later used thin tiles. | 薄磁片~thin tiles
磁板改動是因為厚磁片遮住相鄰格線。| Thick tiles hiding neighboring grid lines caused the board change. | 相鄰格線~neighboring grid lines
磁板的磁材費上限是 NT$96,760。| The magnetic board caps magnet spending at NT$96,760. | 96,760~96760~九萬六千七百六十~磁材費~magnet spending
互動助理負責磁板的薄片貼合。| The interaction aide owns thin-tile bonding on the board. | 互動助理~interaction aide~薄片貼合~thin-tile bonding
互動助理在磁板蓋布只負責刺繡。| The interaction aide only owns embroidery on the cover cloth. | 磁板蓋布~cover cloth~刺繡~embroidery
磁板的強力裸磁仍是未核准提案。| Strong bare magnets remain an unapproved board proposal. | 強力裸磁~strong bare magnets
磁板的吸盤代碼是 DM-699。| The magnetic board's suction-cup code is DM-699. | DM-699~dm699~吸盤~suction-cup
`],
['撤銷教學翻片','undo teaching flaps',`
翻片原先使用細紙軸。| The flaps originally used slim paper pivots. | 細紙軸~slim paper pivots
翻片後來改用布鉸鏈。| The flaps later used fabric hinges. | 布鉸鏈~fabric hinges
翻片改動是因為紙軸反覆轉動後會裂。| Paper pivots splitting after turns caused the flap change. | 紙軸~paper pivots~splitting after turns
翻片的布鉸鏈費上限是 NT$97,870。| The flaps cap fabric-hinge spending at NT$97,870. | 97,870~97870~九萬七千八百七十~布鉸鏈費~fabric-hinge
機關助理負責翻片的布鉸鏈貼合。| The mechanism aide owns fabric-hinge bonding on the flaps. | 機關助理~mechanism aide~布鉸鏈貼合~fabric-hinge bonding
機關助理在翻片箱只負責提把。| The mechanism aide only owns grips on the flap box. | 翻片箱~flap box~提把~grips
翻片已否決使用外露釘軸。| The flaps rejected exposed nail pivots. | 外露釘軸~exposed nail pivots
翻片的墊圈代碼是 DU-891。| The flaps' washer code is DU-891. | DU-891~du891~墊圈~washer
`],
['權限示範棋盤','permission demonstration board game',`
棋盤原先用固定棋格。| The board game originally used fixed cells. | 固定棋格~fixed cells
棋盤後來改用可交換棋格。| The board game later used interchangeable cells. | 可交換棋格~interchangeable cells
棋盤改動是因為示範情境會改變路徑。| Changing demonstration scenarios altering paths caused the board-game change. | 改變路徑~altering paths~demonstration scenarios
棋盤的磁底費上限是 NT$98,980。| The board game caps magnetic-base spending at NT$98,980. | 98,980~98980~九萬八千九百八十~磁底費~magnetic-base
桌遊助理負責棋盤的交換棋格。| The board-game aide owns interchangeable cells on the board. | 桌遊助理~board-game aide~交換棋格~interchangeable cells
桌遊助理在棋盤提匣只負責毛氈。| The board-game aide only owns felt cloth in the carry case. | 棋盤提匣~carry case~毛氈~felt cloth
棋盤的易脫小磁粒仍是未核准提案。| Loose tiny magnets remain an unapproved board-game proposal. | 易脫小磁粒~loose tiny magnets
棋盤的定位板代碼是 DG-492。| The board game's locating-board code is DG-492. | DG-492~dg492~定位板~locating-board
`],
['茶點演練木盤','snack rehearsal wooden tray',`
木盤原先使用平底。| The tray originally used a flat base. | 平底~flat base
木盤後來改用有溝槽的底面。| The tray later used a grooved base. | 溝槽的底面~grooved base
木盤改動是因為示範杯容易在搬動時滑行。| Demonstration cups sliding during moves caused the tray change. | 示範杯~demonstration cups~sliding during moves
木盤的刨槽費上限是 NT$99,190。| The tray caps grooving spending at NT$99,190. | 99,190~99190~九萬九千一百九十~刨槽費~grooving
餐務助理負責木盤的溝槽打磨。| The catering aide owns groove smoothing on the tray. | 餐務助理~catering aide~溝槽打磨~groove smoothing
餐務助理在木盤布巾只負責滾邊。| The catering aide only owns piping on the tray cloth. | 木盤布巾~tray cloth~滾邊~piping
木盤已否決塗上會掉色的顏料。| The tray rejected paint that rubs off. | 會掉色的顏料~paint that rubs off
木盤的烙印代碼是 DT-593。| The tray's branding code is DT-593. | DT-593~dt593~烙印~branding code
`],
['收納示範布袋','packing demonstration cloth bag',`
布袋原先使用單層布。| The cloth bag originally used a single fabric layer. | 單層布~single fabric layer
布袋後來改用雙層布。| The cloth bag later used double fabric layers. | 雙層布~double fabric layers
布袋改動是因為示範物的稜角會頂出輪廓。| Angular props protruding through fabric caused the bag change. | 稜角~angular props~protruding
布袋的襯布費上限是 NT$60,280。| The cloth bag caps lining spending at NT$60,280. | 60,280~60280~六萬零二百八十~襯布費~lining spending
縫紉助理負責布袋的雙層接縫。| The sewing aide owns double-layer joins on the bag. | 縫紉助理~sewing aide~雙層接縫~double-layer joins
縫紉助理在布袋吊牌只負責打結。| The sewing aide only owns knots on the bag tag. | 布袋吊牌~bag tag~打結~knots
布袋的透明塑膠裡層仍是未核准提案。| A clear plastic inner layer remains an unapproved cloth-bag proposal. | 透明塑膠裡層~clear plastic inner layer
布袋的剪裁模代碼是 DB-694。| The cloth bag's cutting pattern code is DB-694. | DB-694~db694~剪裁模~cutting pattern
`],
];
export default stories.map(([zhScope, enScope, text], index) => {
  const target = targets[index];
  const lines = text.trim().split('\n').map(line => {
    const [zh, en, terms] = line.trim().split('|').map(value => value.trim());
    return `${target.name}的${zhScope}：${zh}|In ${target.alias}'s ${enScope}, ${en[0].toLowerCase()}${en.slice(1)}|${zhScope}~${enScope}~${terms}`;
  }).join('\n');
  return family(`hr2b-d${String(index + 1).padStart(2, '0')}`, target.domain,
    `${target.name}${zhScope}`, `${target.alias} ${enScope}`, target.person, target.personAlias, lines);
});
// Numeric templates are confined to four of the eight distractor memories per
// family. Each pair describes a separate fabrication specification, not any
// target decision, assignment, bound, reason or option.
export const FABRICATION = {
  engineering: [['示範座墊厚度','demo-pad thickness','毫米','mm'],['透明護蓋寬度','clear-guard width','毫米','mm']],
  'work-preferences': [['練習夾板寬度','practice-board width','毫米','mm'],['練習外盒深度','practice-case depth','毫米','mm']],
  operations: [['演練底板長度','drill-base length','毫米','mm'],['演練掛帶長度','drill-strap length','毫米','mm']],
  finance: [['教學票槽寬度','teaching-slot width','毫米','mm'],['教學底墊長度','teaching-pad length','毫米','mm']],
  product: [['展示框背板厚度','display-backing thickness','毫米','mm'],['展示托片寬度','display-tab width','毫米','mm']],
  everyday: [['示範隔層寬度','demo-divider width','毫米','mm'],['示範把帶長度','demo-handle length','毫米','mm']],
};

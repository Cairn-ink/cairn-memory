// Independent, finite semantic model for the authored inventory exemplars.
// This module imports neither the fixture generator nor its noun/description
// assignments. Attributes are positive conjunctions: every matching noun must
// be gold. Category/function/material/form features are deliberately shared.
// Material names on foods denote biological source or composition. These are
// inventory exemplars (e.g. fresh sausage), not claims about all real objects.
// Lexical translations identify concepts; descriptions below contain no noun
// IDs, fact indices, document IDs or lists of preassigned matching nouns.
const lexemes = {
  "teapot": ["茶壺", "急須"],
  "lantern": ["提燈", "提灯"],
  "compass": ["羅盤", "羅針"],
  "blanket": ["毛毯", "毛布"],
  "basket": ["竹籃", "竹籠"],
  "mirror": ["鏡子", "鏡"],
  "whistle": ["哨子", "汽笛"],
  "ladder": ["梯子", "梯子"],
  "bucket": ["水桶", "水桶"],
  "bench": ["長凳", "長椅"],
  "ribbon": ["緞帶", "絹帯"],
  "hammer": ["鐵鎚", "金槌"],
  "saddle": ["馬鞍", "馬鞍"],
  "anchor": ["船錨", "船錨"],
  "needle": ["縫針", "縫針"],
  "helmet": ["頭盔", "兜"],
  "trumpet": ["喇叭", "喇叭"],
  "pillow": ["枕頭", "枕"],
  "kettle": ["水壺", "薬缶"],
  "telescope": ["望筒", "遠鏡"],
  "shovel": ["鏟子", "鋤鍬"],
  "sponge": ["海綿", "海綿"],
  "towel": ["浴巾", "手拭"],
  "broom": ["掃帚", "箒木"],
  "scissors": ["剪刀", "鋏刃"],
  "wallet": ["皮夾", "財布"],
  "bracelet": ["手環", "腕輪"],
  "necklace": ["項鍊", "首飾"],
  "glove": ["手套", "手袋"],
  "boot": ["靴子", "長靴"],
  "apron": ["圍裙", "前掛"],
  "drum": ["鼓面", "太鼓"],
  "flute": ["笛子", "横笛"],
  "violin": ["提琴", "提琴"],
  "chisel": ["鑿子", "鑿"],
  "saw": ["鋸子", "鋸"],
  "plane": ["刨子", "鉋"],
  "clamp": ["夾具", "万力"],
  "vase": ["花瓶", "花瓶"],
  "bell": ["銅鈴", "風鈴"],
  "abacus": ["算盤", "算盤"],
  "accordion": ["風琴", "手風"],
  "anvil": ["鐵砧", "金床"],
  "axe": ["斧頭", "手斧"],
  "bagpipe": ["風笛", "袋笛"],
  "barometer": ["氣壓", "気圧"],
  "bathtub": ["浴缸", "浴槽"],
  "binoculars": ["雙筒", "双眼"],
  "blender": ["攪機", "攪拌"],
  "boomerang": ["回鏢", "飛棒"],
  "bow": ["弓箭", "弓矢"],
  "cage": ["鳥籠", "鳥籠"],
  "calculator": ["算機", "計算"],
  "camera": ["相機", "写真"],
  "candle": ["蠟燭", "蝋燭"],
  "cane": ["拐杖", "杖棒"],
  "canoe": ["獨木", "丸木"],
  "cello": ["大提", "大琴"],
  "chessboard": ["棋盤", "碁盤"],
  "clock": ["時鐘", "時計"],
  "corkscrew": ["瓶鑽", "栓抜"],
  "cradle": ["搖籃", "揺籠"],
  "crown": ["王冠", "王冠"],
  "cymbal": ["銅鈸", "銅鑼"],
  "dart": ["飛鏢", "投矢"],
  "desk": ["書桌", "机台"],
  "dice": ["骰子", "賽子"],
  "dictionary": ["字典", "辞書"],
  "dumbbell": ["啞鈴", "鉄亜"],
  "earring": ["耳環", "耳飾"],
  "easel": ["畫架", "画架"],
  "fan": ["扇子", "団扇"],
  "faucet": ["龍頭", "蛇口"],
  "fiddlecase": ["琴盒", "琴箱"],
  "file": ["銼刀", "鑢刀"],
  "fireextinguisher": ["滅火", "消火"],
  "fishingrod": ["釣竿", "釣竿"],
  "fork": ["餐叉", "食叉"],
  "funnel": ["漏斗", "漏斗"],
  "gavel": ["木槌", "木槌"],
  "guitar": ["吉他", "六弦"],
  "harp": ["豎琴", "竪琴"],
  "hourglass": ["沙漏", "砂漏"],
  "iron": ["熨斗", "火熨"],
  "jigsaw": ["拼圖", "組絵"],
  "joystick": ["搖桿", "操桿"],
  "kayak": ["皮艇", "皮舟"],
  "key": ["鑰匙", "鍵片"],
  "kite": ["風箏", "凧紙"],
  "lute": ["琵琶", "琵琶"],
  "magnet": ["磁鐵", "磁石"],
  "magnifier": ["放鏡", "拡鏡"],
  "mandolin": ["曼琴", "八弦"],
  "metronome": ["節拍", "拍子"],
  "microscope": ["顯鏡", "顕鏡"],
  "mop": ["拖把", "雑巾"],
  "net": ["漁網", "漁網"],
  "notebook": ["筆記", "手帳"],
  "oar": ["船槳", "櫂棒"],
  "ocarina": ["陶笛", "土笛"],
  "padlock": ["掛鎖", "錠前"],
  "palette": ["調盤", "絵皿"],
  "parachute": ["降傘", "落傘"],
  "pencil": ["鉛筆", "鉛筆"],
  "pendant": ["墜子", "根付"],
  "piano": ["鋼琴", "洋琴"],
  "pliers": ["鉗子", "鋏具"],
  "plunger": ["吸盤", "吸玉"],
  "protractor": ["量角", "分度"],
  "rake": ["耙子", "熊手"],
  "razor": ["剃刀", "剃刀"],
  "reel": ["線軸", "糸巻"],
  "rollingpin": ["擀杖", "麺棒"],
  "screwdriver": ["起子", "螺廻"],
  "sextant": ["六儀", "六分"],
  "shield": ["盾牌", "盾板"],
  "sieve": ["篩子", "篩網"],
  "skate": ["冰鞋", "氷靴"],
  "spoon": ["湯匙", "匙具"],
  "stapler": ["釘機", "綴機"],
  "shirt": ["襯衫", "襯衣"],
  "coat": ["外套", "外衣"],
  "skirt": ["裙子", "裳衣"],
  "trousers": ["長褲", "袴服"],
  "sock": ["襪子", "靴下"],
  "scarf": ["圍巾", "襟巻"],
  "tie": ["領帶", "襟帯"],
  "belt": ["腰帶", "革帯"],
  "beret": ["貝帽", "丸帽"],
  "bonnet": ["軟帽", "乳帽"],
  "vest": ["背心", "胴衣"],
  "sweater": ["毛衣", "編衣"],
  "raincoat": ["雨衣", "雨合"],
  "sandal": ["涼鞋", "草履"],
  "slipper": ["拖鞋", "上履"],
  "sneaker": ["球鞋", "運靴"],
  "mitten": ["連手", "防手"],
  "robe": ["長袍", "法衣"],
  "kimono": ["和服", "呉服"],
  "turban": ["頭巾", "巻布"],
  "apple": ["蘋果", "林檎"],
  "pear": ["梨子", "梨実"],
  "peach": ["桃子", "桃実"],
  "plum": ["李子", "李実"],
  "banana": ["香蕉", "甘蕉"],
  "orange": ["柳橙", "蜜柑"],
  "lemon": ["檸檬", "檸檬"],
  "lime": ["萊檬", "酢橘"],
  "grape": ["葡萄", "葡萄"],
  "mango": ["芒果", "檬果"],
  "papaya": ["木瓜", "乳瓜"],
  "pineapple": ["鳳梨", "鳳梨"],
  "coconut": ["椰果", "椰子"],
  "avocado": ["酪梨", "鰐梨"],
  "fig": ["無花", "無果"],
  "date": ["椰棗", "棗実"],
  "raisin": ["葡乾", "干葡"],
  "prune": ["李乾", "干李"],
  "apricot": ["杏果", "杏実"],
  "cherry": ["櫻桃", "桜桃"],
  "almond": ["杏仁", "扁桃"],
  "walnut": ["核桃", "胡桃"],
  "hazelnut": ["榛果", "榛実"],
  "peanut": ["花生", "落花"],
  "cashew": ["腰果", "勾実"],
  "pistachio": ["開心", "阿月"],
  "chestnut": ["栗子", "栗実"],
  "acorn": ["橡實", "団栗"],
  "sesame": ["芝麻", "胡麻"],
  "sunflowerseed": ["葵籽", "向種"],
  "rice": ["稻米", "白米"],
  "wheat": ["小麥", "小麦"],
  "barley": ["大麥", "大麦"],
  "oat": ["燕麥", "燕麦"],
  "rye": ["黑麥", "黒麦"],
  "millet": ["小米", "粟米"],
  "corn": ["玉米", "玉蜀"],
  "sorghum": ["高粱", "高粱"],
  "quinoa": ["藜麥", "藜麦"],
  "buckwheat": ["蕎麥", "蕎麦"],
  "carrot": ["胡蘿", "人参"],
  "potato": ["馬鈴", "馬鈴"],
  "onion": ["洋蔥", "玉葱"],
  "garlic": ["大蒜", "大蒜"],
  "ginger": ["生薑", "生姜"],
  "turmeric": ["薑黃", "鬱金"],
  "radish": ["蘿蔔", "大根"],
  "beet": ["甜菜", "甜菜"],
  "turnip": ["蕪菁", "蕪菁"],
  "cabbage": ["甘藍", "甘藍"],
  "lettuce": ["萵苣", "萵苣"],
  "spinach": ["菠菜", "菠薐"],
  "celery": ["芹菜", "芹菜"],
  "asparagus": ["蘆筍", "蘆筍"],
  "broccoli": ["青花", "緑花"],
  "cauliflower": ["白花", "白花"],
  "cucumber": ["黃瓜", "胡瓜"],
  "eggplant": ["茄子", "茄子"],
  "pumpkin": ["南瓜", "南瓜"],
  "zucchini": ["夏瓜", "夏瓜"],
  "tomato": ["番茄", "蕃茄"],
  "pepper": ["甜椒", "甘唐"],
  "chili": ["辣椒", "唐辛"],
  "pea": ["豌豆", "豌豆"],
  "lentil": ["扁豆", "扁豆"],
  "chickpea": ["鷹豆", "雛豆"],
  "soybean": ["黃豆", "大豆"],
  "mushroom": ["蘑菇", "茸菌"],
  "truffle": ["松露", "西茸"],
  "olive": ["橄欖", "橄欖"],
  "bread": ["麵包", "麺麭"],
  "cheese": ["乳酪", "乾酪"],
  "yogurt": ["優格", "酸乳"],
  "butter": ["奶油", "乳脂"],
  "honey": ["蜂蜜", "蜂蜜"],
  "sugar": ["砂糖", "砂糖"],
  "salt": ["食鹽", "食塩"],
  "vinegar": ["食醋", "酢液"],
  "mustard": ["芥末", "芥子"],
  "cinnamon": ["肉桂", "肉桂"],
  "clove": ["丁香", "丁子"],
  "nutmeg": ["肉蔻", "肉荳"],
  "saffron": ["番紅", "番紅"],
  "vanilla": ["香莢", "香莢"],
  "cocoa": ["可可", "加加"],
  "coffee": ["咖啡", "珈琲"],
  "tea": ["茶葉", "茶葉"],
  "noodle": ["麵條", "麺条"],
  "pasta": ["義麵", "伊麺"],
  "tofu": ["豆腐", "豆腐"],
  "sausage": ["香腸", "腸詰"],
  "bacon": ["培根", "燻肉"],
  "ham": ["火腿", "薫腿"],
  "salami": ["臘腸", "乾腸"],
  "salmon": ["鮭魚", "鮭魚"],
  "tuna": ["鮪魚", "鮪魚"],
  "sardine": ["沙丁", "鰯魚"],
  "anchovy": ["鯷魚", "片鰯"],
  "shrimp": ["鮮蝦", "海老"],
  "lobster": ["龍蝦", "伊蝦"],
};
const attributeRows = `
teapot|vessel|serve-tea,brew|ceramic|spout
lantern|light|illuminate,carry|metal,glass|enclosed,oil
compass|instrument|navigate,direction|metal|magnetic
blanket|textile|warm,cover|wool|rectangular,bed
basket|container|carry,hold-flowers|fiber|woven
mirror|optical|reflect|glass|flat
whistle|instrument|signal|metal|shrill,air
ladder|equipment|climb|wood|steps
bucket|container|hold-liquid,hold-flowers|metal|pail
bench|furniture|sit|wood|long
ribbon|textile|decorate|silk|strip
hammer|tool|strike,drive-nails|iron,wood|handle
saddle|equipment|ride,sit|leather|horse-seat
anchor|equipment|moor|iron|weight
needle|tool|sew|steel|point
helmet|clothing|protect-head|metal|headwear
trumpet|instrument|music|brass|horn
pillow|textile|support-head|fabric|sleep
kettle|vessel|boil,brew|metal|pot
telescope|optical|view-distant|glass,metal|single-ocular,tube,astronomy
shovel|tool|dig|steel,wood|spade
sponge|cleaning|wash,absorb|cellulose|porous,block
towel|textile|dry,absorb|cotton|terry,bathing,pad
broom|cleaning|sweep|fiber,wood|brush
scissors|tool|cut|steel|paired-blades
wallet|container|hold-money|leather|pocket
bracelet|jewelry|adorn-wrist|metal|band
necklace|jewelry|adorn-neck|metal|continuous-chain
glove|clothing|cover-fingers,warm|fabric|separate-fingers
boot|footwear|walk|leather|high-shaft
apron|clothing|protect-cooking|fabric|front
drum|instrument|music,percussion|membrane,wood|struck-skin
flute|instrument|music,woodwind|wood|transverse,tube,breath
violin|instrument|music,bow-strings|wood|shoulder-held
chisel|tool|carve|steel|mallet-driven,wood-gouge,blade
saw|tool|cut|steel|teeth,kerf,reciprocating
plane|tool|smooth,shave-wood|metal,wood|bench,sole
clamp|tool|grip|steel|screw,jaws
vase|container|hold-flowers|ceramic|narrow-neck,decorative
bell|instrument|music,percussion,ring|bronze|hollow,clapper,cup
abacus|instrument|count|wood|beads,frame
accordion|instrument|music|wood,metal|bellows,reed,keyboard
anvil|tool|forge|iron|block
axe|tool|strike,split-wood,carve|steel,wood|haft,edge
bagpipe|instrument|music,woodwind|leather,wood|air-bladder,reed,pipes
barometer|instrument|measure-pressure|glass,metal|atmospheric
bathtub|vessel|bathe|ceramic|full-body,basin
binoculars|optical|view-distant|glass,metal|paired-ocular,field
blender|appliance|puree|metal,glass|motorized,mixer
boomerang|equipment|throw|wood|curved,returning
bow|equipment|launch-arrow|wood|arched
cage|container|confine-animal|metal|bars
calculator|instrument|calculate|plastic|electronic,keypad
camera|instrument|photograph|metal,glass|capture
candle|light|illuminate,carry|wax|wick
cane|equipment|support-walking|wood|stick
canoe|watercraft|paddle|wood|narrow,open-hull,single-blade
cello|instrument|music,bow-strings|wood|large,upright,bass
chessboard|game|play-strategy|wood|checkered,surface
clock|instrument|tell-time|metal|dial,hours
corkscrew|tool|extract-stopper|steel|helical,wine
cradle|furniture|sleep-infant|wood|rocking,bed
crown|jewelry|adorn-head|gold|royal,jeweled
cymbal|instrument|music,percussion,ring|bronze|clashing,disc
dart|equipment|throw-at-target|metal|pointed,missile
desk|furniture|write-work|wood|surface
dice|game|randomize|plastic|numbered,cubes
dictionary|book|define-words|paper|alphabetical
dumbbell|equipment|exercise|iron|handheld,weight
earring|jewelry|adorn-ear|metal|lobe
easel|equipment|support-canvas|wood|upright,stand
fan|equipment|cool|paper|hand-waved,screen
faucet|plumbing|control-water|metal|valve
fiddlecase|container|protect-instrument|wood|box,bowed-instrument
file|tool|abrade,smooth|steel|ridged,teeth
fireextinguisher|equipment|suppress-flame|metal|portable,cylinder
fishingrod|equipment|angle-fish|wood|flexible,pole
fork|utensil|eat|steel|prongs
funnel|tool|pour|metal|conical
gavel|tool|strike,sound-judgment|wood|mallet
guitar|instrument|music,pluck-strings|wood|fretted,six-strings
harp|instrument|music,pluck-strings|wood|triangular,vertical
hourglass|instrument|measure-time|glass,sand|bulbs
iron|appliance|press-garments,smooth|iron|heated
jigsaw|game|assemble-picture|cardboard|interlocking,puzzle
joystick|controller|control-game|plastic|pivot,lever
kayak|watercraft|paddle|skin|narrow,decked,double-blade
key|tool|open-lock|metal|teeth
kite|equipment|fly-in-wind|paper|tether,sail
lute|instrument|music,pluck-strings|wood|pear-shaped,neck
magnet|solid|attract-iron|iron|magnetic
magnifier|optical|enlarge|glass|single-lens,handheld
mandolin|instrument|music,pluck-strings|wood|small,paired-strings,plectrum
metronome|instrument|mark-tempo|wood,metal|ticking,pendulum
microscope|optical|view-tiny|glass,metal|laboratory,specimen
mop|cleaning|dry,swab-floor|cotton,wood|long-handle
net|equipment|catch-fish|fiber|knotted,mesh
notebook|book|write|paper|bound,blank-pages
oar|equipment|row|wood|rowlock,blade
ocarina|instrument|music,woodwind|clay|finger-holes,vessel
padlock|equipment|lock|steel|detachable,shackle
palette|equipment|mix-colors|wood|board
parachute|equipment|slow-descent|fabric|canopy,aerial
pencil|tool|write|graphite,wood|stick
pendant|jewelry|adorn-neck|metal|single,hanging,charm
piano|instrument|music|wood,metal|hammer-struck,strings,keyboard
pliers|tool|grip|steel|pivot,jaws
plunger|plumbing|clear-drain|rubber|suction,cup
protractor|instrument|measure-angle|plastic|graduated,semicircle
rake|tool|gather-garden|steel,wood|teeth,head
razor|tool|shave-face|steel|edge
reel|equipment|wind-line|wood|cylindrical,spool
rollingpin|tool|flatten-dough|wood|cylinder
screwdriver|tool|turn-fastener|steel|slotted,shaft
sextant|instrument|navigate,measure-angle|metal|celestial
shield|equipment|defend|metal|hand-carried,plate
sieve|tool|separate-particles|metal|fine,mesh
skate|footwear|glide-ice|leather,steel|high-shaft,runner
spoon|utensil|eat|steel|concave
stapler|tool|fasten-paper|metal|wire,press
shirt|clothing|cover-torso|fabric|button-front
coat|clothing|warm|fabric|outer,winter
skirt|clothing|cover-lower-body|fabric|waist,unbifurcated
trousers|clothing|cover-legs|fabric|waist,two-leg
sock|clothing|cover-foot|yarn|knitted,ankle
scarf|textile|wrap-neck,warm|wool|long
tie|clothing|adorn-neck|silk|knotted,formal
belt|clothing|secure-waist|leather|buckle,strap
beret|clothing|cover-head|wool|soft,round,flat
bonnet|clothing|cover-head|fabric|chin-tied,brim,baby
vest|clothing|cover-torso|fabric|sleeveless,waist-length
sweater|clothing|warm|wool|knitted,pullover
raincoat|clothing|protect-rain|waterproof-fabric|outer,wet-weather
sandal|footwear|walk|leather|open,straps,summer
slipper|footwear|walk|fabric|soft,indoor,backless
sneaker|footwear|athletics|rubber|sole
mitten|clothing|cover-fingers,warm|fabric|single-pocket,four-fingers,winter
robe|clothing|ceremony|fabric|loose,ankle-length
kimono|clothing|ceremony|fabric|crossed-front,japanese
turban|clothing|cover-head,ceremony|cloth|wrapped
apple|fruit|eat|malus|crisp,pome
pear|fruit|eat|pyrus|elongated,pome
peach|fruit|eat|prunus-persica|fuzzy,drupe
plum|fruit|eat|prunus-domestica|smooth,drupe
banana|fruit|eat|musa|curved,bunch
orange|fruit|eat|citrus-sinensis|round
lemon|fruit|eat|citrus-limon|sour,yellow
lime|fruit|eat|citrus-aurantifolia|green
grape|fruit|eat|vitis|small,clustered,berry
mango|fruit|eat|mangifera|large,tropical,drupe
papaya|fruit|eat|carica|orange-flesh
pineapple|fruit|eat|ananas|spiny,multiple-fruit
coconut|fruit|eat|cocos|fibrous,palm,drupe
avocado|fruit|eat|persea|buttery,green,drupe
fig|fruit|eat|ficus-carica|syconium
date|fruit|eat|phoenix|palm,sweet,drupe
raisin|fruit|eat|vitis|dried,berry
prune|fruit|eat|prunus-domestica|dried
apricot|fruit|eat|prunus-armeniaca|small,orange,drupe
cherry|fruit|eat|prunus-avium|small,paired-stem,drupe
almond|seed|eat|prunus-dulcis|kernel
walnut|seed|eat|juglans|wrinkled,kernel
hazelnut|seed|eat|corylus|round,kernel
peanut|legume|eat|arachis|underground
cashew|seed|eat|anacardium|curved,kernel
pistachio|seed|eat|pistacia|green,kernel
chestnut|seed|eat|castanea|glossy,starchy,kernel
acorn|seed|grow|quercus|oak
sesame|seed|eat,extract-oil|sesamum|tiny
sunflowerseed|seed|eat|helianthus|striped
rice|cereal|eat|oryza|polished,grains
wheat|cereal|mill|triticum|grains
barley|cereal|malt|hordeum|grains
oat|cereal|eat|avena|rolled,grains
rye|cereal|make-bread|secale|dark,grains
millet|cereal|eat|panicum|small,grains
corn|cereal|eat|zea|yellow,cob,kernels
sorghum|cereal|eat|sorghaceous|red,grains
quinoa|seed|eat|chenopodium|andean
buckwheat|seed|eat|fagopyrum|triangular
carrot|vegetable|eat|daucus|orange,root
potato|vegetable|eat|solanum-tuberosum|starchy,tuber
onion|vegetable|eat|allium-cepa|layered,bulb
garlic|vegetable|eat|allium-sativum|cloved,bulb
ginger|vegetable|eat|zingiber|pungent,rhizome
turmeric|vegetable|eat|curcuma|golden,rhizome
radish|vegetable|eat|raphanus|crisp,root
beet|vegetable|eat|beta-vulgaris|red,root
turnip|vegetable|eat|brassica-rapa|white,swollen-root
cabbage|vegetable|eat|brassica-oleracea|dense,leaf-head
lettuce|vegetable|eat|lactuca|leafy,salad
spinach|vegetable|eat|spinacia|dark,leafy
celery|vegetable|eat|apium|crisp,stalks
asparagus|vegetable|eat|officinalis|young,spears
broccoli|vegetable|eat|brassica|green,branched,flower-buds
cauliflower|vegetable|eat|brassica|white,compact,flower-curd
cucumber|fruit|eat|cucumis|long,green
eggplant|fruit|eat|solanum-melongena|purple
pumpkin|fruit|eat|cucurbita-pepo|large,orange
zucchini|fruit|eat|cucurbita|slender,green,summer-squash
tomato|fruit|eat|solanum-lycopersicum|red
pepper|fruit|eat|capsicum-annuum|sweet,bell
chili|fruit|eat|capsicum|hot,pungent,pod
pea|pulse|eat|pisum|round,green,pod-seeds
lentil|pulse|eat|lens-culinaris|flat
chickpea|pulse|eat|cicer-arietinum|rounded
soybean|pulse|eat|glycine-max|protein-rich
mushroom|fungus|eat|agaricus|cap
truffle|fungus|eat|tuber|subterranean
olive|fruit|eat|olea-europaea|oily,drupe
bread|food|eat|flour|baked,leavened,loaf
cheese|food|eat|dairy|pressed,cultured,curds
yogurt|food|eat|dairy|fermented,spoonable
butter|food|eat|dairy-fat|churned,block
honey|food|sweeten|floral-nectar|bee-produced
sugar|food|sweeten|sucrose|crystallized
salt|food|season|sodium-chloride|crystalline
vinegar|food|season|acetic-acid|dilute,fermented
mustard|food|season|sinapis|ground,pungent
cinnamon|spice|season|cinnamomum|aromatic,bark
clove|spice|season|syzygium|dried,aromatic,flower-bud
nutmeg|spice|season|myristica|fragrant,seed
saffron|spice|season|crocus|dried,flower-stigmas
vanilla|spice|season|planifolia|cured,orchid-pod
cocoa|food|make-beverage|theobroma|bitter,powder
coffee|food|make-beverage|coffea|roasted,beans
tea|food|make-beverage|camellia-sinensis|dried,leaves
noodle|food|eat|flour|long,thin,paste,strands,alkaline,kansui
pasta|food|eat|durum-semolina,flour|shaped,paste,long,thin,strands
tofu|food|eat|glycine|coagulated,milk-curd
sausage|food|eat|ground-meat|seasoned,casing,fresh,uncured
bacon|food|eat|pork|cured,streaky,belly,strips
ham|food|eat|pork|cured,hind-leg
salami|food|eat|ground-meat|seasoned,casing,dry,fermented,cylinder
salmon|fish|eat|salmo|pink-flesh,anadromous
tuna|fish|eat|thunnus|pelagic
sardine|fish|eat|sardina|small,oily,schooling
anchovy|fish|eat|engraulis|small,salt-cured
shrimp|crustacean|eat|decapod|small
lobster|crustacean|eat|nephrops|large,clawed
`;
export const semanticNouns = Object.freeze(attributeRows.trim().split('\n').map(line => {
  const [name, category, purpose, material, features] = line.trim().split('|');
  return Object.freeze({ name, lexemes: Object.freeze([name, ...lexemes[name]]), attributes: Object.freeze({
    category: Object.freeze([category]), function: Object.freeze(purpose.split(',')),
    material: Object.freeze(material.split(',')), features: Object.freeze(features.split(',')),
  }) });
}));
// Separate query interpretation: each description is an attribute predicate,
// evaluated against ALL nouns, including nouns added after the first corpus.
const predicateRows = `
spouted tea serving pot|category=vessel function=serve-tea features=spout
enclosed carried oil lamp|category=light function=carry features=enclosed,oil
direction finder|category=instrument function=direction
rectangular bed warming textile|category=textile function=warm features=rectangular,bed
woven carrier|function=carry features=woven
reflective glass|function=reflect material=glass
shrill signal|function=signal features=shrill
climbing steps|function=climb features=steps
liquid pail|function=hold-liquid features=pail
long seat|function=sit features=long
silky strip|material=silk features=strip
handled iron nail driver|function=drive-nails material=iron features=handle
riding seat|function=ride features=horse-seat
mooring weight|function=moor features=weight
sewing point|function=sew features=point
protective headwear|function=protect-head features=headwear
brass horn|category=instrument material=brass features=horn
sleeping headrest|function=support-head features=sleep
boiling pot|function=boil features=pot
single ocular astronomical tube|function=view-distant features=single-ocular,tube,astronomy
digging spade|function=dig features=spade
porous cellular washing block|function=wash material=cellulose features=porous,block
looped terry bathing cloth|category=textile features=terry,bathing
finger covering|function=cover-fingers
separate finger compartment handwear|function=cover-fingers features=separate-fingers
high shaft leather walking footwear|category=footwear function=walk material=leather features=high-shaft
sweeping brush|function=sweep features=brush
cutting shears|function=cut features=paired-blades
money holder|function=hold-money
wrist ornament|category=jewelry function=adorn-wrist
continuous neck chain ornament|category=jewelry function=adorn-neck features=continuous-chain
cooking garment|category=clothing function=protect-cooking
membrane percussion instrument|category=instrument function=percussion material=membrane
transverse breath blown tube|category=instrument features=transverse,breath,tube
shoulder held bowed strings|function=bow-strings features=shoulder-held
mallet driven wood gouging blade|function=carve features=mallet-driven,wood-gouge,blade
reciprocating kerf cutting teeth|function=cut features=reciprocating,kerf,teeth
bench carpentry shaving sole|function=shave-wood features=bench,sole
screw tightened workholding jaws|function=grip features=screw,jaws
narrow neck decorative floral urn|function=hold-flowers features=narrow-neck,decorative
hollow clapper struck bronze cup|function=percussion material=bronze features=hollow,clapper,cup
beaded counting frame|function=count features=beads,frame
bellows driven reed keyboard|category=instrument features=bellows,reed,keyboard
blacksmith forging block|function=forge features=block
hafted wood splitting edge|function=split-wood features=haft,edge
air bladder reed pipes|function=woodwind features=air-bladder,reed,pipes
atmospheric pressure gauge|function=measure-pressure features=atmospheric
full body bathing basin|function=bathe features=full-body,basin
paired ocular field glasses|function=view-distant features=paired-ocular,field
motorized puree mixer|function=puree features=motorized,mixer
returning curved throwing stick|function=throw features=curved,returning
arched arrow launcher|function=launch-arrow features=arched
barred animal enclosure|function=confine-animal features=bars
electronic arithmetic keypad|function=calculate features=electronic,keypad
photographic capture device|function=photograph features=capture
wicked wax illuminant|function=illuminate material=wax features=wick
walking support stick|function=support-walking features=stick
narrow paddled watercraft|category=watercraft function=paddle features=narrow
open hull single blade paddled watercraft|category=watercraft function=paddle features=open-hull,single-blade
large upright bowed bass strings|function=bow-strings features=large,upright,bass
checkered strategy playing surface|function=play-strategy features=checkered,surface
dial showing hours|function=tell-time features=dial,hours
helical wine stopper extractor|function=extract-stopper features=helical,wine
rocking infant bed|function=sleep-infant features=rocking,bed
royal jeweled headpiece|function=adorn-head features=royal,jeweled
clashing orchestral metal disc|function=percussion material=bronze features=clashing,disc
pointed target throwing missile|function=throw-at-target features=pointed,missile
writing work surface|function=write-work features=surface
numbered gaming cubes|category=game features=numbered,cubes
alphabetical word meaning volume|category=book function=define-words features=alphabetical
handheld exercise weight|function=exercise features=handheld,weight
ear lobe ornament|category=jewelry function=adorn-ear features=lobe
upright painters canvas stand|function=support-canvas features=upright,stand
hand waved cooling screen|function=cool features=hand-waved,screen
plumbed water flow valve|category=plumbing function=control-water features=valve
bowed instrument protective box|function=protect-instrument features=bowed-instrument,box
ridged metal abrading handtool|category=tool function=abrade material=steel features=ridged
portable flame suppression cylinder|function=suppress-flame features=portable,cylinder
flexible angling pole|function=angle-fish features=flexible,pole
pronged dining utensil|category=utensil function=eat features=prongs
conical pouring guide|function=pour features=conical
judicial sounding mallet|function=sound-judgment features=mallet
fretted six string plucked instrument|function=pluck-strings features=fretted,six-strings
triangular vertical plucked strings|function=pluck-strings features=triangular,vertical
sand filled time measuring bulbs|function=measure-time material=sand features=bulbs
heated garment pressing appliance|category=appliance function=press-garments features=heated
interlocking picture puzzle|function=assemble-picture features=interlocking,puzzle
pivoting game control lever|function=control-game features=pivot,lever
decked double paddle craft|category=watercraft function=paddle features=decked,double-blade
toothed lock opener|function=open-lock features=teeth
tethered wind flown sail|function=fly-in-wind features=tether,sail
pear shaped plucked neck instrument|function=pluck-strings features=pear-shaped,neck
ferrous attracting solid|category=solid function=attract-iron
single handheld enlarging lens|function=enlarge features=single-lens,handheld
small paired string plectrum instrument|function=pluck-strings features=small,paired-strings,plectrum
tempo ticking pendulum device|function=mark-tempo features=ticking,pendulum
laboratory tiny specimen viewer|function=view-tiny features=laboratory,specimen
long handled floor swab|function=swab-floor features=long-handle
knotted fishing mesh|function=catch-fish features=knotted,mesh
bound blank writing pages|category=book function=write features=bound,blank-pages
rowlock mounted propulsion blade|function=row features=rowlock,blade
finger holed clay wind vessel|function=woodwind material=clay features=finger-holes,vessel
detachable shackle lock|function=lock features=detachable,shackle
painters color mixing board|function=mix-colors features=board
canopy for slowing aerial descent|function=slow-descent features=canopy,aerial
graphite writing stick|function=write material=graphite features=stick
single hanging jewelry charm|category=jewelry features=single,hanging,charm
hammer struck string keyboard|category=instrument features=hammer-struck,strings,keyboard
pivot jaw gripping handtool|function=grip features=pivot,jaws
rubber drain suction cup|function=clear-drain material=rubber features=suction,cup
graduated angle measuring semicircle|function=measure-angle features=graduated,semicircle
toothed garden gathering head|function=gather-garden features=teeth,head
facial shaving edge|function=shave-face features=edge
cylindrical winding spool|function=wind-line features=cylindrical,spool
dough flattening cylinder|function=flatten-dough features=cylinder
slotted fastener turning shaft|function=turn-fastener features=slotted,shaft
celestial navigation angle instrument|function=navigate,measure-angle features=celestial
hand carried defensive plate|function=defend features=hand-carried,plate
fine particle separating mesh|function=separate-particles features=fine,mesh
boot mounted ice runner|category=footwear function=glide-ice features=runner
concave eating utensil|category=utensil function=eat features=concave
paper fastening wire press|function=fasten-paper features=wire,press
button front upper body garment|category=clothing function=cover-torso features=button-front
outer winter overgarment|category=clothing function=warm features=outer,winter
waist suspended unbifurcated garment|category=clothing features=waist,unbifurcated
waist worn two leg garment|category=clothing features=waist,two-leg
knitted ankle hosiery|function=cover-foot features=knitted,ankle
long neck wrapping textile|category=textile function=wrap-neck features=long
knotted formal neckwear|function=adorn-neck features=knotted,formal
buckled waist strap|function=secure-waist features=buckle,strap
soft round flat cap|function=cover-head features=soft,round,flat
chin tied brimmed baby cap|function=cover-head features=chin-tied,brim,baby
sleeveless waist length tunic|category=clothing features=sleeveless,waist-length
knitted wool pullover|category=clothing material=wool features=knitted,pullover
waterproof wet weather overgarment|category=clothing function=protect-rain material=waterproof-fabric features=outer,wet-weather
open strapped summer footwear|category=footwear features=open,straps,summer
soft indoor backless footwear|category=footwear features=soft,indoor,backless
rubber soled athletic footwear|category=footwear function=athletics material=rubber features=sole
single pocket four finger winterwear|function=cover-fingers features=single-pocket,four-fingers,winter
loose ankle length ceremonial garment|category=clothing function=ceremony features=loose,ankle-length
traditional crossed front Japanese dress|category=clothing features=crossed-front,japanese
wrapped cloth ceremonial headdress|function=cover-head,ceremony material=cloth features=wrapped
crisp malus orchard pome|category=fruit material=malus features=crisp,pome
elongated pyrus orchard pome|category=fruit material=pyrus features=elongated,pome
fuzzy prunus persica stone fruit|category=fruit material=prunus-persica features=fuzzy,drupe
smooth prunus domestica stone fruit|category=fruit material=prunus-domestica features=smooth,drupe
curved musa bunch fruit|category=fruit material=musa features=curved,bunch
round citrus sinensis fruit|category=fruit material=citrus-sinensis features=round
sour yellow citrus limon fruit|category=fruit material=citrus-limon features=sour,yellow
green citrus aurantifolia fruit|category=fruit material=citrus-aurantifolia features=green
small vitis clustered berry|category=fruit material=vitis features=small,clustered,berry
large tropical mangifera stone fruit|category=fruit material=mangifera features=large,tropical,drupe
orange fleshed carica fruit|category=fruit material=carica features=orange-flesh
spiny ananas multiple fruit|category=fruit material=ananas features=spiny,multiple-fruit
fibrous cocos palm drupe|category=fruit material=cocos features=fibrous,palm,drupe
buttery persea green drupe|category=fruit material=persea features=buttery,green,drupe
ficus carica edible syconium|category=fruit material=ficus-carica features=syconium
phoenix palm sweet drupe|category=fruit material=phoenix features=palm,sweet,drupe
dried vitis berry|category=fruit material=vitis features=dried,berry
dried prunus domestica fruit|category=fruit material=prunus-domestica features=dried
small orange prunus armeniaca drupe|category=fruit material=prunus-armeniaca features=small,orange,drupe
small paired stem prunus avium drupe|category=fruit material=prunus-avium features=small,paired-stem,drupe
edible prunus dulcis kernel|category=seed function=eat material=prunus-dulcis features=kernel
wrinkled juglans edible kernel|category=seed material=juglans features=wrinkled,kernel
round corylus edible kernel|category=seed material=corylus features=round,kernel
underground arachis edible legume|category=legume material=arachis features=underground
curved anacardium edible kernel|category=seed material=anacardium features=curved,kernel
green pistacia edible kernel|category=seed material=pistacia features=green,kernel
glossy castanea starchy kernel|category=seed material=castanea features=glossy,starchy,kernel
quercus oak seed|category=seed material=quercus features=oak
tiny sesamum oil seed|category=seed function=extract-oil material=sesamum features=tiny
helianthus striped edible seed|category=seed material=helianthus features=striped
oryza polished cereal grains|category=cereal material=oryza features=polished,grains
triticum milling cereal grains|category=cereal function=mill material=triticum features=grains
hordeum malting cereal grains|category=cereal function=malt material=hordeum features=grains
avena rolled cereal grains|category=cereal material=avena features=rolled,grains
secale dark bread cereal grains|category=cereal function=make-bread material=secale features=dark,grains
small panicum cereal grains|category=cereal material=panicum features=small,grains
zea yellow cob kernels|category=cereal material=zea features=yellow,cob,kernels
red sorghaceous cereal grains|category=cereal material=sorghaceous features=red,grains
chenopodium Andean edible seeds|category=seed material=chenopodium features=andean
fagopyrum triangular edible seeds|category=seed material=fagopyrum features=triangular
orange daucus root vegetable|category=vegetable material=daucus features=orange,root
starchy solanum tuberosum tuber|category=vegetable material=solanum-tuberosum features=starchy,tuber
layered allium cepa bulb|category=vegetable material=allium-cepa features=layered,bulb
cloved allium sativum bulb|category=vegetable material=allium-sativum features=cloved,bulb
pungent zingiber edible rhizome|category=vegetable material=zingiber features=pungent,rhizome
golden curcuma edible rhizome|category=vegetable material=curcuma features=golden,rhizome
crisp raphanus root vegetable|category=vegetable material=raphanus features=crisp,root
red beta vulgaris root|category=vegetable material=beta-vulgaris features=red,root
white brassica rapa swollen root|category=vegetable material=brassica-rapa features=white,swollen-root
dense brassica oleracea leaf head|category=vegetable material=brassica-oleracea features=dense,leaf-head
leafy lactuca salad greens|category=vegetable material=lactuca features=leafy,salad
spinacia dark leafy greens|category=vegetable material=spinacia features=dark,leafy
crisp apium edible stalks|category=vegetable material=apium features=crisp,stalks
young officinalis edible spears|category=vegetable material=officinalis features=young,spears
green branched brassica flower buds|category=vegetable material=brassica features=green,branched,flower-buds
white compact brassica flower curd|category=vegetable material=brassica features=white,compact,flower-curd
long green cucumis pepo|category=fruit material=cucumis features=long,green
purple solanum melongena fruit|category=fruit material=solanum-melongena features=purple
large orange cucurbita pepo|category=fruit material=cucurbita-pepo features=large,orange
slender green cucurbita summer squash|category=fruit material=cucurbita features=slender,green,summer-squash
red solanum lycopersicum fruit|category=fruit material=solanum-lycopersicum features=red
sweet capsicum annuum bell fruit|category=fruit material=capsicum-annuum features=sweet,bell
hot capsicum pungent pod|category=fruit material=capsicum features=hot,pungent,pod
round green pisum pod seeds|category=pulse material=pisum features=round,green,pod-seeds
lens culinaris flat pulse|category=pulse material=lens-culinaris features=flat
cicer arietinum rounded pulse|category=pulse material=cicer-arietinum features=rounded
glycine max protein rich pulse|category=pulse material=glycine-max features=protein-rich
agaricus edible fungal cap|category=fungus material=agaricus features=cap
subterranean tuber fungal delicacy|category=fungus material=tuber features=subterranean
olea europaea oily drupe|category=fruit material=olea-europaea features=oily,drupe
baked leavened flour loaf|category=food material=flour features=baked,leavened,loaf
pressed cultured dairy curds|category=food material=dairy features=pressed,cultured,curds
fermented spoonable dairy culture|category=food material=dairy features=fermented,spoonable
churned dairy fat block|category=food material=dairy-fat features=churned,block
bee produced floral sweetener|function=sweeten material=floral-nectar features=bee-produced
crystallized sucrose sweetener|function=sweeten material=sucrose features=crystallized
crystalline sodium chloride seasoning|function=season material=sodium-chloride features=crystalline
dilute acetic fermented condiment|function=season material=acetic-acid features=dilute,fermented
ground sinapis pungent condiment|function=season material=sinapis features=ground,pungent
aromatic cinnamomum bark spice|category=spice material=cinnamomum features=aromatic,bark
dried syzygium aromatic flower bud|category=spice material=syzygium features=dried,aromatic,flower-bud
myristica fragrant seed spice|category=spice material=myristica features=fragrant,seed
dried crocus flower stigmas|category=spice material=crocus features=dried,flower-stigmas
cured planifolia orchid pod|category=spice material=planifolia features=cured,orchid-pod
theobroma bitter beverage powder|function=make-beverage material=theobroma features=bitter,powder
roasted coffea beverage beans|function=make-beverage material=coffea features=roasted,beans
dried camellia sinensis leaves|function=make-beverage material=camellia-sinensis features=dried,leaves
long thin flour paste strands|category=food material=flour features=long,thin,paste,strands
alkaline wheat kansui strands|category=food material=flour features=alkaline,kansui,strands
durum semolina shaped alimentary paste|category=food material=durum-semolina features=shaped,paste
coagulated glycine milk curd|category=food material=glycine features=coagulated,milk-curd
seasoned ground meat casing|category=food material=ground-meat features=seasoned,casing
fresh uncured ground meat casing|category=food material=ground-meat features=fresh,uncured,casing
cured streaky pork belly strips|category=food material=pork features=cured,streaky,belly,strips
cured pork hind leg|category=food material=pork features=cured,hind-leg
dry fermented meat cylinder|category=food material=ground-meat features=dry,fermented,cylinder
pink fleshed salmo anadromous fish|category=fish material=salmo features=pink-flesh,anadromous
thunnus pelagic edible fish|category=fish material=thunnus features=pelagic
small oily sardina schooling fish|category=fish material=sardina features=small,oily,schooling
small engraulis salt cured fish|category=fish material=engraulis features=small,salt-cured
small decapod edible crustacean|category=crustacean material=decapod features=small
large clawed nephrops crustacean|category=crustacean material=nephrops features=large,clawed
percussion instrument|category=instrument function=percussion
brewing vessel|category=vessel function=brew
portable light|category=light function=carry
warm covering|function=warm
striking tool|category=tool function=strike
distant viewer|function=view-distant
absorbent pad|function=absorb
drying cloth|function=dry
throat jewelry|category=jewelry function=adorn-neck
tall footwear|category=footwear features=high-shaft
woodwind pipe|function=woodwind
bowed strings|function=bow-strings
carving blade|function=carve
toothed cutter|category=tool features=teeth
smoothing implement|function=smooth
gripping device|function=grip
flower container|category=container function=hold-flowers
ringing metal|function=ring
`;
export const descriptionPredicates = new Map(predicateRows.trim().split('\n').map(line => {
  const [description, conditions] = line.split('|');
  return [description, Object.freeze(Object.fromEntries(conditions.split(' ').map(condition => {
    const [attribute, values] = condition.split('=');
if (!['category', 'function', 'material', 'features'].includes(attribute) || !values) throw Error('invalid_semantic_predicate');
    return [attribute, Object.freeze(values.split(','))];
  })))];
}));
export const satisfies = (noun, predicate) => Object.entries(predicate).every(([attribute, values]) => values.every(value => noun.attributes[attribute].includes(value)));
export const semanticPlaces = [
  ['harbor','港灣','港湾','seaport'], ['garden','花園','庭園','horticultural grounds'],
  ['tower','高塔','塔楼','turret'], ['bridge','石橋','石橋','viaduct'],
  ['station','車站','駅舎','rail depot'], ['market','市場','市場','bazaar'],
  ['school','學校','学校','academy'], ['temple','寺廟','寺院','shrine'],
  ['forest','森林','森林','woodland'], ['lake','湖畔','湖畔','inland water'],
  ['quarry','石場','採石','excavation'], ['bakery','餅房','製菓','bread shop'],
  ['mill','磨坊','水車','grinding works'], ['farm','農場','農場','homestead'],
  ['castle','城堡','城郭','fortress'], ['theater','劇院','劇場','playhouse'],
  ['gallery','畫廊','画廊','exhibition hall'], ['orchard','果園','果樹','fruit grove'],
  ['hut','木屋','小屋','rustic lodge'], ['workshop','工坊','工房','craft studio'],
];

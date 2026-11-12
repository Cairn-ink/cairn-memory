// Labelled synthetic examples. No external corpus, provider or production data.
export function syntheticThreadPairs(){
 const rows=[],add=(language,stratum,positive,left,right)=>rows.push({language,stratum,positive,left,right});
 for(const food of ['egg pancakes','green tea','toasted bread','fresh coffee','sweet potato','brown rice','apple juice','cheese toast']){
  add('en','paraphrase',true,`I like ${food}.`,`I enjoy ${food}.`);
  add('en','paraphrase',true,`I like fresh warm ${food}.`,`I enjoy tasty fresh warm ${food}.`);
  add('en','paraphrase',true,`I like ${food}.`,`The user prefers ${food}.`);
  add('en','paraphrase',true,`I like ${food}.`,`${food} are my favorite breakfast.`);
  add('en','reason',true,`I like ${food}.`,`I no longer eat ${food} because of the oil.`);
  add('en','different-subject',false,`I like ${food}.`,`My brother likes ${food}.`);
  add('en','different-subject',false,`My sister likes ${food}.`,`My brother likes ${food}.`);
  add('en','negation-scope',false,`I like ${food}.`,`I do not like buying ${food}.`);
  add('en','negation-scope',false,`I like ${food}.`,`I do not think my brother likes ${food}.`);
  add('en','unrelated',false,`I like ${food}.`,'My bicycle is blue.');
 }
 for(const property of ['breakfast','workplace','home address','favorite drink','lunch','travel destination','preferred editor','commute']){
  add('en','value-change',true,`My ${property} is the original value.`,`My ${property} is the replacement value.`);
  add('en','value-change',true,`Project Alpha ${property} is original.`,`Project Alpha ${property} is replacement.`);
  add('en','different-subject',false,`Project Alpha ${property} is original.`,`Project Beta ${property} is original.`);
 }
 for(const food of ['蛋餅','綠茶','吐司','咖啡','地瓜','糙米','蘋果汁','起司吐司']){
  add('zh-Hant','paraphrase',true,`我喜歡${food}。`,`我愛吃${food}。`);
  add('zh-Hant','paraphrase',true,`我喜歡香酥的${food}。`,`我喜歡很香酥的${food}。`);
  add('zh-Hant','paraphrase',true,`我喜歡${food}。`,`使用者喜歡${food}。`);
  add('zh-Hant','paraphrase',true,`我喜歡${food}。`,`最喜歡的早餐是${food}。`);
  add('zh-Hant','reason',true,`我喜歡${food}。`,`我因為地溝油不再喜歡${food}。`);
  add('zh-Hant','different-subject',false,`我喜歡${food}。`,`我哥哥喜歡${food}。`);
  add('zh-Hant','different-subject',false,`我妹妹喜歡${food}。`,`我哥哥喜歡${food}。`);
  add('zh-Hant','negation-scope',false,`我喜歡${food}。`,`我不喜歡${food}的價格。`);
  add('zh-Hant','negation-scope',false,`我喜歡${food}。`,`我不認為哥哥喜歡${food}。`);
  add('zh-Hant','unrelated',false,`我喜歡${food}。`,'我的腳踏車是藍色。');
 }
 for(const property of ['早餐','公司','住址','飲料','午餐','旅遊目的地','編輯器','通勤方式']){
  add('zh-Hant','value-change',true,`我的${property}是原本的選擇。`,`我的${property}是後來的選擇。`);
  add('zh-Hant','value-change',true,`專案甲的${property}是原本的選擇。`,`專案甲的${property}是後來的選擇。`);
  add('zh-Hant','different-subject',false,`專案甲的${property}是原本的選擇。`,`專案乙的${property}是原本的選擇。`);
 }
 // Handwritten natural sentences are a separate labelled stratum. Keep misses
 // visible: these are topic labels, not examples generated from matcher rules.
 for(const [positive,left,right] of [
  [true,'I like egg pancakes for breakfast.','I stopped eating egg pancakes because of gutter oil.'],
  [true,'I usually have green tea with lunch.','I no longer drink green tea, because it keeps me awake.'],
  [true,'I love walking along the river after work.','I stopped walking along the river after work because the path is closed.'],
  [true,'My home address is on Cedar Lane.','My home address changed to Pine Road after the move.'],
  [true,'I enjoy playing board games on weekends.','I still enjoy playing board games, especially with my cousins.'],
  [true,'I prefer taking the night train to Boston.','I stopped taking the night train to Boston because the service ended.'],
  [true,'I eat peanut butter on toast most mornings.','I avoid peanut butter now because of an allergy.'],
  [true,'I like listening to jazz while cooking.','I no longer listen to jazz while cooking because my kitchen speaker broke.'],
  [true,'My preferred editor is Vim at work.','My preferred editor is now Helix.'],
  [true,'I drink black coffee before my morning run.','I stopped drinking black coffee because it upsets my stomach.'],
  [true,'I love the little ramen shop near the station.','I do not eat at the little ramen shop near the station anymore because it closed.'],
  [true,'I cycle to the office every Tuesday.','I have given up cycling to the office because the bridge is being repaired.'],
  [true,'I keep my spare keys in the blue drawer.','I moved my spare keys from the blue drawer to my backpack.'],
  [false,'I like egg pancakes for breakfast.','My partner stopped eating egg pancakes because of gutter oil.'],
  [false,'I love playing board games.','I dislike buying board games online because shipping is expensive.'],
  [false,'I enjoy green tea.','I dislike the price of green tea at the airport.'],
  [false,'My home address is on Cedar Lane.','My office address is on Cedar Lane.'],
  [false,'I drink black coffee every morning.','I think my colleague stopped drinking black coffee.'],
  [false,'I like the night train to Boston.','I like the night train to Seattle.'],
  [false,'I like cooking egg pancakes.','I like eating egg pancakes.'],
  [false,'I enjoy walking along the river.','I repaired the bicycle in my garage.'],
 ])add('en','natural',positive,left,right);
 for(const [positive,left,right] of [
  [true,'我喜歡吃蛋餅，早餐幾乎每天都吃蛋餅。','我現在不吃蛋餅了，因為聽說那家早餐店的蛋餅用的是地溝油。'],
  [true,'我喜歡吃蛋餅。','我不喜歡吃蛋餅了，因為地溝油。'],
  [true,'我午餐常常配綠茶。','我最近不喝綠茶了，因為下午喝了晚上睡不著。'],
  [true,'我喜歡下班後沿著河堤散步。','我暫時不去河堤散步，因為步道施工。'],
  [true,'我的住址是松柏路那棟公寓。','我的住址換成了車站旁邊的新大樓。'],
  [true,'我週末很喜歡玩桌遊。','我現在還是喜歡玩桌遊，只是改成跟同事一起玩。'],
  [true,'我習慣搭夜車去台南。','我不搭夜車去台南了，因為班次取消。'],
  [true,'我以前早餐會抹花生醬。','我現在完全不吃花生醬，因為過敏。'],
  [true,'我喜歡煮飯時聽爵士樂。','我最近不在煮飯時聽爵士樂了，因為喇叭壞了。'],
  [true,'我的編輯器是 Vim。','我的編輯器改成 Helix，想試試新的操作方式。'],
  [true,'我每天早上喝黑咖啡再去跑步。','我已經戒掉黑咖啡，因為喝了胃不舒服。'],
  [true,'我很喜歡車站旁邊的小拉麵店。','我不去車站旁邊的小拉麵店了，因為已經歇業。'],
  [true,'我每週二騎腳踏車去公司。','我暫時不騎腳踏車去公司，因為橋在整修。'],
  [true,'我把備用鑰匙放在藍色抽屜裡。','我後來把備用鑰匙從藍色抽屜移到背包了。'],
  [false,'我喜歡吃蛋餅。','我妹妹不吃蛋餅了，因為地溝油。'],
  [false,'我喜歡玩桌遊。','我不喜歡買桌遊，因為運費太貴。'],
  [false,'我喜歡喝綠茶。','我不喜歡綠茶在機場的價格。'],
  [false,'我的住址是松柏路。','我的公司地址是松柏路。'],
  [false,'我早上都喝黑咖啡。','我覺得同事不喝黑咖啡了。'],
  [false,'我喜歡搭夜車去台南。','我喜歡搭夜車去台北。'],
  [false,'我喜歡煎蛋餅。','我喜歡吃蛋餅。'],
  [false,'我喜歡沿河堤散步。','我今天修好了車庫裡的腳踏車。'],
 ])add('zh-Hant','natural',positive,left,right);
 return rows;
}
export function threadClassificationCounts(pairs,score,threshold){
 const strata=new Map();
 for(const pair of pairs){
  const key=pair.language+'/'+pair.stratum,row=strata.get(key)??{language:pair.language,stratum:pair.stratum,tp:0,fp:0,tn:0,fn:0};
  const predicted=score(pair.left,pair.right)>=threshold;
  row[pair.positive?(predicted?'tp':'fn'):(predicted?'fp':'tn')]++;strata.set(key,row);
 }
 return [...strata.values()].map(row=>({...row,precision:row.tp+row.fp?row.tp/(row.tp+row.fp):null,recall:row.tp+row.fn?row.tp/(row.tp+row.fn):null}));
}

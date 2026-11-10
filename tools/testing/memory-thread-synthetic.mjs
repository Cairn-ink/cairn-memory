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

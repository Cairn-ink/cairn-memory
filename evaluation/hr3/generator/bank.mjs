export const SENTENCES = {
  initial: { en:'Record {record}: we adopt {subject} {predicate}: {fields}. Audience: {scope}. Effective interval [{from}, {to}); end excluded.', zh:'紀錄 {record}：我們採用{subject}的{predicate}，{fields}。適用對象：{scope}。生效區間 [{from}, {to})，終點不含在內。' },
  correction: { en:'Correct record {predecessors}: its recorded assertion was erroneous, never an adopted decision. Replace that atomic assertion with record {record}: {subject} {predicate}: {fields}. These are all replacement qualifications. Audience: {scope}. Effective interval [{from}, {to}); end excluded.', zh:'更正紀錄 {predecessors}：原先記載的斷言有誤，從未是實際採用的決定。以紀錄 {record} 更正這個單一斷言：{subject}的{predicate}，{fields}。以上完整重述替代斷言的所有條件。適用對象：{scope}。生效區間 [{from}, {to})，終點不含在內。' },
  reversal: { en:'We withdraw records {predecessors} in full, including every field and qualification. Adopt record {record} instead: {subject} {predicate}: {fields}. Audience: {scope}. Effective interval [{from}, {to}); end excluded.', zh:'我們完整撤回紀錄 {predecessors}，包括每個欄位和條件。改採紀錄 {record}：{subject}的{predicate}，{fields}。適用對象：{scope}。生效區間 [{from}, {to})，終點不含在內。' },
  refinement: { en:'For records {predecessors}, keep the route and all unnamed fields. Adopt record {record} as a partial amendment to {subject} {predicate}: change only {fields}. Audience: {scope}. Effective interval [{from}, {to}); end excluded.', zh:'針對紀錄 {predecessors}，保留派送路線及所有未點名的欄位。採用紀錄 {record}，部分修訂{subject}的{predicate}：只改{fields}。適用對象：{scope}。生效區間 [{from}, {to})，終點不含在內。' },
  scope_change: { en:'Adopt record {record}: for {subject} {predicate}, amend only audience {scope} of records {predecessors} to {fields}. Keep every other audience cell unchanged. Effective interval [{from}, {to}); end excluded.', zh:'採用紀錄 {record}：針對{subject}的{predicate}，只把紀錄 {predecessors} 中適用對象為{scope}的部分改成{fields}，其他對象的決定全部保留。生效區間 [{from}, {to})，終點不含在內。' },
  expiry: { en:'Record {predecessors} for {subject} {predicate} reaches its explicit deadline {from}. It expires for audience {scope}; there is no successor and no older decision reactivates. Record {record} records only this expiry.', zh:'{subject}的{predicate}紀錄 {predecessors} 已到明確期限 {from}，對適用對象{scope}到期失效。沒有接續決定，也不會恢復任何更早的決定。紀錄 {record} 僅記載這次到期。' },
  expiry_lapse: { en:'At {from}, record {predecessors} for {subject} {predicate} has lapsed for audience {scope}. Record {record} reports this expiry, without a successor or reactivation of an older decision. No clock deadline was set for this record.', zh:'在 {from}，{subject}的{predicate}紀錄 {predecessors} 對適用對象{scope}已到期失效。紀錄 {record} 記載這次失效，沒有接續決定，也不恢復更早的決定。這筆紀錄未設定時鐘期限。' },
  idle: { en:'No further change to the focal records in this batch.', zh:'這一批沒有再改動焦點紀錄。' },
  fact: { en:'Confirmed condition: {fact}.', zh:'已確認的狀況：{fact}。' },
  edge: { en:'{fromFact} caused {toFact}.', zh:'因為{fromFact}，所以造成{toFact}。' },
  joint: { en:'Only the conjunction of {a} and {b} caused {c}; neither alone suffices.', zh:'只有{a}和{b}同時成立，才會造成{c}，任一個單獨成立都不夠。' },
  alternative: { en:'Each of those two mediated paths independently suffices for this change.', zh:'上述兩條經過中介的路徑，任一條都足以促成這次變更。' },
  unstated: { en:'No reason for this change was stated.', zh:'這次變更沒有說明原因。' },
  distractor: { en:'Unadopted proposal for {subject}: use {route}. Rejected suggestion: use {other}. Quotation only, not adopted: “use {route}”. An unrelated service {collision} uses {route}. A separate proposal for {subject}: use {route}, only {scope} on {date}. Someone guessed that paint colour caused the focal change; this is unsupported speculation and is not an established reason.', zh:'尚未採用的提案：{subject}改用 {route}。已否決的建議：改用 {other}。僅為引述、未被採用：「改用 {route}」。另一個無關的服務{collision}使用 {route}。另有{subject}的提案，使用 {route}，只涉及{scope}，日期是 {date}。有人猜測油漆顏色造成焦點變更，但這是未獲支持的猜測，並非已確認的原因。' },
  question: { en:'At checkpoint after batch {batch} ({at}), recover {subject} {predicate} for {scope}. Request all three slots: route, approval, cap. Focal change turn: {turn}. Exact requested predecessor turns (with record names): {predecessors}. Historical label vocabulary (shared, not case-specific): {labels}. Use the closed slot answer form: current status and rows; old status and records with predecessor_turn, status and rows; reason status and support. Each row includes scope, source-claimed valid interval, route/approval/cap slots with state and value, and citations. Select a complete causal explanation from delivered evidence, including all serial and conjunctive clauses or one complete sufficient alternative. Use only information already observed.', zh:'在第 {batch} 批之後的檢查點（{at}），回答{subject}對{scope}的{predicate}。請回答全部三個欄位：route（路線）、approval（需經核准）、cap（每日請求上限）。焦點變更發言：{turn}。確切要求的前身發言（含紀錄名稱）：{predecessors}。共用歷史標籤詞彙（並非本案答案）：{labels}。使用封閉欄位回答格式：current 含 status、rows；old 含 status、records，每筆含 predecessor_turn、status、rows；reason 含 status、support。每列含 scope、來源宣告的 valid 區間、route/approval/cap 各自的 state、value，以及 citations。從已交付證據選出完整因果解釋，包含所有串聯及合取子句，或一條完整且充分的替代路徑。只能使用已觀察到的資訊。' },
};
export function sentence(key, language, vars = {}) {
  const render = lang => SENTENCES[key][lang].replace(/\{(\w+)\}/g, (_,name) => {
    if (!(name in vars)) throw new Error(`Missing sentence slot ${key}.${name}`);
    return vars[name];
  });
  // Mixed worlds switch languages at sentence/turn boundaries, rather than duplicating translations.
  return render(language === 'zh-Hant' ? 'zh' : 'en');
}
export function fieldText(fields, language) {
  const zh = language === 'zh-Hant';
  return fields.map(({field,value}) => {
    const label = ({value:zh?'路線':'route', approval:zh?'需經核准':'approval required', cap:zh?'每日請求上限':'daily request cap'})[field];
    const val = value.type === 'Text' ? value.text : value.type === 'Boolean' ? (zh ? value.value?'是':'否' : String(value.value)) : `${value.decimal} ${value.unit}`;
    return `${label} = ${val}`;
  }).join(zh?'，':'; ');
}

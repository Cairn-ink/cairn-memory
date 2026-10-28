// Entirely synthetic authoring recipe. No provider, key or network inputs.
export const seed = 'qualification-p2-product-v4-r1';
export const owner = 'qualification-owner';
export const inventory = [{ownerId:owner,scope:'personal',projectId:null},
  ...['atlas','birch','cedar'].map(projectId=>({ownerId:owner,scope:'project',projectId}))];
export const overflowInventory = [...inventory,
  ...Array.from({length:29},(_,i)=>({ownerId:owner,scope:'project',projectId:`overflow-${String(i).padStart(2,'0')}`}))];
export const otherOwnerNamespace = {ownerId:'qualification-other',scope:'personal',projectId:null};
export const queries = [
  {id:'zh',language:'zh',query:'海港',terms:['海港']},
  {id:'ja',language:'ja',query:'桜庭',terms:['桜庭']},
  {id:'mixed',language:'mixed',query:'cobaltledger 檢索',terms:['cobaltledger','檢索']},
  {id:'single-han',language:'zh',query:'中',terms:['中'],knownMiss:true},
  {id:'empty',language:'mixed',query:'noeligiblequartzneedle',terms:['noeligiblequartzneedle'],empty:true}
];
const lead = ['海港 計畫 證據 排序','桜庭 計画 記録 検索','cobaltledger 檢索 orchard evidence'];
const prose = ['團隊每週核對專案規劃，保留維護預算與資料安全的證據。',
  '東京のチームは毎週プロジェクト計画と保守予算を確認します。',
  'The orchard team reviews durable checkpoints and maintenance budgets each week.'];
export function memoryText(i) {
  if(i<12)return `${lead[Math.floor(i/4)]} specimen${i}`;
  if(i===12)return '中文';
  return `entry${i} ${prose[i%3]} ${prose[(i+1)%3]} ${prose[(i+2)%3]}`;
}
export function cardText(i) {return {title:`Authored record ${i}`,body:`${prose[i%3]} ${prose[(i+1)%3]}`};}
export const fixtureSpecs = [1112,3336].flatMap(count=>[18,23,33].map(schema=>({id:`m${count}-v${schema}`,count,schema,cards:schema===18?0:Math.floor(count/10),
  consistency:'closed-snapshot',inventory,overflowInventory,selectionRevision:'qualification-selection-r1',otherOwnerNamespace})));
export const refKey = ref => JSON.stringify([ref.type,ref.namespace.ownerId,ref.namespace.scope,ref.namespace.projectId,ref.memoryId??ref.cardId]);
export function compareRefs(a,b) {
  const tuple=r=>[r.namespace.ownerId,r.namespace.scope,r.namespace.projectId??'',r.type,r.memoryId??r.cardId];
  const x=tuple(a),y=tuple(b);for(let i=0;i<x.length;i++){const n=Buffer.compare(Buffer.from(x[i]),Buffer.from(y[i]));if(n)return n;}return 0;
}

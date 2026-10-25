import { PUBLIC_CONTRACT } from './contract.mjs';
import { CAUSES, TYPES, DEFAULT_SEED, ALLOCATION_SEED, VERSION, shuffle, sha256 } from './common.mjs';

export const SPLITS = {
  engineering: { lineagesPerType: 6, multiplicity: 1, causalLineages: [1,1,1,1,1,1], languages: [10,10,10], cards: 20, safety: 10 },
  pilot: { lineagesPerType: 6, multiplicity: 2, causalLineages: [1,1,1,1,1,1], languages: [33,18,9], cards: 40, safety: 20 },
  development: { lineagesPerType: 10, multiplicity: 4, causalLineages: [2,2,2,2,1,1], languages: [110,60,30], cards: 40, safety: 20 },
  test: { lineagesPerType: 40, multiplicity: 8, causalLineages: [10,10,5,5,5,5], languages: [880,480,240], cards: 160, safety: 160 },
};
// Original split-disjoint lexical roots. R3 revisions disclose their retired
// same-split parents; renamed strings do not establish independent roots.
const ROOTS = {
  engineering: { zh: ['石榴','杏仁','木瓜','桂圓','桑葚'], en: ['Garnet','Quartz','Jasper','Beryl','Onyx'], reason: ['感測誤差','封裝破損','取樣不足','讀值漂移','元件缺貨'], reasonEn: ['sensor error','damaged packaging','insufficient samples','reading drift','component shortage'] },
  pilot: { zh: ['青竹','海棠','山茶','銀杏','杜鵑'], en: ['Cedar','Aster','Willow','Maple','Clover'], reason: ['佇列壅塞','容量不足','延遲增加','備援不足','處理超時'], reasonEn: ['queue congestion','insufficient capacity','increased latency','insufficient redundancy','processing timeout'] },
  development: { zh: ['白鷺','翠鳥','雲雀','朱鷺','畫眉'], en: ['Kestrel','Heron','Finch','Lark','Wren'], reason: ['溫度偏高','風扇停轉','冷卻不足','機櫃過熱','散熱受阻'], reasonEn: ['elevated temperature','stopped fan','insufficient cooling','rack overheating','blocked ventilation'] },
  test: { zh: ['霧島','晨嶼','雲岬','星灣','月港'], en: ['Estuary','Lagoon','Plateau','Glacier','Delta'], reason: ['庫存短缺','運送延誤','補貨不足','出貨積壓','倉儲受限'], reasonEn: ['inventory shortage','shipping delay','insufficient replenishment','dispatch backlog','warehouse constraint'] },
};
export const GRAMMAR = {
  version: VERSION, languages: ['zh-Hant','en','mixed'],
  ancestryRule: 'Original roots are split-disjoint. R3 banks are disclosed within-split revisions of retired predecessors, not independent roots. Affected development/test banks remain provisional: after calibration v2 and before development/affected held-out generation, instantiate genuinely fresh semantic banks and publish ancestry/allocation. No cross-split ancestry or alias reuse is permitted.',
  productions: {
    family: 'initial + distractors; first_update + cause; intermediate + distractors; final_update + cause',
    assertion: 'named_record + subject + predicate + explicit field assignments + audience + [from,to) + commitment',
    correction: 'atomic erroneous assertion + full replacement qualification, never previously adopted',
    reversal: 'explicit complete withdrawal, all predecessor fields cleared',
    refinement: 'keep unnamed fields, change only the named field',
    scope_change: 'change only selected audience cells; keep every other cell',
    expiry: 'direct: explicit elapsed deadline; other strata: non-clock lapse with no preannounced deadline; no successor or fallback; later adoption independent',
    causality: { direct: [['a','decision']], unstated: [], two_edge_serial: [['a','b'],['b','decision']], three_edge_serial: [['a','b'],['b','c'],['c','decision']], conjunctive_mediated: [['a','c'],['b','c'],['c','decision']], alternative_mediated: [[['a','b'],['b','decision']],[['c','d'],['d','decision']]] },
    distractors: ['proposed','rejected','quoted','subject_collision','scope_collision','date_collision','unsupported_cause'],
  },
  byteGuards: { batchSourceBytes: 12288, familySourceBytes: 32000, note: 'Local conservative source guards, not provider-body/token certification; §13 serializer/tokenizer and provider framing remain external gates.' },
};
function semanticBank(root, t, suffix, id) {
  return { subjectZh:`${root.zh[t]}${suffix}服務`, subjectEn:`${root.en[t]} ${suffix} service`,
    predicateZh:'派送設定', predicateEn:'dispatch configuration',
    routes:['A','B','C'].map(letter => `${root.en[t]}${suffix}-${letter}`),
    reasons:Array.from({length:4}, (_,i) => ({id:`${id}/reason${i+1}`, zh:`${root.reason[(t+i)%5]}，檢查點 ${suffix}.${i+1}`, en:`${root.reasonEn[(t+i)%5]} at station ${suffix}.${i+1}`})) };
}
export function namingPool(split) {
  return {
    subjects:PUBLIC_CONTRACT.aliases.subjects.slice(split==='engineering'?0:6,split==='engineering'?6:12).map(s=>({en:s.canonical,zh:s['zh-Hant'][0],mixed:s.mixed[0]})),
    routes:shuffle(['r','s','t'].map(x=>`${x}-${split==='pilot'?'mavo':'keli'}`), `hr3-a4/${split}/route-lexicon`),
  };
}
function publicBank(split,t,ordinal,legacy) {
  const pool=namingPool(split);
  const subject=shuffle(pool.subjects,`hr3-a4/${split}/subjects/${t}`)[ordinal-1];
  const stations=shuffle(Array.from({length:30},(_,i)=>sha256(`hr3-a4/${split}/station/${i}`).slice(0,10)),`hr3-a4/${split}/stations`);
  const station=stations[t*6+ordinal-1];
  const reasons=legacy.reasons.map((r,i)=>{const tag=sha256(`${station}/${i}`).slice(0,10);return {...r,en:r.en.replace(/ at station .*/,` at station ${tag}`),zh:r.zh.replace(/，檢查點 .*/,`，站點 ${tag}`)};});
  return {...legacy,reasons,subjectEn:subject.en,subjectZh:subject.zh,subjectMixed:subject.mixed,routes:pool.routes};
}
export function inventory(seed = DEFAULT_SEED) {
  const lineages = [], retired_lineages = [];
  for (const [split, spec] of Object.entries(SPLITS)) {
    const count = spec.lineagesPerType * 5 * spec.multiplicity;
    const languages = shuffle(spec.languages.flatMap((n,i) => Array(n).fill(GRAMMAR.languages[i])), `${ALLOCATION_SEED}/${split}/languages`);
    const order = Array.from({length: count}, (_,i) => i);
    const cards = new Set(shuffle(order, `${ALLOCATION_SEED}/${split}/cards`).slice(0, spec.cards));
    const safety = new Set(shuffle(order, `${ALLOCATION_SEED}/${split}/safety`).slice(0, spec.safety));
    let index = 0, cardIndex = 0;
    for (let t = 0; t < TYPES.length; t++) {
      let ordinal = 0;
      for (let c = 0; c < CAUSES.length; c++) for (let n = 0; n < spec.causalLineages[c]; n++) {
        const renewed = TYPES[t] === 'expiry' && CAUSES[c] !== 'direct';
        const id = `${split}-${TYPES[t]}-L${String(++ordinal).padStart(2,'0')}${renewed ? '-R3' : ''}`;
        const root = ROOTS[split];
        const suffix = `${t + 1}${String(ordinal).padStart(2,'0')}${renewed ? 'R3' : ''}`;
        const members = Array.from({length:spec.multiplicity}, (_,member) => {
          const global = index++;
          return { member, family_id: `${id}-W${member + 1}`, language: languages[global], card: cards.has(global),
            card_authoring_path:cards.has(global) ? (Math.floor(cardIndex / 8) % 2 === 0 ? 'confirm_with_dependencies' : 'declare_separately') : null,
            card_branch: cards.has(global) ? cardIndex++ % 8 : null, safety: safety.has(global) };
        });
        lineages.push({ lineage_id:id, split, type:TYPES[t], causal_class:CAUSES[c], authored_rationale_topology:CAUSES[c], multi_hop:c >= 2,
          expiry_mode:TYPES[t] !== 'expiry' ? null : CAUSES[c] === 'direct' ? 'deadline' : CAUSES[c] === 'unstated' ? 'unexplained_lapse' : 'conditional_lapse',
          ancestry: { parent:renewed ? id.replace('-R3','') : null, relation:renewed ? 'revision' : 'root', derivatives:[], aliases:[], grammar:VERSION, bank_id:`bank/${id}` },
          fixture_amendment:['engineering','pilot'].includes(split)?{amendment:'A-4',parent_bank:`bank/${id}`,relation:'same-lineage semantic fixture revision; fresh seed does not create a new independent root',previous_snapshot:'artifacts/previous-e5555ee3/pilot/lineage-inventory.json'}:null,
          freshness:renewed ? (['engineering','pilot'].includes(split) ? 'archived_fixture_revision' : 'provisional_revision_fresh_bank_pending') : 'original_root',
          bank:['engineering','pilot'].includes(split) ? publicBank(split,t,ordinal,semanticBank(root,t,suffix,id)) : semanticBank(root,t,suffix,id),
          multiplicity:spec.multiplicity, rendered_world_audit_members:(split==='test'?members.slice(0,2):members).map(m=>m.family_id), members });
        if (renewed) {
          const retiredId = id.replace('-R3','');
          retired_lineages.push({lineage_id:retiredId, split, type:TYPES[t], status:'retired',
            archived_inventory:'artifacts/previous-ff192c6b/pilot/lineage-inventory.json',
            ancestry:{parent:null,relation:'root',derivatives:[id],aliases:[],grammar:VERSION,bank_id:`bank/${retiredId}`},
            bank:semanticBank(root,t,suffix.replace('R3',''),retiredId)});
        }
      }
    }
  }
  return { version:VERSION, seed, allocationSeed:ALLOCATION_SEED, grammar:GRAMMAR, splits:SPLITS, lineages, retired_lineages,
    preDevelopmentGates:{freshAffectedHeldOutBanks:{status:'pending',after:'independent calibration v2 passes',before:'development and affected held-out generation',
      requirement:'Instantiate genuinely fresh semantic banks for the 8 development and 30 test replacements; preserve every frozen allocation and multiplicity; publish ancestry and allocation before generation. R3 revisions do not satisfy freshness.',
      lineages:Object.fromEntries(['development','test'].map(split=>[split,lineages.filter(l=>l.split===split && l.freshness==='provisional_revision_fresh_bank_pending').map(l=>l.lineage_id)]))}} };
}

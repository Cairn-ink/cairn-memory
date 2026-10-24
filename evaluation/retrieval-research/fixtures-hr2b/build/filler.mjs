// Authored, ordered domain/role sentence banks, factored only to avoid copying
// editorial clauses. A complete bank sentence is lead + ';' + tail + terminator.
// All combinations are disclosed in corpus.filler.sentences, even unused ones.
// These are commentary about reading a discussion, never project answers.
const leads = {
  engineering: {
    zh: ['工程討論的敘述可以沿著現象慢慢讀，不必急著替零散用語補上沒有說明的前提', '技術脈絡有時需要來回閱讀才接得起來，旁邊的補充可以保留討論本來的語氣', '系統相關的談話經常省略上下文，整理時可以留意句子之間是否接得自然'],
    en: ['The technical discussion benefits from keeping the surrounding context close to the description', 'Engineering talk can be easier to read when the explanatory thread stays close to the observation', 'The surrounding system discussion leaves room to read the wording carefully before drawing conclusions'],
  },
  'work-preferences': {
    zh: ['工作溝通的脈絡可以慢慢讀，零散的補充有時只是幫忙接住談話當時的語氣', '協作討論裡的用語常有省略，整理時可以留意前後句是否讓人順著讀下去', '關於工作習慣的談話容易夾帶感受，閱讀時可以把敘述的脈絡放在附近'],
    en: ['The working-style discussion benefits from reading the surrounding explanation alongside the wording', 'Conversation about collaboration can leave the surrounding tone implicit unless the context stays nearby', 'The account of working habits reads more clearly when the commentary follows the surrounding explanation'],
  },
  operations: {
    zh: ['營運現場的談話常省略當下大家都懂的背景，整理時可以把敘述接得自然一些', '日常協調的脈絡可以順著原本談話慢慢讀，補充說明有時只是在幫句子接下去', '活動營運的敘述容易夾著現場感受，閱讀時可以先保留周圍的上下文再消化'],
    en: ['The operations discussion benefits from leaving the surrounding explanation close to the account', 'Coordination talk can assume shared context that becomes less obvious when read away from the conversation', 'The account of operational work reads more clearly when the commentary follows the surrounding discussion'],
  },
  finance: {
    zh: ['帳務討論的用語有時很精簡，閱讀時可以把前後說明放在附近再慢慢消化意思', '費用相關的談話常把熟悉的背景省去，整理脈絡時可以留意句子是否接得自然', '財務溝通裡的補充有時只是在解釋談話語氣，閱讀時可以沿著周圍的敘述理解'],
    en: ['The accounting discussion benefits from keeping the surrounding explanation close to the wording', 'Talk about costs can assume familiar context that is less obvious away from the conversation', 'The financial account reads more clearly when the commentary follows the surrounding explanation'],
  },
  product: {
    zh: ['產品討論常在描述感受時省略背景，閱讀時可以沿著周圍敘述把談話接起來', '介面相關的溝通有時需要多讀幾次，整理脈絡時可以保留句子原本的輕重語氣', '討論使用經驗時容易跳接想法，補充說明可以幫人順著談話本來的脈絡閱讀'],
    en: ['The product discussion benefits from keeping the surrounding explanation close to the account', 'Talk about an experience can leave familiar context implicit when read away from the conversation', 'The surrounding interface discussion reads more clearly when the commentary follows the explanatory thread'],
  },
  everyday: {
    zh: ['生活雜事的談話經常省略熟悉的背景，閱讀時可以沿著周圍敘述慢慢接起來', '日常討論裡的補充有時只是接話，整理脈絡時可以保留句子當時的輕鬆語氣', '關於生活安排的敘述可以慢慢讀，旁邊的說明有時只是在補上聊天的上下文'],
    en: ['The everyday discussion benefits from keeping the surrounding explanation close to the account', 'Casual talk can leave familiar context implicit when read away from the conversation', 'The account of daily life reads more clearly when the commentary follows the surrounding explanation'],
  },
};
const shortLeads = {
  engineering: ['工程脈絡可以慢慢讀', 'The technical context can be read at an easy pace'],
  'work-preferences': ['協作脈絡可以慢慢讀', 'The collaboration context can be read at an easy pace'],
  operations: ['營運脈絡可以慢慢讀', 'The operations context can be read at an easy pace'],
  finance: ['帳務脈絡可以慢慢讀', 'The accounting context can be read at an easy pace'],
  product: ['產品脈絡可以慢慢讀', 'The product context can be read at an easy pace'],
  everyday: ['生活脈絡可以慢慢讀', 'The everyday context can be read at an easy pace'],
};
const additionalLeads = {
  engineering: {
    zh: ['重現現象的說法可以先講順，談到還在猜的地方時也可以保留原本比較猶豫的語氣', '聊技術時有些補充只是順著話題接下去，整理敘述時可以讓這種口氣留在附近'],
    en: ['The technical account can distinguish a tentative guess from a description without making the conversation harder to follow', 'Thinking through the engineering discussion can be easier when casual guesses keep their conversational tone'],
  },
  'work-preferences': {
    zh: ['談工作感受時可以留點接話的空間，說得比較快的句子放回聊天裡也許比較容易讀', '協作時的口頭補充可以保留輕重語氣，回頭讀這段也比較知道敘述是怎麼接下去的'],
    en: ['Talk about working together can leave room for a reply while keeping the surrounding explanation easy to read', 'The account of collaboration can preserve conversational pauses while the wording is being considered'],
  },
  operations: {
    zh: ['現場協調的句子有時省略主詞，把周圍的談話留在附近也比較容易接住當時的意思', '營運討論裡隨口補上的話可以保留語氣，回頭讀時也比較知道敘述為什麼接到這裡'],
    en: ['The account of onsite coordination can leave conversational pauses readable when the surrounding context is kept nearby', 'Operational discussion can preserve the feel of a spoken explanation while leaving tentative wording open'],
  },
  finance: {
    zh: ['說明帳務脈絡時可以先把句子講順，還在琢磨的用語也可以留著慢慢讀', '談費用時的補充可以放在前後敘述旁邊，免得隨口接上的話在回頭閱讀時變得太生硬'],
    en: ['The accounting account can leave tentative interpretations open while the surrounding explanation is being read', 'Financial discussion can preserve the feel of a spoken explanation while the phrasing is being considered'],
  },
  product: {
    zh: ['描述操作感受時可以少些急著下結論的語氣，讓周圍的談話幫忙把句子接順', '產品討論裡說得比較含糊的地方可以保留語氣，回頭讀時也比較知道當時還在想什麼'],
    en: ['The account of using an interface can keep the feel of the conversation while the phrasing is being considered', 'Product discussion can leave tentative impressions open while keeping the surrounding explanation readable'],
  },
  everyday: {
    zh: ['聊生活雜事時可以留著比較輕鬆的口氣，讓回頭閱讀的人順著談話慢慢接下去', '日常安排的說法有時只是順口補充，把周圍的敘述放在附近也比較讀得出語氣'],
    en: ['The everyday account can preserve the feel of casual conversation while leaving room to think through the phrasing', 'Discussion of daily life can leave tentative wording open while keeping the surrounding explanation readable'],
  },
};
const tails = {
  note: {
    zh: ['這段補充著重敘述怎麼接起來，讓讀到這裡的人能順著語氣往下讀，也留下思考措辭的空間', '周圍的說明讓談話比較容易閱讀，整理時保留這種輕重語氣，可以少些替說話者補意思的衝動', '這裡留著討論當時的敘述節奏，讓後來閱讀的人能慢慢消化措辭，而不必把每句閒談都看得很重', '閱讀這段脈絡時可以留意敘述怎麼連接，讓談話原本的感覺留在文字裡，方便後來回頭接著讀'],
    en: ['the accompanying commentary helps the account read naturally and leaves room to consider how the phrasing fits the conversation without making incidental wording carry more meaning than it can support', 'the surrounding explanation keeps the account readable and preserves some of the conversational tone so that a reader can follow the thought without filling in unstated details from habit', 'this commentary keeps the conversational thread close to the account and gives the reader room to consider the phrasing in context rather than rush through language that was casually expressed', 'the explanation around the account helps preserve the conversational tone and lets a reader follow how the thought develops while leaving unstated details open for careful reading'],
  },
  user: {
    zh: ['我想把這段話說得自然些，免得回頭讀的時候只剩零散用語，還要猜當時在聊什麼', '我讀到這裡會想看看周圍怎麼說，這樣比較接得住談話，也比較不會把隨口補充看得太重', '這邊我還在琢磨怎麼說比較順，先把周圍的想法留著，回來讀的時候也比較容易接上'],
    en: ['I want the wording to read naturally so I can come back to this conversation and follow the thought without guessing what was left unsaid', 'I am still thinking about how to phrase this and would like the surrounding explanation nearby when I read through the conversation again', 'I find the account easier to follow with the surrounding explanation nearby because casual wording can feel less clear when I return to it'],
  },
  assistant: {
    zh: ['我會順著談話把這段脈絡接起來，讓回頭閱讀時還能接住原本的語氣，不必替省略的地方猜意思', '讀這段時可以先留意前後怎麼接，這樣比較容易保留談話的感覺，也方便慢慢消化其中的用語', '這段補充可以跟周圍敘述連著讀，先接住當時的語氣，回頭整理措辭時也比較知道怎麼銜接'],
    en: ['I can keep the surrounding explanation close to this account so it reads naturally when you return and follow the thought at your own pace', 'I can follow the conversational thread here and keep the surrounding explanation nearby so the wording stays readable when you return to the discussion', 'The accompanying explanation can stay close to the account so you can read the phrasing in context and follow how the conversation develops'],
  },
};
export const fillerSentences = Object.entries(leads).flatMap(([domain, languages]) =>
  Object.entries(languages).flatMap(([lang, starts]) =>
    Object.entries(tails).flatMap(([mode, endings]) =>
      [...starts, ...additionalLeads[domain][lang], shortLeads[domain][lang === 'zh' ? 0 : 1]].flatMap((lead, i) =>
        [...endings[lang], ...(mode === 'note' ? lang === 'zh' ? ['這段文字保留談話還在琢磨時的感覺，讓後來閱讀的人能循著敘述往下讀，也留下理解措辭的空間', '周圍的補充讓這段敘述比較接得起來，回頭整理文字時也比較容易保留原本說話的節奏與輕重語氣'] : ['the accompanying wording preserves some of the conversational rhythm and gives a reader room to follow the account without turning a casually expressed thought into an unstated conclusion', 'the surrounding commentary gives a reader room to follow the thought as it develops and preserves some of the conversational rhythm without asking incidental wording to settle an open interpretation'] : []),
          lang === 'zh' ? '周圍的敘述能幫忙接住談話的語氣' : 'the surrounding account helps preserve the conversational tone'].map((tail, j) => ({
        id: `fill-${domain}-${lang}-${mode}-${i + 1}-${j + 1}`,
        domain, lang, mode, lead: `${domain}-${lang}-${i}`, tail: `${lang}-${mode}-${j}`,
        text: lang === 'zh' ? `${lead}，${tail}。` : `${lead}; ${tail}.`,
      }))))));
export function bank(domain, lang, mode) {
  return fillerSentences.filter(sentence => sentence.domain === domain && sentence.lang === lang && sentence.mode === mode);
}

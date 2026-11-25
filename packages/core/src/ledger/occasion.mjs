const occasionVerb = /(?<![\p{L}\p{M}\p{N}_])(?:spent|paid|bought|purchased|ordered|grabbed|got|had|walked|ran|hiked|logged|clocked|did|hit|reached)(?![\p{L}\p{M}\p{N}_])|花了|買了|买了|付了|走了|跑了/iu;
const rateInterval = /\b(?:per|a|an|each|every)\s+(?:day|week|month|year|morning|night|weekday)\b/iu;
const ratePhrase = /\b(?:daily|weekly|monthly|yearly|annual|annually)\s+(?:budget|limit|allowance|spend|spending|average|cap|target|goal)\b/iu;
const rateWord = /\b(?:usually|typically|normally|generally|average|budget|allowance|limit)\b|每天|每日|每週|每周|每月|每個月|每个月|每年|平均|預算|预算|通常/iu;
const numberWithPeriod = /\p{Nd}\s*(?:(?:\/|per)\s*)?(?:day|week|month|year|daily|weekly|monthly|yearly)(?![\p{L}\p{M}\p{N}_])/iu;

/** @param {string} content */
export function isLedgerOccasion(content) {
  const text = content.normalize('NFKC');
  return occasionVerb.test(text) && !rateInterval.test(text) && !ratePhrase.test(text) &&
    !rateWord.test(text) && !numberWithPeriod.test(text);
}

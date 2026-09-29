// Synthetic counter shaped like a real tokenizer, NOT a provider tokenizer:
// each CJK character is about one token and other text about a quarter token
// per character, scaled like a host that pads an o200k count by 15%.
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿＀-￯]/gu;

export function createCjkTokenCounter({ scale = 1.15 } = {}) {
  return (text) => {
    const cjk = text.match(CJK)?.length ?? 0;
    let points = 0;
    for (const _ of text) points++;
    return Math.ceil(scale * (cjk + (points - cjk) / 4));
  };
}

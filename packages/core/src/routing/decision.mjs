import { cleanContent } from "../privacy/text.mjs";
import { redactDocumentText } from "./redaction.mjs";
import { caseInsensitiveWords, NONSPACE, SPACE, WORD } from "./text.mjs";

const LINE_START = String.raw`(?<![^\n])`;
const LINE_END = String.raw`(?![^\n])`;
const LIST = new RegExp(
  String.raw`${LINE_START}${SPACE}*(?:[-*•·▪◦]|\p{Nd}{1,2}[.)、．]|[（(]?\p{Nd}{1,2}[)）]|[一二三四五六七八九十]{1,3}[、.]|第[一二三四五六七八九十\p{Nd}]{1,3}[步天日點項]|step${SPACE}*\p{Nd}+|day${SPACE}*\p{Nd}+|☐|\[ ?[x ]?\])${SPACE}*${NONSPACE}`,
  "giu",
);
const TABLE = new RegExp(String.raw`${LINE_START}${SPACE}*\|?[^|\n]+\|[^|\n]+\|`, "gu");
const CODE_START = "def|class|import|from|function|const|let|var|return|if|for|while|#include|public|SELECT";
const CODE = new RegExp(
  "```|" + String.raw`${LINE_START}${SPACE}{2,}${NONSPACE}[^\n]*[;{}()=:]${SPACE}*${LINE_END}|${LINE_START}${SPACE}*(?:${CODE_START})(?!${WORD})`,
  "gu",
);
const REMEMBER = new RegExp(
  caseInsensitiveWords("remember (?:this|that)|save (?:this|that)|keep (?:this|that)") +
    "|記住|記下來|記起來|幫我記|存起來|存下來",
  "iu",
);
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/gu;
const CARD_LIMIT = 4;

/** @param {string} content @returns {import("./index.mjs").DocumentCardReason | null} */
function structuredReason(content) {
  const markers = [];
  if ((content.match(LIST)?.length ?? 0) >= 2) markers.push("list");
  if ((content.match(TABLE)?.length ?? 0) >= 2) markers.push("table");
  if (content.includes("```") || (content.match(CODE)?.length ?? 0) >= 3) markers.push("code");
  return markers.length
    ? /** @type {import("./index.mjs").DocumentCardReason} */ (`structured:${markers.join("+")}`)
    : null;
}

/** @param {readonly import("./index.mjs").DocumentMessage[]} messages
 * @returns {import("./index.mjs").DocumentRoutingDecision}
 */
export function routeDocumentMessages(messages) {
  /** @type {import("./index.mjs").DocumentRouteChoice[][]} */
  const groups = [[], [], []];
  let extractOnly = 0;
  let illFormedText = 0;

  for (const [position, message] of messages.entries()) {
    if (cleanContent(message.content) !== message.content) {
      extractOnly++;
      illFormedText++;
      continue;
    }
    const content = redactDocumentText(message.content);
    if (content === null) {
      extractOnly++;
      continue;
    }
    const assistant = message.role === "assistant";
    const explicit = message.role === "user" && content.length >= 200 && REMEMBER.test(content);
    const weighted = content.length + 2 * (content.match(CJK)?.length ?? 0);
    /** @type {import("./index.mjs").DocumentCardReason | null} */
    let reason = null;
    if (assistant && weighted >= 800) reason = "long_assistant";
    else if (weighted >= 1_600) reason = "long_any";
    else if (content.length >= 200) reason = structuredReason(content);
    if (!reason && explicit) reason = "explicit";

    if (reason) {
      // The first matching rule supplies the reason. An explicit request still gets
      // priority when a length or structure rule also matched.
      const priority = explicit ? 0 : assistant ? 1 : 2;
      groups[priority].push({ position, reason });
    } else {
      extractOnly++;
    }
  }

  const candidates = groups.flat();
  return {
    chosen: candidates.slice(0, CARD_LIMIT),
    drops: {
      extract_only: extractOnly,
      capture_limit: Math.max(0, candidates.length - CARD_LIMIT),
      ...(illFormedText ? { ill_formed_text: illFormedText } : {}),
    },
  };
}

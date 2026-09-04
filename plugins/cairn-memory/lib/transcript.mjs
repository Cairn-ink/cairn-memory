import { createHash } from "node:crypto";
import { redactSecrets } from "./redact.mjs";

function textBlocks(content) {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) =>
    block && block.type === "text" && typeof block.text === "string"
      ? [block.text]
      : [],
  );
}

export function transcriptMessages(jsonl, sessionId) {
  const messages = [];
  for (const [lineIndex, line] of jsonl.split("\n").entries()) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record?.type !== "user" && record?.type !== "assistant") continue;
    const role = record.type;
    const content = textBlocks(record?.message?.content)
      .map(redactSecrets)
      .join("\n")
      .trim()
      .slice(0, 20_000);
    if (!content) continue;
    const id =
      typeof record.uuid === "string" && record.uuid
        ? record.uuid
        : createHash("sha256")
            .update(`${sessionId}\0${lineIndex}\0${role}\0${content}`)
            .digest("hex");
    messages.push({ id, role, content });
  }
  return messages;
}

export function captureEventId(sessionId, messages) {
  return createHash("sha256")
    .update(`${sessionId}\0${messages.map((message) => message.id).join("\0")}`)
    .digest("hex");
}

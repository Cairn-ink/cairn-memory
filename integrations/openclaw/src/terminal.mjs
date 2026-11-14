// Read directly in raw mode so the terminal never echoes the credential.
export function createTerminal(input = process.stdin, output = process.stdout) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("Cairn setup needs a terminal with hidden input. Nothing saved.");
  }
  const print = (text) => output.write(text + "\n");
  const ask = (prompt, hidden = false) => new Promise((resolve, reject) => {
    let text = "";
    const wasRaw = Boolean(input.isRaw);
    const cleanup = () => {
      input.removeListener("data", data); input.removeListener("end", ended); input.removeListener("error", ended);
      input.setRawMode(wasRaw); input.pause(); output.write("\n");
    };
    const ended = () => { cleanup(); reject(new Error("cairn_input_unavailable")); };
    const data = (chunk) => {
      for (const c of chunk.toString("utf8")) {
        if (c === "\x03" || c === "\x04" || c === "\x1b") { ended(); return; }
        if (c === "\r" || c === "\n") { cleanup(); resolve(text); return; }
        if (c === "\x7f" || c === "\b") {
          if (text) { text = text.slice(0, -1); if (!hidden) output.write("\b \b"); }
        } else if (c >= " " && c <= "~") {
          if (text.length >= 16384) { ended(); return; }
          text += c; if (!hidden) output.write(c);
        }
      }
    };
    try {
      input.setRawMode(true); output.write(prompt + (prompt.endsWith(" ") ? "" : " "));
      input.on("data", data); input.once("end", ended); input.once("error", ended); input.resume();
    } catch { ended(); }
  });
  return { ask, print };
}

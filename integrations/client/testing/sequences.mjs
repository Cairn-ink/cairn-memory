// Fixed CI seeds. Each seed expands into 100 bounded operation sequences.
export const SEQUENCE_SEEDS = Object.freeze([0x43583210, 0x51a7e001, 0x0badcafe]);
export const OPERATIONS = Object.freeze([
  "initialize",
  "adopt",
  "complete",
  "reset-claude-custom",
  "reset-codex-custom",
  "reset-claude-default",
  "reset-codex-default",
  "pause",
  "resume",
  "capture",
  "recall",
  "status",
  "delete-key",
  "coord-absent",
  "coord-empty",
  "coord-file",
  "fresh-set",
  "fresh-unset",
  "fresh-relative",
  "repair",
]);
export function generateSequences() {
  const sequences = [];
  for (const seed of SEQUENCE_SEEDS) {
    let state = seed;
    const next = (count) => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) % count;
    };
    for (let index = 0; index < 100; index++) {
      const start = index % 2 ? "adopt" : "initialize";
      const roots = [
        "reset-claude-default",
        "reset-codex-default",
        "reset-claude-custom",
        "reset-codex-custom",
      ];
      const losses = ["coord-absent", "coord-empty", "coord-file"];
      const profiles = ["fresh-set", "fresh-unset", "fresh-relative"];
      let operations;
      if (index < 12)
        operations = [
          start,
          "complete",
          roots[next(4)],
          losses[next(3)],
          profiles[next(3)],
          "resume",
          "recall",
        ];
      else if (index < 24)
        operations = [
          start,
          "complete",
          "delete-key",
          profiles[next(3)],
          ["status", "resume", "capture", "recall"][next(4)],
          "repair",
          "recall",
        ];
      else if (index < 36)
        operations = [
          start,
          "complete",
          "capture",
          losses[next(3)],
          profiles[next(3)],
          "pause",
          "recall",
        ];
      else
        operations = Array.from({ length: 1 + next(7) }, () => OPERATIONS[next(OPERATIONS.length)]);
      // The discovered case is retained verbatim even if generator tuning changes
      // random draw order. Its original seed and overall index (186) stay stable.
      if (seed === 0x51a7e001 && index === 86)
        operations = [
          "initialize",
          "complete",
          "adopt",
          "reset-claude-custom",
          "coord-absent",
          "reset-claude-custom",
          "capture",
        ];
      if (seed === 0x43583210 && index === 24)
        operations = [
          "initialize",
          "complete",
          "delete-key",
          "fresh-relative",
          "recall",
          "repair",
          "recall",
        ];
      sequences.push({ seed, operations });
    }
  }
  return sequences;
}

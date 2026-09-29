// Fixed CI seeds: 73 sequences per original seed and 9 per regression seed (300 total).
const ORIGINAL_SEEDS = [0x43583210, 0x51a7e001, 0x0badcafe];
export const REGRESSION_SEQUENCES = Object.freeze([
  {
    seed: 0x11b00001,
    finding: "sharing must not register (absent)",
    pairRoot: "default",
    operations: [
      "initialize",
      "complete",
      "coord-absent",
      "fresh-unset",
      "recall",
      "setup-implicit",
    ],
  },
  {
    seed: 0x11b00002,
    finding: "sharing must not register (empty)",
    pairRoot: "default",
    operations: [
      "initialize",
      "complete",
      "coord-empty",
      "fresh-unset",
      "recall",
      "setup-implicit",
    ],
  },
  {
    seed: 0x11b00003,
    finding: "whole-root loss cannot mint",
    pairRoot: "default",
    operations: ["initialize", "complete", "delete-root", "fresh-unset", "recall"],
  },
  {
    seed: 0x11b00004,
    finding: "Codex refuses a replacement identity",
    pairRoot: "default",
    operations: ["initialize", "complete", "replace-key", "codex-recall"],
  },
  {
    seed: 0x11b00005,
    finding: "repair capability is private",
    operations: ["inventory-repair-public"],
  },
  {
    seed: 0x11b00006,
    finding: "failed reset preserves bytes and modes",
    operations: ["initialize", "complete", "binding-mode", "reset-claude-custom"],
  },
  {
    seed: 0x11b00007,
    finding: "explicit reset recovers lost identity",
    operations: ["initialize", "complete", "delete-root", "coord-absent", "reset-lost"],
  },
  {
    seed: 0x11b00008,
    finding: "repair without Claude is a named refusal",
    operations: ["codex-single", "repair"],
  },
  {
    seed: 0x11b00009,
    finding: "explicit setup profile conflict refuses",
    operations: ["initialize", "complete", "reset-other-profile"],
  },
]);
export const SEQUENCE_SEEDS = Object.freeze([
  ...ORIGINAL_SEEDS,
  ...REGRESSION_SEQUENCES.map(({ seed }) => seed),
]);
export const DAMAGE_OPERATIONS = Object.freeze([
  "delete-root",
  "binding-delete",
  "binding-json",
  "binding-mode",
  "binding-directory",
  "marker-delete",
  "marker-json",
  "marker-directory",
  "coord-absent",
  "replace-key",
]);
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
  "delete-root",
  "replace-key",
  "binding-delete",
  "binding-json",
  "binding-mode",
  "binding-directory",
  "marker-delete",
  "marker-json",
  "marker-directory",
  "unset-recall",
  "codex-single",
  "codex-pair",
  "codex-capture",
  "codex-recall",
  "codex-status",
  "setup-implicit",
  "reset-lost",
  "reset-other-profile",
  "inventory-repair-public",
  "retired-delete",
  "retired-json",
  "retired-directory",
  "legacy-delete",
  "legacy-json",
  "legacy-directory",
]);
export function generateSequences() {
  const sequences = [];
  for (const seed of ORIGINAL_SEEDS) {
    let state = seed;
    const next = (count) => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) % count;
    };
    for (let index = 0; index < 73; index++) {
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
        operations = Array.from(
          { length: 1 + next(7) },
          () => OPERATIONS[next(OPERATIONS.length)],
        );
      // The discovered case is retained verbatim even if generator tuning changes
      // random draw order. Its original seed and seed stays stable; this retained regression is last in the shortened seed block.
      if (seed === 0x51a7e001 && index === 72)
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
      if (seed === 0x43583210 && index === 37)
        operations = [
          "initialize",
          "complete",
          "binding-delete",
          "replace-key",
          "recall",
          "codex-recall",
          "repair",
        ];
      sequences.push({ seed, operations });
    }
  }
  for (const regression of REGRESSION_SEQUENCES) {
    for (let index = 0; index < 9; index++) {
      const operations =
        index === 0
          ? regression.operations
          : [
              "initialize",
              "complete",
              DAMAGE_OPERATIONS[(index + regression.seed) % DAMAGE_OPERATIONS.length],
              index % 2 ? "codex-status" : "status",
              index % 3 ? "repair" : "setup-implicit",
            ];
      sequences.push({
        ...regression,
        finding: index === 0 ? regression.finding : undefined,
        operations,
      });
    }
  }
  return sequences;
}

const setupRefusals = [
  "pairing_needed",
  "paired_key_missing",
  "retired_root",
  "claude_profile_root_required",
  "claude_confirmation_needed",
  "claude_profile_mismatch",
  "binding_identity_mismatch",
  "binding_history_invalid",
  "pairing_record_mismatch",
  "identity_reset_pending",
  "pending_binding_mismatch",
  "adoption_confirmation_required",
  "adopted_key_missing",
  "adoption_key_conflict",
  "state_permissions",
  "invalid_state_type",
  "state_symlink",
  "invalid_identity: project-key",
  "setup_busy",
  "state_owner",
  "invalid_pairing_metadata",
  "invalid_install",
  "invalid_pairing_record",
];
export const OPERATION_REFUSALS = Object.freeze(
  Object.fromEntries(
    OPERATIONS.map((name) => [
      name,
      name === "repair"
        ? [
            ...setupRefusals,
            "repair_key_conflict",
            "repair_binding_missing",
            "pairing_record_missing",
          ]
        : name.startsWith("reset-")
          ? [
              ...setupRefusals,
              "identity_reset_requires_new_root",
              "identity_reset_history_required",
            ]
          : ["initialize", "adopt", "complete", "setup-implicit"].includes(name)
            ? setupRefusals
            : name.startsWith("codex-")
              ? [
                  "pairing_needed",
                  "pairing_record_missing",
                  "paired_key_missing",
                  "binding_identity_mismatch",
                  "pairing_record_mismatch",
                  "state_permissions",
                  "invalid_state_type",
                  "state_symlink",
                  "invalid_pairing_metadata",
                  "invalid_install",
                  "invalid_pairing_record",
                ]
              : [],
    ]),
  ),
);

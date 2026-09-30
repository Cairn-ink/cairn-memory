// 201 random sequences plus explicitly scripted regression fixtures.
const ORIGINAL_SEEDS = [0x43583210, 0x51a7e001, 0x0badcafe];
export const REGRESSION_SEQUENCES = Object.freeze([
  // These are scripted fixtures, not discoveries by random generation.
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

  {
    seed: 313524225,
    finding: "reset root loss retains ownership",
    pairRoot: "custom",
    operations: [
      "initialize",
      "complete",
      "reset-claude-default",
      "delete-root",
      "fresh-unset",
      "recall",
    ],
  },
  {
    seed: 313524226,
    finding: "alias destination cannot reset identity",
    pairRoot: "custom",
    operations: ["initialize", "complete", "reset-alias"],
  },
  {
    seed: 313524227,
    finding: "pre-keyed reset destination refuses",
    pairRoot: "custom",
    operations: ["initialize", "complete", "reset-prekeyed"],
  },
  {
    seed: 313524228,
    finding: "pre-keyed initialization requires adoption",
    pairRoot: "custom",
    operations: ["initialize-prekeyed"],
  },
  {
    seed: 313524229,
    finding: "Codex resolution cannot register after loss",
    pairRoot: "custom",
    operations: ["initialize", "complete", "coord-absent", "codex-single"],
  },
  {
    seed: 313524230,
    finding: "unknown marker never registers absent",
    pairRoot: "default",
    operations: [
      "initialize",
      "complete",
      "coord-absent",
      "root-mode-zero",
      "fresh-unset",
      "recall",
      "root-mode-restore",
    ],
  },
  {
    seed: 313524231,
    finding: "unknown marker never registers empty",
    pairRoot: "default",
    operations: [
      "initialize",
      "complete",
      "coord-empty",
      "root-mode-zero",
      "fresh-unset",
      "recall",
      "root-mode-restore",
    ],
  },
  {
    seed: 313524232,
    finding: "root file returns named refusal",
    pairRoot: "custom",
    operations: ["initialize", "complete", "root-file", "codex-recall"],
  },
  {
    seed: 313524233,
    finding: "key directory returns named refusal",
    pairRoot: "custom",
    operations: ["initialize", "complete", "key-directory", "codex-recall"],
  },
  {
    seed: 313524234,
    finding: "facade mint checks recorded root",
    pairRoot: "default",
    operations: ["initialize", "complete", "delete-root", "facade-project-key"],
  },
  {
    seed: 313524235,
    finding: "facade ignores no repair option",
    pairRoot: "default",
    operations: ["initialize", "complete", "delete-root", "facade-original-key"],
  },
  {
    seed: 313524236,
    finding: "facade HMAC checks recorded root",
    pairRoot: "default",
    operations: ["initialize", "complete", "delete-root", "facade-project-id"],
  },
  {
    seed: 313524237,
    finding: "invalid backup returns named refusal",
    pairRoot: "custom",
    operations: ["initialize", "complete", "repair-invalid"],
  },
  {
    seed: 313524238,
    finding: "crashed lock recovery permits refusal",
    pairRoot: "custom",
    operations: ["initialize", "complete", "crashed-lock", "reset-other-profile"],
  },
  {
    seed: 313524239,
    finding: "unreadable key returns named refusal",
    pairRoot: "custom",
    operations: ["initialize", "complete", "key-mode-zero", "codex-recall", "key-mode-restore"],
  },
  {
    seed: 313524240,
    finding: "unreadable coordination returns named refusal",
    pairRoot: "custom",
    operations: ["initialize", "complete", "coord-mode-zero", "codex-recall", "coord-mode-restore"],
  },
  {
    seed: 313524241,
    finding: "Codex strict refusal never registers",
    pairRoot: "custom",
    operations: ["root-mode-host", "codex-single"],
  },
  {
    seed: 313524242,
    finding: "invalid repair history is named precisely",
    operations: ["initialize", "complete", "binding-mode", "repair"],
    expectedRefusal: "binding_history_invalid",
  },
  {
    seed: 313524243,
    finding: "combined root and coordination loss preserves K",
    pairRoot: "default",
    operations: ["initialize", "complete", "coord-absent", "delete-root", "fresh-unset", "recall"],
  },
  {
    seed: 313524244,
    finding: "deleted pair roots retain identity through ancestor aliases",
    operations: ["initialize", "complete", "delete-root", "reset-alias"],
    expectedRefusal: "identity_reset_requires_new_root",
  },
  {
    seed: 313524245,
    finding: "facade mint protects deleted pair roots through ancestor aliases",
    operations: ["initialize", "complete", "delete-root", "facade-alias-key"],
  },
  {
    seed: 313524246,
    finding: "retargeted profile aliases cannot inherit a binding",
    operations: ["bind-profile-alias", "complete", "repoint-profile-alias", "recall"],
  },
  {
    seed: 313524247,
    finding: "alias switches without an option retain standalone delivery",
    operations: [
      "bind-profile-alias",
      "complete",
      "repoint-profile-alias",
      "clear-option",
      "recall",
    ],
  },
  {
    seed: 313524248,
    finding: "deleted local history cannot split a paired profile after coordination loss",
    operations: ["initialize", "complete", "binding-delete", "coord-absent", "recall"],
  },
  {
    seed: 313524249,
    finding: "explicit reset recovers erased local history and lost key and coordination",
    operations: [
      "initialize",
      "complete",
      "binding-delete",
      "delete-root",
      "coord-absent",
      "reset-lost",
      "recall",
    ],
  },
  {
    seed: 313524250,
    finding: "deleted Codex history cannot split the second client after coordination loss",
    operations: ["initialize", "complete", "codex-binding-delete", "coord-absent", "codex-single"],
  },
  {
    seed: 313589761,
    finding: "Codex-first unset Claude is a disabled newcomer",
    pairRoot: "default",
    operations: ["codex-first", "fresh-unset", "recall", "codex-status"],
  },
  {
    seed: 313589762,
    finding: "Codex-first plugin-data Claude cannot mint",
    pairRoot: "default",
    operations: ["codex-first", "fresh-set", "recall", "codex-status"],
  },
  {
    seed: 313589763,
    finding: "Claude-first Codex is a disabled newcomer",
    pairRoot: "default",
    operations: ["claude-first", "codex-single", "recall"],
  },
  ...[
    "initialize",
    "adopt",
    "complete",
    "reset-claude",
    "reset-codex",
    "repair",
    "adopt-temporary",
  ].map((setupOperation, index) => ({
    seed: 313589764 + index,
    finding: `interrupted ${setupOperation} retries`,
    setupOperation,
    operations: ["interrupt"],
  })),
  // Retained discoveries from earlier rounds are scripted fixtures too.
  {
    seed: 0x51a7e001,
    finding: "retained reset and loss discovery",
    operations: [
      "initialize",
      "complete",
      "adopt",
      "reset-claude-custom",
      "coord-absent",
      "reset-claude-custom",
      "capture",
    ],
  },
  {
    seed: 0x43583210,
    finding: "retained key-loss discovery",
    operations: [
      "initialize",
      "complete",
      "delete-key",
      "fresh-relative",
      "recall",
      "repair",
      "recall",
    ],
  },
  {
    seed: 0x43583210,
    finding: "retained deleted-history discovery",
    operations: [
      "initialize",
      "complete",
      "binding-delete",
      "replace-key",
      "recall",
      "codex-recall",
      "repair",
    ],
  },
]);
export const SEQUENCE_SEEDS = Object.freeze([
  ...new Set([...ORIGINAL_SEEDS, ...REGRESSION_SEQUENCES.map(({ seed }) => seed)]),
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
  "coord-mode-restore",
  "coord-mode-zero",
  "crashed-lock",
  "facade-original-key",
  "facade-project-id",
  "facade-project-key",
  "initialize-prekeyed",
  "key-directory",
  "key-mode-restore",
  "key-mode-zero",
  "repair-invalid",
  "reset-alias",
  "reset-prekeyed",
  "root-file",
  "root-mode-restore",
  "root-mode-zero",
  "profile-alias",
  "root-mode-host",
  "delete-reset-root",
  "facade-alias-key",
  "bind-profile-alias",
  "repoint-profile-alias",
  "clear-option",
  "codex-binding-delete",
  "codex-first",
  "claude-first",
  "interrupt",
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
    for (let index = 0; index < 67; index++) {
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
        operations = Array.from({ length: 1 + next(7) }, () => {
          const randomOperations = OPERATIONS.filter((operation) => operation !== "interrupt");
          return randomOperations[next(randomOperations.length)];
        });
      sequences.push({ seed, operations });
    }
  }
  for (const fixture of REGRESSION_SEQUENCES) sequences.push({ ...fixture, scripted: true });
  return sequences;
}

const setupRefusals = [
  "state_unreadable",
  "reset_destination_not_new",
  "existing_key_requires_adoption",
  "invalid_original_key",
  "invalid_claude_profile_root",
  "unexpected_state_error",
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
      ["repair", "repair-invalid"].includes(name)
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
          : [
                "initialize",
                "initialize-prekeyed",
                "adopt",
                "complete",
                "setup-implicit",
                "bind-profile-alias",
              ].includes(name)
            ? setupRefusals
            : name.startsWith("codex-")
              ? [
                  "state_unreadable",
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
              : name.startsWith("facade-")
                ? [
                    "paired_key_missing",
                    "invalid_original_key",
                    "invalid_claude_profile_root",
                    "state_unreadable",
                    "invalid_state_type",
                    "state_permissions",
                    "state_symlink",
                    "pairing_needed",
                  ]
                : [],
    ]),
  ),
);

# Source reliability integration inventory

This is a developer-preview integration, not a reliability certification or a
package release. The security fix is already public in [PR #69](https://github.com/Cairn-ink/cairn-memory/pull/69)
and [the advisory](https://github.com/Cairn-ink/cairn-memory/security/advisories/GHSA-42p4-q4pr-vpwf).
Historical private-hold notes below retain their original context.

## Reading order

1. Public PR52–68: current/history support, guarded reconciliation, MOC candidate
   reachability and preserved failed experiments.
2. S1–S7: qualified evidence, trusted manual transitions, bounded experiments,
   retained-source extraction and source-only recall context.
3. S8–S9: source-checkout installation and native Hermes explicit capture.

## Public PR heads to preserve

The table records fetched heads, not a claim that these PRs have been merged.
The final delivery verification must confirm every head is an ancestor. Keep
old PRs and branches intact until the integration is accepted.

| PR | Recorded head | Scope |
| --- | --- | --- |
| [#52](https://github.com/Cairn-ink/cairn-memory/pull/52) | `58e55a40045dd82e566c7f5d2d922967ee5ffa3c` | feat(core): retain superseded history and exclude it from current recall |
| [#53](https://github.com/Cairn-ink/cairn-memory/pull/53) | `c8279bb3e55eef8263fdb8d7eecfe942bdc4011c` | feat(core): reconcile source-ordered captures with atomic history |
| [#54](https://github.com/Cairn-ink/cairn-memory/pull/54) | `2b7e7bacc971162d2ba7085838721a3fd9b81c44` | feat(eval): explicitly authorize reconciliation in the shared budget guard |
| [#55](https://github.com/Cairn-ink/cairn-memory/pull/55) | `c581906a650d99fa4c5797c61a61ed39665ddf0b` | feat(eval): retain independently reviewed ordered memory history |
| [#56](https://github.com/Cairn-ink/cairn-memory/pull/56) | `0c5c68d8ea22c4475ab0151bf89dceb0fc8ad7f3` | feat(eval): freeze positive and negative currentness acceptance |
| [#57](https://github.com/Cairn-ink/cairn-memory/pull/57) | `a01f35bddc74fa60a62b69f3f339b10e0cc42178` | test(eval): verify installed ordered memory through cold MCP lifecycle |
| [#58](https://github.com/Cairn-ink/cairn-memory/pull/58) | `08b566fc6949f65148460e23919e49fcfb188fef` | test(eval): retain live currentness failure and installed MCP evidence |
| [#59](https://github.com/Cairn-ink/cairn-memory/pull/59) | `6c4d0a698d24c0ec299f85eeed304c6f550ea39d` | docs: define source-faithful memory reliability contract |
| [#60](https://github.com/Cairn-ink/cairn-memory/pull/60) | `cb5d31d32a62532d36663613cbb3451956259d6d` | feat(core): qualify reconciliation before retiring memory |
| [#61](https://github.com/Cairn-ink/cairn-memory/pull/61) | `fae2f08b8ed001d20faee2273a89427c174e4206` | feat(core): expose explicit retained historical evidence |
| [#62](https://github.com/Cairn-ink/cairn-memory/pull/62) | `0f1eebcae0d75d3098c8d1573bac25b499127174` | feat(mcp): expose keyless historical inspection filters |
| [#63](https://github.com/Cairn-ink/cairn-memory/pull/63) | `5dbf73c78d8c4b4196dd016db39a766b25a7da39` | test(eval): retain failed paired update-reliability comparison |
| [#64](https://github.com/Cairn-ink/cairn-memory/pull/64) | `f86dbb1bd3a197c2b1c0fb1c656b1532e1dc8b6f` | test(moc): expose candidate-visibility bottlenecks with lexical controls |
| [#65](https://github.com/Cairn-ink/cairn-memory/pull/65) | `b3429f1246c942b3b8adcb68e955d68abb7716c2` | fix(moc): separate classification catalog from memory volume |
| [#66](https://github.com/Cairn-ink/cairn-memory/pull/66) | `31dc319a69828c67a9d12c251ddf8c9e66c6772a` | feat(recall): rank bounded query candidates before pagination |
| [#67](https://github.com/Cairn-ink/cairn-memory/pull/67) | `033a6b2fc545908f352247a8db038e2ef544acb5` | fix(recall): keep retained history out of current candidate allowance |
| [#68](https://github.com/Cairn-ink/cairn-memory/pull/68) | `3512719a3c43c14354f76c31064d8d62666e97bf` | docs(core): define source-backed qualification and update gates |

PR59's contract was already cherry-picked into the feature chain; its original
head still needs ancestry integration. PR64 diagnostic additions and PR66's last
paired-evidence commit were not in the S9 chain and must be included explicitly.

## Local reviewed stages

Base/head abbreviations resolve in the preserved Git history. Every stage passed
its own independent Standards/Spec review on the recorded head. Those reviews
and per-stage verification are historical evidence, **not** final integration
gates; the latter are defined in [the delivery plan](plans/source-reliability-integration.md).

| Stage | Base → reviewed head | Specification / scope |
| --- | --- | --- |
| S1 | `3512719` → `ddd4468` | [Immutable source qualifications and Unicode integration](plans/claim-qualification-storage.md) |
| S2a | `ddd4468` → `b51be08` | [Trusted manual pair transitions](plans/qualified-transition.md) |
| S2b | `b51be08` → `2b1f838` | [Complete trusted transition sets](plans/qualified-transition-set.md) |
| S3a | `2b1f838` → `ffe301d` | [Opt-in v1 extraction and qualification](plans/automatic-qualification.md) |
| S3b | `ffe301d` → `d8be581` | [Explicit submitted capture over MCP](plans/mcp-qualified-capture.md) |
| S4a | `d8be581` → `ccb9316` | [Separate bounded experiment capability](plans/qualification-experiment-guard.md) |
| S4b | `ccb9316` → `7ddf791` | [Frozen one-shot v1 pilot](plans/qualification-pilot.md) |
| S4c | `7ddf791` → `a75f821` | [Preserved failure diagnostics](plans/qualification-diagnostics.md) |
| S5a | `a75f821` → `78fb7b9` | [Core-owned evidence candidate compilation](plans/source-candidate-qualification.md) |
| S5b | `78fb7b9` → `285dc40` | [Explicit v2 mode over MCP](plans/mcp-candidate-qualification.md) |
| S5c | `285dc40` → `133d327` | [Frozen v2 pilot](plans/candidate-qualification-pilot.md) |
| S6a | `133d327` → `4e85b25` | [Bounded qualification-aware recall](plans/source-qualified-recall.md) |
| S6b | `4e85b25` → `de47f02` | [Canonical descriptive labels](plans/candidate-label-canonicalization.md) |
| S6c | `de47f02` → `7766ffe` | [Extraction aligned with retained source prefixes](plans/retained-source-extraction.md) |
| S6d | `7766ffe` → `9a52e8e` | [Interpretation guidance, not a semantic guarantee](plans/qualification-interpretation-guidance.md) |
| S6e | `9a52e8e` → `b6df5ff` | [Fresh eight-case source-support experiment](plans/fresh-source-support-pilot.md) |
| S7 | `b6df5ff` → `39f2b2e` | [Separate source evidence from model interpretation](plans/source-evidence-context.md) |
| S8 | `39f2b2e` → `d958938` | [Install receipt preserves explicit capture mode](plans/qualified-install-receipt.md) |
| S9 | `d958938` → `acadccb` | [Native Hermes explicit capture](plans/hermes-qualified-capture.md) |

## What this does not establish

- Source receipts prove retained correspondence, not truth, authenticated human
  identity, consent, complete extraction, or correct model interpretation.
- The v1 pilot failed structurally; the later six-case v2 pilot had one rejected
  case. Five storage completions were not five semantic passes.
- The fresh eight-case pilot captured and recalled ten records, but independent
  review found false adoption, lost uncertainty and scope/source-selection errors.
  Its [frozen report](../evaluations/results/source-support-v1.json) is unchanged.
- Source-only recall prevents generated interpretations entering rank/final
  memory context. MOC selection still uses generated routing labels; selected
  sources may be incomplete and downstream answer quality is not measured here.
- Trusted manual claim-slot transitions are not automatic identity resolution.
  Recorded decision rationale and premise-challenge tracking remain unfinished;
  the system must not invent a new choice when an old reason is challenged.
- Installed SDK and scripted Hermes agent tests establish wiring, not natural
  tool selection or benefits measured with real users. No passive capture, public
  npm release, remote ChatGPT connector, or production deployment is included.


# Source-first ranking before bounded relationship expansion

Base: `bdc7be8a59b2a535144e1c851133a1fa970cc442` (dependent on PR160).
This is an opt-in availability correction, not a default change or measured
semantic improvement. The frozen decision-transition experiment stays unchanged.

## Observed problem

The existing rationale-neighborhood recall fetch expands every MOC-selected
candidate before ranking. A synthetic relevant root and unrelated root with six
distinct neighbors produce `rationale_limit` before rank runs. Removing that
unrelated candidate, reducing its neighborhood to five neighbors, or using
source-only recall reaches rank successfully. Do not weaken any graph cap.

## Acceptance

- SRF1. Add `rankingMode: 'source-evidence-first-v1'` only for recall with
  `contextMode: 'rationale-neighborhood-evidence'` and
  `sourceProjection: 'neighborhood-sources-v1'`, one namespace, no
  enabled includeQualification or selectionMode (explicit
  `includeQualification: false` remains valid). SDK and actual MCP reject unknown or
  incompatible combinations before any model callback. Existing defaults and
  existing rationale-aware ranking stay unchanged.
- SRF2. Keep the existing MOC selection, source-only candidate fetch and source
  ranking prompt and limits. Rank sees no inferred edges or expanded neighbors.
  After ranking, expand only the selected roots. No additional model callback,
  silent fallback, retry, truncation or cap increase.
- SRF3. In the authoritative final-read transaction, revalidate all candidate
  source snapshots and namespace epochs, including unselected candidates, then
  construct selected-root neighborhoods. Preserve revision/source/graph epoch
  fences, namespace isolation and all graph/source/output limits. No model or
  token-counter callback after this final read. An actually selected oversized
  root must fail explicitly; ignoring an unselected neighborhood must not hide
  stale candidate evidence or an epoch change.
- SRF4. Use the existing pure neighborhood source projector unchanged wherever
  possible. Return only its validated source DTO, with an explicit rankingMode
  marker included in existing serialized-output size enforcement. No graph or
  model interpretation leaks to the source-only answer consumer. The six-source
  union cap and 24,000-character projection bound stay unchanged.
- SRF5. Regression demonstrates existing route still fails the synthetic
  unrelated oversized-neighborhood case while new route reaches rank and returns
  the good root. Selecting the bad root still fails. Cover unselected source or
  revision mutation, namespace/graph epoch drift, selected-link/source mutation,
  union overflow, no graph in rank/output, empty selection, and invalid options.
  Tests must demonstrate their actual preconditions and preserve older tests.
- SRF6. Exercise actual installed MCP in a fresh temporary database, not only
  direct SDK calls. Generic tests, JSON/strict validation, full core/MCP/artifact
  suites and relevant store/MOC/recall examples pass on Node 22.16 and 24.15.
  Any evaluation/live modification additionally requires the full live-offline
  gates on both versions. No paid calls or real credentials/ledger access.
- SRF7. Document API combinations, changed ranking information and limitations;
  update changelog. This is a different whole read path, not an equivalent graph
  ablation. Do not claim a measured reliability improvement from scripted tests.
  Freeze the candidate and require independent Standards/Spec review and primary
  verification before push/PR. No merge, release or deployment.

## Ownership and evidence

Primary owns contract, integration acceptance and paid experiment separately.
One Sol/high worker owns implementation and scoped offline tests in this worktree.
Record final candidate, commands, results and any corrections here before review.

## Implementation and verification record

Worker: Sol/high, isolated `feat/source-rank-first` worktree at fixed base above.
Entrypoints are SDK `core.recall` and installed local MCP `recall_memory` only.
The orchestrator's fetch mode and rank prompt change only under the validated
opt-in; its existing callers, ordinary RN projection, source-evidence recall,
and MOC selection remain unchanged. The final runtime read validates all
source-only candidates before expanding ranked roots in the same transaction.
The source-only answer consumer still receives the existing pure projector DTO.
No browser route, URL replay, copy selector or evaluation/live entrypoint changes.

The focused core test owns SRF1–5: it proves the bad root's six-neighbor overflow,
the ordinary pre-rank failure, source-only rank input and exact source prompt,
selected-root failure, unselected/selected source and revision invalidation,
epoch/link drift, seven-source selected union overflow, empty rank, and no
post-finalize model/token callback. The installed artifact MCP test owns SRF6:
fresh synthetic database, actual stdio schema and rank, with select/rank logs
proving invalid requests invoke neither callback. Existing RN/MCP/artifact
tests cover unchanged defaults and existing output projection bounds.

On final test content, Node 22.16 and Node 24.15 each passed 143 generic tests,
717 core tests, 73 MCP tests and 72 installed-artifact tests, plus JSON and
strict Claude plugin validation and the store, MOC and recall demos. Node 24
commands used its binary for direct commands and a Node-24-first `PATH` for
`npm` scripts and nested processes. Dependency and metadata-cache preparation
used isolated local tooling; all test stores were synthetic temporary paths.
No provider key, paid call, shared ledger or evaluation/live file was used.
The opt-in installed test and core test also passed individually on Node 22
after the final test assertions. These scripted checks establish availability and safety behavior,
not semantic ranking quality or a measured reliability improvement.

Candidate SHA is reported with the scoped local commit. Primary fixed-point verification and
independent Standards/Spec reviews remain required before push or PR.

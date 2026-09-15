# Retention inside ordinary MOC: fresh comparison protocol

Status: the [once-only results](retention-moc-results.md) are now recorded; no
default was promoted. The original protocol below remains unchanged. The
[fixed-candidate result](small-candidate-results.md) found a useful changed-premise
improvement, but did not exercise ordinary selection or inferred capture. This
protocol tests that remaining boundary without promoting a default.

## What changes, and what does not

Use the existing multi-window driver unchanged. Six new histories form three
matched pairs, with three capture windows each. Every window has five user
messages and one assistant message. Paired histories differ in one user qualifier
and share a question. Complete canonical source text, roles, IDs, questions and
rubric are frozen before scoring; include one Traditional Chinese pair.

Run eighteen once-only ordinary capture operations with source-bound candidate
qualification, classification, cold staged/admitted inspection and the existing
bounded source snapshot check. Do not pad admissions, repair omitted extraction,
or silently substitute original transcript text into ordinary recall. Record
actual admitted counts and whether the twelve-memory snapshot limit is exceeded.

Both recall arms use those same captured stores and ordinary MOC selection.
Baseline uses ordinary ranking. Candidate replaces only rank with
`createSmallCandidateRetentionModel`, keeping selection and all existing bounds.
A private comparison sidecar adds the candidate without replacing the driver's
baseline or complete-source control. Alternate arm order across histories.

Selection runs independently in each arm; it is not replayed. Record each actual
selection request/result and pre-wrapper rank input, including the candidate
input when ranking is skipped. Attribute a difference specifically to small-set
retention only when ordered fetched candidates/revisions match and fit limit6.
Unmatched inputs remain end-to-end differences involving selection variability.
Report cases where the policy is inapplicable rather than forcing eligibility.

## Negative queries and answer boundaries

Two separately frozen queries, one English and one Chinese, ask for information
not established by their bound history. Both arms independently query the same
unchanged final stores. Only the question reaches the model;
`expectedUnknowns` is review-only. Missing evidence must not become invented
facts, authorization, denial of authorization or a fabricated agreement.

Successful empty recall still receives an ordinary answer. Failed recall leaves
its answer slot not run. Six canonical complete-source answers remain explicitly
labelled controls and are never replacements for failed retrieval. In total,
retain twenty-two answer slots: six baseline, six candidate, six canonical and
four negative-query arm slots. Preserve unavailable responses and failures;
never regenerate them or adjust the rubric after scoring begins.

## Ceiling and safety gates

At most three generation/count pairs per capture: extraction, batched candidate
qualification and classification. At most three pairs per recall: two selection
rounds and ranking. Eighteen captures plus sixteen recalls therefore allow at
most102 generations and102 provider input-count requests, plus22 ordinary host
completions: **226 provider HTTP requests**. Inspection and local proxy requests
are not provider calls. At current reservations the maximum is **US$2.12**;
the proposed local ceiling is **US$3 within the existing cumulative US$50**.
Validate these method/phase ceilings against the actual operator before freezing.

Reuse existing source-support/candidate-qualification authority and the ordinary
host guard on one durable ledger. Do not issue a new grant, replenish a failed
slot or treat unknown count costs as free. Keep the real provider key in the
explicit parent transport; a required child gets only a random loopback proxy
token. Never inherit older credential-environment shortcuts.

Before paid execution: final clean source/dependency/operator pins; root
dual-runtime checks; independent exact-commit reviews; all17 CI; frozen failure
rehearsals; exclusive run intent; unchanged-grant/budget preflight. The operator
must retain available bounded raw responses before interpretation and stop
future dispatch on transport, pin, accounting or cleanup failures. This protocol
does not itself run or authorize an operator.

## What the result must show

Separate retained staging, qualified admission, map visibility, selected sources,
ranked sources and ordinary answers. Track required and irrelevant source IDs,
decisive qualifiers, changed and reaffirmed reasons, missing evidence, policy
eligibility, exact versus unmatched paired candidates, context bytes/tokens,
calls, latency and conservative costs. Do not turn correct source IDs or
completed transport into semantic accuracy.

Use root and independent content review with explicit nonblind/same-family and
author-overlap disclosures. Source-built experimental stdio is not proof of an
installed package or natural host-client integration. These authored histories
are not a general benchmark, real-user study or basis for automatic promotion.
No release, deployment or commercial/private integration is included.

Acceptance: [plan](plans/retention-moc-comparison.md).

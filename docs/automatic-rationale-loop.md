# Opt-in automatic proposed rationale

The embedded core and local MCP preview can now connect **submitted capture** to
proposed rationale and linked-source recall. This is not passive transcript
capture, proven semantic reliability, a hosted release or an upstream Hermes
integration. It uses the same SQLite core and MOC candidate policy.

## Try the local preview

Build/install the private preview as described in [installation](install-artifact.md),
then add these flags to its existing database/owner command:

```sh
cairn-memory --db /absolute/path/memory.sqlite --owner local-user \
  --capture-qualification source-bound-v2 --capture-rationale source-bound-v1
```

Supply `OPENAI_API_KEY` through the client's protected process environment, never
arguments, source files or version control. Submitted capture sends bounded
retained text to the configured provider. The ordinary preview does not impose a
spending cap. Allow **at least 180 seconds** for opted-in capture: extraction,
qualification, classification and rationale each have a 30-second core timeout,
plus local work. Actual duration/cost depend on the model. No retries are added.
Configuration checks only validate syntax; they do not prove access or readiness.

Use `capture_memory` twice, with different batch IDs:

1. `I chose A because it supports offline work.`
2. `I checked: A cannot work offline.`

Then call `recall_memory` with a relevant question and
`contextMode: "rationale-evidence"`. If the model proposed appropriate links, the
decision's context includes its supporting and challenging sources, even when
the challenge itself was not selected by MOC recall. A single receipt can record
both decision and reason; a separate invented premise memory is not required.
An incoming challenge can also be exposed directly without a separately stored
support edge.
`inspect_rationale` reads this evidence keylessly using an inspected memory ID
and revision. Existing source-only and default modes remain available.

This is an **illustration, not a promised model result**. Inspect actual excerpts.
`reconfirmation-suggested` means a model-proposed challenge is present in the
decision context, possibly without a separate support edge; it does not prove
the premise false, cancel A or adopt B. `unassessed`
does not mean confirmed. All submitted roles, text and proposed relationships
remain untrusted evidence, never instructions or execution permission.

## What happens during capture

After saving and attempting classification, the optional pass rereads guarded
admitted revisions. It prioritizes all admitted memories, then fills at most six
slots from the existing query-aware MOC candidate path. That path uses generated
memory content and literal word overlap, scans at most 1024 current records and
respects active index authority. The query uses up to 4000 UTF-16 units of
canonical retained source text. It can miss paraphrases and important sources;
the response reports query/candidate truncation, scan exhaustion and unassessed
semantic coverage. Filling the window can include irrelevant candidates.

One `relate` model call receives only local indices and complete retained source
excerpts/roles. The baseline adapter uses a request-scoped strict schema and the
existing count/generate framing; strict JSON structure does not establish correct
meaning. See [official Structured Outputs guidance](https://developers.openai.com/api/docs/guides/structured-outputs).
Core still checks endpoint/receipt correlations and snapshot freshness before an
atomic write. No generated summary or client/owner/session/event ID enters this
new model stage. Memory content still influences earlier candidate selection.

The capture response includes a separate `rationale` status:

- `reviewed`: the bounded pass completed, possibly with zero edges; not semantic approval.
- `failed`: memories were already saved; this additional pass failed. Do not invent
  another capture batch ID to retry it.
- `skipped/empty`: no admitted memories to review.
- `not-run/duplicate` or `not-run/processing`: no repeated model calls; previous
  rationale outcome is unavailable, not replayed as success.

This stage is best-effort **after** admission. A crash can leave saved memory
without rationale; there is no pending-job recovery queue yet. An explicit
embedded `reviewRationale` can be used by a trusted host to re-evaluate current
refs, but it may incur another model call. Its default append-only mode does not
retract prior links on empty output. Trusted embedded callers may explicitly pass
`writeMode: 'replace-reviewed'` to replace only links with both endpoints in
their guarded reference set. The separate local MCP
`--rationale-review replace-reviewed-v1` opt-in exposes this same correction
through `review_rationale`; automatic capture still never uses it. A mistaken
new proposal can remove a correct old link. Correcting
or forgetting source evidence invalidates related links.
MOC placement now preserves valid proposed links across filing-only revisions
with unchanged content and complete retained receipts; other revision changes
still invalidate them. This does not validate the proposals' meaning.

## Read limits and compatibility

`rationale-evidence` supports current memories only and conflicts with
`includeQualification: true`. The full root and linked-source graph counts toward
the existing 4000-token fetch / 6000-token rank-input bounds. Oversized context
fails explicitly rather than silently dropping reasons or challenges. Cursors
bind the selected mode. The final atomic read verifies all candidate graphs
after the last callback, including unselected roots and linked sources.

The extra MCP inspection tool appears only with explicit rationale configuration
or the independent correction opt-in;
existing five/six-tool modes are unchanged. No installer receipt flag or Hermes
profile option is added in this slice: configure the local MCP command explicitly.
Do not silently enable it in a Hermes configuration with the older timeout.
There is no historical rationale reconstruction, adjudication UI, claim-slot
identity solver or authority derived from memory.

## Evidence

Scripted core and real SDK tests cover the two-message loop and failures. An
installed-package test uses the actual core, OpenAI adapter and MCP stdio with
fake HTTP: two capture batches (16 HTTP callbacks), rationale recall (4), cold
keyless inspection/replay and forgetting (0). These validate integration and
retention, not model accuracy or natural host tool selection. The new method is
not granted by existing paid experiment capabilities. A frozen fresh live
comparison is a following gate; no new benchmark score is declared here.

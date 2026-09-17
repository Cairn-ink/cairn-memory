# Opt-in source-only neighborhood result

An embedded SDK caller can request the original retained sources from an RN
recall without returning its unverified relationship graph:

```js
await core.recall({ readSet: [namespace], query: 'Why did we choose A?',
  contextMode: 'rationale-neighborhood-evidence',
  sourceProjection: 'neighborhood-sources-v1' });
```

The same optional fields are accepted by local MCP `recall_memory`. Omission
preserves every existing response. The option requires one read-set namespace,
ordinary selection (no `selectionMode`), and no qualification inclusion. It
does not apply to `fetch`. Unknown or incompatible options fail before any
model call. The result has `sourceProjection: 'neighborhood-sources-v1'` even
when `memories` is empty, plus the existing complete coverage and namespace
traversal metadata. Each memory is a canonical source DTO with current ID and
revision, complete receipt IDs, claimed roles and exact retained excerpts,
receipt count, and omission/unassessed markers. No graph edge, rationale
status, generated summary, basis unit or qualification interpretation appears
inside the projected memories.

This is an output projection, not a new retrieval strategy. MOC selection is
unchanged; the RN ranker still sees the same bounded unverified relationship
proposals as ordinary RN recall. The engine authoritatively rereads all selected candidates,
checks epoch and source correspondence, then makes a pure stable root-first
union of each selected root and its already-returned neighborhood sources.
Identical source copies deduplicate; conflicting copies fail. It makes no
additional model call, source fetch or write. It does not refresh the result
after an arbitrary delay in the caller. Linked sources are read within the
same namespace as their selected root; the first version rejects multi-
namespace SDK read sets instead of coalescing authority domains.

Only complete map/fetch traversal is accepted. The union has at most six
unique current memories and a `JSON.stringify` projected-value ceiling of
24,000 JavaScript UTF-16 code units. Existing per-source, relationship,
fetch-token, rank-token and model-output bounds still apply. Partial, stale,
malformed or oversized results fail without truncation, retry or fallback to
the graph-bearing result. The projected DTO is original source evidence, not
verified truth, authenticated speaker identity, correct relevance, adoption,
or permission to act. A wrong relationship may still have influenced ranking.

## Optional source-evidence-first ranking

For the same RN projection, embedded SDK and local MCP callers may additionally
set `rankingMode: 'source-evidence-first-v1'`:

```js
await core.recall({ readSet: [namespace], query: 'Why did we choose A?',
  contextMode: 'rationale-neighborhood-evidence',
  sourceProjection: 'neighborhood-sources-v1',
  rankingMode: 'source-evidence-first-v1' });
```

This mode requires exactly the combination above: one namespace, ordinary
selection, and no qualification inclusion (explicit `includeQualification: false`
is allowed). Unknown or incompatible values fail
before a model callback. Omission preserves the earlier RN ranking behavior.
The response includes the explicit `rankingMode` marker, including for an empty
rank selection; that marker counts toward the 24,000-character output ceiling.

MOC selection and candidate limits are unchanged. Each selected MOC candidate
is fetched as complete source evidence, without relationship expansion, and
the existing source-evidence prompt ranks those candidates. After rank, one
authoritative transaction checks every candidate's revision and source snapshot
and the namespace index epoch, then expands only the ranked roots. The existing
pure projector makes the final source union. No model or token counter is called
after that transaction. A selected oversized root or combined union still fails
whole; an unrelated unselected oversized neighborhood no longer blocks rank.
There is no retry, truncation, fallback, cap increase or claim that source-only
ranking has equivalent relevance to relationship-aware ranking. It is a
different whole read path, and scripted tests do not measure answer quality or
reliability. The returned evidence remains untrusted and semantically unassessed.

The evaluation-only [NC answer adapter](neighborhood-source-answer-delivery.md)
continues to accept an ordinary RN MCP result and separately enforce its
answer-request byte limit. It now shares the core source-union validator; it
does not define the product contract or grant provider access. The earlier
natural comparison stopped after six answer arms with two unrun, and does not
establish a general answer-quality gain from this new option.

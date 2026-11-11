# Local engine defaults

Installer 0.6.6 `setup --local` installs automatic plaintext conversation Raw
capture by default, without a key or model calls. Each selected client gets one
notice. Both clients share the 200,000,000-byte cap and the MCP database/namespace.
Use `setup --local --no-capture` or `config --local-capture off`; enable with
`config --local-capture on` (optionally `--client claude|codex`). Off removes hooks
and keeps data. Status is read-only and shows on/off/blocked with the reason.
Codex requires approval in `/hooks`; if its format is unqualified, capture waits
for qualification with its hooks installed. After a Codex update, capture resumes
once background qualification passes; rerun setup if it stays pending or failed.
Status reads the engine's last observed qualification state and reason without
launching qualification. New Claude sessions capture from their first turn.
A fork or resume of a hidden conversation stays hidden; Codex forks aren't saved
locally. Re-enabling skips off-period text and,
for an already-running Claude Code conversation, the first turn after re-enabling.


Forgetting or correcting a memory hides conversations with messages within
30 minutes before or after when it was saved. This can hide unrelated
conversations and miss others about the same subject. To remove a conversation:

```sh
npx @cairn-ink/memory raw list [--client claude|codex]
npx @cairn-ink/memory raw delete <conversation-id> [--yes]
```

List prints metadata only, never text. Delete requires one explicit id without
wildcards and previews counts, client and time range by default. `--yes` deletes
the selected conversation. Unknown ids fail without changes.

Deletion removes the conversation's Raw messages and index rows and its Episodes, and invalidates dependent Cards under the existing lineage rule. Confirmed authored Card bodies may remain stored. Re-sent copies (fork, resume or cursor reset) are not archived again. Extracted Memories are kept; use each Memory's own forget operation to remove it.

The installer uses its installed
MCP database/owner/project; cloud mode or absent local installation is refused.

`raw delete <conversation-id> --yes` finishes in one command and shows progress
counts. The command retries automatically for up to about 10 minutes. If it stops before completion, run the same command again to continue.
While a large conversation is being deleted, saving in other sessions
pauses and catches up afterwards: about 11–15 seconds for a 10,000-message
conversation in the concurrent-saving workload described in the
[local Raw guide](raw-local-journal.md).

Several sessions saving at once no longer stop one of them from saving. Default
reads keep the Raw excerpts they already validated when a read reaches its time
limit, marked partial, instead of dropping them.

**Search catches up after saving.** Each turn is saved to the local store as soon as it ends. Raw search covers a newly saved conversation only after the local index reaches it. That indexing runs while Claude Code or Codex has the Cairn MCP server open: a few minutes for about 1,000 saved messages, about an hour for 10,000. While you keep working, each new save restarts the indexing pass, so a conversation saved during a busy session may not be searchable until you pause. Until the index has caught up, search reports partial coverage instead of claiming it found everything. Memories, and conversations the index already covers, are not affected and stay searchable as before.

Known limits in this release:
- While new turns keep arriving, the local MCP server keeps indexing: about one small index write per second and roughly 3% of one CPU core.
- Histories of about 50,000 messages or more may never finish indexing; search keeps reporting partial coverage for them.
- Searches served by a reader that doesn't run index maintenance itself, such as keyword-only searches when an embedding model is configured, can keep reporting partial coverage even after indexing has finished. Their results are still returned.
- A later release indexes newly saved conversations first.

Going back to 0.6.5: an attested base-33 store with card lineage revision 1
(physical 53, lineage 1) that 0.6.6 opened with Raw on is refused with
`unsupported_database`; reinstall 0.6.6 to recover access. Attested lineage-0
and ordinary local stores open in 0.6.5. Captured Raw stays searchable, with
eligible excerpts readable through contextRead. Hidden conversations stay hidden
in both current and history Raw search because 0.6.5 enforces the existing
`raw_session_fences` rows. The new local tables remain intact and are ignored.
0.6.5 itself does not capture automatically, so its engine does not use the new
hide windows or fork fences for capture. Old setup leaves 0.6.6 hooks registered
with their retained engine; turn capture off with 0.6.6 before downgrading to
stop them.

A local install retains submitted captures as Raw and maintains a searchable
index. The MCP server exposes `find_memory_candidates`,
`fetch_memory_candidate_evidence`, and `read_memory_context` alongside the old
recall tools. Prefer these contextRead tools for memory reads. The default dated read
combines Memory with eligible Raw evidence; its default budget is
6,000 local tokens and 24 items.

These defaults apply to the ordinary local MCP server, including the engine
registered by `setup --local`. Library `openMemoryCore({path})` keeps Raw off;
select `raw:true` for the local Raw composition and its default search lane.
Local foreground setup can select Raw-only capture with interpretation consent
false and plaintext Raw/foreground consent true. It saves Raw and advances turns
without a key or provider. Its daily model-cost cap does not apply; the owner
Raw cap does. See [local setup and hiding rules](raw-local-journal.md).
Omission and `raw:false` both keep library construction Raw-free. Library
contextRead still requires an explicit authority configuration. These defaults
do not install a transcript hook, start capturing a conversation, or enable hosted processing.
Only messages actually submitted to capture enter Raw. The separately selected
retained-profile server is a read-only host with its own authority boundaries.

| Capability | What it does | Default | Cost | Programmatic option / CLI switch |
| --- | --- | --- | --- | --- |
| Raw retention | Saves submitted capture messages through the Raw journal, with lineage and existing exclusion/forgetting controls | On in MCP and the installer; off in the library | Local plaintext disk, default 200,000,000-byte owner cap; no extra model call | MCP `raw:false` / `--no-raw` disables retention. Library callers enable it with `raw:true`; omit or use `raw:false` to disable. For a custom cap, sealing port or policy, use `rawConversations:{mode:'raw-v1',capBytes,port,readPolicy}`. `mode:'off'` disables saving while retaining management APIs. |
| Raw search | Searches retained Raw with BM25 plus semantic similarity fused by RRF when a provider is configured, using a separate derived index and canonical authorization checks | On when Raw retention is enabled; BM25 only without a provider or while vector coverage is partial | Local plaintext postings, metadata and vectors, up to 512 MiB per index; semantic queries and background Raw embedding use the shared embedding budget | `rawSearch:false` / `--no-raw-search`; omit to enable. Turning Raw off prevents new saving; existing retained data is not erased. |
| Raw maintenance | Builds and refreshes the index after captures, with bounded background work | On with Raw search | One non-overlapping quantum per second, up to 16 rows / 25 ms; existing one-second publication cadence still applies | Follows `rawSearch` / `--no-raw-search`. `close()` stops scheduling and joins work. Capture never waits for index publication. |
| contextRead tools | Finds candidates, refetches evidence and assembles bounded memory context | On in MCP | Local reads and tokenizer work; no language-model call | MCP option `contextRead:false` / `--no-context-read`; enable with `contextRead:'context-read-v1'` / `--context-read context-read-v1`. Core hosts supply `contextRead:{version:'context-read-v1',authority,counter,...}` to bind their own read authority. |
| Three-layer read | Returns Memory plus eligible Raw excerpts with dates | On for the default contextRead presentation | Local reads and a 6,000-token / 24-item response budget; no model call | Follows contextRead; `--no-context-read` removes the tools. There is no separate presentation CLI flag. |
| Semantic search | Adds embedding similarity to lexical candidate search | On in MCP when `OPENAI_API_KEY` is configured; otherwise BM25 only | Query and background document embedding calls. Automatic OpenAI configuration: `text-embedding-3-small`, 1,536 dimensions, US$1 estimated embedding spend per server process shared by Memory and Raw, concurrency 1; no practical automatic request ceiling | `contextSemantic:false` / `--no-context-semantic`; each read can also set `semantic:false`. Core hosts supply `contextRead.embedder` and `policy`; MCP hosts supply `contextEmbedding`. Explicit provider CLI groups override automatic settings. |
| Dated reads | Labels evidence with its event date rather than relying only on generated summaries | On for the default contextRead presentation | Local timestamp reads; no provider calls | Follows contextRead; core callers can select `representation:'representation-v2'` for the legacy undated representation. No separate CLI flag. |
| Event time | Ordinary capture keeps its receive-time fallback for missing `occurredAt`; an explicit canonical UTC instant wins | On for ordinary capture and Raw capture | Timestamp metadata only | Set message `occurredAt` to assert event time. Session range metadata separately marks missing real event time and conservatively matches any local hide window. Legacy sessions without a range row are filled from their own messages and marked conservatively unknown. |
| Ordered reconciliation | Reconciles successive captures in a caller-declared causal stream | Off | One additional model call per capture that requires reconciliation | Caller supplies `causal:{streamId,sequence}` to `capture()`; omit to disable. MCP has no causal-sequence flag or argument. |
| Relation read sources | Adds eligible one-hop relations as retrieval sources | Off | Bounded local graph reads; no extra model call during reads | Core `contextRead.sources:['relations-one-hop-v1']`; MCP `contextReadSources:['relations-one-hop-v1']` / `--context-read-sources relations-one-hop-v1`. Omit to disable. |
| MOC read sources | Uses maps of content to find evidence | Off | Bounded local organization reads; no extra model call during reads | Core `contextRead.sources:['moc-v1']`; MCP `contextReadSources:['moc-v1']` / `--context-read-sources moc-v1`. Omit to disable. Both source IDs may be selected together. |
| Old recall | Lets a model browse a catalog and rank current memories | On, available alongside contextRead | Selection/ranking model calls; needs a model provider and has its existing budgets | Core `recall()` / MCP `recall_memory`. Use the contextRead tools to avoid those recall model calls. There is no separate tool-removal switch. |
| Submitted source-qualified capture | Extracts, qualifies and files explicitly submitted messages | Off in MCP; core `capture()` remains callable | Extraction, qualification and classification model calls when configured; Raw disk retention is independent | `captureQualification:'source-bound-v1'` or `'source-bound-v2'` / `--capture-qualification source-bound-v1` or `--capture-qualification source-bound-v2`; omit to remove the MCP capture tool. |
| Staged capture evidence | Keeps bounded capture evidence for inspection and recovery | Off | Local disk, bounded 24-hour evidence retention; no extra model call for staging | `captureEvidence:'staged-v1'` / `--capture-evidence staged-v1`, requiring source-bound-v2 capture. Omit to disable new staging. `captureEvidenceAccess:'staged-v1'` / `--capture-evidence-access staged-v1` enables only management tools. |
| Proposed rationale | Adds a proposed rationale pass after source-qualified capture | Off | Additional bounded model work and stored rationale | `captureRationale:'source-bound-v1'` / `--capture-rationale source-bound-v1`, requiring source-bound-v2 capture; omit to disable. |
| Classification recovery | Inspects capture admission and explicitly classifies inspected unfiled memories | Off in MCP | Inspection is local; explicit classification calls a model | `classificationRecovery:'guarded-v1'` / `--classification-recovery guarded-v1`; omit to disable these tools. |
| Whole-source snapshot tool | Reads a bounded current-admitted source set without ranking | Off in MCP | Local reads and token counting; no provider call | Server `sourceSnapshot:'current-admitted-v1'` / `--source-snapshot current-admitted-v1`; omit to remove the tool. Core `sourceSnapshot()` remains available. |
| Legacy source-only recall presentation | Returns retained receipts instead of generated summaries in old recall | Off | Existing model-guided recall costs plus larger source responses | Server `recallContext:'source-evidence'` / `--recall-context source-evidence`; omit to disable the default. Core/per-call `contextMode:'source-evidence'` selects it for one call. |
| Session interpretation access | Reads and manages retained session interpretations and next steps | Off in MCP | Local reads; token counting for start context | `sessionEpisodesAccess:'episode-v1'` / `--session-episodes-access episode-v1`; omit to remove the tools. |
| Session interpretation generation | Interprets messages from a separately trusted producer | Off | Additional interpretation model calls and bounded retained evidence | Core `sessionEpisodes:{mode:'episode-v1',draftEveryBatches:8}` with source-bound-v2 capture and staged evidence; omit to disable. MCP `--session-episodes episode-v1` records configuration but does not install that producer. |
| Private authored Cards | Reads, drafts and organizes authored Cards with supporting sources | Off for authoring tools; eligible retained Cards can be read through authorized contextRead | Local plaintext disk and reads; no automatic model call | Server `privateCards:'local-v1'` / `--private-cards local-v1`; omit to remove authoring tools. Core hosts configure a `privateCards` authority port. Local confirmation uses its separate terminal review. |
| Method packages | Stores and reads reusable method text and bindings | Off | Local plaintext disk; no execution or model call from reading a method | Server `methodPackages:'local-v1'` / `--method-packages local-v1`; omit to disable the tools. Core hosts configure a method-package authority port. |
| Assets | Stores asset versions and reads bounded derivatives | Off | Local blobs, derivatives and processing; no automatic model call | Server `assets:'local-v1'` / `--assets local-v1`; omit to disable the tools. Core hosts configure an asset authority port. |
| Role profiles | Resolves role-bound methods and role context | Off | Local profile storage and reads; no extra read-time model call | Server `roleProfiles:'local-v1'` / `--role-profiles local-v1`, requiring method packages and contextRead with matching read sets; omit to disable. |
| Card method dependencies | Reviews authored Card dependencies on method versions | Off for authoring; existing declarations remain enforced | Local dependency records and reads; no model call | Server `privateCardCurrentDependencies:'local-v1'` / `--private-card-current-dependencies local-v1`, requiring private Cards and method packages; omit to disable authoring tools. |
| Personal reads from a project server | Expands the fixed read set to the same owner's personal namespace | Off | More eligible local data; configured semantic refresh may embed that data | `contextReadPersonal:true` / `--context-read-personal`; method reads use `methodReadPersonal:true` / `--method-read-personal`. Both require project scope; omit to keep project-only reads. |
| Local embedding model | Uses an explicitly installed local embedding pack | Off; no model is downloaded automatically | Local model disk and CPU; no embedding API charge | Use the complete `--context-embedder local` group, or supply a local `contextRead.embedder` and policy. `--no-context-semantic` disables semantic reads; see [the local model guide](local-embedder-bge-m3.md). |
| Memory decision review | Holds selected inferred decisions for explicit review | Off | Local review metadata; existing capture model work | Core `decisionReview:'required-v1'`; omit to disable new review holds. There is no MCP startup flag. |
| Attested content-safety layout | Enables the separately versioned content-safety schema and suppression facts | Off for new stores unless explicitly selected; installed protections remain enforced | Local schema/fact metadata; no provider call | Core `contentSafety:'s2h-v1'` for supported new stores; existing stores use the explicit offline safety migration. There is no default-on migration CLI flag. |
| Automatic transcript hooks | Submits selected conversation messages without an explicit MCP capture call | Off in the standalone MCP server | When separately installed: Raw disk plus configured capture model calls | No MCP flag installs hooks. Installer `setup --local` installs Raw-only hooks by default; use `--no-capture` or `config --local-capture off\|on`. Standalone engine setup remains separate. |

For local Raw selections, forget/correct terminally hide every source session
whose event-time range overlaps ±30 minutes around an old receipt's creation
time, plus every real receipt-named session. This includes concurrent sessions
and can hide more than the affected memory. Permanent content-free namespace
windows also fence later arrivals; both Raw search intents enforce the fence.
Hiding anchors on when the memory was saved or corrected; the saving turn
normally has a captured message nearby. A conversation with no captured message
near that time, no range crossing the window and no named receipt is not hidden.
Use `raw delete` to remove it. This is a known limit for delayed memory saves.

If an existing attested layout cannot hold the Raw capabilities, `raw:true`
opens Memory-only and reports `raw:'unsupported_store'` in Raw search status;
contextRead diagnostics report the same Raw coverage reason. The failed Raw
attempt closes its handle and rolls back before reopening. Corrupt, foreign or
otherwise unsupported databases still fail; explicit `rawConversations`
profiles retain their existing refusal behavior. No Raw index is started for
these Memory-only stores.

Default Raw retention supports `claude-code` and `codex`; other clients capture Memory as before without retaining Raw.

Raw and its derived index are local plaintext by default, including vocabulary,
metadata and any vectors in sidecars. A custom Raw sealing port changes Raw
storage, not the plaintext nature of the local search index. Keep the database,
sidecars and backups private. Excluded, suppressed, forgotten or unauthorized
Raw must never be delivered; owner and namespace boundaries apply to both Raw
and Memory. Turning a feature off stops future work and does not erase retained
files or backups.

The embedding budget is process-local, shared by Raw document refresh, Memory
refresh and query embeddings for the same provider ID and revision. It is not
persisted and does not reset each day; restarting the server creates a fresh
allowance. Reopening a store in the same process does not reset it. It is not an
account-wide spending cap. Automatic configuration keeps the US$1 estimated
spend cap and uses `Number.MAX_SAFE_INTEGER` for the request ceiling, replacing
the previous 1,000-request limit so ordinary daily capture does not exhaust a
small lifetime request allowance. Explicit provider request and dollar limits
remain supported.

At a request or dollar limit, further provider dispatch is refused with
`budget_denied`; existing data remains available through BM25. Raw semantic
search requires current vectors for every scoped row and uses BM25 during
catch-up. `getRawSearchStatus({namespace})` exposes the last search's semantic
state/reason and the embedding limits, their process scope and their shared
Memory budget. Read diagnostics identify budget refusal when query embedding
is denied. Raw and Memory can embed the same source separately; both document
calls and semantic query calls count toward the shared cap. Without a key, startup and
BM25 reads need no provider and make no embedding calls. The installer does not
copy credentials into registrations or generated files. `--check-config` makes
no provider request and does not open the database.

For a minimal keyless server:

```sh
node adapters/mcp/cli.mjs --db /absolute/private/memory.sqlite --owner local-user
```

For local reads without Raw retention or embedding calls:

```sh
node adapters/mcp/cli.mjs --db /absolute/private/memory.sqlite --owner local-user \
  --no-raw --no-context-semantic
```

See [context reads](context-read-local.md), [Raw retention](raw-local-journal.md),
and [standalone MCP](standalone-mcp.md) for the detailed API and control contracts.

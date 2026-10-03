# Private mixed result journal

The public evaluation runner can explicitly retain terminal arm results before
the next arm starts. This is an observation mechanism for a future separately
frozen operator. It does not recover answers from the interrupted older run,
modify that private operator, resume a consumed cohort, retry requests, settle
its ledger, expose evaluator material or authorize spending.

## Explicit API

Create one fresh journal for one process-local prepared comparison, then pass
the same handle through generation and scoring:

```js
import { createMixedResultJournal, inspectMixedResultJournal }
  from '../evaluation/longmemeval/mixed-result-journal.mjs';

const resultJournal = createMixedResultJournal({ directory, prepared });
const generationReport = await runMixedGeneration({
  prepared, guard, apiKey, cairnStoreRoot, resultJournal,
});
const scoringReport = await scoreMixedGeneration({
  generationReport, evaluatorRows, referenceRenderings, guard, apiKey, resultJournal,
});
```

`directory` must be an absolute canonical fresh path beneath an existing
owner-private 0700 directory. Existing paths, symlink ancestors, nonprivate
parents, malformed options and other prepared/report object identities fail
closed. The handle is process-local and one-shot: generation must precede
scoring, and each phase can start only once. A frozen JSON copy or inspected
report cannot replace the actual generation return value for that handle.
Omitting `resultJournal` preserves existing behavior and report schemas. An
own `resultJournal: undefined` is invalid rather than silently disabling it.

The journal is separately versioned `cairn-lme-mixed-result-journal-v1` and
binds the existing manifest, roster, fixed N, question IDs and case/arm order.
Its manifest selects exactly one supported family: legacy mixed-source v2 or
explicit supplied history. Context/scorer identities are recomputed for its
native configuration and qualified/indexed-evidence capture profile; the full
Mem0 wire profile must equal the supported immutable profile. That same private
family determines both phase schemas and every generation digest domain.
Legacy identity, report and journal bytes remain unchanged. The writer also
checks the corresponding preparation schema before publishing anything; cold
identities have no preparation schema, so inspection never invents one or emits
a new family field. SHA-shaped arbitrary/incoherent protocol identities that
were formerly accepted now reject. Opaque answer, adapter and artifact hashes
still declare inputs; this does not authenticate absent original source data.
All authority,
source policies, prompts, model settings, guard validation, evaluator separation,
failure reasons and fixed-N denominators retain their existing behavior.

The journal also composes with the existing explicit generation observations:
`phaseTiming: 'bounded-tail-v1'` and `recallWitness: 'bounded-v1'`. Their
bounded diagnostics are retained in the terminal arm and completed generation
report after the existing observer close/disposal boundary. Transport failure
observations and capture classification diagnostics retain their existing
meaning. Omitted journal and omitted observation options keep their existing
behavior; enabling these observations grants no additional execution authority.

Generation diagnostics also accept optional `nativeFailure` only on a failed
Mem0 execution arm (`stage: 'execution'`). It has exactly version 1, a runtime
or gateway layer, and a finite reason from the shared native observation shape.
Unknown/extra fields, unsupported versions, layer-mismatched codes, success and
Cairn contexts fail on writes and offline reads. The typed runner projection
retains no exception payload; schema-valid inspected JSON is not proof that a
genuine exception occurred. This category remains separate from the outer halt
and transport branch observation. A globally halted phase can retain it without
dispatching the later arm, resolving unknown costs or permitting scoring.
The shared shape validator uses only builtins, so offline inspection does not
load native execution or adapters. Extraction-text subtype observations likewise
remain finite diagnostic events, not retained rejected output or admission.

## Durable boundaries and interrupted inspection

The writer records a phase start before its first dispatch, then an arm entry
before entering its scope. After scope accounting and owned transport settle
(and the Cairn core closes), it records that arm's existing terminal result,
including failed/blocked generation and unresolved judgments, before the next
arm can start. A whole-phase completion marker binds the actual returned report
only after processing finishes. A halted report may have a completion marker;
that means observation processing returned, never that all arms succeeded.

On supported POSIX hosts, the exclusively created directory is 0700 and its
files are 0600. Each record is written to a new private staging file, fsynced,
atomically published with a no-overwrite hard link, and followed by directory
fsync. Initial directory creation also fsyncs the private parent. A failed
write, fsync, identity/order check or publication stops execution without a
later arm/judge dispatch. The poisoned handle cannot be reused. A failed
directory fsync can leave a visible record whose crash durability was not
acknowledged; never treat a rejected phase as a returned report or permission
to retry. Pending files may remain as private failure evidence.

Offline inspection requires only the journal path:

```js
const observation = inspectMixedResultJournal({ directory });
```

Each phase has `started`, schedule-ordered `arms` and `completion`. Each arm is
`terminal` (a committed result was observed), `entered` (entry without a terminal
record) or `unobserved` (no entry). Missing arms are neither incorrect answers,
completed work nor a formal score. Partial journals have no completion marker
or invented whole-phase score. Inspection checks private modes, bounded records,
contiguous sequence/hash links, identity, phase/arm order and result structure;
completed report aggregates must agree with their existing judgments.

Inspection imports no adapter, native gateway, guard, tokenizer or evaluator and has no
HTTP, key, ledger mutation, execution, recovery or resume hook. It cannot
replace the scorer's generation/X receipt validation or authentic accounting.
The module's append functions support the trusted in-process runner; calling
them is not authenticated execution evidence or new authority.

The cold helper uses only builtins and readable immutable protocol snapshots.
The ordered drift gate compares their complete bodies to the existing source,
wire, stage, experiment and official-scoring boundaries; it has no automatic
refresh. Cold-process tests construct a minimal module tree, deny outside
imports and `node:sqlite`, and install a throwing fetch. Neither this family
binding nor detached diagnostic retention independently authenticates nested
`modelDiagnostics` or proves that a reported observation genuinely occurred.

## Retention and threat limits

This adds a PRIVATE personal-data-bearing retention surface: validated answer
text, question text/date, opaque identifiers, case hashes, existing receipt
coordinates/diagnostics, judgment outcomes and final reports. Files are not
redacted public telemetry. Model output may itself contain sensitive material;
validated text is not guaranteed secret-free. The writer never receives or
stores the `apiKey` option, request headers, raw provider bodies, arbitrary
exception text, original corpus histories or evaluator/reference payloads.

Permissions, directory replacement checks, exclusive publication and hash links
detect ordinary unsafe paths, accidental corruption, malformed records and
inconsistent observations. They are not signatures or proof of an immutable
host. A hostile process with the same UID can rewrite a coherent journal or
race filesystem checks; `O_NOFOLLOW` protects the final opened component, not
an adversarial ancestor swap between checks. Concurrent same-UID tampering,
filesystem/host failures beyond supported fsync semantics, encryption, secure
deletion and local backups/snapshots are outside this guarantee. Operators must
protect and retain/remove the entire private directory under their own policy.

## Offline gates

`npm run test:longmemeval` includes ordinary journal tests on both CI runtimes;
these cases require no native installation and do not silently skip. The
generation SIGKILL gate runs the real Cairn core and fake HTTP, pausing before
native dispatch. Ordinary scoring SIGKILL uses scripted generation with real
X scopes and fake-HTTP answers, then the real scoring runner. The separate
`npm run test:mixed-native-local` gate requires the existing pinned native roots
and containment prerequisites; it exercises actual Cairn/native generation,
scoring, both arm orders and interruptions with fake HTTP. Missing prerequisites
fail that explicit gate. None of these tests measures semantic reliability.

The [SJ evidence record](plans/supplied-history-journal-integration.md) records
offline verification on exact Node 22.16.0 and 24.15.0 for both source families,
ordered factory/identity drift, full-byte legacy compatibility, minimal-tree
cold inspection and actual-native interruptions. Original failures and explicit
unchanged-gate carryforward remain separate from fresh passes. Final candidate,
review and delivery are pending; no new score or paid-run authority follows.
This is the 2026-10-02 UTC offline checkpoint; current commit/review/CI/delivery
state is tracked in the
[matching branch PR](https://github.com/Cairn-ink/cairn-memory/pulls?q=is%3Apr+head%3Afeat%2Fsupplied-history-journal-integration),
not a declaration that this snapshot is merged or released.

Tests use owned workspaces, close guards/cores and stop/verify owned subprocess
groups before removal. Native interruption pauses only before native execution
or after native children settle; failure teardown also fences tracked native
groups. The retained original RED log established actual completed-answer loss
before runtime changes. `CAIRN_MIXED_JOURNAL_BASELINE=1` selects the deliberately
unjournaled child fixture to reproduce that exact failing assertion after the
fix; the ordinary RD9 test checks its nonzero result and clean owned scratch.
Diagnostic logs are retained outside those test workspaces. No historical or
operational temporary-directory sweep is used.

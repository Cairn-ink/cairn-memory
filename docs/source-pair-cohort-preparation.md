# Qualified source-pair cohort preparation (offline)

`evaluation/longmemeval/source-pair-preparation.mjs` provides two pure preparation
helpers. Neither reads a dataset file, ledger, key or environment variable, calls
a model, creates an authorization, or selects a replacement after a failure.
The [frozen contract](plans/source-pair-cohort-preparation.md) defines the
prospective experiment; these helpers do not launch it.

`selectSourcePairCohorts({ inventory, exclusions })` accepts exactly 500
data-only `{ sourceQuestionId, questionType }` entries and a complete, audited
list of excluded source IDs. IDs must be unique, well-formed, nonblank strings
of at most 256 UTF-16 units. Each of the six existing question types must have
at least six eligible IDs. The fixed new seed ranks eligible IDs by SHA-256 of
its UTF-8 seed-and-ID string, then by UTF-8 ID bytes. Per type, the first is
development and the next five are reserved holdout. Returned membership is
also ordered as in the input inventory, matching prepared-v2's dataset order.
The result freezes schema/seed, a SHA-256 over JSON-encoded ordered
`[sourceQuestionId, questionType]` tuples, a SHA-256 over JSON-encoded sorted
excluded IDs, and separate membership and prepared-order SHA-256 digests for
each cohort. Membership digests hash JSON arrays of sorted IDs; prepared-order
digests hash JSON arrays in input order. These hashes are reproducibility
checks, not signatures or authority. Caller-owned objects are detached;
accessors, callbacks, sparse arrays and extra/oracle fields are refused.
The own-data snapshot also refuses nesting beyond 32 levels or more than
200,000 traversed values. Those limits protect this local helper; they are not
model token limits or a judgment about answer quality.

`projectSourcePairCase({ history, question, namespace, answerModel, limits,
armOrder, reservations })` validates the existing two-arm protocol and both
actual source plans. A blocked or mismatched plan is refused, not truncated or
re-batched. The four reservation values are positive safe integers for the
frozen count, Cairn generation, answer and judge routes. They are inputs for
conservative arithmetic, not provider prices discovered by this helper.
With prefix/indexed batch counts `bP` and `bI`, the upper number of core model
methods is `M = 3 × (bP + bI) + 6`: three per capture batch and three recall
methods per arm. The count and Cairn-generation routes can each run at most
`M` times. The two answers belong to generation; the two judges to scoring.
Generation requests are `2M + 2`, scoring requests are `2`, and the full
reservation ceiling is `M × (count + Cairn generation) + 2 × answer + 2 × judge`.
Checked integer arithmetic rejects overflow. A failed, empty or timed-out arm
may actually use fewer calls; this upper bound is never a refund or invoice.

The projection returns the full source-bound protocol, policy-specific batch
counts, route and phase ceilings, and its reservation inputs. It explicitly
leaves provider prompt fit and semantic source coverage unestablished. Before
any operational use, an independently reviewed operator must audit all earlier
reserved cohorts, the real ledger/grants and prices, source identity, complete
per-case projections, cumulative phase caps and comparator headroom. Development
and holdout remain disjoint; reserving holdout IDs does not permit opening their
answers or scoring them.

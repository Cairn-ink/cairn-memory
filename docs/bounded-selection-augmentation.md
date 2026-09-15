# Bounded candidate augmentation (offline candidate)

This evaluation-only strategy preserves a valid selector's choices, then appends
other visible memory references in the existing query-aware map order. It tests
discretionary prefilter loss without another engine, new model method or
character-offset planning. Production defaults and installed CLI behavior are
unchanged. See the [acceptance plan](plans/bounded-selection-augmentation.md).

`prepareBoundedSelection` reuses the existing bounded map/reference compiler as
a mechanical validator. An internal whole-query span does not claim semantic
decomposition. Invalid baseline output fails; it is never repaired by padding.
Valid references keep their original order. Repeated placements and group refs
cannot inflate selection. Additions stay within twelve unique references per
namespace and the incoming `maxRefs`, at most twenty-four overall.

An empty baseline stays empty, including zero remaining budget. This avoids
manufacturing candidates or a new ranking call after an empty selection, but
does not repair false-empty retrieval or establish absence. Nonempty selections
can gain irrelevant candidates, including from other namespaces already present
in the authorized read set. No source outside the supplied maps is consulted.

`createAugmentedSelectionModel` replaces only the model's selection method. It
calls the original method once with the original instructions and frozen input,
then compiles the augmented refs. It preserves cancellation, local input/output
ceilings, and counter-failure/mutation checks. The core retains its existing
navigation rounds, fetched-source validation, rank limit and final authoritative
read. More candidates can exceed its unchanged rank-input budget and fail; no
smaller fallback, retry or increased ceiling is substituted.

## Why test this candidate

The [checklist comparison](checklist-selection-results.md) exposed all fifteen
active references to selection, yet selected only two to five per history.
Ranking retained every candidate; eleven baseline required passages were lost
before rank. Its mechanically valid question spans included word fragments.

A read-only counterfactual preserved the frozen baseline choices and appended
visible refs in the same map order, up to twelve per namespace. All32 required
passages would become rank candidates instead of21. However, total candidate
exposure grows21 →72: eleven additional required sources, thirty-five additionally
pre-labelled irrelevant sources and five other non-required sources. No rank,
capture or answer was regenerated. These are eligibility counts, not recovered
answers or a passed comparison. The successful mount-test source in c03b lands
at position twelve, demonstrating cutoff sensitivity rather than robustness.

This differs from the existing small complete-map source scan: the fifteen-item
maps exceed that strategy's twelve-per-namespace prerequisite, while this
augmentation still excludes three visible candidates. It does not fix deeper
pagination, the current literal matching limitations, lexical decoys, large or
partial maps, or model interpretation of changed reasons.

## Evidence still required

Offline scripted tests establish ordering, bounds, freshness and method isolation,
not relevance. A fresh frozen comparison must measure required sources entering
and surviving rank, new losses of previously retained evidence, irrelevant
exposure and returned context, answer fidelity, bytes/tokens and latency. Source
coverage must not conceal added overclaiming or indiscriminate abstention.
Real-provider, installed-package and natural-host behavior remain unvalidated
for this candidate. Existing failed results remain unchanged; no paid call,
grant, release, deployment or default switch follows from this package.

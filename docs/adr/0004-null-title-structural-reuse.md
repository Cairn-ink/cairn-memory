# Retain topic identity without renewing an unsupported label

The DRI accepted this prospective decision on 2026-10-03; the released-main
delivery is tracked by [NR1–NR8](../plans/null-title-main-integration.md).
An exact same-namespace, same-level canonical title may identify an existing
topic only when its current source-derived label is NULL. Reuse its identity
rather than create a duplicate, while preserving all original title/source
bindings and never presenting fresh evidence as support for the old label.
Visible-title collisions still refuse; key equality is not semantic equivalence.

We chose full NULL-only reuse over orphan-only reuse, permanent collision refusal
or relabeling. An invalid source can leave a group nonempty, so emptiness is not
the label-validity boundary. Fresh membership can make retained ancestors
navigable again, deliberately associating new memories with existing hierarchy.
That is a real organization/privacy tradeoff, not zero privacy change or restored
forgotten text. Original provenance remains unsupported; reversing this identity
association requires unwinding memberships and hierarchy, not just a display
change. No new retention, semantic assessment, automatic retry or historical-cause
claim follows.


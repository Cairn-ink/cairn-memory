# Require a decision chain for a current-basis challenge

Base e82f256f027742f1553ba6d5ff9693c531565340 after its evidence-only merge. The source-basis comparison found
an accepted challenge between two different days' career feelings without any
recorded decision unit. Source matching and role direction did not prevent it.

## Acceptance

1. Every `challenges-current-basis` link must target a premise that is also the
   source of at least one `supports-decision` link to a decision in the same
   proposal. Validate the whole graph, independently of link order.
2. Missing chains reject the whole model output, without inventing a decision,
   repairing links, discarding selected edges or writing any stored state.
   Existing exact quote, role, size, freshness and nonpersistence gates remain.
3. Empty output and unlinked units remain allowed and explicitly unassessed.
   Confirming source units need not all be linked. Valid multi-premise graphs
   and a challenge backed by a later-listed support remain accepted.
4. The prompt/documents explain that a structural chain is not evidence of
   adoption, subject/time/scope agreement or semantic challenge. It cannot fix
   stale historical challenges or cross-scope support in otherwise valid chains.
5. Red-before/green-after tests cover orphan and unrelated-support graphs,
   order independence, multiple decisions and no-write failure. Run contributor,
   core/demo, adapter/demo and installed-artifact gates on both Node versions,
   then independent dual review. No paid run, migration or default promotion.

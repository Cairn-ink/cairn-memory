# Provisional relation guide (experiment only)

These are source-attributed proposals, not facts, permissions or automatic
decision changes. `from` is the evidence supplying a premise or update; `to`
is the decision or premise being supported or challenged. Both receipt indices
must point to passages that actually carry those roles. Keep subject, property,
scope and applicable time aligned.

- **Support** (`supports-decision`): a source states a reason and a source
  explicitly adopts a decision *because of it*. “I chose the ferry because it
  avoids traffic” can support its own decision. Shared topics, a plausible benefit,
  advice, a question, consideration or a tentative preference cannot.
- **Challenge** (`challenges-premise`): later or separate evidence directly
  disputes an identified premise in the same subject, scope and applicable
  conditions. “The route now takes 35 minutes, not the expected 10 minutes”
  can challenge a continuing speed premise, from update to premise. A changed current price can challenge
  continued affordability without making the old price historically false.
  A challenge does not cancel the decision.
- **Elaboration** adds compatible detail; **reaffirmation** repeats an existing
  choice or premise. Neither is a challenge or a new adoption. A confirmation
  may support an already adopted decision only when it supplies its actual
  stated reason.
- **Replacement** requires explicit adoption of a different choice for the
  same decision slot. “I adopted B for export while A still works offline”
  supports B's own decision; it does not challenge A's offline premise. It is
  not inferred from a challenged premise, and this experiment has no
  replacement wire type. **Discussion continuation** (asking, comparing or
  receiving advice) likewise has no relation wire type. “I am considering B
  but retain A” is not support for an adopted B.

Addition is a storage operation, not a semantic edge. “Considered,” “tentative”
and “adopted” are claim states; only adoption supplies a decision target here.
Different people, projects, conditions or historical periods are not made
equivalent by similar words. Historical truth does not imply current
applicability. When either role, direction or scope is uncertain, omit the edge;
`{"edges":[]}` is a valid answer. Emit only the two existing wire types.

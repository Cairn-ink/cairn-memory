# Cairn Memory

Vocabulary for a source-backed memory layer. These terms distinguish truth
claims from their evidence; they are not a statement of shipped capabilities.

## Language

**Current assertion**:
A remembered claim presented as applicable now within its subject and scope.
_Avoid_: Latest message, guaranteed truth

**Supersession**:
An explicit change that makes an earlier assertion no longer current for the
same subject, property and scope, while retaining its historical evidence.
_Avoid_: Contradiction, deletion

**Contradiction**:
Incompatible assertions whose disagreement has not established which one
should be treated as current.
_Avoid_: Automatic replacement

**Proposal**:
A suggested or hypothetical change that has not been adopted by its source.
_Avoid_: Decision, current assertion

**Tentative choice**:
A source's provisional preference for an option, short of adopting it as the
applicable decision. It does not supersede an existing adopted choice.
_Avoid_: Final decision, adopted replacement

**Source receipt**:
Attributable evidence tying a remembered assertion to captured source text.
A receipt proves provenance, not the truth or continuing applicability of a claim.

**Submitted evidence**:
Source text and speaker roles supplied by a memory client as claims about a
conversation, not an authenticated transcript or execution permission.
_Avoid_: Verified human statement, authenticated consent

**Staged evidence**:
Submitted evidence retained separately while its interpretation is incomplete or
unsuccessful; it is not an admitted assertion, authenticated record or permission.
_Avoid_: Trusted memory, complete archive, verified source

**Historical assertion**:
A claim retained as evidence of an earlier state, not presented as current.
_Avoid_: Forgotten memory

**Reaffirmation**:
New evidence confirming an existing assertion without changing its applicable
value or scope.
_Avoid_: Supersession

**Recorded rationale**:
A source-attributed reason explicitly associated with a decision or conclusion.
_Avoid_: Reconstructed motive, proof of causation

**Decision evolution**:
The source-attributed history of a choice, its commitment, and recorded rationale
within its subject and scope, including replacements and unchanged choices with revised reasons.
_Avoid_: Newest mention wins, automatic supersession

**Needs reconfirmation**:
A decision whose recorded supporting premise no longer holds, without evidence
that its source has adopted a different decision.
_Avoid_: Cancelled decision, replacement decision

**Reconfirmation suggestion**:
An unverified interpretation that new evidence challenges a recorded reason for
a decision, warranting review without establishing either source as true.
_Avoid_: Confirmed invalid premise, cancelled decision, adopted replacement

**Unresolved conflict**:
Incompatible assertions within the same subject, property, time and scope for
which the available evidence does not justify a resolution.
_Avoid_: Newest statement wins

**Claim qualification**:
The attribution, time, scope and degree of commitment attached to an assertion,
such as a personal feeling, a proposal or an adopted decision.
_Avoid_: Objective truth, model confidence

**Source author**:
The attributed speaker of recorded evidence, who may be describing somebody else.
_Avoid_: Claim subject

**Claim subject**:
The person or thing an assertion describes, distinct from who reported it.
_Avoid_: Message author, namespace owner

**Claim slot**:
The subject, property and applicable scope that make two asserted values
potential alternatives for the same matter, excluding the values themselves.
_Avoid_: Topic similarity, shared keywords

**Source anchor**:
A specific passage of recorded evidence supporting an attributed assertion or
qualification; its existence does not prove that its interpretation is correct.
_Avoid_: Semantic proof, execution permission

**Evidence candidate**:
A bounded exact passage prepared from a canonical source receipt for a model to
select. Selecting it permits precise source attachment, not trusted semantic
interpretation, identity or adoption. Its index is local to one model request.
_Avoid_: Verified fact, persistent claim identity

**Source evidence**:
Retained source passages and their attributed speakers, distinct from a later
interpretation of what they mean. Their preservation does not establish truth
or that every necessary passage was retained.
_Avoid_: Verified memory, complete conversation

**Model interpretation**:
A model's proposed summary or description of source evidence, which may alter
its meaning even when its citations point to real passages.
_Avoid_: Source text, confirmed fact, adoption evidence

**Admitted-source snapshot**:
The complete retained source evidence for a bounded set of currently admitted
assertions, without relevance filtering or a claim that the conversation is complete.
_Avoid_: Complete personal history, verified context, relevant-only recall

**Adoption evidence**:
Recorded evidence that a source committed to a proposed value within a stated
scope, rather than merely quoted, considered or received it as advice.
_Avoid_: Recency, suggestion, past authorization

**Relationship proposal**:
An unverified interpretation connecting particular source evidence as a reason
or a challenge; its existence does not establish a decision or a true premise.
_Avoid_: Proven dependency, confirmed contradiction

**Decision context**:
Source evidence organized around a recorded decision, its proposed supporting
reasons and challenges to those reasons; it need not include every relationship proposal.
_Avoid_: Complete relationship history, verified decision rationale

**Decision-basis unit**:
A particular source passage interpreted in one or more decision-basis roles;
the assigned roles remain interpretations rather than properties proven by citation.
_Avoid_: Verified atomic fact, whole conversation, execution authorization

**Decision-basis role**:
The function attributed to a passage in a decision's context, such as decision,
supporting premise or update; the same update may also support another decision.
_Avoid_: Mutually exclusive fact type, verified dependency

**Current applicability**:
Whether a recorded premise still applies to a particular decision's present
subject and scope, distinct from whether that premise was true historically.
_Avoid_: Historical truth, newest statement wins, automatic decision change

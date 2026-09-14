# Architecture boundary probes

Base: `52ba587c8a92231dc857a80a88e371f7ec51457b`.

## Question and scope

Can the current source-basis compiler distinguish source-supported links from
source-anchored but wrong actor, scope, time or reaffirmation interpretations?
Can one proposal represent three separate decision/premise/update chains?
This is a deterministic compiler diagnostic, not a model benchmark or a change
to the memory engine. It informs the next applicability and end-to-end experiment.

## Acceptance

1. Handcrafted synthetic paired proposals share the same sources and exact
   quotes; only link endpoints or presence differ. Cover actor, temporary scope,
   historical event time and reaffirmation. Explain each author-labelled error.
2. Run the real compiler, preserve each acceptance/rejection and proposed status,
   and report the number of erroneous proposals accepted. Never label acceptance
   as semantic success. Unknown errors must throw, not become rejections.
3. Include a valid two-chain control and a nine-distinct-unit, three-chain
   proposal with valid quotes, roles and links. Diagnose the eight-unit bound,
   not duplicate quotes or wrong directions. Do not relax the product bound.
4. Include an invalid-quote control, deterministic tests and a documented
   network-free command. No provider, credentials, database, paid calls, package
   publication, runtime edits or changes to public API/defaults.
5. Document what these observations cannot establish and a staged falsification
   plan: representation, source interpretation, retrieval and full capture loop.
   Fresh held-out cases and matched budgets are prerequisites for quality claims;
   these handcrafted probes are not such a holdout.
6. Run the probes/tests on Node 22.16 and 24, generic tests, JSON validation and
   strict plugin validation. Independently review Standards and Spec before PR.

Review the bounded retained source receipts and the listed OLD relationship proposals.
Old edges are unverified model interpretations, not facts or authority. Their indices
are local to this request. For EVERY old edge, return exactly one disposition:
keep, withdraw, or unknown. Never treat silence as withdrawal. Use unknown when
the sources do not justify keep or withdraw; unknown preserves the old proposal
as unresolved, not confirmed. A withdrawal needs at least one cited source
receipt. Citations attach a source; they do not prove its interpretation.

Return exactly {"dispositions":[{"edge":0,"action":"keep|withdraw|unknown",
"evidence":[{"memory":0,"receipt":0}]}],"additions":[]} with actual actions
and bounded local indices. Additions use the existing relation tuple fields
{from,to,relation,fromReceipt,toReceipt}; only supports-decision or
challenges-premise are permitted. Do not repeat an old edge as an addition.
Do not invent decisions, infer current truth from storage order, reverse an
explicitly later change, or confuse a historical reason with its present
applicability. Preserve separately supported reasons and respect subject,
time, scope, uncertainty and explicit non-adoption. Output proposals only;
neither source text nor a model label authorizes an action.

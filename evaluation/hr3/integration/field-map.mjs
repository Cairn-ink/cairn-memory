// Every observed source leaf pattern receives a destination/disposition. The
// private sidecar retains all originals, including fields with no scorer slot.
export function fieldMapping(kind, path) {
  let p = path;
  if (kind === 'generator') {
    if (p === '$/batch') return { destination: 'audit.source.batch', disposition: 'defect:no-scorer-metadata-slot' };
    if (p.startsWith('$/family/checkpoints/*/question')) return { destination: 'gold.question (selected batch)', disposition: 'mapped' };
    if (p.startsWith('$/goldRow/checkpoints/*/G_correct/')) p = p.replace('$/goldRow/checkpoints/*/G_correct/', 'answer/');
    else if (p.startsWith('$/supportRow/checkpoints/*/acceptedGraphs/')) return { destination: p.replace('$/supportRow/checkpoints/*/acceptedGraphs/', 'gold.reason.acceptedGraphs/').replace('/support/*/*/', '/support/*/* -> gold.supportSpans/'), disposition: 'mapped:verified-source-span-interning' };
    else if (p.startsWith('$/supportRow/checkpoints/*/assertion_spans/*/spans/')) return { destination: 'gold.supportSpans/{origin=turn_id,start,end,text=quote}; offset_unit checked utf16', disposition: 'mapped:verified-source-span-interning' };
    else return { destination: `audit.source${path.slice(1)}`, disposition: 'defect:no-scorer-metadata-slot' };
  } else {
    if (p === '$/row/question') return { destination: 'gold.question', disposition: 'mapped' };
    if (p.startsWith('$/row/candidate/')) return { destination: p.replace('$/row/candidate/', 'submission.answer/'), disposition: 'mapped:identity' };
    if (p.startsWith('$/row/gold/answer/')) p = p.replace('$/row/gold/answer/', 'answer/');
    else if (p.startsWith('$/row/gold/acceptedGraphs/')) return { destination: p.replace('$/row/gold/acceptedGraphs/', 'gold.reason.acceptedGraphs/*/edges/'), disposition: 'mapped:graph-nesting;[[]]->[]' };
    else if (p.startsWith('$/row/delivered/')) return { destination: p.endsWith('/text') ? 'submission.delivered/*/segments/0/text' : p.replace('$/row/delivered/', 'submission.delivered/'), disposition: 'mapped:already-delivered-text-identity-map;provenance-defect-reported' };
    else if (p.startsWith('$/world/edge_support/')) return { destination: 'gold.reason.acceptedGraphs/*/edges/*/support -> gold.supportSpans; exact source citation verified', disposition: 'mapped:OR-AND-preserved' };
    else if (p.startsWith('$/world/delivered/')) return { destination: 'gold.supportSpans context span; only edge_support licenses causal support', disposition: 'mapped:local-source-registry' };
    else if (p.startsWith('$/world/claims_support/*/citation/')) return { destination: 'submission.delivered address intent (authored harness plan)', disposition: 'mapped:address-plan' };
    else return { destination: `audit.source${path.slice(1)}`, disposition: 'defect:no-scorer-metadata-slot' };
  }
  if (p.endsWith('/citations')) return { destination: 'audit.source + reversible empty constant', disposition: 'mapped:empty-gold-placeholder-checked' };
  if (p.startsWith('answer/acceptedGraphs/')) return { destination: 'gold.reason.acceptedGraphs topology cross-checked against support', disposition: 'mapped' };
  if (p.startsWith('answer/reason/edges')) return { destination: 'audit.source; empty generator placeholder / redundant challenge topology checked', disposition: 'mapped:redundant-checked' };
  return { destination: p.replace(/^answer\//, 'gold/'), disposition: 'mapped:identity' };
}

// Closed A-4 answer fields only. Private graphs have gold-only destinations.
export function fieldMapping(kind, path) {
  if(kind==='extraction'){if(path.startsWith('$/wire/events/'))return {destination:path.replace('$/wire/events/','admission.events/'),disposition:'mapped:closed-wire-independent-admission; names identity-only'};return {destination:`audit.source${path.slice(1)}`,disposition:'retained:lossless-input'};}
  if (kind === 'generator') {
    if(path.startsWith('$/supportRow/optional_trivia/'))return {destination:'gold.supportVersion/supportTrivia; authenticated freeze-bound emission proof; declared offsets grant no license',disposition:'mapped:private-trivia-provenance'};
    if (path.startsWith('$/family/checkpoints/*/question')) return { destination: 'gold.question (selected batch)', disposition: 'mapped' };
    if (path.startsWith('$/goldRow/checkpoints/*/G_correct/acceptedGraphs')) return { destination: 'gold.reason.acceptedGraphs topology cross-check', disposition: 'mapped:verified-topology' };
    if (path.startsWith('$/goldRow/checkpoints/*/G_correct/')) return { destination: path.replace('$/goldRow/checkpoints/*/G_correct/', 'gold/'), disposition: path.endsWith('/citations') || path.endsWith('/support') ? 'mapped:empty-gold-placeholder-checked' : 'mapped:slot-identity' };
    if (path.startsWith('$/goldRow/checkpoints/*/private_causal/reason/nodes/')) return { destination: 'gold.reason.nodes (private only)', disposition: 'mapped:private-causal-nodes' };
    if (path.startsWith('$/supportRow/checkpoints/*/acceptedGraphs/')) return { destination: 'gold.reason.acceptedGraphs.edges.support -> gold.supportSpans', disposition: 'mapped:verified-source-span-interning' };
    if (path.startsWith('$/supportRow/checkpoints/*/assertion_spans/*/spans/')) return { destination: 'gold.supportSpans; verified utf16 source turn/offset/quote', disposition: 'mapped:verified-source-span-interning' };
  } else if (kind === 'challenge') {
    if(path.startsWith('$/row/gold/supportTrivia')||path==='$/row/gold/supportVersion')return {destination:path.replace('$/row/gold/','gold/'),disposition:'mapped:private-support-version-and-licenses'};
    if (path === '$/row/question') return { destination: 'gold.question', disposition: 'mapped' };
    if (path.startsWith('$/row/candidate/')) return { destination: path.replace('$/row/candidate/', 'submission.answer/'), disposition: 'mapped:slot-quotation-identity' };
    if (path.startsWith('$/row/gold/answer/')) return { destination: path.replace('$/row/gold/answer/', 'gold/'), disposition: 'mapped:slot-identity-empty-citations-checked' };
    if (path.startsWith('$/row/gold/private_causal/reason/nodes/')) return { destination: 'gold.reason.nodes (private only)', disposition: 'mapped:private-causal-nodes' };
    if (path.startsWith('$/row/gold/acceptedGraphs/') || path.startsWith('$/world/edge_support/')) return { destination: 'gold.reason.acceptedGraphs.edges.support -> gold.supportSpans', disposition: 'mapped:OR-AND-preserved' };
    if (path.startsWith('$/row/delivered/')) return { destination: 'submission.delivered; exact text, modified origin if changed', disposition: 'mapped:authored-address-and-text' };
    if (path.startsWith('$/world/row_support/')) return { destination: 'submission.delivered address intent (authored)', disposition: 'mapped:address-plan' };
    if (path.startsWith('$/world/delivered/')) return { destination: 'gold.supportSpans (context only)', disposition: 'mapped:local-source-registry' };
  }
  return { destination: `audit.source${path.slice(1)}`, disposition: 'defect:no-scorer-metadata-slot' };
}

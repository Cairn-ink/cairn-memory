// Effective membership is determined by gold, never by an authored label.
export function reasonStratum(gold) {
  const graphs = gold.acceptedGraphs ?? gold.reason.acceptedGraphs;
  const status = gold.reason.status;
  if (status === 'not_stated') {
    if (graphs.length) throw new Error('not_stated has accepted causal graphs');
    return {status, minimumEdges:null, multiHop:false};
  }
  if (status !== 'stated' || !graphs.length || graphs.some(g => !g.edges.length)) throw new Error('Invalid effective reason stratum');
  const minimumEdges = Math.min(...graphs.map(g => g.edges.length));
  return {status, minimumEdges, multiHop:minimumEdges > 1};
}

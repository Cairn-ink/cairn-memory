// Private, handle-local wall-cost history; no storage probes or host policy.
export function checkpointCost(now) {
  // Whole transaction seed covers BEGIN, bounded work, freshness, signing and
  // COMMIT. The observation seed covers the fresh final snapshot and result.
  let transactionMs=100, remainingMs=100, commitMs=50, tailMs=50;
  // High-water marks cannot predict an unseen stall. In particular a
  // single indivisible COMMIT longer than the quantum can still overrun it.
  return {
    admit(quantum,started) {
      // Before a page's freshness/scan prefix, price the whole checkpoint.
      // At BEGIN, price the measured remaining transaction instead: charging
      // the prefix twice can starve a fitting page; subtracting an unexpectedly
      // slow prefix from the whole estimate can underprice the work still due.
      const estimate=started===undefined?transactionMs:remainingMs;
      return now()+Math.max(commitMs,estimate)+tailMs<quantum.cutoff-quantum.reserve;
    },
    commit:ms=>{commitMs=Math.max(commitMs,ms);},
    transaction(ms,remaining=ms) {
      transactionMs=Math.max(transactionMs,ms);remainingMs=Math.max(remainingMs,remaining);
    },
    tail:ms=>{tailMs=Math.max(tailMs,2*Math.max(0,ms));}
  };
}

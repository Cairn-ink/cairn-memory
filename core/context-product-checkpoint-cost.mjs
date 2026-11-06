// Private, handle-local wall-cost history; no storage probes or host policy.
export function checkpointCost(now) {
  // Whole transaction seed covers BEGIN, bounded work, freshness, signing and
  // COMMIT. The observation seed covers the fresh final snapshot and result.
  const history=seed=>{
    let estimate=seed;
    // Decaying peak: retain a new outlier immediately, then halve its weight
    // on each observation until the conservative seed floor is reached.
    return {get:()=>estimate,add(ms){estimate=Math.max(seed,Math.max(0,ms),estimate/2);}};
  };
  const transaction=history(100),remaining=history(100),commit=history(50),tail=history(50);
  let usableBudget=Infinity;
  // Decaying peaks cannot predict an unseen stall. In particular a
  // single indivisible COMMIT longer than the quantum can still overrun it.
  return {
    turn(quantum) {usableBudget=Math.max(0,quantum.cutoff-quantum.reserve-now());},
    admit(quantum,started) {
      // Before a page's freshness/scan prefix, price the whole checkpoint.
      // At BEGIN, price the measured remaining transaction instead: charging
      // the prefix twice can starve a fitting page; subtracting an unexpectedly
      // slow prefix from the whole estimate can underprice the work still due.
      const estimate=(started===undefined?transaction:remaining).get();
      return now()+Math.min(usableBudget,Math.max(commit.get(),estimate)+tail.get())<quantum.cutoff-quantum.reserve;
    },
    commit:ms=>commit.add(ms),
    transaction(ms,remainingMs=ms) {
      transaction.add(ms); // Complete cost includes the measured COMMIT.
      // Keep elapsed prefixes separate from the work still due at BEGIN.
      remaining.add(remainingMs);
    },
    tail:ms=>tail.add(2*Math.max(0,ms))
  };
}

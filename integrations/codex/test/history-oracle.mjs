// Independent model: operation-history byte positions and human texts only.
// No imports from production. JSONL lengths here come from the fixture history.
export class HistoryOracle {
  constructor(initial, projectId) {
    this.bytes = Buffer.byteLength(initial);
    this.offset = 0;
    this.paused = false;
    this.barrier = false;
    this.expected = [];
    this.pending = [];
    this.epoch = 0;
    this.history = [];
    this.sourceChanged = false;
    this.projectId = projectId;
  }
  apply(
    op,
    {
      bytes = 0,
      text = null,
      size = null,
      previousOffset = this.offset,
      projectId = this.projectId,
    } = {},
  ) {
    this.history.push({ op, bytes, text, size, projectId });
    if (op === "pause") {
      this.paused = true;
      this.barrier = true;
      return;
    }
    if (op === "resume") {
      this.paused = false;
      return;
    }
    if (["resume-cwd", "late-handoff"].includes(op)) {
      this.projectId = projectId;
      this.sourceChanged = true;
      return;
    }
    if (op === "replace") {
      this.bytes = size;
      this.sourceChanged = true;
      return;
    }
    if (op === "truncate") {
      this.bytes = size;
      if (previousOffset > size) this.sourceChanged = true;
      return;
    }
    this.bytes += bytes;
    if (!this.paused && !this.barrier && !this.sourceChanged && text !== null)
      this.pending.push({ text, projectId: this.projectId });
  }
  hook(outcome = "complete") {
    if (outcome === "state_busy") {
      this.history.push({ op: "hook", outcome });
      return; // No admission or cursor movement; the same authorized hook can retry.
    }
    if (outcome !== "complete") throw new Error("unknown_oracle_outcome");
    if (this.paused) return;
    if (this.sourceChanged) {
      this.epoch++;
      this.sourceChanged = false;
      this.pending = [];
    }
    if (this.barrier) {
      this.barrier = false;
      this.pending = [];
    }
    this.offset = this.bytes;
    this.expected.push(...this.pending);
    this.pending = [];
  }
  assert(assert, state, bodies) {
    const actual = bodies.flatMap((body) =>
      body.messages.map((m) => ({ text: m.content, projectId: body.project_id })),
    );
    const sorted = (entries) => entries.map((entry) => JSON.stringify(entry)).sort();
    assert.deepEqual(sorted(actual), sorted(this.expected), JSON.stringify(this.history));
    assert.equal(
      new Set(actual.map((entry) => entry.text)).size,
      actual.length,
      "no text admitted twice",
    );
    if (state) {
      assert.equal(state.offset, this.offset, "history-derived cursor");
      assert.equal(state.epoch, this.epoch, "history-derived epoch");
      assert.equal(
        state.accepted + Object.values(state.skipped).reduce((n, x) => n + x, 0),
        state.offset,
        "no unaccounted bytes",
      );
      assert.ok(state.observedEnd >= state.offset);
    }
  }
}
export function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

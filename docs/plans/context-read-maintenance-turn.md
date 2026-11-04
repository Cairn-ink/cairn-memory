# Context-read maintenance turn contract (v1)

Status: **agreed plan**, 2026-11-04. The parties are:
- the lexical maintenance pump;
- the semantic maintenance pump;
- the host's maintenance broker.

**Option chosen:** multi-user maintenance on a shared canonical core uses an engine pre-quantum admission seam plus a host broker. Per-owner sidecars were evaluated and set aside.

This plan document is the shared contract. Each pump's implementation PR adds its own normative, append-only addendum to `docs/context-read-product.md` and cites this document. Nothing here is implemented yet.

[code] marks a statement about the current source. Line references were taken at `700b6008` (the head of #541 at writing) or main `c23ed4be`; they are approximate and will move. [proposed] marks contract behaviour to be built.

## 1. Purpose and scope

A host can schedule maintenance quanta across owners that share one canonical core. The pump waits for the host's permission **before** a quantum starts, so the waiting sits outside every quantum, budget clock, reservation, watchdog, open and refresh.

**In scope:**
- both maintenance pumps: lexical `renewContextMaintenancePump` without `semanticConfig`, and the semantic pump;
- every quantum kind each pump runs.

**Unchanged:**
- **No port configured:** behaviour, statement counts and every existing test stay as they are today.
- **Cross-process exclusion stays host-owned**, as today (`docs/context-read-product.md:336–338`): the host's per-owner lease and its core-wide physical gate. The broker is in-process only. A grant does not replace the host's exclusion. After a grant the host's existing gate entry stays zero-wait, and a cross-process collision still fails closed exactly as today.
- **The host's gate key is unchanged.** The engine defines no new gate key, so no rollout barrier is needed for one.
- **Per-pump admission arithmetic:** the existing bounds keep their values (§7).

**Not provided:**
- independent per-owner availability. The canonical safety hold, DELETE locks, the semantic ledger and CPU stay shared. See §9.

## 2. The port

[proposed] The host passes one optional **admission port** when it activates a pump, as a new top-level pump option. It is not part of `host.configuration`, which accepts only bounded data (`core/context-product-control.mjs:65–99`).

```js
preQuantum: {
  version: 1,
  maxWaitMs: 1000,                       // host choice; integer 1..5000; independent of Q
  createTurn(request) {                  // synchronous allocation only; no gate work, no I/O
    return {
      enter({ signal, untilMonoMs }) {   // "admitted" | "defer", or a native Promise of exactly one of them
      },
      release(outcome, reason) {         // synchronous, idempotent, must not throw; valid while queued or granted
      }
    };
  }
}
```

**Validation:**
- The engine validates the port once, before activation, without invoking any accessor or Proxy trap. It reuses the descriptor-chain capture and captured-receiver invocation patterns in `core/content-safety-boundary.mjs:304–335`, `ownData` (`core/local-authority-input.mjs:5–14`) and `exact` (`core/context-semantic-input.mjs:13–16`).
- `contentAuthorityPort` itself refuses async results, so a new asynchronous adapter is needed. `inertContentPortValue` materialises accessors instead of refusing them, so it is **not** used here.
- The port's object identity is kept across renewal. The host passes the **same** port object on every renewal of a pump. A different port object on an existing pump refuses that renewal with the closed code `invalid_input`, before any state change, so a host bug fails loudly at renewal rather than mid-window.
- An invalid port refuses activation with `invalid_input`. It never falls back to "no port".
- **Each ticket** returned by `createTurn` is validated the same way, before anything on it is invoked. It must be a plain, non-Proxy object whose own data properties `enter` and `release` are functions, with no accessors. Both methods are captured, with their receiver, **before** `enter` is called. A malformed ticket is a port failure under §4. The engine invokes nothing on a malformed ticket, because it has no validated `release` to call.

**Per realm:**
- Each pump uses the port of the realm that calls its renewal function. For example, a host may run its lexical pumps in a scheduler Worker and its semantic pump on the main thread.
- One per-core broker serves both realms, for example over shared memory. Its cross-realm mechanics belong to the host.
- Outcomes are the plain strings `"admitted"` and `"defer"`. No engine object identity has to survive a realm crossing.

**`release` arguments:** `outcome` and `reason` are engine-defined closed strings (§5, §6). They are purely informational: the host may record them, but they never change what `release` must do. `release` stays synchronous, idempotent and no-throw whatever its arguments.

**What the request carries:** `request` is a frozen object built by the engine from primitives only:

| Field | Values |
|---|---|
| `version` | `1` |
| `pumpId`, `windowId` | the pump's existing identifiers |
| `lane` | integer: the bounded projection index (lexical) or slot index (semantic), so a pump with several selections stays unambiguous |
| `family` | `"lexical"` \| `"semantic"` |
| `kind` | `"lexical"` \| `"embeddings"` \| `"status"` \| `"validation"` |
| `phase` | `"admission"` (the lexical open-only turn) \| `"work"` |
| `intent` | `"current"` \| `"history"` for lexical lanes; `null` otherwise |
| `maxMs` | the quantum allowance Q, or the validation horizon for `validation` |

- The request has no owner ID, credential, grant, path, query or error. The host binds each port instance to the pump, and therefore the owner, it created it for.
- The host must treat the request as scheduling metadata only.

## 3. Turn lifecycle

The engine requests a turn for **every** quantum, as follows.

1. **Select, then request.**
   - The pump finishes its pure eligibility and lane/slot selection.
   - It latches "admission pending", so a concurrent tick cannot request again, and calls `createTurn(request)`.
   - It then awaits `enter({signal, untilMonoMs})`. While pending there is no `lastTick` stamp, reservation, dispatch ordinal, watchdog, `firstCoverage`, drain, open, status, refresh or provider work.
   - **Lexical:** the await sits after lane selection and before the `lastTick`, round-robin, ledger reservation, ordinal and watchdog sequence (`core/context-product-pump.mjs` about `:259–300`).
   - **Semantic:** it sits between slot selection and `lastTick=now(); turn(...)` (`core/context-semantic-pump.mjs:338–346`), before the deadline, ordinal and watchdog at `:174–179` and before `firstCoverage` at `:347`.
   - [code] The semantic pump starts **one** selected turn per tick (`:338–358`). Its startup status, lexical work, embedding work and coverage validation turns each request their own admission. Several provider batches inside one embedding turn share that turn (`core/context-product-index.mjs:407–439`); they are not separate quanta.
2. **The wait deadline.**
   - `untilMonoMs` is the earlier of `now + maxWaitMs` and the last instant that still leaves a full allowance before the window or authority horizon: `min(window end, renewed-until) − maxMs`.
   - At that deadline the engine treats the turn as `"defer"`.
3. **Cancellation.**
   - The engine's `signal` aborts on close, supervisor stop, accepted renewal (same or new window), authority or window cutoff, and the wait deadline. A rejected renewal does not cancel.
   - On abort, a queued request is withdrawn with `release("withdrawn")`. Cancellation adds **no** failure record of its own. The state that triggered it is preserved: close and stop still stop the pump, and expiry, exhaustion or an existing error keep their existing outcome. After a renewal handoff or the wait deadline, the pump continues.
   - If a grant races the abort, the engine **owns** the granted permit and releases it under §5. Abort never auto-releases a granted permit.
   - Late results never dispatch work.
   - **Withdrawal is final.** After `release("withdrawn")` the host must never grant that ticket. If a late `"admitted"` arrives for a withdrawn ticket anyway, the engine ignores it and calls nothing again.
4. **`"defer"`.**
   - No quantum, charge, refund, failure (`read_timeout` / `read_cancelled`), cursor or startup-progress change, dispatch ordinal, observation, or acknowledgement of earlier pending usage.
   - The engine calls `release("withdrawn")` and retries at normal spacing through a separate retry-not-before time, so an overdue lookahead cannot spin with zero delay (semantic `:185–202`).
   - A deferral by itself never changes public status: the pump stays `active` with `error:null`. The exception is a close, stop, expiry, exhaustion or existing error that happens at the same time; it keeps its own outcome (§3.3).
5. **`"admitted"`: the post-grant recheck.** The engine synchronously rechecks the pump-local conditions:
   - stop or error;
   - the admission generation (a renewal since the request);
   - the authority and window horizon, including the full-allowance horizon;
   - quota and floors (lexical) or exhaustion (semantic);
   - minimum start spacing;
   - the selected lane or slot, and `residentEpoch`.

   It recomputes amounts from current state; it never reuses values from before the wait.
   - If a check fails, the engine calls `release("declined", reason)` with a reason from §6 and starts nothing.
   - Otherwise it stamps the quantum start and proceeds exactly as today: reserve, arm the watchdog, then drain, open and work.
6. **Dynamic checks stay inside the turn.** Host authorization and currentness, ledger binding, price, budgets, purge and enablement are still checked per operation inside the granted turn, exactly as today (`core/context-semantic-worker.mjs:98–180,217–238,284–285`; `core/context-product-authority.mjs:18–47`).
   - Their failures are ordinary turn outcomes with today's accounting, not declines.
   - A grant is never cached permission that outlives the turn.

## 4. Fail-closed rules

| Event | Result |
|---|---|
| Before any ticket is validated: `createTurn` throws or returns a malformed ticket, or the port's shape is found changed when the engine is about to call `createTurn` | No validated ticket exists, so there is nothing to release. **Terminal `authority_required`** for that pump. P2a is unchanged; the host reopens on its next tick. A caller-supplied error's code, name or text is never inspected or propagated. |
| `enter` throws or rejects, or returns anything other than the two strings or a native Promise of one (a non-native thenable is malformed and is never awaited) | **Terminal `authority_required`** for that pump. The ticket exists and an exception cannot prove that the broker holds no permit for it. No engine work started, so the engine calls the captured `release("withdrawn")` exactly once, as soon as `enter` has thrown, rejected or returned. If that `release` throws, the row below applies, and its `reader_failed` takes precedence. |
| The port's shape is found changed while a validated ticket exists | **Terminal `authority_required`** for that pump. The existing ticket is still finalized through the exactly-once release ledger, using the captured `release`. It gets `release("withdrawn")` if no engine work started, or §5's rule if its turn was granted and ran. |
| `release()` throws (on any path) | The broker's state is uncertain. The engine records the attempt **before** invoking `release`, so it never calls it twice. The claim is **poisoned**: terminal `reader_failed`, no further turns for that pump, no successor admitted by this engine instance. The host must provide an atomic, no-throw `release`. |
| Disposal for a granted turn is unproven or failed (§5) | **No release.** The claim stays poisoned across pump IDs, with no TTL. The existing safety quarantine applies. Only a process restart clears it. The engine's private status shows phase `poisoned`, so the host can alert and restart. |

[code] The pump site is content-free. No protected content read is active (projection reads run in separate Workers, `core/context-product-reader.mjs:111–116`), so the port adds **no** E1 owner-epoch read. If a later change moved admission inside a protected read, E1 would apply (`core/content-safety-boundary.mjs:337–350`).

## 5. Release obligation

`release` is called **exactly once** per validated ticket (§2), with the single exception of a withheld, poisoned claim. A malformed ticket gets no call (§4).

| Path | When the engine calls `release` |
|---|---|
| Queued, then aborted or past its deadline, or a `"defer"` | Immediately: `release("withdrawn")`. |
| Granted, then declined by the recheck | Immediately: `release("declined", reason)`. No work, reservation or disposal happened. Any earlier quarantine stays. |
| Granted; any successful turn: lexical work, the lexical open-only admission, and semantic status, lexical, embeddings or validation, including an embeddings refresh that succeeds after a caught provider timeout and a control-only turn whose controls ran but whose work was skipped | `release("settled")` after settlement **and** the joins below. For the semantic pump, that means its finalizer. |
| Granted; `!result.ok`, a thrown failure, timeout, cutoff, stop, close, renewal handoff, generation loss, or resident replacement | `release("settled")` only after conservative settlement and every **required** disposal is proven. For replacement, that means the predecessor drain plus the new open and admission, never halfway through. |
| Granted; unproven or failed disposal, forced termination, or an elapsed proof deadline | **Withhold** (§4: poisoned). This takes precedence over every row above: if disposal for a granted turn is not proven, `release` is never called, whatever the turn's result. |

**Settlement for the lexical pump:**
- [code] for ordinary work, after the observation, original-ledger settlement and bookkeeping;
- [proposed, depends on the lexical open-only amendment] for an open-only admission turn, after its zero-work settlement. Neither `c23ed4be` nor `700b6008` has a separate admission turn: both still open and refresh in the same turn;
- after the joined shutdown disposal on failure.

**Settlement for the semantic pump.** [code] No per-operation settlement join exists today:
- the semantic client drops late replies (`core/context-semantic-client.mjs:8–10,21–27`);
- coordinator calls resolve on timeout before their Worker handler finishes (`core/context-semantic-coordinator.mjs:173–188`);
- provider settlement and ledger mutation continue after a provider timeout (`core/context-semantic-worker.mjs:190–215`);
- an `ok:true` embedding refresh can follow a caught provider timeout (`core/context-product-index.mjs:437–457`).

[proposed] Each semantic grant therefore gets an engine-owned, exactly-once **finalizer**:
- It joins the turn's open, its control/reserve/finish handlers, its refresh or validation handlers, its provider children, its queued ledger mutations and its required disposals.
- These joins are registered before dispatch.
- A success result or a handler `finally` alone is **not** settlement.

A healthy resident may stay cached after `"settled"`: native read transactions end before return (`core/database.mjs:304–343`). "Required disposal" means attributable cleanup, not tearing down every healthy resident.

**Coordinator ownership:**
- [code] Pump close does not retire a coordinator the host supplied (`core/context-semantic-pump.mjs:361–372`; `docs/context-read-product.md:916–920`). That stays the host's job.
- [proposed] A granted semantic turn whose provider or ledger work is still unsettled at close stays unreleased until that work settles. The host's own coordinator close, with its successful disposal proof (`core/context-semantic-coordinator.mjs:73–120`), settles it. A failed proof poisons it.

## 6. Decline reasons (closed)

[proposed] A decline is new and nonterminal. The `reason` is one of the following:

| Reason | Cause |
|---|---|
| `stopped` | stop, close or error since the request |
| `renewal_expired` | authority or window horizon, or no full allowance left |
| `generation_changed` | accepted renewal or handoff since the request |
| `budget_exhausted` | item/ms quota, floors or semantic exhaustion |
| `spacing` | minimum start spacing not yet met |
| `lane_changed` | the selected lane or slot, or `residentEpoch`, changed |
| `admission_held` | lexical only: the open-only capacity hold after `open_exceeds_quantum` is active for that physical sidecar (at most 2 automatic admissions per capacity epoch, 5 s/30 s backoff, held in process memory) |

A decline never relabels a real failure. Timeouts, provider errors, authority failures inside the turn and malformed port results keep their existing codes and accounting.

## 7. Arithmetic and observation duty

[code] The per-pump capacity bounds are unchanged by the turn:
- **Lexical:** warm `N·S + Q ≤ 5000`, with `S = max(pollMs, Q)` and `N = 2·selections`, at `core/context-product-pump.mjs:82–85`. The cold bound `(N+C)·S + Q ≤ 5000`, where C is the number of fresh resident admissions that can precede a complete sweep, is **proposed** by the lexical open-only amendment and is not in the code yet.
- **Semantic:** `(N + 1 + 2T)·S ≤ 5000`, with `S = max(pollMs, q.maxMs, first.maxMs)`, at `core/context-semantic-pump.mjs:46–49,63`; `docs/context-read-product.md:1285–1299`. The semantic pump has **no** separate open-only turn: opening stays inside its status or work turn (`:246–283`). The lexical open-only amendment excludes `semanticConfig`.
- **Semantic** terms: N is the expanded regular intent/mode lanes, and T is the initial target descriptors.
- With one lexical pump per owner (one selection, two intents), N=2 and, once open-only lands, C=1. At Q=S=1000 that gives warm 3000 and cold 4000.

**Waiting is not in these bounds:**
- Broker waits sit outside every quantum, ledger elapsed time, histogram and stall marker.
- **Worst case, every turn using its full allowance:** a lexical pump is guaranteed its 5,000 ms observation duty only if `Σ broker waits + (N+C)·S + Q ≤ 5000`. For one lexical pump per owner at Q=S=1000, that leaves about **1,000 ms of broker wait per sweep**.
- A per-core broker grants one quantum at a time, and each owner needs 2–3 lexical turns per sweep plus its semantic turns. So under full-allowance occupancy, **more than two owners on one core cannot all be guaranteed the 5 s duty at Q=1000**. Turns that finish well inside their allowance can fit more owners. This bounds the worst case; it is not an absolute owner limit.
- This is a capacity fact, not a contract violation. The ≤30 s commit→ready freshness target is a separate measurement.

**How misses are recorded:**
- [code] Observation duty is tracked per lexical lane. A gap over 5000 ms counts once until a successful observation (lexical pump; semantic `:75–85,330–334`).
- [proposed] Misses stay **wall-time honest**: waiting never fabricates an observation, clears a missed flag, extends authority or the window, or resets a duty.
- Waiting also causes **no** failure, error state or terminal transition. The engine only records it.
- Private diagnostics (§8) attribute misses to waiting.
- The existing `cadenceMisses` meaning is unchanged. [code] In the engine it is diagnostic only: a miss "records a cadence miss and continues maintenance while authority and quota last", the public DTO stays `active` with no error, and the counters live only in the internal maintenance-pump diagnostic (`docs/context-read-product.md:670–683`). No engine control path reads it. Hosts must not treat it as a failure. **No second, wait-excluded clock is needed.** Any consumer that wants a wait-excluded view derives it from the new counters.

## 8. Diagnostics

[proposed] Saturating counters go on each pump's **private** diagnostic snapshot only, reusing `add()` saturation (`core/context-product-attribution.mjs:23–24`). The public status/completion DTO stays closed and unchanged (`core/context-semantic-pump.mjs:107–110`; `docs/context-read-product.md:676–685`).
- `deferredTurns`: the count of `"defer"` outcomes and deadline-defers.
- `turnWaitMs`: total wait, including the currently pending wait at snapshot time.
- `declinedTurns`, keyed by the §6 reason.
- `turnPhase`: `idle` \| `waiting` \| `running` \| `settling` \| `poisoned`.
- `missedObservations`: the raw wall-time overdue lexical duties, once per interval.
- `admissionHold: {held, attempts}`: lexical only, the open-only capacity hold, so a held owner is visible.

There is no growing history. Diagnostic consumers that do not know a field treat it as unavailable.

## 9. Known shared-core limits (risk notes for ≤4 owners)

Neither pump removes these. A multi-owner deployment check should watch them.

- **Canonical safety hold:** [code] keyed by the canonical domain (`core/context-read-supervisor.mjs:47–63`). While owner A's disposal proof is pending, owner B's open or call waits up to its cutoff, and a failed proof gives `reader_failed` (`core/test/context-read-registry-hold.test.mjs:152–164`).
- **Canonical DELETE-mode locks:** maintainer read snapshots delay other writers' commits. Ordinary canonical writers default to a 5,000 ms busy timeout (`core/database.mjs:40,435`), while maintainer DELETE waits stay zero. A hot canonical journal gives `storage_busy`.
- **Shared resources:** the semantic ledger and provider budget, supervisor capacity (256 live records), the reader Worker pool, CPU and I/O.
- **Poisoned claims:** one blocks every owner of that core until restart (§4).
  - The broker is per core and shared by both families, so a poisoned **semantic** claim also stops **lexical** maintenance for every owner on that core. An example is a turn still unsettled at close whose coordinator close then fails its disposal proof (§5).
  - [code] In the engine, a failed disposal proof is `reader_failed` plus the existing quarantine. How a host reacts to a failed close is host policy. Whatever a host does today for one owner, a poisoned claim on the shared broker blocks the whole core.
  - This is a deliberate availability trade for safety. The host should log each poisoned claim once (family and phase) and document an operator restart.

## 10. Checklist against the product requirements

| # | Requirement | Where it is met |
|---|---|---|
| 1 | Awaited before everything, in both pumps, with each semantic turn admitted separately | §3.1 (semantic: one turn per tick, each admitted) |
| 2 | Cancellable by stop, close, renewal handoff and cutoff; no failure record | §3.3 |
| 3 | Deferral is neither error nor completion; how waiting is accounted | §3.4, §7 (honest misses, no failure), §8 |
| 4 | Release exactly once after settlement and proven disposal; withheld if unproven | §5, §4 |
| 5 | A throw or rejection is terminal `authority_required`; deferral is a value, not an exception | §4, §2 (string outcomes) |
| 6 | Composition with open-only, `residentEpoch` and F1 handoff | §3.1, §3.5, §5 (lexical open-only: separate admission and work turns; F1 prompt handoff keeps the resident; a cancelled queued ticket forces no reopen) |
| 7 | Arithmetic per pump unchanged | §7 |
| 8 | Deferred-turn count and wait ms | §8 |

## 11. Agreement record (2026-11-04)

1. **`release(outcome, reason)` arguments.** The draft adds `"withdrawn"`, `"declined"` (with a §6 reason) and `"settled"`, so the broker can record why a turn ended. The broker stays no-throw for any argument values.
2. **Request fields.** `family`, `phase`, `intent`, `maxMs` and `windowId` are carried with `{pumpId, lane, kind}`. The owner is bound through the port instance rather than passed: the host creates one port instance per pump, which means per owner and family.
3. **Lexical open-only admission turn:** `phase:"admission"` with `kind:"lexical"`. The broker queues admission and work tickets the same way.
4. **Shared helper: agreed.** A small module for port validation and the ticket lifecycle. It covers validation, the `createTurn`/`enter` race against the engine signal, the exactly-once release ledger, poisoning and the counters. It lands with the lexical seam; the semantic seam reuses it. Cadence stays per pump.
5. **Semantic implementation scope** (stacks after the lexical seam). It covers the finalizer/settlement join (§5), a separate admission controller and retry clock (§3), and the private counters (§8), all reusing the shared helper.

# First value: a decision that survives a new conversation

The goal is explicit, controllable cross-session memory: save a decision once,
use its current version later, inspect its source and forget it when requested.
This page separates a runnable **no-key installation check** from a **pending
real-model chat experiment**. It is not a recorded successful chat or human study.

## First check: no account, no model key

Follow the [source installer and six-stage walkthrough](local-memory-demo.md#install-from-the-source-checkout).
Choose a new absolute installation directory beneath an existing real parent.
The default walkthrough starts its own fresh synthetic database and strips the
model key from the server environment. It does not test the installation's
future user database, a Hermes profile or semantic relevance.

A passing no-key report means five tools were discovered, a memory and receipt
survived process restart, correction rejected a stale revision, forgetting
removed the active memory, and recall honestly returned `model_not_configured`.
It does **not** mean a chat model knows when to use those tools.

Do not add `--with-recall` as an attempted fix for missing model configuration.
That is an explicit paid path, sends synthetic memory content to the provider,
and the existing walkthrough has no built-in dollar ceiling.

## Select the Hermes route deliberately

For the native preview, use the [pinned Hermes setup](../integrations/hermes/cairn/README.md).
Its verified boundary is Linux, Hermes 0.21.1 commit
`c8aa5608c24e3636e77c267650c0f1f52e44adb0`, Python 3.11 and MCP SDK 2.0.0.
Do not assume the current upstream release or an existing default profile is
equivalent. Use a new dedicated profile and synthetic content for verification.

The native plugin uses the installed **executable**, but owns a different data
location and identity: `<active-profile>/cairn/memory.sqlite` plus `owner-id`.
It does not open or migrate the source installer's `data/memory.sqlite`.
Its namespace is personal to that profile; putting a project name in a memory
does not create a project namespace. Generic MCP with an explicit `--project`
binding is a separate configuration, not another view of the native store.

Two model connections are involved:

| Connection | Purpose | Credential boundary |
| --- | --- | --- |
| Hermes chat model | Decides which tool to call and writes the answer | Configured through the selected host profile |
| Cairn recall model | Selects/ranks memories inside the public engine | Native plugin uses dedicated `CAIRN_MEMORY_OPENAI_API_KEY` |

The native bridge does not reuse the host's generic `OPENAI_API_KEY`. Missing
Cairn recall credentials can therefore coexist with working Hermes chat.
Save/inspect/correct/forget do not call Cairn's model, but asking the **chat
model** to perform them can still cost money. Never paste keys into a prompt,
`cairn.json`, evidence report or committed client configuration.

## Frozen live acceptance protocol — not yet executed

This experiment must wait for a separately reviewed combined budget guard and
explicit new paid-run approval. It must cover both connections above, count
preflights, generation, failures and unknown outcomes across process restarts.
No command on this page launches the experiment or supplies that guard.

Use only this synthetic decision task. Pin the Cairn commit/artifact hash,
Hermes revision, chat model, recall model, prompts, allowed tools, context limits
and trial count **before** calls. Disable other memory channels, background
tools, project context loading and conversation resumption. New sessions share
only the selected Cairn database/owner, not previous messages or answers.
Keep evaluator expectations outside the model's prompts and context files.

| Stage | Prompt given to a fresh chat session | Required evidence |
| --- | --- | --- |
| A: save | “Please remember this explicit decision: the fictional Lantern project runs its release review on Tuesday.” | Actual remember tool success; operator records ID/revision and inspects a matching source receipt |
| B: retrieve | “Use Cairn to check: when does the fictional Lantern project run its release review?” | Actual recall returns the A memory/current revision with supporting receipt; answer states Tuesday without invented details |
| C: correct | “Please correct the Lantern release-review decision to Friday, replacing the old day rather than adding a second decision.” | Actual inspection/correction of the same ID at its current revision; new receipt supports Friday |
| D: retrieve again | Same question as B | Actual recall and final answer use Friday; Tuesday must not be presented as the current day |
| E: forget | “Please forget the Lantern release-review decision.” | Actual forget succeeds at the current revision; operator inspection finds no active memory |
| F: verify forgetting | Same question as B | Actual recall returns no corresponding active memory; answer says the day is unknown rather than guessing Tuesday/Friday |

Each row starts a new agent session/process; do not resume history. The operator
may inspect tool traces after a turn, but must not repair an answer by inserting
the expected tool response. If the model adds another memory instead of
correcting the existing one, or says it forgot without a successful tool call,
retain the failure. Only synthetic task content belongs in evidence artifacts.

This is **explicitly requested tool use**, not a test of spontaneous recall or
automatic capture. A later task can test unprompted usefulness separately. The
native tool names have the `cairn_` prefix; use the host-discovered schema, not
handcrafted tool responses. Existing [scripted loop tests](hermes-agent-loop.md)
are a separate prerequisite, not a substitute for this experiment.

Run a no-memory control with the same question, answering model and allowance,
but no history, Cairn access or other memory. A correct guess without evidence
does not count as sourced recall. Record it rather than treating one control
question as statistically meaningful proof of superiority.

## Evidence and reporting

Retain every attempted trial and phase, including failed/blocked phases. Record
runtime/model identities, elapsed time, provider usage when available, reserved
cost, actual tool names/results, memory IDs/revisions and supporting receipts.
No credentials, personal paths, actual user transcripts or raw provider error
bodies belong in a public report. A timeout after a possible write is an unknown
outcome until inspected, never automatic permission to replay the mutation.

Report three separate outcomes: installation/protocol, real-model task success,
and human usefulness. An unrun phase stays `not_run`; a protocol failure stays
failed; insufficient evidence stays inconclusive. Do not turn a synthetic pass
into measured time savings, retention, universal host support or a benchmark score.
The parallel evaluation track measures broader quality on different data.

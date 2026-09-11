# Conversation history diagnostic

This is a four-history synthetic diagnostic, not LongMemEval or a large-history
benchmark. It checks whether source-faithful capture remains useful after updates,
rejected proposals and intervening messages. No public runtime, prompt or model
default changes are included.

The model-facing fixtures in `evaluations/history-cases.mjs` contain only source
messages and questions. `evaluations/history-rubric.mjs` contains evaluator-only
required/forbidden propositions; the runner must not import it or send it to a
model. The [frozen plan](plans/conversation-history-audit.md) defines acceptance.

`runHistoryAudit` takes an injected model and a fresh private temporary directory.
It captures six windows across four isolated histories, closes/reopens SQLite
between windows, then asks seven final questions. It retains snapshots, receipts,
query envelopes, diagnostics and failures. It never explicitly corrects, admits
or resolves conflicts to repair the observed outcome.

Independent agent review separates:

- Source support for every distinct stored assertion/revision across snapshots.
- Currentness of final active assertions: current, explicitly historical or stale.
- Retention of each required fact, citing actual stored evidence.
- Relevance of every returned memory and whether each question was answered.

A historically supported Friday assertion can still fail currentness after a
later Monday update. Complete execution, authentic receipts and relevant-looking
returns do not independently establish quality. Missing/invalid reviews and
failed or incomplete queries cannot produce acceptance.

## Offline checks

```sh
npm ci --prefix adapters/openai
npm run test:openai
npm test
npm run validate
```

The history regression tests are included in existing OpenAI offline CI and
use actual public core with scripted models. Run on Node22.16 and24. They need
no provider key and do not authorize paid requests. Pinned Claude validation
remains the generic contributor gate. There is no TypeScript gate in this repo.

Live execution, if performed, uses the reviewed private operator, original
cumulative ledger and frozen intent. There is no unguarded public live CLI or
model judge. Failed results must remain visible; any subsequent fix gets a new
versioned experiment rather than rewriting these fixtures or results.

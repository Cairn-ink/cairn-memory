# Experimental relation-model control

Embedded callers may configure the rationale profile for the explicit `relate`
and `reviewRationaleDispositions` ports:

```js
const model = createOpenAIModel({
  apiKey,
  rationaleModel: 'gpt-5.6-luna', // or gpt-5.6-sol
});
```

The default remains `gpt-4.1-mini-2025-04-14`. The disposition port is an
opt-in, read-only review and is never called by automatic capture. This
parameter is independent of
`extractionModel`; qualification, classification, select, rank and reconciliation
stay on their existing baseline. Sol is not a new extraction option. Unknown
names, invented snapshots and null reject before HTTP. No CLI/MCP default changes.

The new choices explicitly set reasoning effort to `none`. The strict schema,
source payload, provider token counting, 6,000 local-input/7,024 provider-input
and 1,024 output-token limits, exact response model ID and no-retry behavior stay
unchanged. Unsupported or unavailable models fail rather than silently falling
back. This is not a comparison of reasoning-effort budgets.

## Selection rationale and evidence limits

We need to separate model-capacity limitations from representation problems
before rewriting the memory engine. [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
is the cost-sensitive candidate; [Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol)
is a flagship control. Official prices checked 2026-09-14 are $0.20/$1.20 and
$4/$20 per million input/output tokens, respectively. Sol's listed promotional
pricing lasts at least through 2026-11-21. Both support structured outputs and
reasoning none, but neither has demonstrated rationale quality in this slice.
These pages list undated names, not dated immutable snapshots; do not claim
frozen model weights or verified account access.

Profiles reserve input at the 1.25x cache-write rate. Luna's existing conservative
ceiling is 2,985 microUSD; Sol's is 55,600 microUSD per HTTP attempt, including
count requests. These are cost estimates using maximum bounded tokens, not
invoices or evidence that count requests are free. A shared transport budget
must enforce its own limits before actual sends; profile metadata alone does not.

Existing paid experiment guards still deny these alternative relation routes.
No guard, grant or authorization changes here. A separately reviewed experiment
must preserve old grants and aggregate budget, freeze fresh cases, retain all
failures and compare identical input contracts before any live quality claim.
The earlier source-only and claim-focus semantic gates remain failed.

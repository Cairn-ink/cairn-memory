# GitHub promotion claims and evidence

This is the evidence checklist for preparing Cairn Memory's GitHub introduction.
Lead with the local developer preview: explicit cross-session memory with
inspectable source receipts, revision-checked correction and logical forgetting.
Keep hosted installation, automatic capture and model-backed quality claims
scoped to their own evidence.

Reviewed on 2026-10-03 against `main` at
`7467aebcb32563c9aab4356a8c3e04c0ebb1ecd4`, also the commit tagged `v0.2.0`.
The latest GitHub release is the [v0.2.0 prerelease](https://github.com/Cairn-ink/cairn-memory/releases/tag/v0.2.0),
published on 2026-10-01. The local archive separately identifies itself as
`cairn-memory-local-preview@0.0.0-preview.1`; a hosted protocol tag is not a
local-package release or certification of every feature in that source tree.
See the [artifact contract](install-artifact.md) and
[release notes](../CHANGELOG.md#020--2026-10-01).

The [2026-10-03 installation checks](promotion/install-validation/README.md)
add three clean, agent-operated installs and model-free SDK walkthroughs of
that source commit on Linux x64. All passed; human onboarding and semantic
recall were not tested in that batch.

## Claims for the introduction

| Intended claim | Mode and evidence | Necessary qualification |
| --- | --- | --- |
| Store memory in a local SQLite file without a Cairn account. | Local public core and source-built preview: [store boundary](local-store.md), [installer walkthrough](local-memory-demo.md#install-from-the-source-checkout). | The core has no network client or telemetry. A configured cloud model receives selected inputs; local storage does not establish fully local model processing. Hosted use has a separate account/token boundary. |
| Inspect the source receipt attached to a memory. | Local default MCP tools: [tool contract](standalone-mcp.md#tools), [recorded keyless responses](demo/transcript.txt). | Explicit remember/correct receipts contain the submitted assertion. They are not authenticated human transcripts, proof of truth or proof of complete source retention. |
| Save in one process and read the memory and receipt in another. | Local installed preview: [recorded demo](demo/README.md), [installed real-model probe](plans/install-artifact.md#installed-provider-and-client-evidence). | The recorded GIF verifies keyless persistence and inspection. The historical real-model probe covers one synthetic installed lifecycle, not general recall reliability or the current checkout's end-to-end quality. |
| Inspect, correct and forget using explicit tools. | Local default MCP: [five-tool contract](standalone-mcp.md#tools), [walkthrough assertions](../adapters/mcp/walkthrough.mjs). | Correction and forgetting require the inspected revision; stale mutations reject. The hosted three-tool MCP surface is a separate contract. |
| Logical forgetting removes a memory from active use and suppresses matching re-admission. | Local core: [storage contract](storage-contract.md), [retention limits](local-store.md#correction-forgetting-and-retention), [backup and uninstall guide](../packaging/README.md). | Suppression follows stored fingerprints; it is not semantic blocking of every paraphrase or secure disk erasure. SQLite pages, sidecars and backups have separate retention boundaries; uninstall preserves the external database. |
| Try remember, inspect, correct and forget without a model key. | Local preview: [installed no-key walkthrough](local-memory-demo.md#installed-no-key-walkthrough), [source startup](standalone-mcp.md#source-startup-commands). | Default semantic recall needs an explicitly supplied OpenAI key and may incur provider charges. Without it, recall reports `model_not_configured`; the demo's result is not a successful semantic recall. |
| Automatic conversation capture is available through the hosted Claude Code plugin. | Hosted plugin: [privacy and data flow](privacy.md#data-flow), [plugin configuration](../plugins/cairn-memory/.claude-plugin/plugin.json), [v0.2.0 changes](../CHANGELOG.md#020--2026-10-01). | Installation and a configured service/token are required; capture and content-free telemetry default on. Default local MCP has explicit tools. Opt-in local capture is explicitly submitted and does not install passive transcript hooks. Hosted v0.2.0 conformance remains a separate gate. |
| The installed local preview has tested SDK and pinned Hermes paths. | [Artifact compatibility matrix](install-artifact.md#verification-and-compatibility), [Hermes agent-loop evidence](hermes-agent-loop.md), [native real-model report](../integrations/hermes/evidence/native-live-v1.json). | State exact host/runtime and test type. SDK transport, scripted host dispatch and a bounded real-model probe do not establish current Claude/Codex/ChatGPT local compatibility or natural model tool selection. |
| The public repository contains a reusable memory core and client integrations. | [Architecture boundary](architecture.md#source-of-truth-rule), [self-hosting requirements](self-hosting.md), [v0.2.0 release scope](../CHANGELOG.md#020--2026-10-01). | Hosted UI, accounts and service operations are separate. The local stdio server cannot stand in for the plugin's HTTP service. There is no public npm release of this local preview. |
| Codex can use the documented hosted explicit MCP connection. | [Hosted connection instructions](../README.md#connect-from-codex-explicit-mcp-memory), [Codex integration boundary](../integrations/codex/README.md), [v0.2.0 release scope](../CHANGELOG.md#020--2026-10-01). | This is distinct from local-preview compatibility and automatic capture. Codex capture building blocks remain uninstalled and disabled; accepting a protocol discriminator does not enable lifecycle hooks or prove hosted support. |

## Supported paths

These entries describe the scope of the cited checks. SDK transport checks do
not establish compatibility with every chat client or the deployed service.

| Path | Requirements | Evidence and present boundary |
| --- | --- | --- |
| Local preview with official SDK stdio client | Git, Node >=22.16, npm, `tar`; no Cairn account; OpenAI key for semantic recall | [Three fresh model-free installs](promotion/install-validation/README.md) on Linux x64, Node 22.16.0 and 24.15.0; a separate historical real-model lifecycle passed. Start with the [installed walkthrough](local-memory-demo.md). |
| Local preview with Hermes 0.21.1 | Pinned Hermes commit `c8aa5608c24e3636e77c267650c0f1f52e44adb0`, Linux x64, separately installed preview | MCP discovery, scripted actual-agent dispatch and a separate native real-model probe are recorded. Versions, archive hashes and limits are in the [Hermes guide](hermes-memory-provider.md) and [agent-loop record](hermes-agent-loop.md). |
| Hosted Claude Code plugin | Compatible hosted HTTP service and Cairn token; plugin runtime Node >=20 | Automatic recall/capture and explicit hosted MCP. Current manifests are v0.2.0; deployed quota/session-start compatibility is not established by this repo audit. See [release boundary](#release-and-promotion-gates). |
| Hosted explicit MCP from Claude Code or Codex | Hosted MCP endpoint and the documented authentication flow | Use the [Claude Code connection](../README.md#hosted-explicit-mcp-for-claude-code) or [Codex connection](../README.md#connect-from-codex-explicit-mcp-memory). Explicit remember/recall/forget only; these instructions do not certify the local stdio package for those clients. |
| Automatic Codex capture | Installed lifecycle integration and verified hosted protocol support still required | Current [building blocks](../integrations/codex/README.md) are uninstalled and disabled by default. Do not advertise an enabled automatic-capture installation. |

## Release and promotion gates

The [marketplace](../.claude-plugin/marketplace.json) and
[plugin manifest](../plugins/cairn-memory/.claude-plugin/plugin.json) both declare
v0.2.0. Its release notes explicitly require verified hosted v0.2.0 support before
Codex sending and hosted quota-response adaptation before deployment conformance.
They include no hosted server implementation or hook enablement. Describe the
hosted installation mode separately from this protocol prerelease; do not turn
older v0.1 prose into an unqualified claim that all v0.2.0 paths are deployed.

Default source-support quality still fails its retained gate, and human adoption
has not been established. Keep evaluation
results and retained failures in [Known limitations](limitations.md), following
[CONTRIBUTING](../CONTRIBUTING.md#where-to-record-evaluation-limitations).
This page maps claims to existing evidence; it does not create a new benchmark,
approve broad-promotion readiness or establish user outcomes. The remaining
product gates are in [ROADMAP](../ROADMAP.md#next-gates); communication and
onboarding checks are in the [promotion plan](plans/github-promotion.md).

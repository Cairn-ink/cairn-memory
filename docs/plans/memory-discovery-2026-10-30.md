# Cairn Memory discovery metadata

Base: `eeef2e8ff777e27515e03b55452e4211578ca912`. Worktree:
`/home/chichieh/Github/cairn-memory-worktrees/memory-discovery-20261030`, branch
`docs/memory-discovery-20261030`. This is a bounded metadata and entry-point
copy change. It does not alter the product, installer version, or published
package.

## Acceptance contract

- **D1 — Identity.** Cairn is the main brand; Cairn Memory is the AI memory
  project from Cairn.ink. The first public package and repository descriptions
  should make that relationship clear. Link the exact npm package
  `@cairn-ink/memory` and repository `Cairn-ink/cairn-memory`. Do not direct
  readers to the unrelated unscoped `cairn-memory` package. Keep installer
  version `0.6.2`, plugin version `0.3.3`, product names, and existing logo
  unchanged.
- **D2 — npm metadata.** Describe the package as Cairn.ink AI memory for Claude
  Code and Codex, with local MCP tools or cloud automatic memory. Add only
  focused terms supported by the package: `memory`, `ai-memory`,
  `agent-memory`, `mcp`, `model-context-protocol`, `claude-code`, `codex`,
  `cairn`, and `cairn-ink`. Set `homepage` to `https://cairn.ink`; preserve the
  scoped package name, GitHub repository metadata, files, scripts, and install
  instructions.
- **D3 — Entry-point copy.** At the start of the npm package README and both
  GitHub READMEs, identify Cairn Memory as Cairn.ink's AI memory project and
  provide descriptive links to the official site, npm package, and repository.
  Keep the addition concise and preserve existing setup steps, anchors, and
  detailed product documentation.
- **D4 — Accurate scope.** Preserve the distinction between explicit local
  MCP tools and cloud automatic memory, including current client and Node
  requirements, key and privacy disclosures, and source-receipt limitations.
  Add no unsupported client, quality, performance, or capability claims.
- **D5 — Bounded discovery baseline.** Freeze these unbranded queries:
  `ai memory`, `mcp memory`, `claude code memory`, and `codex memory`.
  `memory` may be recorded as a broad exploratory query, but is not part of the
  focused acceptance set. Record the top 20 results independently from the
  official npm registry search API and GitHub repository search, with query,
  date, rank, result URL, and whether the result is Cairn.ink, the exact scoped
  package, or the exact repository. Exact-name discovery, general search rank,
  Google indexing, site citations, and AI citations are separate outcomes. Do
  not change or combine the existing 20-prompt / 60-slot pilot.
- **D6 — Baseline and claims.** The published npm `0.6.2` package currently has
  no keywords, describes local MCP tools or cloud automatic memory for Claude
  Code and Codex, and points its homepage at the GitHub install section. GitHub
  already describes Cairn.ink Memory and links to `https://cairn.ink`; its
  existing topics include `agent-memory`, `ai-agents`, `cairn-ink`,
  `claude-code`, `local-first`, `mcp`, `mcp-server`, `memory`, `provenance`, and
  `sqlite`. Existing README copy already explains the product, but the opening
  paragraph does not explicitly connect it to Cairn.ink. The focused API
  baseline below found neither the exact package nor repository in their
  respective sampled top 20 for any frozen query. Label these metadata changes
  as unpublished until a separately approved release; claim no discovery
  improvement before comparable indexed results exist.
- **D7 — Scope and affected surfaces.** Only these files may change:
  `packages/setup/package.json`, `packages/setup/README.md`, `README.md`,
  `README.zh-TW.md`, `docs/limitations.md`, this plan, and `CHANGELOG.md`. A
  small Unreleased changelog note may describe the metadata and documentation
  update only. Do not change runtime, generated files, build manifests,
  dependencies, versions, live accounts, production, publication, tags,
  settings, or the prior pilot. The changed discovery surfaces are npm package
  search/homepage/package README and GitHub README entry points; retained
  discovery evidence also goes in `docs/limitations.md` per CONTRIBUTING. No UI
  replay is implicated. The primary agent owns the scoped PR gates: Node
  22.16/24.15 tests, packaging, and final diff review. Any release qualification
  and publication remain later work under the release checklist and separate
  approval. This worker runs static JSON and scoped-diff checks only; no heavy
  tests or installs.

## Initial discovery-surface audit

| Surface | Published/current state before this change |
| --- | --- |
| npm package | `@cairn-ink/memory@0.6.2`; no keywords; package description covers local MCP tools or cloud automatic memory for Claude Code and Codex; homepage points to the GitHub install section. |
| GitHub repository | About text says “Cairn.ink Memory: lightweight cross-session memory for AI agents, with receipts.” Homepage is `https://cairn.ink`; topics are recorded in D6. |
| GitHub READMEs | Both identify the memory project and link to Cairn.ink, but the opening product description does not make the Cairn.ink relationship explicit. |
| Focused unbranded search | Neither the exact npm package nor exact GitHub repository appeared in the top 20 for any of the four frozen queries; details follow. |

## Search baseline and follow-up

The primary audit queried the public npm registry search API and GitHub
repository search independently on **2026-10-30 09:08:04–09:08:06 UTC**
(17:08 Asia/Taipei). It used each API's default search order, with no extra
qualifiers or sort. Every request returned HTTP 200 and 20 results; all four
GitHub responses reported `incomplete_results: false`.
The request patterns were
`https://registry.npmjs.org/-/v1/search?text=<query-with-spaces-as-plus>&size=20`
and
`https://api.github.com/search/repositories?q=<query-with-spaces-as-plus>&per_page=20`.

| Query | npm total | `@cairn-ink/memory` in top 20? | GitHub total | `Cairn-ink/cairn-memory` in top 20? |
| --- | ---: | --- | ---: | --- |
| `ai memory` | 266,791 | No | 52,244 | No |
| `mcp memory` | 175,112 | No | 12,788 | No |
| `claude code memory` | 2,108,039 | No | 7,919 | No |
| `codex memory` | 98,055 | No | 3,921 | No |

The primary audit independently reconciled all 160 focused result rows against
the raw response ledger (exit 0). A separate exploratory `memory` query, not a
fifth focused query, returned 20 results from each API at 09:09:53 UTC: npm
total 65,372; GitHub total 494,785 (`incomplete_results: false`). The exact
package and repository were absent. Its raw summary is
`broad-memory-baseline.json` in the evidence directory below.

Separate branded identity controls at 09:22:29–09:22:30 UTC returned the npm
query `@cairn-ink/memory` at position 1 of 20 and GitHub query
`cairn-memory user:Cairn-ink` at position 1 of 1 (both HTTP 200). These controls
are not part of the unbranded baseline and do not indicate generic-memory
visibility improvement. The summary is in `branded-controls.json` in the
evidence directory below; raw payloads are in `npm-branded-control.json` and
`github-branded-control.json`.

For the unbranded queries, the exact package/repository rank is unavailable:
each target was absent from the sampled top 20. These API results do not measure
the website's search order, Google web rankings, site citations, or AI citations.
The focused response summary and its eight raw responses are retained outside
the worktree at
`/home/chichieh/.local/share/cairn/seo-geo/2026-10-30-discovery/`.

After a separately approved package publication, record its actual version and
release date, then repeat these same query URLs and compare npm and GitHub
results separately. Do not schedule automatic reruns.

## Entry-point checks

| Changed surface | Existing dependent checks | Owner and evidence |
| --- | --- | --- |
| npm package metadata | JSON parses; `name`, `version`, `repository`, `files`, `scripts`, and `engines` remain unchanged; homepage and keywords match D2. | Worker: static JSON parse and diff inspection. |
| npm package README | Setup examples, bilingual instructions, and local/cloud disclosures remain intact; site/package/repository links are exact. | Worker: diff inspection. |
| English and Traditional Chinese GitHub READMEs | Existing anchors and detailed content remain intact; opening identifies the Cairn.ink relationship and links to the three official entry points. | Worker: diff inspection. |
| Evaluation limitations record | Labeled as discovery measurement, links to this plan, and separates API visibility from product-quality evidence. | Worker: diff inspection. |
| Discovery query baseline | Query list, platform-specific results, and post-publication follow-up remain separate from the existing pilot. | Primary audit: eight API responses and summary at the private evidence path above. |

## Routing record

Implementation was delegated for this bounded documentation and metadata task.
The requested `gpt-5.6-luna/max` was unavailable; the actual selection was
`gpt-6-luna/max`. The primary agent retains integration and acceptance.

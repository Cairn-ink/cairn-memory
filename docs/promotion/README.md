# Cairn Memory promotion materials

This folder contains the share image, reproducible demo, installation evidence,
reader-test materials and measurement records for the GitHub developer-preview
introduction. The [promotion plan](../plans/github-promotion.md) defines the
launch criteria. Prepared materials do not establish human adoption or a
completed campaign.

## Share image

![Cairn Memory: AI memory with a source, inspect, correct and forget](social-preview.png)

- Upload: [social-preview.png](social-preview.png), 1280 × 640 pixels, 82,216 bytes.
- Editable source: [social-preview.svg](social-preview.svg).
- Suggested alt text: “Cairn Memory developer preview. AI memory with a source.
  Inspect, correct and forget. An illustrated Harbor memory links to its
  submitted source text. Local SQLite and explicit MCP tools; semantic recall
  uses your OpenAI key.”
- The card is an illustrated example, not a screenshot or a new model result.
  Product name, headline and example were checked at 640 × 320 pixels.

The PNG follows GitHub's [social-preview size and format guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview).
The asset still needs uploading in the repository's
[Settings](https://github.com/Cairn-ink/cairn-memory/settings) under Social preview.
Saving it here does not change that setting.

The repository topics now include `agent-memory`, `mcp-server`, `sqlite` and
`local-first`, preserving the existing topics. The read-back result and remaining
publication status are in [repository-settings.json](repository-settings.json).

## Campaign and reader testing

Use the [campaign kit](campaign-kit.md) for the X and Threads copy, recruitment
message and neutral reader-test script. Record all five reader attempts in
[reader-test.csv](reader-test.csv); pending rows are not failures or passes.
Once an attempt begins, an unanswered or interrupted attempt counts as a
non-pass under the plan's rule. Keep contact details outside this public repo.

[Installation evidence](install-validation/README.md) distinguishes automated
checks from the required unfamiliar human operator. The
[demo](demo/README.md) documents its source transcript and rendering scope.

## Measurement

From the repository root, with Python 3 and an existing GitHub CLI login that
can read this repository's traffic:

```sh
python3 tools/promotion/snapshot.py --phase preparation
```

Each invocation writes a new UTC-stamped directory under `metrics/`, containing
the API response data and a summary. It reads GitHub and writes local files;
it does not publish, schedule jobs or collect reader content. The repository
response retains only the explicitly listed summary fields. A partial API
failure is saved in `summary.json` and returns a nonzero exit status.

The [first saved snapshot](metrics/20261002T171417.327267Z/summary.json) was
collected at 2026-10-02 17:14 UTC (2026-10-03 01:14 Taipei): 20 stars,
222 views and 51 whole-window unique visitors for the returned dates
2026-09-18 through 2026-10-01. This is a preparation observation. It does not
replace the star count immediately before the first campaign post.

After the launch criteria pass, run with `--phase campaign` immediately before
publishing and once per UTC day through the 14-day observation period. Enter
the actual URL, account, UTC time, asset and starting stars into
[publications.csv](publications.csv). The header-only file currently means
there are no recorded posts. Recruitment can be logged separately from the
formal D0 campaign start. Record voluntary, substantive responses in
[feedback.csv](feedback.csv), using anonymous participant IDs.

The [GitHub traffic API](https://docs.github.com/en/rest/metrics/traffic) returns
a rolling 14-day window. Preserve raw windows; do not add daily uniques.
Per-channel star attribution and clone-to-install conversion are unavailable
from these endpoints. Installer and reviewer visits can affect the counts.
No recurring collection job has been installed; start the daily collection
when D0 is known, and record missed days rather than inventing data.

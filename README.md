# action-agent

GitHub Action (Node) that runs Codex CLI from issues and issue comments.

## What this does

- Runs Codex on GitHub-hosted runners.
- Persists Codex session state per issue via [Workflow Artifacts](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts).
- Posts responses back to the issue.
- Can create branches/commits and open PRs when instructed.

## Requirements

1) OpenAI API key
- Add `OPENAI_API_KEY` as a secret in the target repo or org.

2) Repo settings (required for PR creation)
- Settings → Actions → Workflow permissions → enable **“Allow GitHub Actions to create and approve pull requests.”**

3) Caller workflow permissions
- `contents: write` — push branches/commits back to the repo.
- `issues: write` — add reactions and post issue comments.
- `pull-requests: write` — create draft PRs from branches.
- `actions: read` — list/download artifacts for session restore.

## Quick start (caller workflow)

Create a workflow in the target repo, e.g. `.github/workflows/action-agent-issue.yml`:

```yaml
name: action-agent

on:
  issues:
    types: [opened, edited]
  issue_comment:
    types: [created, edited]

permissions:
  contents: write
  issues: write
  pull-requests: write
  actions: read

jobs:
  action-agent:
    runs-on: ubuntu-latest
    concurrency:
      group: ${{ format('issue-{0}', github.event.issue.number) }}
      cancel-in-progress: false
    steps:
      - name: Checkout repo
        uses: actions/checkout@v4

      - name: Setup node
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Run action-agent
        uses: sudden-network/action-agent@main
        with:
          issue_number: ${{ github.event.issue.number }}
          comment_id: ${{ github.event.comment.id || '' }}
          openai_api_key: ${{ secrets.OPENAI_API_KEY }}
          github_token: ${{ github.token }}
          # Optional:
          # model: gpt-5.1-codex-mini
          # reasoning_effort: low
```

## Notes

- The action runs on an ephemeral runner. It tells Codex to commit and push any repo changes so work persists between runs.
- Session artifacts are handled automatically by the action; follow‑up comments resume from the latest saved session. Artifacts are retained for 7 days, so conversations expire after that retention window.
- `AGENTS.md` (if present in the repo root) is loaded automatically and will influence agent behavior.

# Codex Worker

GitHub Action (Node) that runs Codex CLI from issues and issue comments.

## What this does

- Runs Codex on GitHub-hosted runners.
- Persists Codex session state per issue via artifacts.
- Posts responses back to the issue.
- Can create branches/commits and open PRs when instructed.

## Requirements

1) OpenAI API key
- Add `OPENAI_API_KEY` as a secret in the target repo or org.

2) Repo settings (required for PR creation)
- Settings → Actions → Workflow permissions → enable **“Allow GitHub Actions to create and approve pull requests.”**
- The **Read and write** default is optional if your workflow sets explicit permissions (this one does).

3) Caller workflow permissions
- `contents: write` — push branches/commits back to the repo.
- `issues: write` — add reactions and post issue comments.
- `pull-requests: write` — create draft PRs from branches.
- `actions: read` — list/download artifacts for session restore.

4) Runner requirements
- Bash shell, `git`, `gh`, and `node` available.

## Quick start (caller workflow)

Create a workflow in the target repo, e.g. `.github/workflows/codex-worker-issue.yml`:

```yaml
name: Codex Worker Issue

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
  codex-worker:
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

      - name: Run Codex Worker
        uses: etienne-martin/codex-worker/.github/actions/codex-worker@main
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

- The runner filesystem is ephemeral. Only commits pushed to a branch persist.
- For follow-up comments, a session artifact must exist or the run fails.
- If Codex creates changes, it should commit and push before responding.
- `AGENTS.md` (if present in the repo root) is loaded automatically and will influence agent behavior.

## Files

- `/.github/actions/codex-worker/action.yml` — Node action entry point.
- `/draft.md` — original design notes and exploration.

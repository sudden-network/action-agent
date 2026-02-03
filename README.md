# action-agent

Run the OpenAI Codex CLI as a GitHub Action for any workflow trigger (issues, pull requests, comments, schedule, workflow_dispatch, etc.).

This action is intentionally thin:
- Installs a pinned `@openai/codex` CLI version.
- Logs in with your `api_key`.
- Configures GitHub MCP so Codex can interact with GitHub using the workflow `github_token` (scoped by your workflow `permissions`).
- Optionally resumes a per-issue / per-PR Codex session via GitHub [Workflow Artifacts](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts).
- Runs `codex exec` with a prompt built from the GitHub event context + your optional `prompt` input.

## What you can build with this

Because you can attach `action-agent` to any workflow trigger and provide a tailored `prompt`, you can build focused agents, for example:
- Issue auto-triage: ask the right questions, label, detect duplicates, close with references.
- PR reviews: summarize changes, identify risks, propose fixes, open follow-up PRs.
- Repo maintenance on a schedule: weekly backlog grooming, stale PR nudges, summaries, "what changed this week" digests.
- One-off automations via workflow dispatch: "triage everything with label X", "draft release notes", "summarize open incidents".

## Inputs

| Input | Required | Description |
| --- | --- | --- |
| `api_key` | yes | Model provider API key (used for `codex login`). |
| `github_token` | yes | GitHub token used by the action (API + artifacts) and passed to Codex as `GITHUB_TOKEN` for MCP. |
| `model` | no | Codex model override (passed to `codex exec --model`). |
| `reasoning_effort` | no | Codex reasoning effort override (passed via `-c model_reasoning_effort=...`). |
| `prompt` | no | Extra instructions appended to the built-in prompt. |
| `resume` | no | Enable per-issue/per-PR session resume (`true`/`false`). Default: `false`. |

## Configuring the agent

- Use `prompt` for per-workflow instructions (triage rules, review style, escalation policy, etc).
- If your repo has an `AGENTS.md` at the repo root, Codex will pick it up and use it as persistent guidance across runs.

## Permissions (job-level)

This action relies on the workflow `GITHUB_TOKEN`. Grant only what you need at the job level.

Common permissions:
- `issues: write` to post issue comments (including PR conversation comments).
- `pull-requests: write` to comment on PRs and open PRs.
- `contents: write` to push branches/commits.
- `actions: read` to download/list artifacts (required only when `resume: true`).

If you want the agent to open PRs, also enable the repo setting:
Settings -> Actions -> Workflow permissions -> "Allow GitHub Actions to create and approve pull requests."

## GitHub MCP (how the agent talks to GitHub)

This action configures the GitHub MCP server for Codex and passes `GITHUB_TOKEN` to the Codex process.

- MCP inherits the same workflow `permissions` you grant to `github_token`.
- You do not need to loosen the Codex sandbox for Codex to interact with GitHub.

## Quick start examples

All examples assume you created a secret named `OPENAI_API_KEY`.

### 1) Issue assistant (triage + resume)

```yaml
name: action-agent

on:
  issues:
    types: [opened, edited]
  issue_comment:
    types: [created, edited]

jobs:
  agent:
    runs-on: ubuntu-latest
    permissions:
      issues: write
      actions: read # required only because resume: true
    steps:
      - uses: sudden-network/action-agent@main
        with:
          api_key: ${{ secrets.OPENAI_API_KEY }}
          github_token: ${{ github.token }}
          resume: true
          prompt: |
            Triage this thread.
            Ask clarifying questions if needed.
            If it's a duplicate, link the canonical issue and close this one.
```

### 2) PR reviewer (code-aware)

If you want Codex to read/modify repository files, you must checkout the repo.

```yaml
name: action-agent

on:
  pull_request:
    types: [opened, edited, synchronize, ready_for_review]
  issue_comment:
    types: [created, edited] # PR conversation comments also come through here
  pull_request_review_comment:
    types: [created, edited] # inline comments

jobs:
  agent:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
      actions: read # only if resume: true
    steps:
      - uses: actions/checkout@v4
      - uses: sudden-network/action-agent@main
        with:
          api_key: ${{ secrets.OPENAI_API_KEY }}
          github_token: ${{ github.token }}
          model: gpt-5.1-codex-mini
          reasoning_effort: low
          resume: true
          prompt: |
            Review this PR. Be concise and concrete.
            If you can fix something safely, open a follow-up PR with the change.
```

### 3) Scheduled agent (maintenance / "night shift")

Resume does not apply to scheduled runs (no issue/PR thread), so keep it disabled.

```yaml
name: action-agent-night-shift

on:
  schedule:
    - cron: "0 9 * * 1-5" # weekdays

jobs:
  agent:
    runs-on: ubuntu-latest
    permissions:
      issues: write
      pull-requests: write
    steps:
      - uses: sudden-network/action-agent@main
        with:
          api_key: ${{ secrets.OPENAI_API_KEY }}
          github_token: ${{ github.token }}
          prompt: |
            Summarize the top 5 oldest PRs and open a single issue titled "Daily PR triage" with next steps.
```

### 4) Manual dispatch (ad-hoc agent)

```yaml
name: action-agent-dispatch

on:
  workflow_dispatch:
    inputs:
      prompt:
        description: What you want the agent to do for this run
        required: true

jobs:
  agent:
    runs-on: ubuntu-latest
    permissions:
      issues: write
      pull-requests: write
    steps:
      - uses: sudden-network/action-agent@main
        with:
          api_key: ${{ secrets.OPENAI_API_KEY }}
          github_token: ${{ github.token }}
          prompt: ${{ inputs.prompt }}
```

## Resume (persistent sessions)

When `resume: true` and the event is tied to an issue or pull request, action-agent:
- Downloads the latest Workflow Artifact for that thread (`action-agent-issue-<n>` or `action-agent-pr-<n>`).
- Restores it into `~/.codex` before running Codex.
- Uploads the updated session state after the run.

Notes:
- Resume is blocked on public repositories (the action throws).
- Resume requires `actions: read` to list/download artifacts.
- Artifact retention is controlled by your repo/org settings (see [Workflow Artifacts](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts)).

## Safety model

- The action refuses to run unless the triggering `github.actor` has write access (admin/write/maintain) to the repo.
- Codex runs with its default `codex exec` sandbox settings.
- GitHub side effects are constrained by the workflow `permissions` you grant to `GITHUB_TOKEN`.

## Troubleshooting

- `403: Resource not accessible by integration` typically means missing workflow permissions (`contents: write`, `pull-requests: write`, `issues: write`, etc.).
- `Resume is enabled but the workflow lacks actions: read permission.` means you set `resume: true` but didn't grant `actions: read`.
- If the workflow succeeds but you don't see a comment, check the run logs. By design, Codex decides when/where to comment; the built-in prompt encourages commenting only when useful.

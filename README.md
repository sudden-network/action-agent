# action-agent

Run the [OpenAI Codex CLI](https://github.com/openai/codex) as a GitHub Action for any [workflow trigger](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows) (issues, pull requests, comments, schedule, workflow_dispatch, etc.).

This action is intentionally thin:
- Installs a pinned `@openai/codex` CLI version.
- Logs in with your `api_key`.
- Starts a built-in [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server so Codex can interact with GitHub (scoped by your workflow `permissions`).
- Optionally resumes a per-issue / per-PR Codex session via GitHub [Workflow Artifacts](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts).
- Runs `codex exec` with a prompt built from the GitHub event context + your optional `prompt` input.

## What you can build with this

Because you can attach `action-agent` to any workflow trigger and provide a tailored `prompt`, you can build focused agents, for example:
- Issue auto-triage: ask the right questions, label, detect duplicates, close with references.
- PR reviews: summarize changes, identify risks, propose fixes, open follow-up PRs.
- Scheduled automation: periodic code security audits, cleanup, recurring maintenance.
- One-off automations via workflow dispatch: "triage everything with label X", "draft release notes", "summarize open incidents".

## Inputs

| Input | Required | Description |
| --- | --- | --- |
| `api_key` | yes | Model provider API key (used for `codex login`). |
| `github_token` | yes | GitHub token used by the action (MCP server + artifacts). |
| `model` | no | Codex model override (passed to `codex exec --model`). |
| `reasoning_effort` | no | Codex reasoning effort override (passed via `-c model_reasoning_effort=...`). |
| `prompt` | no | Additional instructions for the agent. |
| `resume` | no | Enable per-issue/per-PR session resume (`true`/`false`). Default: `false`. |

## Configuring the agent

- Use `prompt` for per-workflow instructions (triage rules, review style, escalation policy, etc).
- If you want repo-level instructions, add an `AGENTS.md` at the repo root and run this action after `actions/checkout` so Codex can read it.

## Permissions

This action relies on the workflow `GITHUB_TOKEN`. Grant only what you need at the job level.
See GitHub documentation for [permissions](https://docs.github.com/en/actions/security-guides/automatic-token-authentication#permissions-for-the-github_token).

Common permissions:
- `issues: write` to post issue comments (including PR conversation comments).
- `pull-requests: write` to comment on PRs and open PRs.
- `contents: write` to push branches/commits.
- `actions: read` to download/list artifacts (required only when `resume: true`).

If you want the agent to open PRs, also enable the repo setting:
Settings -> Actions -> Workflow permissions -> "Allow GitHub Actions to create and approve pull requests."

## Persistent sessions

When you enable `resume`, the agent doesn't start from scratch on every new comment or update. Instead, it resumes the previous Codex session for the same issue or pull request, so it can:
- Keep the full context of an evolving thread (requirements, decisions, past suggestions).
- Reference earlier comments naturally, even after many follow-ups.
- Stay consistent across multiple workflow runs (for example: issue opened -> clarifying Q&A -> later comment -> later edit -> etc.).

When `resume: true` and the event is tied to an issue or pull request, action-agent:
- Downloads the latest Workflow Artifact for that thread (`action-agent-issue-<n>` or `action-agent-pr-<n>`).
- Restores it into `~/.codex` before running Codex.
- Uploads the updated session state after the run.

Notes:
- Resume is blocked on public repositories (the action throws).
- Resume requires `actions: read` to list/download artifacts.
- Artifact retention is controlled by your repo/org settings (see [Workflow Artifacts](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts)).

## GitHub MCP (how the agent talks to GitHub)

This action starts a local MCP server that exposes GitHub tools to Codex.

- MCP inherits the same workflow `permissions` you grant to `github_token`.
- The `github_token` is held by the action process (not exposed directly to Codex).
- Use `github.octokit_request` to call GitHub REST endpoints.

## Quick start examples

All examples assume you created a secret named `OPENAI_API_KEY`.

### Issue assistant

Auto-triage issue threads: ask clarifying questions, detect duplicates, and keep context across follow-ups.

```yaml
name: action-agent-issues

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

### PR reviewer

Review pull requests, respond to PR comments, and open follow-up issues.

```yaml
name: action-agent-pr-reviewer

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
      - uses: actions/checkout@v4 # required for Codex to read/modify repo files

      - uses: sudden-network/action-agent@main
        with:
          api_key: ${{ secrets.OPENAI_API_KEY }}
          github_token: ${{ github.token }}
          resume: true
          prompt: |
            Review this pull request. Be concise and specific.
            Focus on correctness, security, and maintainability.
            If you find issues, leave inline comments when appropriate and propose concrete fixes.
```

### Scheduled agent

Run periodic automation that would be annoying to do manually (e.g. a regular code security review that files issues).

```yaml
name: action-agent-scheduled

on:
  schedule:
    - cron: "0 9 * * 1-5" # weekdays

jobs:
  agent:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: write
    steps:
      - uses: actions/checkout@v4 # required for Codex to read repo files
      - uses: sudden-network/action-agent@main
        with:
          api_key: ${{ secrets.OPENAI_API_KEY }}
          github_token: ${{ github.token }}
          prompt: |
            Perform a security review of this repository.
            Open GitHub issues for any findings (include file paths, risk, and suggested fixes).
```

### Manual dispatch

Kick off an agent run on demand with a one-off prompt (release notes, repo audit, triage a label, etc).

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

## Safety model

- The action refuses to run unless the triggering `github.actor` has write access (admin/write/maintain) to the repo.
- Codex runs with its default `codex exec` sandbox settings.
- GitHub side effects are constrained by the workflow `permissions` you grant to `GITHUB_TOKEN`.

## Troubleshooting

- `403: Resource not accessible by integration` typically means missing workflow permissions (`contents: write`, `pull-requests: write`, `issues: write`, etc.).
- `Resume is enabled but the workflow lacks actions: read permission.` means you set `resume: true` but didn't grant `actions: read`.

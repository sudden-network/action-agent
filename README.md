# Codex Worker: Feasibility + Design Notes

## Feasibility (short)

Yes. GitHub Actions can host Codex CLI runs, trigger them manually or from PR comments, persist sessions via artifacts, and reuse a single "worker" workflow across repos. See refs in this doc for the specific primitives.

## Core features -> how to implement

### 1) Manual start from GitHub mobile (issue-driven)

- **Need**: Trigger a run with an initial prompt.
- **Implement**: Create an issue with title + description as the prompt. A workflow on `issues` (created/edited) starts the run and uses the issue content as the initial prompt.
- **Refs**: GitHub Actions events docs.

### 2) PR comment-driven loop

- **Need**: Agent responds to PR comments and can be continued by replying.
- **Implement**: `issue_comment` trigger with `types: [created, edited]` and guard with `if: github.event.issue.pull_request` to ensure PR-only.
- **Refs**: `issue_comment` docs.

### 2b) Issue comment-driven loop (thread on issue)

- **Need**: Back-and-forth on the issue before a PR exists.
- **Implement**: Use `issue_comment` without the PR guard for issue threads. Persist the Codex session id on the issue (label or hidden marker comment) and read it on each follow-up.
- **Refs**: `issue_comment` docs.

### 3) Worker lives in separate repo

- **Need**: Reuse the same automation across multiple repos.
- **Implement**: Reusable workflow (`on: workflow_call`) in the worker repo. In target repos, call via `jobs.<id>.uses: owner/repo/.github/workflows/<file>@<ref>`.
- **Notes**: Called workflow inherits caller context; `GITHUB_TOKEN` permissions can only be **downgraded** by the called workflow.
- **Refs**: Reusable workflow docs.

### 4) Persist Codex context between runs

- **Need**: Continue the agent session after a comment.
- **Implement**: Use explicit session ids + per-thread artifacts:
  - Codex stores transcripts locally; session ids are available in the picker, `/status`, or under `~/.codex/sessions/`.
  - Do not rely on `--last` when runs can overlap; always pass a specific session id.
  - Source of truth is the Codex session id created by the initial run; capture it after the run from `~/.codex/sessions/` (or `/status` in TUI) and persist it alongside the artifact.
  - Each thread (initial prompt) has its own session id and its own artifact; never reuse an artifact across threads or branches.
  - Only persist the current session + its artifacts in the uploaded bundle (no other sessions).
- **Refs**: Codex CLI features + Codex CLI reference + GitHub artifacts docs.

### 5) Secrets + auth for Codex

- **Need**: Secure auth in GitHub-hosted runners.
- **Implement**: Use repo secrets + env vars. Codex caches auth in `~/.codex/auth.json` (or OS keyring). Treat the file as sensitive. Device-code login exists for headless envs (`codex login --device-auth`). Optionally force file-based storage via `cli_auth_credentials_store` so auth can be carried in an artifact.
- **Refs**: Codex auth docs.

### 6) Concurrency + queuing

- **Need**: Controlled ordering with multiple runs possible.
- **Implement**: Use `concurrency` to limit parallelism per session id, not globally. Always route a comment to its matching session id to avoid `--last`. Use per-thread artifacts so runs in different threads never share state. You still need a queue/drain strategy in the workflow logic.
- **Refs**: Concurrency docs.

### 7) Cancellation feedback

- **Need**: If a workflow is canceled, comment back on the PR.
- **Implement**: Add a step gated by `if: ${{ cancelled() }}` to post a cancellation comment.
- **Refs**: Workflow cancellation docs.

## Suggested architecture (minimal)

### Worker repo (single source of truth)

Reusable workflow with these phases:

1. Checkout target repo (using caller context).
2. Restore the per-thread session artifact (only that session).
3. Run Codex with the prompt and explicit session id:
   - initial (bootstrap phase): run `codex exec "<prompt>"`, read the generated Codex session id from `~/.codex/sessions/`, and persist it on the issue (label or marker comment).
   - follow-up (issue thread): read the session id from the issue and run `codex exec resume <session-id> "<comment>"`.
   - follow-up (PR thread): read the session id persisted on the PR and run `codex exec resume <session-id> "<comment>"`.
4. If code changes are requested, create the session branch and commit/push once after the run finishes (see Branch + PR naming below).
5. Post the agent response back on the issue (issue thread) or on the PR (PR thread).
6. Upload updated per-thread `~/.codex` bundle as an artifact.
7. When a PR is created from an issue, fork a new session id for the PR thread and persist it on the PR; comments move to the PR.

### Target repo (thin wrappers)

- **Bootstrap**: `issues` workflow that calls the worker workflow with the issue title + body as the initial prompt.
- **Comment**: `issue_comment` workflow that routes issue comments vs PR comments.

## Queue options (two viable paths)

### Option A: Drain-in-one-run (simpler)

- Each run:
  1. Load the "last processed comment id" per session id from state.
  2. Process all new issue or PR comments for that session id in order.
  3. Re-check once for new comments before exit.
- Works with `concurrency` to ensure one active run, avoids reliance on run ordering.

### Option B: Explicit queue file (more robust)

- A lightweight "enqueue" workflow appends comment payloads to a queue file artifact or a dedicated branch.
- A single "worker" workflow drains the queue sequentially under a fixed concurrency group.

## Feasibility notes / gotchas

- `issue_comment` fires for both issues and PRs; guard with `github.event.issue.pull_request`.
- For the bootstrap flow, use `issues` events and ignore non-task issue types by label or title prefix.
- Reusable workflow permissions are inherited from the caller; they cannot be elevated in the worker repo.
- Concurrency group ordering is not guaranteed; pending runs can be replaced.
- Artifact retention is configurable with `retention-days` but capped by org/repo policy.
- Use explicit session ids when multiple runs can overlap; avoid `--last`.
- Persist one artifact per thread; do not share artifact bundles across branches or prompts.
- Closing keywords in PR descriptions only auto-link/close issues when the PR targets the default branch.

## Suggested MVP plan

1. Build worker repo with one reusable workflow.
2. Add thin caller workflows in one target repo (issue bootstrap + comment-driven).
3. Add artifact-based session persistence and explicit session ids.
4. Add queue logic (Option A first, Option B later).

## Branch + PR naming

- **Branch name**: include the issue number + short kebab-case prompt summary.
- **Example**: `codex/issue-<issue-number>/<short-kebab-summary>`.
- **Behavior**: only create a branch when code changes are needed. Commit and push once after the run finishes. The session id is captured from the issue for resume; it does not need to be in the branch name.
- **PR**: create a PR at the end of the issue thread (non-draft), or only when explicitly requested. Include a closing keyword in the PR body, e.g. `Closes #<issue-number>`, so GitHub links and auto-closes the issue when merged.
- **Issue link**: optionally link the branch to the issue via the issue sidebar (Development) or by creating the branch from the issue so it appears under Development.

## Thread isolation

- **Definition**: a thread starts at the initial prompt and owns a single Codex session id.
- **End condition**: the issue thread ends when a PR is created; the PR starts a new thread with its own session id.
- **Artifact rule**: one artifact per thread; name it with the session id and restore only that artifact.
- **State rule**: bundle only the current session and its artifacts; exclude other sessions to avoid cross-thread bleed.
- **Issue rule**: persist the session id on the issue (label or hidden marker comment) so the thread can continue before a PR exists.
- **PR rule**: when a PR is opened, fork a new session id and persist it on the PR; comments move to the PR thread.

## Artifact cleanup

- **Policy**: rely on artifact `retention-days` to auto-expire per thread (simple, low maintenance).
- **Suggested**: set `retention-days: 7` on upload.
- **Behavior**: always upload with `overwrite: true` to replace the prior artifact for the thread and reset the retention window (no artifact history kept).

## References

- OpenAI Codex CLI features: https://developers.openai.com/codex/cli/features
- OpenAI Codex CLI reference: https://developers.openai.com/codex/cli/reference
- OpenAI Codex auth: https://developers.openai.com/codex/auth
- GitHub Actions events: https://docs.github.com/en/actions/reference/events-that-trigger-workflows
- GitHub Actions reusable workflows: https://docs.github.com/en/actions/reference/workflows-and-actions/reusable-workflows
- GitHub Actions reusing workflows: https://docs.github.com/en/enterprise-cloud%40latest/actions/using-workflows/reusing-workflows
- GitHub Actions concurrency: https://docs.github.com/en/actions/using-jobs/using-concurrency
- GitHub Actions workflow cancellation: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-cancellation
- GitHub Actions artifacts: https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-what-your-workflow-does/storing-and-sharing-data-from-a-workflow
- GitHub Issues: linking a pull request to an issue: https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue
- GitHub Issues: using keywords in issues and pull requests: https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/using-keywords-in-issues-and-pull-requests
- GitHub Issues: creating a branch for an issue: https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-a-branch-for-an-issue

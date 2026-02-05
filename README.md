# action-agent

Run programmable agents on any [GitHub Workflow](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflows) (issues, pull requests, comments, schedule, dispatch, etc.) to unlock a wide range of automation.

## Persistent sessions

Sessions persist per issue and pull request, so the agent picks up where it left off across new comments, edits, and new commits.

This makes iterative work practical: the agent remembers what it already covered, reacts to changes, and stays consistent throughout the process.

## What you can build with this

You can attach an agent to any workflow and provide a custom prompt to unlock a huge range of automations. For example:

- [Code review](recipes/code-review.md) - Review PRs, respond to comments, and open follow-up issues.
- [Issue assistant](recipes/issue-assistant.md) - Auto-triage issue threads with clarifying questions and duplicate detection.
- [Manual dispatch](recipes/manual-dispatch.md) - Kick off a one-off run with a custom prompt.
- [Security audit](recipes/security-audit.md) - Run periodic code security reviews and file issues.
- [Todo to issues](recipes/todo-to-issue.md) - Create issues for new TODOs introduced on develop.

Have a useful workflow? [Share your recipe](https://github.com/sudden-network/action-agent/new/main/recipes?filename=recipe.yml)

## Action Inputs

| Input | Required | Description |
| --- | --- | --- |
| `agent` | no | Agent to run (`codex` default). |
| `agent_api_key` | yes | Agent API key. |
| `github_token` | yes | GitHub token used by the action. |
| `model` | no | Agent model override (for Codex, append reasoning effort with /, e.g. `gpt-5.2-codex/xhigh`) |
| `prompt` | no | Additional instructions for the agent. |
| `resume` | no | Enable session persistence. Default: `false`. |

- Session persistence requires the `actions: read` permission to download artifacts.
- Artifact retention is controlled by your repo/org settings (see [Workflow Artifacts](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts)).

## Configuring the agent

- Use `prompt` for per-workflow instructions.
- If you want repo-level instructions, add an [AGENTS.md](https://agents.md/) file and run this action after `actions/checkout` so the agent can read it.

## Permissions

This action relies on the workflow `GITHUB_TOKEN`.

> Grant only what you need at the job level.
See GitHub documentation for [permissions](https://docs.github.com/en/actions/security-guides/automatic-token-authentication#permissions-for-the-github_token).

Common permissions:
- `issues: write` to post issue comments (including PR conversation comments).
- `pull-requests: write` to comment on PRs and open PRs.
- `contents: write` to push branches/commits.
- `actions: read` to download/list artifacts.

If you want the agent to open PRs, also enable the repo setting:
Settings -> Actions -> Workflow permissions -> "Allow GitHub Actions to create and approve pull requests."

## Security

- The `GITHUB_TOKEN` is held by the action process and is not exposed directly to the agent.
- The action only runs on private repositories and fails on public/unknown visibility.
- The action refuses to run unless the triggering `github.actor` has write access to the repo.
- GitHub side effects are constrained by the workflow `permissions` you grant to `GITHUB_TOKEN`.
- By default, `GITHUB_TOKEN` is scoped to the repository running the workflow: it cannot write to other repositories unless you supply a broader token with cross-repo access.
- Agents run in `read-only` sandbox mode: they can read files but cannot write to disk or access the network, even from shell commands.

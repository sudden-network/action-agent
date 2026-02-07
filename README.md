# Workflow Agent

Run programmable agents on any [GitHub Workflow](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflows) (issues, pull requests, comments, schedule, dispatch, etc.) to enable automation across your repo.

## What you can automate

You can attach an agent to any workflow and provide a custom prompt to unlock a wide range of automations. For example:

- [Code review](recipes/code-review.md) - Review PRs, respond to comments, and open follow-up issues.
- [Issue assistant](recipes/issue-assistant.md) - Auto-triage issue threads with clarifying questions and duplicate detection.
- [Manual dispatch](recipes/manual-dispatch.md) - Kick off a one-off run with a custom prompt.
- [Security audit](recipes/security-audit.md) - Run periodic code security reviews and file issues.
- [Tag and release](recipes/tag-and-release.md) - Tag and publish releases when versions change.
- [Todo to issues](recipes/todo-to-issue.md) - Create issues for new TODOs introduced on the default branch.
- [Version bump](recipes/version-bump.md) - Suggest version bumps based on PR impact.

Have a useful workflow? [Share your recipe](https://github.com/sudden-network/workflow-agent/new/main/recipes?filename=recipe.yml)

## Persistent sessions

Sessions persist per issue and pull request, so the agent picks up where it left off across new comments, edits, and new commits.

This makes iterative work practical: the agent remembers what it already covered, reacts to changes, and stays consistent throughout the process.

## Action inputs

| Input | Required | Description |
| --- | --- | --- |
| `agent` | no | Agent to run (`codex` default). |
| `agent_api_key` | no | Agent API key. Required unless `agent_auth_file` is set. |
| `agent_auth_file` | no | Agent auth file content (agent-specific). |
| `github_token` | yes | GitHub token used by the action. |
| `model` | no | Agent model override (for Codex, append reasoning effort with /, e.g. `gpt-5.3-codex/xhigh`) |
| `prompt` | no | Additional instructions for the agent. |
| `resume` | no | Enable session persistence. Default: `false`. |

- Session persistence requires the `actions: read` permission to download artifacts.
- Artifact retention is controlled by your repo/org settings (see [Workflow Artifacts](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts)).

## Configuring the agent

- Use `prompt` for per-workflow instructions.
- If you want repo-level instructions, add an [AGENTS.md](https://agents.md/) file and run this action after `actions/checkout` so the agent can read it.

## Authentication

Authentication is agent-specific, but this action exposes two generic ways to pass credentials:

- `agent_api_key`: API key auth (recommended for CI).
- `agent_auth_file`: inject an agent-specific auth file into the runner.

Treat `agent_auth_file` like a password (it grants access to the underlying agent account).

For the default agent (`codex`), `agent_auth_file` can be used to inject Codex's `auth.json` (from `~/.codex/auth.json`) so the CLI can use a ChatGPT subscription.

## GitHub App quick start

Use the Workflow Agent GitHub App when you need capabilities that `GITHUB_TOKEN` cannot provide (for example, updating workflow files or cross-repo changes).

1. Install the Workflow Agent GitHub App on your org or repo.
2. Store the app credentials as secrets: `WORKFLOW_AGENT_APP_ID` and `WORKFLOW_AGENT_APP_PRIVATE_KEY`.
3. Mint an installation token in your workflow and pass it to `github_token`.

```yaml
- uses: actions/create-github-app-token@v1
  id: app-token
  with:
    app-id: ${{ secrets.WORKFLOW_AGENT_APP_ID }}
    private-key: ${{ secrets.WORKFLOW_AGENT_APP_PRIVATE_KEY }}
- uses: sudden-network/workflow-agent@vX
  with:
    github_token: ${{ steps.app-token.outputs.token }}
```

If you do not have app credentials, keep using `GITHUB_TOKEN`.

Maintainers can bootstrap the app using `github-app-manifest.json` in this repo.

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

Note: GitHub blocks `GITHUB_TOKEN` from updating workflow files in `.github/workflows/`.

## Security

- The `GITHUB_TOKEN` is held by the action process and is not exposed directly to the agent.
- The action refuses to run unless the triggering `github.actor` has write access to the repo.
- GitHub side effects are constrained by the workflow `permissions` you grant to `GITHUB_TOKEN`.
- By default, `GITHUB_TOKEN` is scoped to the repository running the workflow: it cannot write to other repositories unless you supply a broader token with cross-repo access.
- Agents run in `read-only` sandbox mode: they can read files but cannot write to disk or access the network, even from shell commands.
- Use clear, scoped prompts and least-privilege permissions.
- Agents can make mistakes, so scope triggers carefully and keep permissions minimal before enabling.
- Keep humans in the loop for decisions that affect code, security, or policy.

This action uses generative AI to produce responses and automation. It runs with the workflow’s permissions; review prompts, triggers, and repo access before enabling it, and keep permissions minimal.

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

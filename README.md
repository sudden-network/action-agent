# Sudden Agent

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

Have a useful workflow? [Share your recipe](https://github.com/sudden-network/agent/new/main/recipes?filename=recipe.yml)

## Persistent sessions

Sessions persist per issue and pull request, so the agent picks up where it left off across new comments, edits, and new commits.

This makes iterative work practical: the agent remembers what it already covered, reacts to changes, and stays consistent throughout the process.

## Action inputs

| Input | Required | Description |
| --- | --- | --- |
| `agent` | no | Agent to run (`codex` default). |
| `agent_api_key` | no | Agent API key. Required unless `agent_auth_file` is set. |
| `agent_auth_file` | no | Agent auth file content (agent-specific). |
| `github_token` | no | GitHub token used by the action (defaults to the workflow token). |
| `github_token_actor` | no | Actor login for `github_token` when using a non-workflow token (e.g. `sudden-agent[bot]`). |
| `model` | no | Agent model override (for Codex, append reasoning effort and service tier with `/`, e.g. `gpt-5.6-sol/xhigh/fast`). |
| `prompt` | no | Additional instructions for the agent. |
| `resume` | no | Enable session persistence. Default: `false`. |
| `sudo` | no | Disable sandbox; allow write + network access. Default: `false`. |

- Session persistence requires the `actions: read` permission to download artifacts.
- Artifact retention is controlled by your repo/org settings (see [Workflow Artifacts](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts)).

## Configuring the agent

- Use `prompt` for per-workflow instructions.
- If you want repo-level instructions, add an [AGENTS.md](https://agents.md/) file and run this action after `actions/checkout` so the agent can read it.

### Codex model selection

Set `model` to `<model>[/<reasoning effort>[/<service tier>]]`. For example, use `gpt-5.6-sol/xhigh/fast` for Sol with extra-high reasoning and fast mode.

Current GPT-5.6 choices are:

- `gpt-5.6-sol` for complex work where capability matters most.
- `gpt-5.6-terra` to balance capability and cost.
- `gpt-5.6-luna` for efficient, high-volume work.

See OpenAI's [model guidance](https://developers.openai.com/api/docs/guides/latest-model) for current model and reasoning options. Omit `model` to let Codex choose its default.

## Authentication

Authentication is agent-specific, but this action exposes two generic ways to pass credentials:

- `agent_api_key`: API key auth (recommended for CI).
- `agent_auth_file`: inject an agent-specific auth file into the runner.

Treat `agent_auth_file` like a password (it grants access to the underlying agent account).

For the default agent (`codex`), `agent_auth_file` can be used to inject Codex's `auth.json` (from `~/.codex/auth.json`) so the CLI can use a ChatGPT subscription.

To use Codex with a ChatGPT subscription in GitHub Actions, create and upload a dedicated `CODEX_AUTH_JSON` secret:

```bash
./scripts/setup-codex-auth-secret.sh
```

The helper uses `gh` and arrow-key menus to select a personal repository, an organization repository, or an organization secret. For an organization secret, choose its visibility and any selected repositories. If you are on a remote machine, the helper prints one macOS command that uploads the credential to the exact target you selected. See the [GitHub App setup](github-app/README.md) for prerequisites, remote setup, manual setup, and workflow configuration.

## Permissions

This action relies on the workflow `GITHUB_TOKEN`.

> Grant only what you need at the job level.
See GitHub documentation for [permissions](https://docs.github.com/en/actions/security-guides/automatic-token-authentication#permissions-for-the-github_token).

If you provide a non-workflow token, also set `github_token_actor` so the agent can recognize its own comments.

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
- In non-`sudo` Codex mode on GitHub-hosted Linux runners, this action prepares Codex sandboxing by enabling unprivileged user namespaces and clearing Ubuntu's AppArmor user namespace gate for the rest of the job.
- Use clear, scoped prompts and least-privilege permissions.
- Agents can make mistakes, so scope triggers carefully and keep permissions minimal before enabling.
- Keep humans in the loop for decisions that affect code, security, or policy.

This action uses generative AI to produce responses and automation. It runs with the workflow’s permissions; review prompts, triggers, and repo access before enabling it, and keep permissions minimal.

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

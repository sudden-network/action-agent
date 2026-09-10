# GitHub App setup

This folder contains a helper HTML page with an embedded manifest to create a GitHub App with the right defaults.

## When to use a GitHub App

- You want a distinct bot identity for comments and commits.
- You need your agent to be able to update workflow files in `.github/workflows`.
- You need your agent to refresh repository Actions secrets such as `CODEX_AUTH_JSON`.
- You need org-wide access across multiple repos.

## Create the app

1. Open [create-app.html](./create-app.html) in your browser (download it first, then open locally).
2. Select the App owner and `CODEX_AUTH_JSON` scope. Use an organization-owned App for organization repositories and secrets.
3. Click "Create GitHub App from manifest".
4. Review the configuration and create the app.
5. GitHub redirects you with a `code` in the URL. Paste that code into the helper page to get the conversion command.
6. Run the conversion command to finalize the app and get the client ID and private key:

```bash
gh api --method POST /app-manifests/<code>/conversions
```

7. Install the app on your org or repo. Select the repo(s) you want the app to access. If “selected repositories,” ensure your target repo is included.

Alternatively create the app manually in GitHub settings if you want different permissions.

## Store credentials

- Set `WORKFLOW_AGENT_GITHUB_APP_CLIENT_ID` as a variable.
- Set `WORKFLOW_AGENT_GITHUB_APP_PRIVATE_KEY` as a secret.

Use org-level settings for reuse across repos, or repo-level settings for a single repo.

## Use in a workflow

```yaml
- uses: actions/create-github-app-token@v3
  id: app_token
  with:
    client-id: ${{ vars.WORKFLOW_AGENT_GITHUB_APP_CLIENT_ID }}
    private-key: ${{ secrets.WORKFLOW_AGENT_GITHUB_APP_PRIVATE_KEY }}
    permission-secrets: write
    # Add only when CODEX_AUTH_JSON is an organization secret:
    # permission-organization-secrets: write

- uses: sudden-network/agent@v1
  with:
    agent_auth_file: ${{ secrets.CODEX_AUTH_JSON }}
    github_token: ${{ steps.app_token.outputs.token }}
    github_token_actor: ${{ steps.app_token.outputs.app-slug }}[bot]
    ...
```

## Use Codex with ChatGPT in Actions

For the default agent (`codex`), `agent_auth_file` can inject Codex's `auth.json` so the CLI can use a ChatGPT subscription. Codex can update that login file during a run, so the action saves the updated file back into `CODEX_AUTH_JSON`.

During a run:

- The workflow passes `agent_auth_file: ${{ secrets.CODEX_AUTH_JSON }}`.
- The action writes that value to Codex's `~/.codex/auth.json`.
- Codex may update `auth.json`.
- If `auth.json` changed, the action saves it back to the existing `CODEX_AUTH_JSON` repository or organization secret.

Requirements:

- The workflow must pass `agent_auth_file: ${{ secrets.CODEX_AUTH_JSON }}`. GitHub does not let actions read secret values by name.
- `CODEX_AUTH_JSON` must already exist as a repository secret or an organization secret shared with the repository.
- A repository secret needs a GitHub App token with `permission-secrets: write`.
- An organization secret also needs `permission-organization-secrets: write` and the App's `organization_secrets: write` permission.
- The default `GITHUB_TOKEN` cannot update either secret.

Use a separate Codex `auth.json` for this GitHub Actions secret. Running `codex logout` with the same file revokes its refresh token and invalidates `CODEX_AUTH_JSON`. Treat the file like a password, as described in the [Codex authentication documentation](https://developers.openai.com/codex/auth).

### Create and upload the secret

Use Bash on macOS, Linux, or WSL. Install Node.js and the GitHub CLI. Authenticate `gh`, then run the helper from a clone of this repository:

```bash
gh auth login
./scripts/setup-codex-auth-secret.sh
```

The helper:

1. Lets you choose a repository Actions secret or organization Actions secret.
2. Lists repositories where you have admin access when repository selection is required.
3. Lets you choose `selected`, `private`, or `all` visibility for an organization secret.
4. Lets you choose one or more repositories when you select `selected` visibility.
5. Shows the target, existing visibility, resulting access, and create or replace action.
6. Asks whether you are on a remote machine.
7. On a remote machine, prints one macOS command with the exact repository or organization access you selected, then exits.
8. Otherwise, confirms the action and opens a fresh Codex browser login in a temporary `CODEX_HOME`.
9. In the local flow, passes `auth.json` to `gh secret set` from a permission-restricted temporary file, then deletes it.

Use the Up and Down arrow keys and press Enter in each single-choice menu. In the selected-repository menu, press Enter to choose one repository. Press Space to select multiple repositories, then press Enter to continue. Press `q` to cancel.

On a remote machine, choose `Yes, show a command for my local Mac`. Copy the printed command and run it on a trusted Mac. The Mac needs Node.js, `pbcopy`, `pbpaste`, and an authenticated GitHub CLI. The command opens the browser login locally, uploads the credential to the selected target, and clears the clipboard after a successful upload. The credential does not pass through the remote machine.

OpenAI recommends [device-code authentication (beta)](https://developers.openai.com/codex/auth) for general headless Codex login. This helper offers a Mac handoff so the dedicated credential goes directly from the trusted local machine to GitHub.

For organization secrets, choose `Selected repositories`, `Private repositories`, or `All repositories`. Repository selection appears only for `Selected repositories`. Prefer selected access unless broader sharing is required. When replacing a secret, review the current and requested access before confirming. A repository secret named `CODEX_AUTH_JSON` takes precedence over an organization secret with the same name.

Organization secret setup needs GitHub organization owner access. For a GitHub CLI OAuth login, add the required scope before running the helper:

```bash
gh auth refresh --scopes admin:org
```

Create a fresh login for each repository or organization secret. Do not reuse one generated `auth.json` across separate secrets.

### Manual macOS clipboard setup

Create that separate file locally without touching your normal `~/.codex` login:

```bash
curl -fsSL https://raw.githubusercontent.com/sudden-network/agent/main/scripts/bootstrap-codex-auth.sh | bash
```

The script uses Codex browser login with a fresh temporary `CODEX_HOME` and copies `auth.json` with macOS `pbcopy`. Paste it into `CODEX_AUTH_JSON`, or pipe it from the clipboard:

```bash
bash -o pipefail -c 'pbpaste | gh secret set CODEX_AUTH_JSON --app actions --repo OWNER/REPOSITORY && pbcopy </dev/null'
```

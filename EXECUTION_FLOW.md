# Execution flow (ActionAgent action)

This describes the current runtime order in `/.github/actions/action-agent/src/index.js`.

1) Inputs + context bootstrap
- Read inputs: `issue_number`, `comment_id`, `model`, `reasoning_effort`, `openai_api_key`, `github_token`.
- Pull repo context (`owner`, `repo`) and event action (`opened/edited/created`).
- Instantiate Octokit.

2) Codex env + paths
- Compute `codexHome`, `codexStateDir`, `codexSessionsPath`.
- Export CODEX env vars.
- Build `codexEnv` (includes GH_TOKEN, GITHUB_TOKEN, OPENAI_API_KEY).

3) Early checks + setup
- Install Codex CLI (`npm install -g @openai/codex@...`).
- If API key missing, set failure output (no run).
- If event is `edited`, do “stale edit” guard:
  - Fetch latest issue/comment body from API.
  - Compare with event payload; if mismatch → return early (no comment).

4) Add “eyes” reaction
- If comment: react on comment. Else: react on issue.
- Errors are logged and ignored.

5) Resume decision + artifact restore
- Determine `isFollowUp` (comment or issue edited).
- If follow‑up:
  - List artifacts.
  - Filter by name `action-agent-session-<issue>`.
  - Sort by `created_at`, pick latest.
  - Download artifact into temp dir.
  - Restore into `CODEX_STATE_DIR` (handles both root/sessions layouts).
  - If missing → fail with “Session artifact not found; cannot resume.”

6) Load issue/comment data
- Fetch issue title/body/url.
- If commentId:
  - Fetch comment body/url.

7) Build prompt
- If comment body exists:
  - If `edited` event: add header with comment URL + “respond to updated content”.
  - Use comment body as prompt; set `resumeMode = true`.
- Else (issue open / issue edited):
  - Load `prompt-template.md`.
  - If `edited` event, prepend “Issue updated” header and set `resumeMode = true`.
  - Replace template placeholders with issue data.

8) Codex login (after restore)
- `printenv OPENAI_API_KEY | codex login --with-api-key`.
- If login fails → fail with “Codex login failed.”

9) Run Codex
- Build args:
  - `codex exec --json --sandbox workspace-write` plus env config.
  - Optional `--model` and `model_reasoning_effort`.
  - If resume mode: `resume --last -`, else `-` (stdin).
- Execute Codex with prompt as stdin.
- Capture stdout/stderr to `/tmp/codex_output.txt`.

10) Extract response
- Parse JSONL and capture last `agent_message` text.
- Write to `/tmp/codex_response.txt`.
- If parsing fails, fall back to raw output.

11) Cleanup Codex state
- Remove `auth.json`.
- Remove `tmp/` folder.

12) Upload session artifact (on success)
- If codex exit is 0:
  - List all files in `CODEX_STATE_DIR`.
  - Upload artifact `action-agent-session-<issue>`.

13) Compose comment body + post
- Optional header (edited issue/comment).
- If codex failed: use output file.
- Else: use response file.
- Post comment to the issue.

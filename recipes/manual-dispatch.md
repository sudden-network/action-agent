# Manual dispatch

Kick off an agent run on demand with a one-off prompt.

## Workflow

```yaml
name: manual-dispatch

on:
  workflow_dispatch:
    inputs:
      prompt:
        description: What you want the agent to do for this run
        required: true

jobs:
  manual-dispatch:
    runs-on: ubuntu-latest
    permissions:
      actions: read # enable artifact access if needed
      contents: write # enable repo edits when requested
      issues: write # post comments, open issues
      pull-requests: write # comment on PRs, open PRs
    steps:
      - name: Run workflow-agent
        uses: sudden-network/workflow-agent@v1
        with:
          agent_api_key: ${{ secrets.OPENAI_API_KEY }}
          github_token: ${{ github.token }}
          prompt: ${{ inputs.prompt }}
```

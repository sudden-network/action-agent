# Issue assistant

Auto-triage issue threads: ask clarifying questions and close duplicates.

## Workflow

```yaml
name: issue-assistant

on:
  issues:
    types: [opened, edited]
  issue_comment:
    types: [created, edited]

jobs:
  issue-assistant:
    runs-on: ubuntu-latest
    permissions:
      issues: write # post comments, close duplicates
      actions: read # resume sessions via artifacts
    steps:
      - name: Run workflow-agent
        uses: sudden-network/workflow-agent@v1
        with:
          agent_api_key: ${{ secrets.OPENAI_API_KEY }}
          github_token: ${{ github.token }}
          resume: true
          prompt: |
            Triage this thread.
            Ask clarifying questions if needed.
            If it's a duplicate, link the canonical issue and close this one.
```

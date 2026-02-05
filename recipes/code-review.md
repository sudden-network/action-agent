# Code review

Review pull requests, respond to PR comments, and open follow-up issues when requested.

## Workflow

```yaml
name: code-review

on:
  pull_request:
    types: [opened, edited, synchronize, ready_for_review]
  issue_comment:
    types: [created, edited] # PR conversation comments also come through here
  pull_request_review_comment:
    types: [created, edited] # inline comments

jobs:
  code-review:
    runs-on: ubuntu-latest
    permissions:
      contents: read # read PR diff and files
      pull-requests: write # inline review comments and replies
      issues: write # PR conversation comments and follow-up issues
      actions: read # resume sessions via artifacts
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Run action-agent
        uses: sudden-network/action-agent@main
        with:
          agent_api_key: ${{ secrets.OPENAI_API_KEY }}
          github_token: ${{ github.token }}
          resume: true
          prompt: |
            Review this pull request. Be concise and specific.
            Focus on correctness, security, and maintainability.
            If you find issues, leave inline comments when appropriate and propose concrete fixes.
            Only open follow-up issues when explicitly requested.
```

# Security audit

Run a scheduled security review that scans for risky patterns and files issues with suggested fixes.

## Workflow

```yaml
name: security-audit

on:
  schedule:
    - cron: "0 22 * * *" # daily at 22:00

jobs:
  security-audit:
    runs-on: ubuntu-latest
    permissions:
      contents: read # scan repo for findings
      issues: write # file issues with results
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Run action-agent
        uses: sudden-network/action-agent@main
        with:
          agent_api_key: ${{ secrets.OPENAI_API_KEY }}
          github_token: ${{ github.token }}
          prompt: |
            Perform a security review of this repository.
            Open GitHub issues for any findings (include file paths, risk, and suggested fixes).
```

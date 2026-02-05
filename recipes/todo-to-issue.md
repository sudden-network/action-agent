# Todo to issues

Scan new TODOs introduced on the default branch and open issues for the ones that do not already exist.

## Workflow

```yaml
name: todo-to-issue

on: push

jobs:
  todo-to-issues:
    runs-on: ubuntu-latest
    if: ${{ github.ref_name == github.event.repository.default_branch }}
    permissions:
      contents: read # scan repo for TODOs
      issues: write # create issues for new TODOs
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Run workflow-agent
        uses: sudden-network/workflow-agent@v1
        with:
          agent_api_key: ${{ secrets.OPENAI_API_KEY }}
          github_token: ${{ github.token }}
          prompt: |
            Scan the repository for TODO comments introduced by this merge.
            For each new TODO, check whether a matching issue already exists.
            If there is no matching issue, create a new issue that references the file and line.
            Do not create duplicates. Do not reopen or edit existing issues.
```

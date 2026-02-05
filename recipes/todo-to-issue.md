# Todo to issues

Scan new TODOs introduced on `develop` and open issues for the ones that do not already exist.

## Workflow

```yaml
name: todo-to-issue

on:
  push:
    branches:
      - develop

jobs:
  todo-to-issues:
    runs-on: ubuntu-latest
    permissions:
      contents: read # scan repo for TODOs
      issues: write # create issues for new TODOs
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Run action-agent
        uses: sudden-network/action-agent@develop
        with:
          agent_api_key: ${{ secrets.OPENAI_API_KEY }}
          github_token: ${{ github.token }}
          prompt: |
            Scan the repository for TODO comments introduced by this merge.
            For each new TODO, check whether a matching issue already exists.
            If there is no matching issue, create a new issue that references the file and line.
            Do not create duplicates. Do not reopen or edit existing issues.
```

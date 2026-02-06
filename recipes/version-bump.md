# Version bump

Suggest a semantic version bump for pull requests.

## Workflow

```yaml
name: version-bump

on:
  pull_request:
    types: [opened, reopened, edited, synchronize, ready_for_review]

jobs:
  version-bump:
    if: ${{ !github.event.pull_request.draft }}
    runs-on: ubuntu-latest
    permissions:
      contents: read # read PR files and diffs
      pull-requests: write # post inline review comments
      issues: write # post PR conversation comments
      actions: read # resume sessions via artifacts
    steps:
      - name: Run workflow-agent
        uses: sudden-network/workflow-agent@v1
        with:
          agent_api_key: ${{ secrets.OPENAI_API_KEY }}
          github_token: ${{ github.token }}
          resume: true
          prompt: |
            Goal: keep the package.json version aligned with the impact of changes.

            Review the PR changes and decide whether a version bump is needed:
            - Breaking changes -> major.
            - New backward compatible features -> minor.
            - Backward compatible bug fixes, security fixes, dependency updates -> patch.
            - Internal-only changes, no runtime changes -> none.

            If you recommend a bump:
            - Comment on the PR with a short summary explaining the reason for the bump.
            - Include the current version and the proposed version in a diff-style code fence:
              ```diff
              - version: <current>
              + version: <proposed>
              ```
            If you do not recommend a bump, do not comment.
```

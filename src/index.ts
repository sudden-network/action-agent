import { setFailed } from '@actions/core';
import { bootstrap, runCodex, teardown } from './codex';
import { postErrorComment } from './github/comment';
import { isIssueOrPullRequest } from './github/context';
import { ensurePermission } from './github/permissions';
import { buildPrompt } from './prompt';

const main = async (): Promise<void> => {
  try {
    await Promise.all([
      ensurePermission(),
      bootstrap(),
    ]);
    await runCodex(buildPrompt());
    await teardown();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    setFailed(`action-agent failed: ${message}`);

    if (isIssueOrPullRequest()) {
      await postErrorComment(message);
    }
  }
};

void main();

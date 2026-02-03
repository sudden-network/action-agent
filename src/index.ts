import { setFailed } from '@actions/core';
import { bootstrap, runCodex, teardown } from './codex';
import { postErrorComment } from './comment';
import { isIssueOrPullRequest } from './context';
import { ensurePermission } from './permissions';
import { buildPrompt } from './prompt';

const main = async (): Promise<void> => {
  try {
    await ensurePermission();
    await bootstrap();
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

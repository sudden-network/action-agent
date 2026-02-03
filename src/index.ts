import { setFailed } from '@actions/core';
import { context } from '@actions/github';
import { bootstrap, runCodex, teardown } from './codex';
import { postComment } from './comment';
import { getIssueNumber, getSubjectType } from './context';
import { readInputs } from './input';

const main = async (): Promise<void> => {
  try {
    const { apiKey, githubToken } = readInputs();

    await bootstrap({ apiKey, githubToken });

    await runCodex([
      'You are action-agent, running inside a GitHub Actions runner.',
      `Repo: ${context.repo.owner}/${context.repo.repo}`,
      `Event: ${context.eventName}`,
      `Subject: ${getSubjectType()} #${getIssueNumber()}`,
      `Workspace: ${process.env.GITHUB_WORKSPACE}`,
      `Event: ${await import(process.env.GITHUB_EVENT_PATH ?? "")}`, // TODO throw if it's undefined
      'Act autonomously and take action only if it is useful.',
    ].join('\n'), githubToken);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await postComment(`
action-agent failed:
\`\`\`
${message}
\`\`\`
    `);

    setFailed(`action-agent failed: ${message}`);
  } finally {
    await teardown();
  }
};

void main();

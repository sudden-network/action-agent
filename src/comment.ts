import { context, getOctokit } from '@actions/github';
import { getIssueNumber } from './context';
import { inputs } from './input';
import { isPermissionError } from './permissions';

export const postComment = async (comment: string): Promise<void> => {
  const { owner, repo } = context.repo;

  try {
    await getOctokit(inputs.githubToken).rest.issues.createComment({
      owner,
      repo,
      issue_number: getIssueNumber(),
      body: comment,
    });
  } catch (error) {
    if (isPermissionError(error)) return;
    throw error;
  }
};

export const postErrorComment = async (comment: string): Promise<void> => {
  await postComment(`
action-agent failed:
\`\`\`
${comment}
\`\`\`
    `.trim())
};

import core from '@actions/core';
import github from '@actions/github';
import { getIssueNumber } from './github-context';

export const postComment = async (message: string): Promise<void> => {
  const { owner, repo } = github.context.repo;
  const githubToken = core.getInput('github_token', { required: true });

  await github.getOctokit(githubToken).rest.issues.createComment({
    owner,
    repo,
    issue_number: getIssueNumber(),
    body: message,
  });
};

import { warning } from '@actions/core';
import { context } from '@actions/github';
import { getIssueNumber } from './context';
import { isPermissionError } from './error';
import { getOctokit } from './octokit';

export const postComment = async (comment: string) => {
  const { owner, repo } = context.repo;

  try {
    await getOctokit().rest.issues.createComment({
      owner,
      repo,
      issue_number: getIssueNumber(),
      body: comment,
    });
  } catch (error) {
    if (isPermissionError(error)) {
      warning('Attempted to post a comment but the workflow lacks `issues: write` permission.');
      return;
    }
    throw error;
  }
};

export const postErrorComment = async () => {
  const { serverUrl, runId } = context;
  const { owner, repo } = context.repo;
  const runUrl = `${serverUrl}/${owner}/${repo}/actions/runs/${runId}`;

  await postComment(`action-agent failed, see workflow run: ${runUrl}`);
};

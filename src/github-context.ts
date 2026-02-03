import { error } from '@actions/core';
import { context } from '@actions/github';

export const getIssueNumber = (): number => {
  const { issue, pull_request } = context.payload;

  if (issue?.number) return issue.number;
  if (pull_request?.number) return pull_request.number;

  const message = 'Missing issue or pull request number in event payload.';
  error(message);
  throw new Error(message);
};

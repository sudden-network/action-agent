import { inputs } from './input';

export const WORKFLOW_TOKEN_ACTOR = 'github-actions[bot]';

const isWorkflowToken = () => {
  return inputs.githubToken === inputs.workflowGithubToken;
}

export const resolveTokenActor = async (): Promise<string> => {
  if (inputs.githubTokenActor) return inputs.githubTokenActor;
  if (!isWorkflowToken()) {
    throw new Error('Missing `github_token_actor` input for non-workflow GitHub tokens.');
  }
  return WORKFLOW_TOKEN_ACTOR;
};

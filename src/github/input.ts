import { getInput } from '@actions/core';

export const inputs = {
  get agentApiKey(): string | undefined {
    return getInput('agent_api_key') || undefined;
  },
  get agentAuthFile(): string | undefined {
    return getInput('agent_auth_file') || undefined;
  },
  get githubToken(): string {
    const token = getInput('github_token') || inputs.workflowGithubToken;

    if (!token) {
      throw new Error('Missing GitHub token. Set `github_token` input or provide the workflow token.');
    }

    return token;
  },
  get workflowGithubToken(): string | undefined {
    return getInput('workflow_github_token') || undefined;
  },
  get githubTokenActor(): string | undefined {
    return getInput('github_token_actor') || undefined;
  },
  get agent(): string {
    return getInput('agent') || 'codex';
  },
  get model(): string | undefined {
    return getInput('model') || undefined;
  },
  get prompt(): string | undefined {
    return getInput('prompt') || undefined;
  },
  get resume(): boolean {
    return getInput('resume').toLowerCase() === 'true';
  },
};

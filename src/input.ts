import core from '@actions/core';

interface Inputs {
  apiKey: string;
  githubToken: string;
  cliVersion?: string;
  model: string;
  reasoningEffort: string;
}

export const readInputs = (): Inputs => ({
  apiKey: core.getInput('api_key', { required: true }),
  githubToken: core.getInput('github_token', { required: true }),
  cliVersion: core.getInput('cli_version') || undefined,
  model: core.getInput('model'),
  reasoningEffort: core.getInput('reasoning_effort'),
});


let githubTokenMock = 'workflow-token';
let githubTokenActorMock: string | undefined;
let workflowGithubTokenMock = 'workflow-token';
jest.mock('./input', () => ({
  inputs: {
    get githubToken() {
      return githubTokenMock;
    },
    get workflowGithubToken() {
      return workflowGithubTokenMock;
    },
    get githubTokenActor() {
      return githubTokenActorMock;
    },
  },
}));

import { resolveTokenActor, WORKFLOW_TOKEN_ACTOR } from './identity';

describe('resolveTokenActor', () => {
  afterEach(() => {
    githubTokenMock = 'workflow-token';
    githubTokenActorMock = undefined;
    workflowGithubTokenMock = 'workflow-token';
  });

  it('returns the workflow token actor when using the workflow token', async () => {
    await expect(resolveTokenActor()).resolves.toBe(WORKFLOW_TOKEN_ACTOR);
  });

  it('returns the provided token actor when supplied', async () => {
    githubTokenActorMock = 'sudden-agent[bot]';

    await expect(resolveTokenActor()).resolves.toBe('sudden-agent[bot]');
  });

  it('throws when token actor is missing for non-workflow tokens', async () => {
    githubTokenMock = 'other-token';
    workflowGithubTokenMock = 'workflow-token';

    await expect(resolveTokenActor()).rejects.toThrow(
      'Missing `github_token_actor` input for non-workflow GitHub tokens.',
    );
  });
});

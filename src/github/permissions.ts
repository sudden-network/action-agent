import { context } from '@actions/github';
import { isNotFoundError } from './error';
import { getOctokit } from './octokit';

export const fetchPermission = async (): Promise<string> => {
  const { actor, repo: { owner, repo } } = context;

  try {
    const { data } = await getOctokit().rest.repos.getCollaboratorPermissionLevel({
      owner,
      repo,
      username: actor,
    });

    return data.permission ?? 'none';
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new Error(`Actor '${actor}' is not a collaborator on ${owner}/${repo}; write access is required.`);
    }

    throw new Error(`Failed to verify permissions for '${actor}': ${error instanceof Error ? error.message : 'unknown error'}`);
  }
};

import { context, getOctokit } from '@actions/github';
import { inputs } from './input';

const { actor, repo: { owner, repo } } = context;

const isErrorWithStatus = (error: unknown): error is { status?: number } => {
  return Boolean(error && typeof error === 'object' && 'status' in error);
};

export const getErrorStatus = (error: unknown): number | undefined => {
  if (!isErrorWithStatus(error)) return undefined;
  const { status } = error;
  return typeof status === 'number' ? status : undefined;
};

export const isPermissionError = (error: unknown): boolean => {
  return getErrorStatus(error) === 403;
};

const isNotFoundError = (error: unknown): boolean => {
  return getErrorStatus(error) === 404;
};

const fetchPermission = async (): Promise<string> => {
  const octokit = getOctokit(inputs.githubToken);

  try {
    const { data } = await octokit.rest.repos.getCollaboratorPermissionLevel({
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

export const ensurePermission = async (): Promise<void> => {
  const permission = await fetchPermission();

  if (!(["admin", "write", "maintain"].includes(permission))) {
    throw new Error(`Actor '${actor}' must have write access to ${owner}/${repo}. Detected permission: '${permission}'.`);
  }
};

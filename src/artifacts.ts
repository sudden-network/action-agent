import { DefaultArtifactClient } from '@actions/artifact';
import { create } from '@actions/glob';
import { context, getOctokit } from '@actions/github';
import path from 'path';
import { getIssueNumber, getSubjectType } from './context';

type RepoArtifact = Awaited<
  ReturnType<ReturnType<typeof getOctokit>['rest']['actions']['listArtifactsForRepo']>
>['data']['artifacts'][number];

const getArtifactName = () => `action-agent-${getSubjectType()}-${getIssueNumber()}`;

const listArtifactsByName = async (githubToken: string): Promise<RepoArtifact[]> => {
  const { owner, repo } = context.repo;
  const octokit = getOctokit(githubToken);

  const perPage = 100;

  const fetchPage = async (page: number): Promise<RepoArtifact[]> => {
    const { data } = await octokit.rest.actions.listArtifactsForRepo({
      owner,
      repo,
      per_page: perPage,
      page,
      name: getArtifactName(),
    });

    if (page * perPage >= data.total_count) return data.artifacts;
    return data.artifacts.concat(await fetchPage(page + 1));
  };

  return fetchPage(1);
};

const getLatestArtifact = async (githubToken: string): Promise<RepoArtifact | null> => {
  const artifacts = await listArtifactsByName(githubToken);
  const candidates = artifacts.filter((artifact) => !artifact.expired);

  return candidates.reduce<RepoArtifact | null>((latest, artifact) => {
    if (!latest) {
      return artifact;
    }
    const latestTime = latest.created_at ? Date.parse(latest.created_at) : 0;
    const artifactTime = artifact.created_at ? Date.parse(artifact.created_at) : 0;
    return artifactTime > latestTime ? artifact : latest;
  }, null);
};

export const downloadLatestArtifact = async (
  githubToken: string,
  downloadPath: string,
): Promise<RepoArtifact | null> => {
  const { owner, repo } = context.repo;
  const latest = await getLatestArtifact(githubToken);
  const workflowRunId = latest?.workflow_run?.id;

  if (!latest) return null;
  if (!workflowRunId) throw new Error('Latest artifact missing workflow run id.');

  await new DefaultArtifactClient().downloadArtifact(latest.id, {
    path: downloadPath,
    findBy: {
      token: githubToken,
      repositoryOwner: owner,
      repositoryName: repo,
      workflowRunId,
    },
  });

  return latest;
};

export const uploadArtifact = async (rootDirectory: string): Promise<void> => {
  const pattern = `${path.resolve(rootDirectory).replace(/\\/g, '/')}/**/*`;
  const globber = await create(pattern, { matchDirectories: false });

  await new DefaultArtifactClient().uploadArtifact(getArtifactName(), await globber.glob(), rootDirectory);
};

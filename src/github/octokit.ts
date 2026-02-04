import { getOctokit as octokit } from '@actions/github';
import { inputs } from './input';

export const getOctokit = () => octokit(inputs.githubToken);

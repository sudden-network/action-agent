import fs from 'fs';
import os from 'os';
import path from 'path';
import { context } from '@actions/github';
import { downloadLatestArtifact, uploadArtifact } from './github/artifacts';
import { runCommand } from './exec';
import { githubMcpServer } from './github/mcp';
import { inputs } from './github/input';
import { isPermissionError } from './github/error';

const CODEX_VERSION = '0.93.0';
const CODEX_DIR = path.join(os.homedir(), '.codex');
const CODEX_CONFIG_PATH = path.join(CODEX_DIR, 'config.toml');
const mcpServer = githubMcpServer(inputs.githubToken);

const ensureDir = (dir: string) => fs.mkdirSync(dir, { recursive: true });

const buildConfig = async () => `
[mcp_servers.github]
url = "${await mcpServer.url}"
`.trim();

const shouldResume = (): boolean => {
  if (!inputs.resume) return false;
  if (context.payload.repository?.private !== true) {
    throw new Error('Resume is only supported on private repositories.');
  }
  return Boolean(context.payload.issue || context.payload.pull_request);
};

const configureMcp = async () => {
  ensureDir(CODEX_DIR);
  fs.writeFileSync(CODEX_CONFIG_PATH, await buildConfig());
};

const restoreSession = async () => {
  if (!shouldResume()) return;
  ensureDir(CODEX_DIR);
  try {
    await downloadLatestArtifact(inputs.githubToken, CODEX_DIR);
  } catch (error) {
    if (isPermissionError(error)) {
      throw new Error('Resume is enabled but the workflow lacks `actions: read` permission.');
    }
    throw error;
  }
};

const persistSession = async () => {
  if (!shouldResume()) return;
  fs.rmSync(CODEX_CONFIG_PATH, { force: true });
  fs.rmSync(path.join(CODEX_DIR, 'auth.json'), { force: true });
  fs.rmSync(path.join(CODEX_DIR, 'tmp'), { recursive: true, force: true });
  await uploadArtifact(CODEX_DIR);
};

const install = async () => {
  await runCommand('npm', ['install', '-g', `@openai/codex@${CODEX_VERSION}`]);
};

const login = async () => {
  await runCommand('bash', ['-lc', 'printenv OPENAI_API_KEY | codex login --with-api-key'], {
    env: { OPENAI_API_KEY: inputs.apiKey },
  });
};

export const bootstrap = async () => {
  await Promise.all([
    install(),
    restoreSession(),
    configureMcp(),
  ]);
  await login();
};

export const teardown = async () => {
  await Promise.all([
    mcpServer.close(),
    persistSession(),
  ]);
};

export const runCodex = async (prompt: string) => {
  await runCommand(
    'codex',
    [
      'exec',
      'resume',
      '--last',
      '--skip-git-repo-check',
      ...(inputs.model ? ['--model', inputs.model] : []),
      ...(inputs.reasoningEffort ? ['-c', `model_reasoning_effort=${inputs.reasoningEffort}`] : []),
      prompt,
    ],
    {},
    'stderr',
  );
};

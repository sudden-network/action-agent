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
const CODEX_SESSIONS_PATH = path.join(CODEX_DIR, 'sessions');
const mcpServer = githubMcpServer();

const ensureDir = (dir: string) => fs.mkdirSync(dir, { recursive: true });

const buildConfig = async () => `
[mcp_servers.github]
url = "${await mcpServer.url}"
`.trim();

const shouldResume = (): boolean => {
  if (!inputs.resume) return false;
  return Boolean(context.payload.issue || context.payload.pull_request);
};

const configureMcp = async () => {
  ensureDir(CODEX_DIR);
  fs.writeFileSync(CODEX_CONFIG_PATH, await buildConfig());
};

const restoreSession = async () => {
  if (!shouldResume()) return;
  ensureDir(CODEX_SESSIONS_PATH);
  try {
    await downloadLatestArtifact(CODEX_SESSIONS_PATH);
  } catch (error) {
    if (isPermissionError(error)) {
      throw new Error('Resume is enabled but the workflow lacks `actions: read` permission.');
    }
    throw error;
  }
};

const persistSession = async () => {
  if (!shouldResume()) return;
  await uploadArtifact(CODEX_SESSIONS_PATH);
};

const install = async () => {
  await runCommand('npm', ['install', '-g', `@openai/codex@${CODEX_VERSION}`]);
};

const login = async () => {
  await runCommand(
    'codex',
    ['login', '--with-api-key'],
    { input: Buffer.from(inputs.apiKey, 'utf8') },
  );
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
  await Promise.allSettled([
    mcpServer.close(),
    persistSession(),
  ]);
};

export const runCodex = async (prompt: string) => {
  await runCommand(
    'codex',
    [
      'exec',
      '--sandbox=read-only',
      ...(inputs.model ? [`--model=${inputs.model}`] : []),
      ...(inputs.reasoningEffort ? [`--config=model_reasoning_effort=${inputs.reasoningEffort}`] : []),
      '-',
      'resume',
      '--last',
      '--skip-git-repo-check',
    ],
    { input: Buffer.from(prompt, 'utf8') },
    'stderr',
  );
};

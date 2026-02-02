import * as core from '@actions/core';
import * as github from '@actions/github';
import { DefaultArtifactClient } from '@actions/artifact';
import * as exec from '@actions/exec';
import type { ExecListeners } from '@actions/exec';
import * as fs from 'fs';
import * as path from 'path';

const CODEX_VERSION = '0.93.0';
const OUTPUT_FILE = '/tmp/codex_output.txt';
const RESPONSE_FILE = '/tmp/codex_response.txt';
const ARTIFACT_RETENTION_DAYS = 7;

const readText = (filePath: string): string => fs.readFileSync(filePath, 'utf8');

const writeText = (filePath: string, contents: string): void => {
  fs.writeFileSync(filePath, contents, { encoding: 'utf8' });
};

const ensureDir = (dirPath: string): void => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const copyDir = (src: string, dest: string): void => {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      ensureDir(path.dirname(destPath));
      fs.copyFileSync(srcPath, destPath);
    }
  }
};

const listFiles = (dir: string): string[] => {
  const files: string[] = [];
  const stack: string[] = [dir];
  while (stack.length) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }
  return files;
};

const readPromptTemplate = (): string => {
  const actionPath = process.env.GITHUB_ACTION_PATH || path.resolve(__dirname, '..');
  const templatePath = path.join(actionPath, 'src', 'prompt-template.md');
  return readText(templatePath);
};

const replaceTemplate = (template: string, replacements: Record<string, string>): string => {
  let output = template;
  for (const [key, value] of Object.entries(replacements)) {
    output = output.split(key).join(value);
  }
  return output;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const parseJsonLines = (filePath: string): string => {
  if (!fs.existsSync(filePath)) {
    return '';
  }
  const data = readText(filePath);
  let response = '';
  for (const line of data.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error('Failed to parse Codex JSONL output.');
    }
    if (isRecord(parsed) && parsed.type === 'item.completed') {
      const item = isRecord(parsed.item) ? parsed.item : {};
      if (item.type === 'agent_message') {
        response = typeof item.text === 'string' ? item.text : '';
      }
    }
  }
  return response;
};

const createCodexOutput = (message: string): void => {
  writeText(OUTPUT_FILE, message);
};

const buildEnv = (env: NodeJS.ProcessEnv): Record<string, string> => {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      output[key] = value;
    }
  }
  return output;
};

const main = async (): Promise<void> => {
  const issueNumberInput = core.getInput('issue_number', { required: true });
  const commentIdInput = core.getInput('comment_id') || '';
  const model = core.getInput('model') || '';
  const reasoningEffort = core.getInput('reasoning_effort') || '';
  const openaiApiKey = core.getInput('openai_api_key', { required: true });
  const githubToken = core.getInput('github_token', { required: true });

  const issueNumber = Number(issueNumberInput);
  const commentId = commentIdInput.trim();

  const { owner, repo } = github.context.repo;
  const eventAction = github.context.payload.action ?? '';

  const octokit = github.getOctokit(githubToken);

  const codexHome = path.join(process.env.RUNNER_TEMP || '/tmp', 'codex-home');
  const codexStateDir = codexHome;
  const codexSessionsPath = path.join(codexHome, 'sessions');

  ensureDir(codexHome);
  core.exportVariable('CODEX_HOME', codexHome);
  core.exportVariable('CODEX_STATE_DIR', codexStateDir);
  core.exportVariable('CODEX_SESSIONS_PATH', codexSessionsPath);

  const codexEnv = buildEnv({
    ...process.env,
    CODEX_HOME: codexHome,
    CODEX_STATE_DIR: codexStateDir,
    CODEX_SESSIONS_PATH: codexSessionsPath,
    GITHUB_TOKEN: githubToken,
    OPENAI_API_KEY: openaiApiKey,
  });

  let codexExit: number | null = null;
  let promptText = '';
  let resumeMode = false;

  try {
    await exec.exec('npm', ['install', '-g', `@openai/codex@${CODEX_VERSION}`]);

    if (!openaiApiKey) {
      codexExit = 1;
      createCodexOutput('OPENAI_API_KEY is missing. Add it as a repo/org secret.');
    }

    if (eventAction === 'edited') {
      let stale = false;
      if (commentId) {
        const current = await octokit.rest.issues.getComment({ owner, repo, comment_id: Number(commentId) });
        const currentBody = current.data.body || '';
        const eventBody = github.context.payload.comment?.body || '';
        if (currentBody !== eventBody) {
          stale = true;
        }
      } else {
        const issue = await octokit.rest.issues.get({ owner, repo, issue_number: issueNumber });
        const currentTitle = issue.data.title || '';
        const currentBody = issue.data.body || '';
        const eventTitle = github.context.payload.issue?.title || '';
        const eventBody = github.context.payload.issue?.body || '';
        if (currentTitle !== eventTitle || currentBody !== eventBody) {
          stale = true;
        }
      }

      if (stale) {
        return;
      }
    }

    try {
      if (commentId) {
        await octokit.rest.reactions.createForIssueComment({
          owner,
          repo,
          comment_id: Number(commentId),
          content: 'eyes',
        });
      } else {
        await octokit.rest.reactions.createForIssue({
          owner,
          repo,
          issue_number: issueNumber,
          content: 'eyes',
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      core.info(`Reaction failed: ${message}`);
    }

    const isFollowUp = Boolean(commentId) || eventAction === 'edited';
    if (codexExit === null && isFollowUp) {
      const artifacts = await octokit.rest.actions.listArtifactsForRepo({ owner, repo, per_page: 100 });
      const matches = artifacts.data.artifacts
        .filter((item) => item.name === `codex-worker-session-${issueNumber}` && !item.expired)
        .sort((a, b) => {
          const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
          const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
          return aTime - bTime;
        });

      if (!matches.length) {
        codexExit = 1;
        createCodexOutput('Session artifact not found; cannot resume.');
      } else {
        const latest = matches[matches.length - 1];
        const artifactClient = new DefaultArtifactClient();
        const downloadPath = path.join(process.env.RUNNER_TEMP || '/tmp', 'codex-session');
        const workflowRunId = latest.workflow_run?.id;
        ensureDir(downloadPath);

        if (!workflowRunId) {
          codexExit = 1;
          createCodexOutput('Session artifact missing workflow run; cannot resume.');
        } else {
          try {
            await artifactClient.downloadArtifact(latest.id, {
              path: downloadPath,
              findBy: {
                token: githubToken,
                repositoryOwner: owner,
                repositoryName: repo,
                workflowRunId,
              },
            });
          } catch (error) {
            codexExit = 1;
            createCodexOutput('Session artifact not found; cannot resume.');
          }
        }

        if (codexExit === null) {
          const sessionsDir = path.join(downloadPath, 'sessions');
          const source = downloadPath;
          const target = fs.existsSync(sessionsDir)
            ? codexStateDir
            : path.join(codexStateDir, 'sessions');

          if (!fs.existsSync(source)) {
            codexExit = 1;
            createCodexOutput('Session artifact missing contents; cannot resume.');
          } else {
            fs.rmSync(codexStateDir, { recursive: true, force: true });
            ensureDir(target);
            copyDir(source, target);
          }
        }
      }
    }

    const issue = await octokit.rest.issues.get({ owner, repo, issue_number: issueNumber });
    const issueTitle = issue.data.title || '';
    const issueBody = issue.data.body || '';
    const issueUrl = issue.data.html_url || '';

    let commentBody = '';
    let commentUrl = '';
    if (commentId) {
      const comment = await octokit.rest.issues.getComment({ owner, repo, comment_id: Number(commentId) });
      commentBody = comment.data.body || '';
      commentUrl = comment.data.html_url || '';
    }

    if (commentBody) {
      const lines: string[] = [];
      if (eventAction === 'edited' && commentUrl) {
        lines.push(`Edited comment: ${commentUrl}`);
        lines.push('Respond to the updated content and continue the existing thread.');
        lines.push('');
      }
      lines.push(commentBody);
      promptText = lines.join('\n');
      resumeMode = true;
    } else {
      const template = readPromptTemplate();
      let editContext = '';
      if (eventAction === 'edited') {
        if (issueUrl) {
          editContext = `Issue updated: ${issueUrl}\n\nContinue the existing thread; do not restart.\n\n`;
        } else {
          editContext = 'Issue updated. Continue the existing thread; do not restart.\n\n';
        }
        resumeMode = true;
      }
      promptText = replaceTemplate(template, {
        '{{ISSUE_NUMBER}}': String(issueNumber),
        '{{ISSUE_TITLE}}': issueTitle,
        '{{ISSUE_BODY}}': issueBody,
        '{{EDIT_CONTEXT}}': editContext,
      });
    }

    if (codexExit === null) {
      const loginExit = await exec.exec(
        'bash',
        ['-lc', 'printenv OPENAI_API_KEY | codex login --with-api-key'],
        {
          env: codexEnv,
          ignoreReturnCode: true,
        }
      );
      if (loginExit !== 0) {
        codexExit = loginExit;
        createCodexOutput('Codex login failed.');
      }
    }

    if (codexExit === null) {
      const codexArgs = [
        'exec',
        '--json',
        '--sandbox',
        'workspace-write',
        '-c',
        'approval_policy="never"',
        '-c',
        'sandbox_workspace_write.network_access=true',
        '-c',
        'shell_environment_policy.inherit=all',
        '-c',
        'shell_environment_policy.ignore_default_excludes=true',
      ];
      if (model) {
        codexArgs.push('--model', model);
      }
      if (reasoningEffort) {
        codexArgs.push('-c', `model_reasoning_effort=${reasoningEffort}`);
      }

      if (resumeMode) {
        codexArgs.push('resume', '--last', '-');
      } else {
        codexArgs.push('-');
      }

      const outputStream = fs.createWriteStream(OUTPUT_FILE, { flags: 'w' });
      const listeners: ExecListeners = {
        stdout: (data) => {
          outputStream.write(data);
        },
        stderr: (data) => {
          outputStream.write(data);
        },
      };

      const exitCode = await exec.exec('codex', codexArgs, {
        env: codexEnv,
        input: Buffer.from(promptText, 'utf8'),
        listeners,
        ignoreReturnCode: true,
      });

      await new Promise((resolve) => outputStream.end(resolve));
      codexExit = exitCode;
    }

    let responseText = '';
    try {
      responseText = parseJsonLines(OUTPUT_FILE);
    } catch (error) {
      responseText = '';
    }

    if (responseText) {
      writeText(RESPONSE_FILE, responseText);
    } else if (fs.existsSync(OUTPUT_FILE)) {
      fs.copyFileSync(OUTPUT_FILE, RESPONSE_FILE);
    } else {
      writeText(RESPONSE_FILE, '');
    }

    fs.rmSync(path.join(codexStateDir, 'auth.json'), { force: true });
    fs.rmSync(path.join(codexStateDir, 'tmp'), { recursive: true, force: true });

    if (codexExit === 0) {
      const artifactClient = new DefaultArtifactClient();
      const artifactName = `codex-worker-session-${issueNumber}`;
      const files = listFiles(codexStateDir);
      if (!files.length) {
        throw new Error('No Codex state files found for upload.');
      }

      await artifactClient.uploadArtifact(artifactName, files, codexStateDir, {
        retentionDays: ARTIFACT_RETENTION_DAYS,
      });
    }

    const header = (() => {
      if (eventAction !== 'edited') {
        return '';
      }
      if (commentUrl) {
        return `Edited comment: ${commentUrl}\n\n`;
      }
      if (issueUrl) {
        return `Issue updated: ${issueUrl}\n\n`;
      }
      return 'Issue updated.\n\n';
    })();

    let body = '';
    if (codexExit && codexExit !== 0) {
      if (fs.existsSync(OUTPUT_FILE)) {
        body = header + readText(OUTPUT_FILE);
      } else {
        body = header + '(no output)';
      }
    } else if (fs.existsSync(RESPONSE_FILE)) {
      body = header + readText(RESPONSE_FILE);
    } else if (fs.existsSync(OUTPUT_FILE)) {
      body = header + readText(OUTPUT_FILE);
    } else {
      body = header + '(no output)';
    }

    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(message);
  }
};

void main();

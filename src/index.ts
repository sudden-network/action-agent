import * as core from '@actions/core';
import * as github from '@actions/github';
import { DefaultArtifactClient } from '@actions/artifact';
import * as exec from '@actions/exec';
import * as fs from 'fs';
import * as path from 'path';

const CODEX_VERSION = '0.93.0';
const ARTIFACT_RETENTION_DAYS = 7;
const MAX_ITEMS = 20;
const STATE_FILENAME = 'state.json';

type SubjectType = 'issue' | 'pr';

type Subject = {
  type: SubjectType;
  number: number;
};

type SessionState = {
  subjectType: SubjectType;
  subjectNumber: number;
  lastRunAt: string;
  lastIssueCommentId?: number;
  lastReviewCommentId?: number;
  lastHeadSha?: string;
};

type IssueComment = {
  id: number;
  body?: string | null;
  html_url?: string;
  created_at?: string;
  updated_at?: string;
  user?: { login?: string | null } | null;
};

type ReviewComment = {
  id: number;
  body?: string | null;
  html_url?: string;
  created_at?: string;
  updated_at?: string;
  path?: string | null;
  line?: number | null;
  user?: { login?: string | null } | null;
};

type PullRequestData = {
  html_url: string;
  title: string;
  body: string | null;
  state: string;
  draft: boolean;
  updated_at: string | null;
  base: { ref: string };
  head: { ref: string; sha: string };
};

type IssueData = {
  html_url: string;
  title: string;
  body: string | null;
  state: string;
  updated_at: string | null;
};

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

const buildEnv = (env: NodeJS.ProcessEnv): Record<string, string> => {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      output[key] = value;
    }
  }
  return output;
};

const readPromptTemplate = (): string => {
  const templatePath = path.resolve(__dirname, '../src/prompt-template.md');
  return readText(templatePath);
};

const replaceTemplate = (template: string, replacements: Record<string, string>): string =>
  Object.entries(replacements).reduce((output, [key, value]) => output.split(key).join(value), template);

const isSubjectType = (value: unknown): value is SubjectType => value === 'issue' || value === 'pr';

const loadState = (statePath: string): SessionState | null => {
  if (!fs.existsSync(statePath)) {
    return null;
  }
  const raw: unknown = JSON.parse(readText(statePath));
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const subjectType = record.subjectType;
  const subjectNumber = record.subjectNumber;
  const lastRunAt = record.lastRunAt;
  if (!isSubjectType(subjectType) || typeof subjectNumber !== 'number' || typeof lastRunAt !== 'string') {
    return null;
  }
  const state: SessionState = { subjectType, subjectNumber, lastRunAt };
  if (typeof record.lastIssueCommentId === 'number') {
    state.lastIssueCommentId = record.lastIssueCommentId;
  }
  if (typeof record.lastReviewCommentId === 'number') {
    state.lastReviewCommentId = record.lastReviewCommentId;
  }
  if (typeof record.lastHeadSha === 'string') {
    state.lastHeadSha = record.lastHeadSha;
  }
  return state;
};

const writeState = (statePath: string, state: SessionState): void => {
  writeText(statePath, `${JSON.stringify(state, null, 2)}\n`);
};

const parseOptionalNumber = (value: string): number | null => {
  if (!value) {
    return null;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};

const getSubjectFromEvent = (eventName: string, payload: typeof github.context.payload, fallback: number | null): Subject => {
  if (eventName === 'issues') {
    const number = payload.issue?.number ?? fallback;
    if (!number) {
      throw new Error('Issue number missing from event payload.');
    }
    return { type: 'issue', number };
  }
  if (eventName === 'issue_comment') {
    const number = payload.issue?.number ?? fallback;
    if (!number) {
      throw new Error('Issue number missing from event payload.');
    }
    const type: SubjectType = payload.issue?.pull_request ? 'pr' : 'issue';
    return { type, number };
  }
  if (
    eventName === 'pull_request' ||
    eventName === 'pull_request_review' ||
    eventName === 'pull_request_review_comment'
  ) {
    const number = payload.pull_request?.number ?? fallback;
    if (!number) {
      throw new Error('Pull request number missing from event payload.');
    }
    return { type: 'pr', number };
  }
  if (fallback) {
    return { type: 'issue', number: fallback };
  }
  throw new Error(`Unsupported event: ${eventName}`);
};

const formatIssueComment = (comment: IssueComment) => ({
  id: comment.id,
  author: comment.user?.login ?? 'unknown',
  body: comment.body ?? '',
  url: comment.html_url ?? '',
  created_at: comment.created_at ?? null,
  updated_at: comment.updated_at ?? null,
});

const formatReviewComment = (comment: ReviewComment) => ({
  id: comment.id,
  author: comment.user?.login ?? 'unknown',
  body: comment.body ?? '',
  url: comment.html_url ?? '',
  path: comment.path ?? null,
  line: comment.line ?? null,
  created_at: comment.created_at ?? null,
  updated_at: comment.updated_at ?? null,
});

const formatCommit = (commit: { sha: string; commit?: { message?: string }; author?: { login?: string } | null }) => ({
  sha: commit.sha,
  message: commit.commit?.message ?? '',
  author: commit.author?.login ?? null,
});

const formatFile = (file: { filename?: string; status?: string; changes?: number }) => ({
  filename: file.filename ?? '',
  status: file.status ?? '',
  changes: file.changes ?? null,
});

const loadPullRequest = async ({
  owner,
  repo,
  pullNumber,
  octokit,
}: {
  owner: string;
  repo: string;
  pullNumber: number;
  octokit: ReturnType<typeof github.getOctokit>;
}): Promise<PullRequestData> => {
  const pr = await octokit.rest.pulls.get({ owner, repo, pull_number: pullNumber });
  return {
    html_url: pr.data.html_url,
    title: pr.data.title,
    body: pr.data.body,
    state: pr.data.state,
    draft: pr.data.draft ?? false,
    updated_at: pr.data.updated_at,
    base: { ref: pr.data.base.ref },
    head: { ref: pr.data.head.ref, sha: pr.data.head.sha },
  };
};

const loadIssue = async ({
  owner,
  repo,
  issueNumber,
  octokit,
}: {
  owner: string;
  repo: string;
  issueNumber: number;
  octokit: ReturnType<typeof github.getOctokit>;
}): Promise<IssueData> => {
  const issue = await octokit.rest.issues.get({ owner, repo, issue_number: issueNumber });
  return {
    html_url: issue.data.html_url,
    title: issue.data.title,
    body: issue.data.body ?? null,
    state: issue.data.state,
    updated_at: issue.data.updated_at ?? null,
  };
};

const buildDelta = async ({
  eventName,
  eventAction,
  payload,
  subject,
  state,
  owner,
  repo,
  octokit,
}: {
  eventName: string;
  eventAction: string | undefined;
  payload: typeof github.context.payload;
  subject: Subject;
  state: SessionState | null;
  owner: string;
  repo: string;
  octokit: ReturnType<typeof github.getOctokit>;
}): Promise<{ deltaJson: string; subjectUrl: string; nextState: SessionState }> => {
  const runStartedAt = new Date().toISOString();
  const delta: Record<string, unknown> = {
    event: {
      name: eventName,
      action: eventAction ?? null,
      actor: payload.sender?.login ?? null,
    },
    subject: {
      type: subject.type,
      number: subject.number,
    },
  };

  let subjectUrl = '';
  let issueData: IssueData | null = null;
  let prData: PullRequestData | null = null;

  if (subject.type === 'pr') {
    prData = await loadPullRequest({ owner, repo, pullNumber: subject.number, octokit });
    subjectUrl = prData.html_url;
  } else {
    issueData = await loadIssue({ owner, repo, issueNumber: subject.number, octokit });
    subjectUrl = issueData.html_url;
  }

  delta.subject = { type: subject.type, number: subject.number, url: subjectUrl };
  delta.subjectDetails = prData ?? issueData;

  if (eventName === 'issues' && payload.issue) {
    delta.eventIssue = {
      title: payload.issue.title,
      body: payload.issue.body ?? null,
      url: payload.issue.html_url,
      state: payload.issue.state,
    };
  }

  if (eventName === 'issue_comment' && payload.comment) {
    delta.eventComment = formatIssueComment(payload.comment);
  }

  if (eventName === 'pull_request' && payload.pull_request) {
    delta.eventPullRequest = {
      title: payload.pull_request.title,
      body: payload.pull_request.body ?? null,
      url: payload.pull_request.html_url,
      state: payload.pull_request.state,
      draft: payload.pull_request.draft ?? false,
      head: payload.pull_request.head?.sha ?? null,
      base: payload.pull_request.base?.ref ?? null,
    };
  }

  if (eventName === 'pull_request_review_comment' && payload.comment) {
    delta.eventReviewComment = formatReviewComment(payload.comment);
  }

  if (eventName === 'pull_request_review' && payload.review) {
    delta.eventReview = {
      state: payload.review.state,
      body: payload.review.body ?? null,
      url: payload.review.html_url,
      author: payload.review.user?.login ?? null,
    };
  }

  const since = state?.lastRunAt;
  const newIssueComments = since
    ? (
        await octokit.rest.issues.listComments({
          owner,
          repo,
          issue_number: subject.number,
          since,
          per_page: 100,
        })
      ).data
    : [];

  if (newIssueComments.length) {
    delta.newComments = newIssueComments.slice(-MAX_ITEMS).map(formatIssueComment);
  }

  const newReviewComments =
    subject.type === 'pr' && since
      ? (
          await octokit.rest.pulls.listReviewComments({
            owner,
            repo,
            pull_number: subject.number,
            since,
            per_page: 100,
          })
        ).data
      : [];

  if (newReviewComments.length) {
    delta.newReviewComments = newReviewComments.slice(-MAX_ITEMS).map(formatReviewComment);
  }

  if (subject.type === 'pr' && prData) {
    const lastHeadSha = state?.lastHeadSha;
    const currentSha = prData.head.sha;
    if (lastHeadSha && lastHeadSha !== currentSha) {
      const compare = await octokit.rest.repos.compareCommits({
        owner,
        repo,
        base: lastHeadSha,
        head: currentSha,
      });
      delta.commitChanges = {
        from: lastHeadSha,
        to: currentSha,
        commits: compare.data.commits.slice(-MAX_ITEMS).map(formatCommit),
        files: (compare.data.files ?? []).slice(0, MAX_ITEMS).map(formatFile),
      };
    } else if (!lastHeadSha) {
      const commits = await octokit.rest.pulls.listCommits({
        owner,
        repo,
        pull_number: subject.number,
        per_page: 5,
      });
      delta.commitChanges = {
        to: currentSha,
        commits: commits.data.map(formatCommit),
      };
    }
  }

  const commentIds = newIssueComments.map((comment) => comment.id);
  const reviewCommentIds = newReviewComments.map((comment) => comment.id);

  const nextState: SessionState = {
    subjectType: subject.type,
    subjectNumber: subject.number,
    lastRunAt: runStartedAt,
  };

  const lastIssueCommentId = [...commentIds, state?.lastIssueCommentId]
    .filter((value): value is number => typeof value === 'number')
    .reduce((max, value) => Math.max(max, value), -1);
  if (lastIssueCommentId > -1) {
    nextState.lastIssueCommentId = lastIssueCommentId;
  }

  const lastReviewCommentId = [...reviewCommentIds, state?.lastReviewCommentId]
    .filter((value): value is number => typeof value === 'number')
    .reduce((max, value) => Math.max(max, value), -1);
  if (lastReviewCommentId > -1) {
    nextState.lastReviewCommentId = lastReviewCommentId;
  }

  if (subject.type === 'pr' && prData) {
    nextState.lastHeadSha = prData.head.sha;
  }

  return {
    deltaJson: `${JSON.stringify(delta, null, 2)}\n`,
    subjectUrl,
    nextState,
  };
};

const installSkills = (workspace: string, codexHome: string): void => {
  const sourceDir = path.join(workspace, 'skills');
  if (!fs.existsSync(sourceDir)) {
    return;
  }
  const targetDir = path.join(codexHome, 'skills');
  fs.rmSync(targetDir, { recursive: true, force: true });
  copyDir(sourceDir, targetDir);
  core.addPath(targetDir);
};

const getLatestSessionArtifact = async ({
  owner,
  repo,
  subject,
  octokit,
}: {
  owner: string;
  repo: string;
  subject: Subject;
  octokit: ReturnType<typeof github.getOctokit>;
}) => {
  const perPage = 100;
  type Artifact = Awaited<
    ReturnType<typeof octokit.rest.actions.listArtifactsForRepo>
  >['data']['artifacts'][number];
  const matches: Artifact[] = [];

  for (let page = 1; ; page += 1) {
    const artifacts = await octokit.rest.actions.listArtifactsForRepo({
      owner,
      repo,
      name: `action-agent-session-${subject.type}-${subject.number}`,
      per_page: perPage,
      page,
    });
    const pageArtifacts = artifacts.data.artifacts;
    matches.push(...pageArtifacts.filter((item) => !item.expired));
    if (pageArtifacts.length < perPage) {
      break;
    }
  }

  if (!matches.length) {
    return null;
  }

  matches.sort((a, b) => {
    const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
    return aTime - bTime;
  });

  return matches[matches.length - 1];
};

const main = async (): Promise<void> => {
  let subject: Subject | null = null;
  let owner = '';
  let repo = '';
  let octokit: ReturnType<typeof github.getOctokit> | null = null;

  const codexHome = path.join(process.env.RUNNER_TEMP || '/tmp', 'codex-home');
  const codexStateDir = codexHome;
  const codexSessionsPath = path.join(codexHome, 'sessions');

  ensureDir(codexHome);
  core.exportVariable('CODEX_HOME', codexHome);
  core.exportVariable('CODEX_STATE_DIR', codexStateDir);
  core.exportVariable('CODEX_SESSIONS_PATH', codexSessionsPath);

  const postErrorComment = async (message: string): Promise<void> => {
    if (!octokit || !owner || !repo || !subject) {
      return;
    }
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: subject.number,
      body: message,
    });
  };

  try {
    const issueNumberInput = parseOptionalNumber(core.getInput('issue_number'));
    const model = core.getInput('model');
    const reasoningEffort = core.getInput('reasoning_effort');
    const openaiApiKey = core.getInput('openai_api_key', { required: true });
    const githubToken = core.getInput('github_token', { required: true });
    ({ owner, repo } = github.context.repo);
    const eventName = github.context.eventName;
    const eventAction = github.context.payload.action;
    octokit = github.getOctokit(githubToken);

    subject = getSubjectFromEvent(eventName, github.context.payload, issueNumberInput);

    const codexEnv = buildEnv({
      ...process.env,
      CODEX_HOME: codexHome,
      CODEX_STATE_DIR: codexStateDir,
      CODEX_SESSIONS_PATH: codexSessionsPath,
      GITHUB_TOKEN: githubToken,
      OPENAI_API_KEY: openaiApiKey,
    });

    await exec.exec('npm', ['install', '-g', `@openai/codex@${CODEX_VERSION}`]);

    if (!openaiApiKey) {
      throw new Error('OPENAI_API_KEY is missing. Add it as a repo/org secret.');
    }

    installSkills(process.env.GITHUB_WORKSPACE || process.cwd(), codexHome);

    const latestSessionArtifact = await getLatestSessionArtifact({ owner, repo, subject, octokit });
    if (latestSessionArtifact) {
      const downloadPath = path.join(process.env.RUNNER_TEMP || '/tmp', 'codex-session');
      const workflowRunId = latestSessionArtifact.workflow_run?.id;
      ensureDir(downloadPath);

      if (!workflowRunId) {
        throw new Error('Session artifact missing workflow run; cannot resume.');
      }

      await new DefaultArtifactClient().downloadArtifact(latestSessionArtifact.id, {
        path: downloadPath,
        findBy: {
          token: githubToken,
          repositoryOwner: owner,
          repositoryName: repo,
          workflowRunId,
        },
      });

      const source = downloadPath;
      const target = fs.existsSync(path.join(downloadPath, 'sessions'))
        ? codexStateDir
        : path.join(codexStateDir, 'sessions');

      if (!fs.existsSync(source)) {
        throw new Error('Session artifact missing contents; cannot resume.');
      }
      fs.rmSync(codexStateDir, { recursive: true, force: true });
      ensureDir(target);
      copyDir(source, target);
    }

    const statePath = path.join(codexStateDir, STATE_FILENAME);
    const state = loadState(statePath);

    const { deltaJson, subjectUrl, nextState } = await buildDelta({
      eventName,
      eventAction,
      payload: github.context.payload,
      subject,
      state,
      owner,
      repo,
      octokit,
    });

    const promptText = replaceTemplate(readPromptTemplate(), {
      '{{EVENT_NAME}}': eventName,
      '{{EVENT_ACTION}}': eventAction ?? '',
      '{{SUBJECT_TYPE}}': subject.type,
      '{{SUBJECT_NUMBER}}': String(subject.number),
      '{{SUBJECT_URL}}': subjectUrl,
      '{{DELTA_JSON}}': deltaJson,
    });

    await exec.exec('bash', ['-lc', 'printenv OPENAI_API_KEY | codex login --with-api-key'], {
      env: codexEnv,
    });

    const codexExit = await exec.exec(
      'codex',
      [
        ['exec'],
        ['--sandbox', 'workspace-write'],
        ['-c', 'approval_policy="never"'],
        ['-c', 'sandbox_workspace_write.network_access=true'],
        ['-c', 'shell_environment_policy.inherit=all'],
        ['-c', 'shell_environment_policy.ignore_default_excludes=true'],
        ...(model ? [['--model', model]] : []),
        ...(reasoningEffort ? [['-c', `model_reasoning_effort=${reasoningEffort}`]] : []),
        ...(latestSessionArtifact ? [['resume', '--last', '-']] : [['-']]),
      ].flat(),
      {
        env: codexEnv,
        input: Buffer.from(promptText, 'utf8'),
        ignoreReturnCode: true,
      }
    );

    if (codexExit !== 0) {
      throw new Error(`Codex exited with code ${codexExit}.`);
    }

    writeState(statePath, nextState);

    fs.rmSync(path.join(codexStateDir, 'auth.json'), { force: true });
    fs.rmSync(path.join(codexStateDir, 'tmp'), { recursive: true, force: true });

    const files = listFiles(codexStateDir);

    if (!files.length) {
      throw new Error('No Codex state files found for upload.');
    }

    await new DefaultArtifactClient().uploadArtifact(
      `action-agent-session-${subject.type}-${subject.number}`,
      files,
      codexStateDir,
      {
        retentionDays: ARTIFACT_RETENTION_DAYS,
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await postErrorComment(message);
    } catch (commentError) {
      const commentMessage = commentError instanceof Error ? commentError.message : String(commentError);
      core.info(`Failed to post error comment: ${commentMessage}`);
    }
    core.setFailed(message);
  }
};

void main();

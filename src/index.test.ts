import fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';

const mockFs = fs;
const mockPath = path;

type ExecCallOptions = {
  env?: NodeJS.ProcessEnv;
  input?: string | Buffer;
  ignoreReturnCode?: boolean;
};

let mockArtifactClient: { downloadArtifact: jest.Mock; uploadArtifact: jest.Mock };
let mockCodexExit = 0;
let mockLoginExit = 0;

jest.mock('@actions/core', () => ({
  getInput: jest.fn(),
  exportVariable: jest.fn(),
  setFailed: jest.fn(),
  info: jest.fn(),
  addPath: jest.fn(),
}));

jest.mock('@actions/exec', () => ({
  exec: jest.fn(async (cmd: string, _args: string[], opts: ExecCallOptions = {}) => {
    if (cmd === 'npm') {
      return 0;
    }
    if (cmd === 'bash') {
      if (!opts.ignoreReturnCode && mockLoginExit !== 0) {
        throw new Error(`Command failed with exit code ${mockLoginExit}.`);
      }
      return mockLoginExit;
    }
    if (cmd === 'codex') {
      if (opts.env?.CODEX_STATE_DIR) {
        mockFs.mkdirSync(opts.env.CODEX_STATE_DIR, { recursive: true });
        mockFs.writeFileSync(mockPath.join(opts.env.CODEX_STATE_DIR, 'history.jsonl'), '');
      }
      return mockCodexExit;
    }
    return 0;
  }),
}));

jest.mock('@actions/artifact', () => ({
  DefaultArtifactClient: jest.fn(() => mockArtifactClient),
}));

jest.mock('@actions/github', () => ({
  context: {
    repo: { owner: 'acme', repo: 'demo' },
    eventName: 'issues',
    payload: {
      action: 'opened',
      issue: { title: 'Default title', body: 'Default body', number: 1 },
      comment: { body: '', id: 1 },
    },
  },
  getOctokit: jest.fn(),
}));

const execMock = exec.exec as jest.MockedFunction<typeof exec.exec>;
const mockGetOctokit = github.getOctokit as jest.MockedFunction<typeof github.getOctokit>;
const coreGetInputMock = core.getInput as jest.MockedFunction<typeof core.getInput>;
const coreSetFailedMock = core.setFailed as jest.MockedFunction<typeof core.setFailed>;

const getCodexInput = (): string => {
  const call = execMock.mock.calls.find(([cmd]) => cmd === 'codex');
  const input = call?.[2]?.input;
  if (Buffer.isBuffer(input)) {
    return input.toString('utf8');
  }
  if (typeof input === 'string') {
    return input;
  }
  return '';
};

type OctokitInstance = ReturnType<typeof github.getOctokit>;

const setOctokit = (value: unknown): void => {
  mockGetOctokit.mockReturnValue(value as OctokitInstance);
};

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

const waitFor = async (fn, timeoutMs = 2000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) {
      return;
    }
    await flushPromises();
  }
  throw new Error('Timed out waiting for condition');
};

const setInputs = (overrides: Partial<Record<string, string>> = {}) => {
  const inputs = {
    issue_number: '',
    comment_id: '',
    model: '',
    reasoning_effort: '',
    openai_api_key: 'test-key',
    github_token: 'ghs_test',
    ...overrides,
  };

  coreGetInputMock.mockImplementation((name) => inputs[name] ?? '');
};

type ContextOverrides = {
  eventName?: string;
  action?: string;
  issue?: { title?: string; body?: string; number?: number };
  comment?: { body?: string; id?: number };
  pullRequest?: { title?: string; body?: string; number?: number; head?: { sha?: string }; base?: { ref?: string } };
};

const setContext = ({
  eventName = 'issues',
  action = 'opened',
  issue,
  comment,
  pullRequest,
}: ContextOverrides = {}) => {
  github.context.eventName = eventName;
  github.context.payload.action = action;
  if (issue) {
    github.context.payload.issue = {
      title: 'Issue title',
      body: 'Issue body',
      number: 1,
      ...issue,
    };
  }
  if (comment) {
    github.context.payload.comment = { body: '', id: 1, ...comment };
  }
  if (pullRequest) {
    github.context.payload.pull_request = {
      title: 'PR title',
      body: 'PR body',
      number: 1,
      head: { sha: 'head-sha', ...pullRequest.head },
      base: { ref: 'main', ...pullRequest.base },
      html_url: 'https://example.com/pulls/1',
      state: 'open',
      draft: false,
      ...pullRequest,
    };
  }
};

type Artifact = {
  id: number;
  name: string;
  expired: boolean;
  created_at: string;
  workflow_run?: { id?: number };
};

const createOctokit = ({
  issueTitle = 'Issue title',
  issueBody = 'Issue body',
  issueUrl = 'https://example.com/issues/1',
  pullTitle = 'PR title',
  pullBody = 'PR body',
  pullUrl = 'https://example.com/pulls/1',
  pullHeadSha = 'head-sha',
  pullBaseRef = 'main',
  issueComments = [] as { id: number }[],
  reviewComments = [] as { id: number }[],
  compareCommits = [] as { sha: string }[],
  compareFiles = [] as { filename: string }[],
  artifacts = [] as Artifact[],
}: {
  issueTitle?: string;
  issueBody?: string;
  issueUrl?: string;
  pullTitle?: string;
  pullBody?: string;
  pullUrl?: string;
  pullHeadSha?: string;
  pullBaseRef?: string;
  issueComments?: { id: number }[];
  reviewComments?: { id: number }[];
  compareCommits?: { sha: string }[];
  compareFiles?: { filename: string }[];
  artifacts?: Artifact[];
} = {}) => ({
  rest: {
    issues: {
      get: jest.fn().mockResolvedValue({
        data: { title: issueTitle, body: issueBody, html_url: issueUrl, state: 'open', updated_at: null },
      }),
      listComments: jest.fn().mockResolvedValue({ data: issueComments }),
      createComment: jest.fn().mockResolvedValue({}),
    },
    pulls: {
      get: jest.fn().mockResolvedValue({
        data: {
          title: pullTitle,
          body: pullBody,
          html_url: pullUrl,
          state: 'open',
          draft: false,
          updated_at: null,
          base: { ref: pullBaseRef },
          head: { ref: 'feature', sha: pullHeadSha },
        },
      }),
      listReviewComments: jest.fn().mockResolvedValue({ data: reviewComments }),
      listCommits: jest.fn().mockResolvedValue({ data: [] }),
    },
    repos: {
      compareCommits: jest.fn().mockResolvedValue({ data: { commits: compareCommits, files: compareFiles } }),
    },
    actions: {
      listArtifactsForRepo: jest.fn().mockResolvedValue({ data: { artifacts } }),
    },
  },
});

const runAction = async () => {
  jest.isolateModules(() => {
    require('../src/index');
  });
  await flushPromises();
};

describe('action-agent action', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockArtifactClient = {
      downloadArtifact: jest.fn(),
      uploadArtifact: jest.fn(),
    };
    mockCodexExit = 0;
    mockLoginExit = 0;

    process.env.RUNNER_TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-test-'));
    process.env.GITHUB_ACTION_PATH = path.resolve(__dirname, '..');
  });

  test('runs on new issue and uploads session without auto-comment', async () => {
    setInputs();
    setContext({ eventName: 'issues', action: 'opened', issue: { number: 7 } });

    const octokit = createOctokit({ issueTitle: 'New issue', issueBody: 'Do work' });
    setOctokit(octokit);

    await runAction();
    await waitFor(() => mockArtifactClient.uploadArtifact.mock.calls.length === 1);

    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled();
    expect(execMock).toHaveBeenCalledWith(
      'codex',
      expect.not.arrayContaining(['resume']),
      expect.objectContaining({ input: expect.any(Buffer) })
    );
    expect(getCodexInput()).toContain('issues');
    expect(mockArtifactClient.uploadArtifact).toHaveBeenCalledWith(
      'action-agent-session-issue-7',
      expect.any(Array),
      expect.any(String),
      expect.objectContaining({ retentionDays: 7 })
    );
  });

  test('resumes when session artifact exists', async () => {
    setInputs();
    setContext({ eventName: 'issue_comment', action: 'created', issue: { number: 8 } });

    const octokit = createOctokit({
      artifacts: [
        {
          id: 1,
          name: 'action-agent-session-issue-8',
          expired: false,
          created_at: '2026-02-02T00:00:00Z',
          workflow_run: { id: 1001 },
        },
      ],
    });
    setOctokit(octokit);

    mockArtifactClient.downloadArtifact.mockImplementation(async (_id, options) => {
      fs.mkdirSync(options.path, { recursive: true });
      fs.writeFileSync(path.join(options.path, 'history.jsonl'), '');
    });

    await runAction();
    await waitFor(() => execMock.mock.calls.length > 0);

    expect(execMock).toHaveBeenCalledWith(
      'codex',
      expect.arrayContaining(['resume', '--last']),
      expect.objectContaining({ input: expect.any(Buffer) })
    );
  });

  test('posts error comment on codex failure', async () => {
    setInputs();
    setContext({ eventName: 'issues', action: 'opened', issue: { number: 11 } });

    mockCodexExit = 2;
    const octokit = createOctokit();
    setOctokit(octokit);

    await runAction();
    await waitFor(() => octokit.rest.issues.createComment.mock.calls.length === 1);

    const [{ body }] = octokit.rest.issues.createComment.mock.calls[0];
    expect(body).toContain('Codex exited with code 2');
    expect(coreSetFailedMock).toHaveBeenCalled();
  });

  test('includes commit delta for pull request when head sha changes', async () => {
    setInputs();
    setContext({
      eventName: 'pull_request',
      action: 'synchronize',
      pullRequest: { number: 5, head: { sha: 'def' } },
    });

    const octokit = createOctokit({
      pullHeadSha: 'def',
      compareCommits: [{ sha: 'commit-sha' }],
    });
    setOctokit(octokit);

    mockArtifactClient.downloadArtifact.mockImplementation(async (_id, options) => {
      fs.mkdirSync(path.join(options.path, 'sessions'), { recursive: true });
      fs.writeFileSync(
        path.join(options.path, 'state.json'),
        JSON.stringify({
          subjectType: 'pr',
          subjectNumber: 5,
          lastRunAt: new Date().toISOString(),
          lastHeadSha: 'abc',
        })
      );
    });

    octokit.rest.actions.listArtifactsForRepo.mockResolvedValue({
      data: {
        artifacts: [
          {
            id: 2,
            name: 'action-agent-session-pr-5',
            expired: false,
            created_at: '2026-02-02T00:00:00Z',
            workflow_run: { id: 1002 },
          },
        ],
      },
    });

    await runAction();
    await waitFor(() => execMock.mock.calls.length > 0);

    expect(octokit.rest.repos.compareCommits).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'demo',
      base: 'abc',
      head: 'def',
    });
    expect(getCodexInput()).toContain('commitChanges');
  });
});

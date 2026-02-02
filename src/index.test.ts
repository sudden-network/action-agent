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
  listeners?: {
    stdout?: (data: Buffer) => void;
    stderr?: (data: Buffer) => void;
  };
  input?: string | Buffer;
  ignoreReturnCode?: boolean;
};

let mockArtifactClient: { downloadArtifact: jest.Mock; uploadArtifact: jest.Mock };
let mockCodexOutput = '';
let mockCodexExit = 0;
let mockLoginExit = 0;

jest.mock('@actions/core', () => ({
  getInput: jest.fn(),
  exportVariable: jest.fn(),
  setFailed: jest.fn(),
  info: jest.fn(),
}));

jest.mock('@actions/exec', () => ({
  exec: jest.fn(async (cmd: string, args: string[], opts: ExecCallOptions = {}) => {
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
      const outputBuffer = Buffer.from(mockCodexOutput, 'utf8');
      if (opts.listeners?.stdout) {
        opts.listeners.stdout(outputBuffer);
      }
      if (opts.listeners?.stderr && mockCodexOutput) {
        opts.listeners.stderr(Buffer.from('', 'utf8'));
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
const coreInfoMock = core.info as jest.MockedFunction<typeof core.info>;
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
    issue_number: '1',
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
  action?: string;
  issue?: { title: string; body: string };
  comment?: { body: string };
};

const setContext = ({ action = 'opened', issue, comment }: ContextOverrides = {}) => {
  github.context.payload.action = action;
  github.context.payload.issue = { title: 'Issue title', body: 'Issue body', number: 1, ...issue };
  github.context.payload.comment = { body: '', id: 1, ...comment };
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
  commentBody = '',
  commentUrl = 'https://example.com/issues/1#comment',
  artifacts = [] as Artifact[],
  artifactPages,
}: {
  issueTitle?: string;
  issueBody?: string;
  issueUrl?: string;
  commentBody?: string;
  commentUrl?: string;
  artifacts?: Artifact[];
  artifactPages?: Artifact[][];
} = {}) => ({
  rest: {
    issues: {
      get: jest.fn().mockResolvedValue({
        data: { title: issueTitle, body: issueBody, html_url: issueUrl },
      }),
      getComment: jest.fn().mockResolvedValue({
        data: { body: commentBody, html_url: commentUrl },
      }),
      createComment: jest.fn().mockResolvedValue({}),
    },
    reactions: {
      createForIssue: jest.fn().mockResolvedValue({}),
      createForIssueComment: jest.fn().mockResolvedValue({}),
    },
    actions: {
      listArtifactsForRepo: jest.fn().mockImplementation(({ page = 1 }) => {
        const pageArtifacts = artifactPages ? artifactPages[page - 1] ?? [] : artifacts;
        return Promise.resolve({ data: { artifacts: pageArtifacts } });
      }),
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
    mockCodexOutput = `${JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: 'Hello from Codex' },
    })}\n`;

    const runnerTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-test-'));
    process.env.RUNNER_TEMP = runnerTemp;
    process.env.GITHUB_ACTION_PATH = path.resolve(__dirname, '..');
    fs.rmSync('/tmp/codex_output.txt', { force: true });
    fs.rmSync('/tmp/codex_response.txt', { force: true });
  });
  test('runs on new issue and posts response', async () => {
    setInputs({ issue_number: '7' });
    setContext({ action: 'opened' });

    const octokit = createOctokit({ issueTitle: 'New issue', issueBody: 'Do work' });
    setOctokit(octokit);

    await runAction();
    await waitFor(() => octokit.rest.issues.createComment.mock.calls.length === 1);

    const [{ body }] = octokit.rest.issues.createComment.mock.calls[0];
    expect(body).toBe('Hello from Codex');
    expect(octokit.rest.reactions.createForIssue).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'demo',
      issue_number: 7,
      content: 'eyes',
    });
    expect(execMock).toHaveBeenCalledWith(
      'codex',
      expect.arrayContaining(['exec', '--json']),
      expect.objectContaining({
        input: expect.any(Buffer),
      })
    );
    expect(execMock).toHaveBeenCalledWith(
      'codex',
      expect.not.arrayContaining(['resume']),
      expect.objectContaining({
        input: expect.any(Buffer),
      })
    );
    expect(getCodexInput()).toContain('<issue-title>New issue</issue-title>');
    expect(getCodexInput()).toContain('<issue-body>Do work</description>');
    expect(mockArtifactClient.uploadArtifact).toHaveBeenCalledWith(
      'action-agent-session-7',
      expect.any(Array),
      expect.any(String),
      expect.objectContaining({ retentionDays: 7 })
    );
  });

  test('resumes from comment with latest artifact', async () => {
    setInputs({ issue_number: '8', comment_id: '55' });
    setContext({ action: 'created', comment: { body: 'What is up?' } });

    const octokit = createOctokit({
      commentBody: 'What is up?',
      artifacts: [
        {
          id: 1,
          name: 'action-agent-session-8',
          expired: false,
          created_at: '2026-02-01T00:00:00Z',
          workflow_run: { id: 1001 },
        },
        {
          id: 2,
          name: 'action-agent-session-8',
          expired: false,
          created_at: '2026-02-02T00:00:00Z',
          workflow_run: { id: 1002 },
        },
      ],
    });
    setOctokit(octokit);

    mockArtifactClient.downloadArtifact.mockImplementation(async (_id, options) => {
      expect(_id).toBe(2);
      const sessionsDir = path.join(options.path, 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.writeFileSync(path.join(sessionsDir, 'session.jsonl'), '');
    });

    await runAction();
    await waitFor(() => octokit.rest.issues.createComment.mock.calls.length === 1);

    const [{ body }] = octokit.rest.issues.createComment.mock.calls[0];
    expect(body).toBe('Hello from Codex');
    expect(octokit.rest.actions.listArtifactsForRepo).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'action-agent-session-8',
        per_page: 100,
        page: 1,
      })
    );
    expect(octokit.rest.reactions.createForIssueComment).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'demo',
      comment_id: 55,
      content: 'eyes',
    });
    expect(execMock).toHaveBeenCalledWith(
      'codex',
      expect.arrayContaining(['resume', '--last']),
      expect.objectContaining({ input: expect.any(Buffer) })
    );
    expect(getCodexInput()).toBe('What is up?');
  });

  test('paginates artifact listing with name filter', async () => {
    setInputs({ issue_number: '20', comment_id: '300' });
    setContext({ action: 'created', comment: { body: 'Continue' } });

    const artifactsPage1 = Array.from({ length: 100 }, (_value, index) => {
      const minute = Math.floor(index / 60);
      const second = index % 60;
      return {
        id: index + 1,
        name: 'action-agent-session-20',
        expired: false,
        created_at: `2026-02-01T00:${String(minute).padStart(2, '0')}:${String(second).padStart(
          2,
          '0'
        )}Z`,
        workflow_run: { id: 2000 + index },
      };
    });
    const artifactsPage2 = [
      {
        id: 999,
        name: 'action-agent-session-20',
        expired: false,
        created_at: '2026-02-02T00:00:00Z',
        workflow_run: { id: 3000 },
      },
    ];

    const octokit = createOctokit({
      commentBody: 'Continue',
      artifactPages: [artifactsPage1, artifactsPage2],
    });
    setOctokit(octokit);

    mockArtifactClient.downloadArtifact.mockImplementation(async (_id, options) => {
      expect(_id).toBe(999);
      const sessionsDir = path.join(options.path, 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.writeFileSync(path.join(sessionsDir, 'session.jsonl'), '');
    });

    await runAction();
    await waitFor(() => octokit.rest.issues.createComment.mock.calls.length === 1);

    expect(octokit.rest.actions.listArtifactsForRepo).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'action-agent-session-20',
        per_page: 100,
        page: 2,
      })
    );
  });

  test('fails when follow-up has no session artifact', async () => {
    setInputs({ issue_number: '9', comment_id: '77' });
    setContext({ action: 'created', comment: { body: 'continue' } });

    const octokit = createOctokit({ artifacts: [] });
    setOctokit(octokit);

    await runAction();
    await waitFor(() => octokit.rest.issues.createComment.mock.calls.length === 1);

    const [{ body }] = octokit.rest.issues.createComment.mock.calls[0];
    expect(body).toContain('Session artifact not found; cannot resume.');
    expect(execMock).not.toHaveBeenCalledWith('codex', expect.anything(), expect.anything());
  });

  test('skips stale edited comment without posting', async () => {
    setInputs({ issue_number: '10', comment_id: '88' });
    setContext({ action: 'edited', comment: { body: 'new body' } });

    const octokit = createOctokit({ commentBody: 'old body' });
    setOctokit(octokit);

    await runAction();
    await waitFor(() => execMock.mock.calls.length > 0);

    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  test('skips stale edited issue without posting', async () => {
    setInputs({ issue_number: '25' });
    setContext({
      action: 'edited',
      issue: { title: 'Old title', body: 'Old body' },
    });

    const octokit = createOctokit({
      issueTitle: 'Current title',
      issueBody: 'Current body',
    });
    setOctokit(octokit);

    await runAction();
    await waitFor(() => execMock.mock.calls.length > 0);

    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  test('adds edited comment context to prompt', async () => {
    setInputs({ issue_number: '15', comment_id: '101' });
    setContext({ action: 'edited', comment: { body: 'Updated comment body' } });

    const octokit = createOctokit({
      commentBody: 'Updated comment body',
      commentUrl: 'https://example.com/issues/15#comment-101',
      artifacts: [
        {
          id: 3,
          name: 'action-agent-session-15',
          expired: false,
          created_at: '2026-02-01T00:00:00Z',
          workflow_run: { id: 1501 },
        },
      ],
    });
    setOctokit(octokit);

    mockArtifactClient.downloadArtifact.mockImplementation(async (_id, options) => {
      const sessionsDir = path.join(options.path, 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.writeFileSync(path.join(sessionsDir, 'session.jsonl'), '');
    });

    await runAction();
    await waitFor(() => octokit.rest.issues.createComment.mock.calls.length === 1);

    expect(execMock).toHaveBeenCalledWith(
      'codex',
      expect.any(Array),
      expect.objectContaining({
        input: expect.any(Buffer),
      })
    );
    expect(execMock).toHaveBeenCalledWith(
      'codex',
      expect.any(Array),
      expect.objectContaining({
        input: expect.any(Buffer),
      })
    );
    expect(execMock).toHaveBeenCalledWith(
      'codex',
      expect.any(Array),
      expect.objectContaining({
        input: expect.any(Buffer),
      })
    );
    expect(getCodexInput()).toContain('Edited comment: https://example.com/issues/15#comment-101');
    expect(getCodexInput()).toContain('Respond to the updated content');
    expect(getCodexInput()).toContain('Updated comment body');
  });

  test('includes edited comment header in response body', async () => {
    setInputs({ issue_number: '18', comment_id: '202' });
    setContext({ action: 'edited', comment: { body: 'Updated comment body' } });

    const octokit = createOctokit({
      commentBody: 'Updated comment body',
      commentUrl: 'https://example.com/issues/18#comment-202',
      artifacts: [
        {
          id: 4,
          name: 'action-agent-session-18',
          expired: false,
          created_at: '2026-02-01T00:00:00Z',
          workflow_run: { id: 1801 },
        },
      ],
    });
    setOctokit(octokit);

    mockArtifactClient.downloadArtifact.mockImplementation(async (_id, options) => {
      const sessionsDir = path.join(options.path, 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.writeFileSync(path.join(sessionsDir, 'session.jsonl'), '');
    });

    await runAction();
    await waitFor(() => octokit.rest.issues.createComment.mock.calls.length === 1);

    const [{ body }] = octokit.rest.issues.createComment.mock.calls[0];
    expect(body.startsWith('Edited comment: https://example.com/issues/18#comment-202')).toBe(true);
  });

  test('reports missing OpenAI API key', async () => {
    setInputs({ issue_number: '11', openai_api_key: '' });
    setContext({ action: 'opened' });

    const octokit = createOctokit();
    setOctokit(octokit);

    await runAction();
    await waitFor(() => octokit.rest.issues.createComment.mock.calls.length === 1);

    const [{ body }] = octokit.rest.issues.createComment.mock.calls[0];
    expect(body).toContain('OPENAI_API_KEY is missing');
    expect(execMock).not.toHaveBeenCalledWith('codex', expect.anything(), expect.anything());
  });

  test('reports login failure', async () => {
    setInputs({ issue_number: '12' });
    setContext({ action: 'opened' });

    mockLoginExit = 1;
    const octokit = createOctokit();
    setOctokit(octokit);

    await runAction();
    await waitFor(() => octokit.rest.issues.createComment.mock.calls.length === 1);

    const [{ body }] = octokit.rest.issues.createComment.mock.calls[0];
    expect(body).toContain('Command failed with exit code 1.');
    expect(execMock).not.toHaveBeenCalledWith('codex', expect.anything(), expect.anything());
  });

  test('falls back to raw output when JSONL parse fails', async () => {
    setInputs({ issue_number: '13' });
    setContext({ action: 'opened' });

    mockCodexOutput = 'not-json\\n';
    const octokit = createOctokit();
    setOctokit(octokit);

    await runAction();
    await waitFor(() => octokit.rest.issues.createComment.mock.calls.length === 1);

    const [{ body }] = octokit.rest.issues.createComment.mock.calls[0];
    expect(body).toContain('not-json');
  });

  test('edited issue resumes and includes header', async () => {
    setInputs({ issue_number: '14' });
    setContext({ action: 'edited' });

    const octokit = createOctokit({
      issueUrl: 'https://example.com/issues/14',
      artifacts: [
        {
          id: 2,
          name: 'action-agent-session-14',
          expired: false,
          created_at: '2026-02-01T00:00:00Z',
          workflow_run: { id: 1401 },
        },
      ],
    });
    setOctokit(octokit);

    mockArtifactClient.downloadArtifact.mockImplementation(async (_id, options) => {
      fs.mkdirSync(options.path, { recursive: true });
      fs.writeFileSync(path.join(options.path, 'history.jsonl'), '');
    });

    await runAction();
    await waitFor(() => octokit.rest.issues.createComment.mock.calls.length === 1);

    const [{ body }] = octokit.rest.issues.createComment.mock.calls[0];
    expect(body.startsWith('Issue updated: https://example.com/issues/14')).toBe(true);
    expect(execMock).toHaveBeenCalledWith(
      'codex',
      expect.arrayContaining(['resume', '--last']),
      expect.objectContaining({
        input: expect.any(Buffer),
      })
    );
    expect(getCodexInput()).toContain('Issue updated');
  });

  test('edited issue uses template edit context when no comment', async () => {
    setInputs({ issue_number: '19' });
    setContext({ action: 'edited' });

    const octokit = createOctokit({
      issueUrl: 'https://example.com/issues/19',
      artifacts: [
        {
          id: 5,
          name: 'action-agent-session-19',
          expired: false,
          created_at: '2026-02-01T00:00:00Z',
          workflow_run: { id: 1901 },
        },
      ],
    });
    setOctokit(octokit);

    mockArtifactClient.downloadArtifact.mockImplementation(async (_id, options) => {
      fs.mkdirSync(options.path, { recursive: true });
      fs.writeFileSync(path.join(options.path, 'history.jsonl'), '');
    });

    await runAction();
    await waitFor(() => octokit.rest.issues.createComment.mock.calls.length === 1);

    expect(execMock).toHaveBeenCalledWith(
      'codex',
      expect.any(Array),
      expect.objectContaining({
        input: expect.any(Buffer),
      })
    );
    expect(execMock).toHaveBeenCalledWith(
      'codex',
      expect.any(Array),
      expect.objectContaining({
        input: expect.any(Buffer),
      })
    );
    expect(getCodexInput()).toContain('Issue updated: https://example.com/issues/19');
  });

  test('uses model and reasoning effort when provided', async () => {
    setInputs({ issue_number: '16', model: 'gpt-test', reasoning_effort: 'low' });
    setContext({ action: 'opened' });

    const octokit = createOctokit();
    setOctokit(octokit);

    await runAction();
    await waitFor(() => octokit.rest.issues.createComment.mock.calls.length === 1);

    expect(execMock).toHaveBeenCalledWith(
      'codex',
      expect.arrayContaining(['--model', 'gpt-test']),
      expect.any(Object)
    );
    expect(execMock).toHaveBeenCalledWith(
      'codex',
      expect.arrayContaining(['-c', 'model_reasoning_effort=low']),
      expect.any(Object)
    );
  });

  test('passes workspace-write sandbox to allow controlled edits', async () => {
    setInputs({ issue_number: '26' });
    setContext({ action: 'opened' });

    const octokit = createOctokit();
    setOctokit(octokit);

    await runAction();
    await waitFor(() => octokit.rest.issues.createComment.mock.calls.length === 1);

    expect(execMock).toHaveBeenCalledWith(
      'codex',
      expect.arrayContaining(['--sandbox', 'workspace-write']),
      expect.any(Object)
    );
  });

  test('sets approval_policy to avoid interactive prompts', async () => {
    setInputs({ issue_number: '27' });
    setContext({ action: 'opened' });

    const octokit = createOctokit();
    setOctokit(octokit);

    await runAction();
    await waitFor(() => octokit.rest.issues.createComment.mock.calls.length === 1);

    expect(execMock).toHaveBeenCalledWith(
      'codex',
      expect.arrayContaining(['-c', 'approval_policy="never"']),
      expect.any(Object)
    );
  });

  test('enables network access for workspace-write sandbox', async () => {
    setInputs({ issue_number: '28' });
    setContext({ action: 'opened' });

    const octokit = createOctokit();
    setOctokit(octokit);

    await runAction();
    await waitFor(() => octokit.rest.issues.createComment.mock.calls.length === 1);

    expect(execMock).toHaveBeenCalledWith(
      'codex',
      expect.arrayContaining(['-c', 'sandbox_workspace_write.network_access=true']),
      expect.any(Object)
    );
  });

  test('inherits environment to expose workflow tokens', async () => {
    setInputs({ issue_number: '29' });
    setContext({ action: 'opened' });

    const octokit = createOctokit();
    setOctokit(octokit);

    await runAction();
    await waitFor(() => octokit.rest.issues.createComment.mock.calls.length === 1);

    expect(execMock).toHaveBeenCalledWith(
      'codex',
      expect.arrayContaining(['-c', 'shell_environment_policy.inherit=all']),
      expect.any(Object)
    );
  });

  test('ignores default env excludes to keep auth vars available', async () => {
    setInputs({ issue_number: '30' });
    setContext({ action: 'opened' });

    const octokit = createOctokit();
    setOctokit(octokit);

    await runAction();
    await waitFor(() => octokit.rest.issues.createComment.mock.calls.length === 1);

    expect(execMock).toHaveBeenCalledWith(
      'codex',
      expect.arrayContaining(['-c', 'shell_environment_policy.ignore_default_excludes=true']),
      expect.any(Object)
    );
  });

  test('handles artifact download failure', async () => {
    setInputs({ issue_number: '20', comment_id: '303' });
    setContext({ action: 'created', comment: { body: 'continue' } });

    const octokit = createOctokit({
      artifacts: [
        {
          id: 6,
          name: 'action-agent-session-20',
          expired: false,
          created_at: '2026-02-01T00:00:00Z',
          workflow_run: { id: 2001 },
        },
      ],
    });
    setOctokit(octokit);

    mockArtifactClient.downloadArtifact.mockRejectedValue(new Error('boom'));

    await runAction();
    await waitFor(() => octokit.rest.issues.createComment.mock.calls.length === 1);

    const [{ body }] = octokit.rest.issues.createComment.mock.calls[0];
    expect(body).toContain('Session artifact not found; cannot resume.');
  });

  test('handles session artifact missing contents', async () => {
    setInputs({ issue_number: '21', comment_id: '404' });
    setContext({ action: 'created', comment: { body: 'continue' } });

    const octokit = createOctokit({
      artifacts: [
        {
          id: 7,
          name: 'action-agent-session-21',
          expired: false,
          created_at: '2026-02-01T00:00:00Z',
          workflow_run: { id: 2101 },
        },
      ],
    });
    setOctokit(octokit);

    const downloadPath = path.join(process.env.RUNNER_TEMP || '/tmp', 'codex-session');
    mockArtifactClient.downloadArtifact.mockImplementation(async (_id, options) => {
      fs.mkdirSync(options.path, { recursive: true });
      fs.writeFileSync(path.join(options.path, 'history.jsonl'), '');
    });

    const existsSpy = jest.spyOn(fs, 'existsSync');
    existsSpy.mockImplementation((filePath) => {
      if (filePath === downloadPath) {
        return false;
      }
      return true;
    });

    await runAction();
    await waitFor(() => octokit.rest.issues.createComment.mock.calls.length === 1);

    const [{ body }] = octokit.rest.issues.createComment.mock.calls[0];
    expect(body).toContain('Session artifact missing contents; cannot resume.');
    existsSpy.mockRestore();
  });

  test('handles list artifacts failure', async () => {
    setInputs({ issue_number: '22', comment_id: '505' });
    setContext({ action: 'created', comment: { body: 'continue' } });

    const octokit = createOctokit();
    octokit.rest.actions.listArtifactsForRepo.mockRejectedValue(new Error('fail'));
    setOctokit(octokit);

    await runAction();
    await waitFor(() => coreSetFailedMock.mock.calls.length === 1);

    expect(coreSetFailedMock).toHaveBeenCalledWith('fail');
    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'demo',
      issue_number: 22,
      body: 'fail',
    });
  });

  test('logs reaction failures and continues', async () => {
    setInputs({ issue_number: '31' });
    setContext({ action: 'opened' });

    const octokit = createOctokit();
    octokit.rest.reactions.createForIssue.mockRejectedValue(new Error('nope'));
    setOctokit(octokit);

    await runAction();
    await waitFor(() => octokit.rest.issues.createComment.mock.calls.length === 1);

    expect(coreInfoMock).toHaveBeenCalledWith('Reaction failed: nope');
    expect(octokit.rest.issues.createComment).toHaveBeenCalled();
  });

  test('reports codex non-zero exit with raw output', async () => {
    setInputs({ issue_number: '23' });
    setContext({ action: 'opened' });

    mockCodexExit = 2;
    mockCodexOutput = 'codex failed\\n';
    const octokit = createOctokit();
    setOctokit(octokit);

    const existsSpy = jest.spyOn(fs, 'existsSync');
    existsSpy.mockImplementation((filePath) => {
      if (filePath === '/tmp/codex_output.txt') {
        return true;
      }
      if (filePath === '/tmp/codex_response.txt') {
        return false;
      }
      return true;
    });

    await runAction();
    await waitFor(() => octokit.rest.issues.createComment.mock.calls.length === 1);

    const [{ body }] = octokit.rest.issues.createComment.mock.calls[0];
    expect(body).toContain('codex failed');
    expect(mockArtifactClient.uploadArtifact).not.toHaveBeenCalled();
    existsSpy.mockRestore();
  });

  test('reports no output when codex fails and output missing', async () => {
    setInputs({ issue_number: '32' });
    setContext({ action: 'opened' });

    mockCodexExit = 2;
    mockCodexOutput = '';
    const octokit = createOctokit();
    setOctokit(octokit);

    const existsSpy = jest.spyOn(fs, 'existsSync');
    existsSpy.mockImplementation((filePath) => {
      if (filePath === '/tmp/codex_output.txt') {
        return false;
      }
      if (filePath === '/tmp/codex_response.txt') {
        return false;
      }
      return true;
    });

    const originalReadFileSync = fs.readFileSync.bind(fs);
    const readSpy = jest.spyOn(fs, 'readFileSync');
    readSpy.mockImplementation((filePath, encoding) => {
      if (filePath === '/tmp/codex_response.txt') {
        throw new Error('missing');
      }
      return originalReadFileSync(filePath, encoding);
    });

    await runAction();
    await waitFor(() => octokit.rest.issues.createComment.mock.calls.length === 1);

    const [{ body }] = octokit.rest.issues.createComment.mock.calls[0];
    expect(body).toContain('(no output)');
    existsSpy.mockRestore();
    readSpy.mockRestore();
  });

  test('reports no output when response and output files are absent', async () => {
    setInputs({ issue_number: '34' });
    setContext({ action: 'opened' });

    mockCodexExit = 0;
    mockCodexOutput = '';
    const octokit = createOctokit();
    setOctokit(octokit);

    const originalExistsSync = fs.existsSync.bind(fs);
    const existsSpy = jest.spyOn(fs, 'existsSync');
    existsSpy.mockImplementation((filePath) => {
      if (filePath === '/tmp/codex_output.txt') {
        return false;
      }
      if (filePath === '/tmp/codex_response.txt') {
        return false;
      }
      return originalExistsSync(filePath);
    });

    await runAction();
    await waitFor(() => octokit.rest.issues.createComment.mock.calls.length === 1);

    const [{ body }] = octokit.rest.issues.createComment.mock.calls[0];
    expect(body).toContain('(no output)');
    existsSpy.mockRestore();
  });

  test('fails when no session files exist to upload', async () => {
    setInputs({ issue_number: '33' });
    setContext({ action: 'opened' });

    const octokit = createOctokit();
    setOctokit(octokit);

    const readdirSpy = jest.spyOn(fs, 'readdirSync');
    readdirSpy.mockReturnValue([]);

    await runAction();
    await waitFor(() => coreSetFailedMock.mock.calls.length === 1);

    expect(coreSetFailedMock).toHaveBeenCalledWith('No Codex state files found for upload.');
    readdirSpy.mockRestore();
  });

  test('falls back to raw output when no agent_message', async () => {
    setInputs({ issue_number: '24' });
    setContext({ action: 'opened' });

    mockCodexOutput = `${JSON.stringify({ type: 'item.completed', item: { type: 'tool_call', text: '' } })}\\n`;
    const octokit = createOctokit();
    setOctokit(octokit);

    const existsSpy = jest.spyOn(fs, 'existsSync');
    existsSpy.mockImplementation((filePath) => {
      if (filePath === '/tmp/codex_output.txt') {
        return true;
      }
      if (filePath === '/tmp/codex_response.txt') {
        return false;
      }
      return true;
    });

    await runAction();
    await waitFor(() => octokit.rest.issues.createComment.mock.calls.length === 1);

    const [{ body }] = octokit.rest.issues.createComment.mock.calls[0];
    expect(body).toContain('item.completed');
    existsSpy.mockRestore();
  });

  test('strips auth and temp files after run', async () => {
    setInputs({ issue_number: '17' });
    setContext({ action: 'opened' });

    const octokit = createOctokit();
    setOctokit(octokit);

    const rmSpy = jest.spyOn(fs, 'rmSync');

    await runAction();
    await waitFor(() => octokit.rest.issues.createComment.mock.calls.length === 1);

    expect(rmSpy).toHaveBeenCalledWith(expect.stringContaining('auth.json'), { force: true });
    expect(rmSpy).toHaveBeenCalledWith(expect.stringContaining(path.join('codex-home', 'tmp')), {
      recursive: true,
      force: true,
    });
    rmSpy.mockRestore();
  });
});

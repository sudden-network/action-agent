import { randomUUID } from 'crypto';
import http from 'http';
import { getOctokit } from '@actions/github';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod/v4';
import { isNotFoundError } from './error';

interface RunningMcpServer {
  url: Promise<string>;
  close: () => Promise<void>;
};

const readJsonBody = async (req: http.IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return null;
  return JSON.parse(raw);
};

const createGitHubServer = (githubToken: string): McpServer => {
  const octokit = getOctokit(githubToken);
  const server = new McpServer({ name: 'action-agent-github', version: '0.1.0' });

  server.registerTool(
    'add_issue_comment',
    {
      description:
        'Add a comment to a GitHub issue. Use this for pull request conversation comments too (issue_number = PR number).',
      inputSchema: {
        owner: z.string(),
        repo: z.string(),
        issue_number: z.number().int(),
        body: z.string(),
      },
    },
    async ({ owner, repo, issue_number, body }) => {
      const { data } = await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number,
        body,
      });

      return { content: [{ type: 'text', text: data.html_url }] };
    },
  );

  server.registerTool(
    'issue_write',
    {
      description: 'Create or update an issue in a GitHub repository.',
      inputSchema: {
        method: z.enum(['create', 'update']),
        owner: z.string(),
        repo: z.string(),
        issue_number: z.number().int().optional(),
        title: z.string().optional(),
        body: z.string().optional(),
        assignees: z.array(z.string()).optional(),
        labels: z.array(z.string()).optional(),
        milestone: z.number().int().optional(),
        state: z.enum(['open', 'closed']).optional(),
        state_reason: z.enum(['completed', 'not_planned', 'reopened']).optional(),
      },
    },
    async ({ method, owner, repo, issue_number, title, body, assignees, labels, milestone, state, state_reason }) => {
      if (method === 'create') {
        if (!title) {
          throw new Error('issue_write(create) requires title');
        }

        const { data } = await octokit.rest.issues.create({
          owner,
          repo,
          title,
          body,
          assignees,
          labels,
          milestone,
        });

        return { content: [{ type: 'text', text: data.html_url }] };
      }

      if (!issue_number) {
        throw new Error('issue_write(update) requires issue_number');
      }

      const { data } = await octokit.rest.issues.update({
        owner,
        repo,
        issue_number,
        title,
        body,
        assignees,
        labels,
        milestone,
        state,
        state_reason,
      });

      return { content: [{ type: 'text', text: data.html_url }] };
    },
  );

  server.registerTool(
    'create_branch',
    {
      description: 'Create a new branch in a GitHub repository.',
      inputSchema: {
        owner: z.string(),
        repo: z.string(),
        branch: z.string(),
        from_branch: z.string().optional(),
      },
    },
    async ({ owner, repo, branch, from_branch }) => {
      const baseBranch = from_branch
        ? from_branch
        : (await octokit.rest.repos.get({ owner, repo })).data.default_branch;

      const baseRef = await octokit.rest.git.getRef({
        owner,
        repo,
        ref: `heads/${baseBranch}`,
      });

      const { data } = await octokit.rest.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branch}`,
        sha: baseRef.data.object.sha,
      });

      return { content: [{ type: 'text', text: data.ref }] };
    },
  );

  server.registerTool(
    'create_or_update_file',
    {
      description:
        'Create or update a file on a branch (via the Contents API). This creates a commit on the target branch. Use this to update files for a pull request by targeting its head branch.',
      inputSchema: {
        owner: z.string(),
        repo: z.string(),
        path: z.string(),
        content: z.string(),
        message: z.string(),
        branch: z.string(),
        sha: z.string().optional(),
      },
    },
    async ({ owner, repo, path, content, message, branch, sha }) => {
      const existingSha = sha
        ? sha
        : await (async () => {
            try {
              const { data } = await octokit.rest.repos.getContent({
                owner,
                repo,
                path,
                ref: branch,
              });

              if (Array.isArray(data) || data.type !== 'file') return undefined;
              return data.sha;
            } catch (error) {
              if (isNotFoundError(error)) return undefined;
              throw error;
            }
          })();

      const { data } = await octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message,
        content: Buffer.from(content, 'utf8').toString('base64'),
        branch,
        sha: existingSha,
      });

      return { content: [{ type: 'text', text: JSON.stringify({ commit: data.commit.sha }, null, 2) }] };
    },
  );

  server.registerTool(
    'create_pull_request',
    {
      description: 'Create a pull request in a GitHub repository.',
      inputSchema: {
        owner: z.string(),
        repo: z.string(),
        title: z.string(),
        head: z.string(),
        base: z.string(),
        body: z.string().optional(),
        draft: z.boolean().optional(),
        maintainer_can_modify: z.boolean().optional(),
      },
    },
    async ({ owner, repo, title, head, base, body, draft, maintainer_can_modify }) => {
      const { data } = await octokit.rest.pulls.create({
        owner,
        repo,
        title,
        head,
        base,
        body,
        draft,
        maintainer_can_modify,
      });

      return { content: [{ type: 'text', text: data.html_url }] };
    },
  );

  server.registerTool(
    'reply_pull_request_review_comment',
    {
      description: 'Reply to an inline pull request review comment by comment ID.',
      inputSchema: {
        owner: z.string(),
        repo: z.string(),
        comment_id: z.number().int(),
        body: z.string(),
      },
    },
    async ({ owner, repo, comment_id, body }) => {
      const { data: comment } = await octokit.rest.pulls.getReviewComment({
        owner,
        repo,
        comment_id,
      });

      const pullNumber = Number(new URL(comment.pull_request_url).pathname.split('/').pop());
      if (!Number.isInteger(pullNumber)) {
        throw new Error(`Failed to derive pull request number from review comment ${comment_id}`);
      }

      const { data } = await octokit.rest.pulls.createReplyForReviewComment({
        owner,
        repo,
        pull_number: pullNumber,
        comment_id,
        body,
      });

      return { content: [{ type: 'text', text: data.html_url }] };
    },
  );

  return server;
};

const startGitHubMcpServer = async (githubToken: string) => {
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const handleRequest = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/mcp') {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const sessionId = req.headers['mcp-session-id'];
      const existing = typeof sessionId === 'string' ? transports.get(sessionId) : undefined;

      if (existing) {
        await existing.handleRequest(req, res, body);
        return;
      }

      if (!isInitializeRequest(body)) {
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
            id: null,
          }),
        );
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => transports.set(newSessionId, transport),
      });

      transport.onclose = () => {
        if (!transport.sessionId) return;
        transports.delete(transport.sessionId);
      };

      const server = createGitHubServer(githubToken);
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    if (req.method === 'GET' || req.method === 'DELETE') {
      const sessionId = req.headers['mcp-session-id'];
      const transport = typeof sessionId === 'string' ? transports.get(sessionId) : undefined;
      if (!transport) {
        res.statusCode = 400;
        res.end('Invalid or missing session ID');
        return;
      }

      await transport.handleRequest(req, res);
      return;
    }

    res.statusCode = 405;
    res.end('Method Not Allowed');
  };

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error: unknown) => {
      if (res.headersSent) return;
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: error instanceof Error ? error.message : 'Internal server error' },
          id: null,
        }),
      );
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });
  server.unref();

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start MCP server');
  }

  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: async () => {
      await Promise.allSettled(Array.from(transports.values()).map((transport) => transport.close()));
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
};

export const githubMcpServer = (githubToken: string): RunningMcpServer => {
  const serverPromise = startGitHubMcpServer(githubToken);
  return {
    url: serverPromise.then((server) => server.url),
    close: () => serverPromise.then((server) => server.close()),
  };
};

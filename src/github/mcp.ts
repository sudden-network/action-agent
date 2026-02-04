import { randomUUID } from 'crypto';
import http from 'http';
import { getOctokit } from '@actions/github';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod/v4';

interface RunningMcpServer {
  url: Promise<string>;
  close: () => Promise<void>;
}

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
    'octokit_request',
    {
      description:
        'Call any GitHub REST API endpoint via Octokit.request. Provide `route` like "GET /repos/{owner}/{repo}/pulls/{pull_number}".',
      inputSchema: {
        route: z.string(),
        parameters: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async ({ route, parameters }) => {
      const response = await octokit.request(route, parameters ?? {});

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: response.status,
                data: response.data,
              },
              null,
              2,
            ),
          },
        ],
      };
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

  // TODO(high): This local HTTP MCP endpoint has no auth beyond localhost. In GitHub Actions,
  // any process in the same job could hit 127.0.0.1:<port>/mcp and invoke GitHub API ops with
  // the job token. Consider a shared secret header, unix socket binding, or restricting access
  // to the Codex child process.
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

/**
 * GitHub-like MCP Server (stdio)
 *
 * Simulates a real GitHub MCP server with realistic tool schemas
 * and response payloads. Uses actual GitHub API response shapes.
 */

import { createInterface } from 'node:readline';

// ---------------------------------------------------------------------------
// Tool definitions — mirrors real GitHub MCP server schemas
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'list_repos',
    description: 'List repositories for the authenticated user or a specified organization',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner (user or org)' },
        type: { type: 'string', enum: ['all', 'owner', 'member'], default: 'all' },
        sort: { type: 'string', enum: ['created', 'updated', 'pushed', 'full_name'], default: 'updated' },
        per_page: { type: 'number', description: 'Results per page (max 100)', default: 30 },
        page: { type: 'number', description: 'Page number', default: 1 },
      },
      required: ['owner'],
    },
  },
  {
    name: 'get_repo',
    description: 'Get detailed information about a specific repository including stats, languages, and topics',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'search_issues',
    description: 'Search for issues and pull requests across repositories using GitHub search syntax',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Search query using GitHub search syntax (e.g., "bug label:critical is:open")' },
        sort: { type: 'string', enum: ['comments', 'reactions', 'created', 'updated', 'best-match'], default: 'best-match' },
        order: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
        per_page: { type: 'number', default: 30 },
        page: { type: 'number', default: 1 },
      },
      required: ['q'],
    },
  },
  {
    name: 'get_issue',
    description: 'Get detailed information about a specific issue including body, labels, assignees, and timeline',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        issue_number: { type: 'number', description: 'Issue number' },
      },
      required: ['owner', 'repo', 'issue_number'],
    },
  },
  {
    name: 'create_issue',
    description: 'Create a new issue in a repository',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        title: { type: 'string', description: 'Issue title' },
        body: { type: 'string', description: 'Issue body (Markdown supported)' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Label names' },
        assignees: { type: 'array', items: { type: 'string' }, description: 'GitHub usernames to assign' },
        milestone: { type: 'number', description: 'Milestone ID' },
      },
      required: ['owner', 'repo', 'title'],
    },
  },
  {
    name: 'get_pull_request',
    description: 'Get detailed information about a pull request including diff stats, review status, and merge state',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        pull_number: { type: 'number' },
      },
      required: ['owner', 'repo', 'pull_number'],
    },
  },
  {
    name: 'list_pull_request_files',
    description: 'List files changed in a pull request with patch details',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        pull_number: { type: 'number' },
        per_page: { type: 'number', default: 30 },
      },
      required: ['owner', 'repo', 'pull_number'],
    },
  },
  {
    name: 'create_pull_request_review',
    description: 'Create a review for a pull request (approve, request changes, or comment)',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        pull_number: { type: 'number' },
        body: { type: 'string', description: 'Review body text' },
        event: { type: 'string', enum: ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'] },
        comments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              position: { type: 'number' },
              body: { type: 'string' },
            },
            required: ['path', 'position', 'body'],
          },
        },
      },
      required: ['owner', 'repo', 'pull_number', 'event'],
    },
  },
  {
    name: 'list_commits',
    description: 'List commits on a repository branch with author, message, and stats',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        sha: { type: 'string', description: 'Branch name or commit SHA' },
        since: { type: 'string', description: 'ISO 8601 date — only commits after this date' },
        until: { type: 'string', description: 'ISO 8601 date — only commits before this date' },
        per_page: { type: 'number', default: 30 },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'get_file_contents',
    description: 'Get the contents of a file or directory in a repository',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        path: { type: 'string', description: 'File path relative to repository root' },
        ref: { type: 'string', description: 'Branch, tag, or commit SHA' },
      },
      required: ['owner', 'repo', 'path'],
    },
  },
  {
    name: 'search_code',
    description: 'Search for code across all repositories using GitHub code search',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Search query (e.g., "addClass in:file language:js repo:jquery/jquery")' },
        sort: { type: 'string', enum: ['indexed'], description: 'Sort by last indexed date' },
        order: { type: 'string', enum: ['asc', 'desc'] },
        per_page: { type: 'number', default: 30 },
      },
      required: ['q'],
    },
  },
  {
    name: 'list_workflow_runs',
    description: 'List recent workflow runs for a repository (CI/CD status)',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        workflow_id: { type: 'string', description: 'Workflow file name or ID' },
        branch: { type: 'string' },
        status: { type: 'string', enum: ['completed', 'action_required', 'cancelled', 'failure', 'neutral', 'skipped', 'stale', 'success', 'timed_out', 'in_progress', 'queued', 'requested', 'waiting', 'pending'] },
        per_page: { type: 'number', default: 10 },
      },
      required: ['owner', 'repo'],
    },
  },
];

// ---------------------------------------------------------------------------
// Realistic response payloads
// ---------------------------------------------------------------------------

function makeRepoResponse() {
  return {
    id: 123456789,
    node_id: 'R_kgDOBzJ3Xw',
    name: 'nekte-protocol',
    full_name: 'nekte-protocol/nekte',
    private: false,
    owner: {
      login: 'nekte-protocol',
      id: 98765432,
      avatar_url: 'https://avatars.githubusercontent.com/u/98765432?v=4',
      type: 'Organization',
    },
    html_url: 'https://github.com/nekte-protocol/nekte',
    description: 'Token-efficient agent-to-agent coordination protocol',
    fork: false,
    created_at: '2025-01-15T10:30:00Z',
    updated_at: '2026-04-07T14:22:00Z',
    pushed_at: '2026-04-07T09:15:00Z',
    homepage: 'https://nekte.dev',
    size: 4520,
    stargazers_count: 1247,
    watchers_count: 89,
    language: 'TypeScript',
    forks_count: 156,
    open_issues_count: 23,
    default_branch: 'main',
    topics: ['agents', 'mcp', 'protocol', 'token-efficient', 'a2a'],
    license: { key: 'mit', name: 'MIT License', spdx_id: 'MIT' },
    subscribers_count: 89,
    network_count: 156,
  };
}

function makeReposListResponse(count = 5) {
  return Array.from({ length: count }, (_, i) => ({
    id: 100000000 + i,
    name: ['nekte', 'nekte-docs', 'nekte-examples', 'mcp-bridge-starter', 'agent-toolkit'][i] ?? `repo-${i}`,
    full_name: `nekte-protocol/${['nekte', 'nekte-docs', 'nekte-examples', 'mcp-bridge-starter', 'agent-toolkit'][i] ?? `repo-${i}`}`,
    private: i === 3,
    description: [
      'Token-efficient agent-to-agent coordination protocol',
      'Documentation and specification for NEKTE protocol',
      'Example implementations and integration guides',
      'Starter template for MCP-to-NEKTE bridge deployment',
      'Toolkit for building NEKTE-compatible agents',
    ][i] ?? `Repository ${i}`,
    html_url: `https://github.com/nekte-protocol/repo-${i}`,
    language: ['TypeScript', 'MDX', 'TypeScript', 'TypeScript', 'Python'][i],
    stargazers_count: [1247, 234, 89, 45, 312][i],
    updated_at: '2026-04-07T14:22:00Z',
    topics: ['nekte', 'agents'][i % 2 === 0 ? 0 : 1] ? ['nekte', 'agents'] : [],
  }));
}

function makeIssueResponse() {
  return {
    id: 987654321,
    number: 142,
    title: 'Bridge fails to reconnect after MCP server restart',
    state: 'open',
    user: { login: 'alice-dev', id: 11111, avatar_url: 'https://avatars.githubusercontent.com/u/11111' },
    labels: [
      { id: 1, name: 'bug', color: 'd73a4a', description: 'Something isn\'t working' },
      { id: 2, name: 'bridge', color: '0075ca', description: 'MCP bridge component' },
      { id: 3, name: 'P1', color: 'e4e669', description: 'High priority' },
    ],
    assignees: [
      { login: 'bob-maintainer', id: 22222 },
    ],
    milestone: { id: 5, number: 3, title: 'v0.3.0', due_on: '2026-05-01T00:00:00Z' },
    comments: 7,
    created_at: '2026-04-01T08:15:00Z',
    updated_at: '2026-04-06T16:30:00Z',
    body: `## Description\n\nWhen an upstream MCP server restarts (e.g., during deployment), the bridge's \`McpConnector\` does not attempt to re-establish the connection. The periodic refresh fails silently and the bridge serves stale tool schemas.\n\n## Steps to Reproduce\n\n1. Start bridge with \`nekte-bridge --config bridge.json\`\n2. Verify tools are discovered correctly\n3. Restart the upstream MCP server\n4. Wait for refresh interval (5 min default)\n5. Observe: refresh fails, no reconnection attempt\n\n## Expected Behavior\n\nThe bridge should detect the connection failure and attempt exponential backoff reconnection.\n\n## Environment\n\n- @nekte/bridge v0.2.0\n- Node.js 22.4.0\n- MCP server: @modelcontextprotocol/server-filesystem\n\n## Logs\n\n\`\`\`\n[nekte-bridge] Failed to refresh MCP server "filesystem": TypeError: fetch failed\n\`\`\``,
    reactions: { '+1': 12, '-1': 0, laugh: 0, hooray: 0, confused: 2, heart: 0, rocket: 0, eyes: 3 },
  };
}

function makeSearchIssuesResponse() {
  return {
    total_count: 47,
    incomplete_results: false,
    items: Array.from({ length: 5 }, (_, i) => ({
      id: 900000000 + i,
      number: 140 + i,
      title: [
        'gRPC streaming drops events under high concurrency',
        'Version hash collision on tools with identical schemas',
        'Bridge fails to reconnect after MCP server restart',
        'SSE event ordering not guaranteed with multiple delegates',
        'MessagePack codec truncates large binary payloads',
      ][i],
      state: i < 3 ? 'open' : 'closed',
      labels: [
        [{ name: 'bug' }, { name: 'grpc' }],
        [{ name: 'bug' }, { name: 'core' }],
        [{ name: 'bug' }, { name: 'bridge' }, { name: 'P1' }],
        [{ name: 'bug' }, { name: 'streaming' }],
        [{ name: 'bug' }, { name: 'codec' }],
      ][i],
      user: { login: ['alice-dev', 'charlie-qa', 'alice-dev', 'dana-ops', 'eve-contrib'][i] },
      comments: [3, 1, 7, 5, 2][i],
      created_at: `2026-04-0${1 + i}T10:00:00Z`,
      score: [15.2, 12.1, 18.7, 9.3, 7.8][i],
    })),
  };
}

function makePRResponse() {
  return {
    id: 555555555,
    number: 89,
    title: 'feat: add exponential backoff reconnection to MCP connector',
    state: 'open',
    user: { login: 'bob-maintainer', id: 22222 },
    body: `## Summary\n\nImplements automatic reconnection with exponential backoff when upstream MCP servers become unavailable.\n\n## Changes\n\n- Added \`ReconnectionManager\` class with configurable backoff strategy\n- Modified \`McpConnector.refreshAll()\` to trigger reconnection on failure\n- Added connection health tracking per server\n- New config options: \`maxRetries\`, \`baseDelayMs\`, \`maxDelayMs\`\n\n## Test Plan\n\n- [x] Unit tests for ReconnectionManager\n- [x] Integration test: server restart scenario\n- [ ] Load test under high concurrency\n\nCloses #142`,
    head: { ref: 'feat/reconnection', sha: 'abc123def456' },
    base: { ref: 'main', sha: '789ghi012jkl' },
    draft: false,
    mergeable: true,
    mergeable_state: 'clean',
    additions: 347,
    deletions: 42,
    changed_files: 8,
    commits: 3,
    review_comments: 2,
    labels: [{ name: 'enhancement' }, { name: 'bridge' }],
    requested_reviewers: [{ login: 'alice-dev' }],
    created_at: '2026-04-05T11:00:00Z',
    updated_at: '2026-04-07T08:30:00Z',
  };
}

function makePRFilesResponse() {
  return [
    {
      sha: 'aaa111',
      filename: 'packages/bridge/src/reconnection.ts',
      status: 'added',
      additions: 187,
      deletions: 0,
      changes: 187,
      patch: '@@ -0,0 +1,187 @@\n+/**\n+ * ReconnectionManager — Exponential backoff reconnection\n+ */\n+\n+export interface ReconnectionConfig {\n+  maxRetries: number;\n+  baseDelayMs: number;\n+  maxDelayMs: number;\n+}\n+\n+export class ReconnectionManager {\n+  private attempts = new Map<string, number>();\n+  \n+  constructor(private config: ReconnectionConfig) {}\n+  \n+  async reconnect(serverName: string, connectFn: () => Promise<void>): Promise<boolean> {\n+    const attempt = (this.attempts.get(serverName) ?? 0) + 1;\n+    this.attempts.set(serverName, attempt);\n+    \n+    if (attempt > this.config.maxRetries) {\n+      return false;\n+    }\n+    \n+    const delay = Math.min(\n+      this.config.baseDelayMs * Math.pow(2, attempt - 1),\n+      this.config.maxDelayMs\n+    );\n+    \n+    await new Promise(r => setTimeout(r, delay));\n+    \n+    try {\n+      await connectFn();\n+      this.attempts.delete(serverName);\n+      return true;\n+    } catch {\n+      return this.reconnect(serverName, connectFn);\n+    }\n+  }\n+}',
    },
    {
      sha: 'bbb222',
      filename: 'packages/bridge/src/mcp-connector.ts',
      status: 'modified',
      additions: 45,
      deletions: 12,
      changes: 57,
      patch: '@@ -88,6 +88,18 @@ export class McpConnector {\n       } catch (err) {\n-        console.warn(`[nekte-bridge] Failed to refresh MCP server "${name}": ${err}`);\n+        // Trigger reconnection on failure\n+        if (this.reconnectionManager) {\n+          const success = await this.reconnectionManager.reconnect(\n+            name,\n+            () => this.connect(conn.config)\n+          );\n+          if (success) {\n+            changed = true;\n+          } else {\n+            this.log.error(`Reconnection failed for ${name} after max retries`);\n+          }\n+        } else {\n+          console.warn(`Failed to refresh: ${name}: ${err}`);\n+        }',
    },
    {
      sha: 'ccc333',
      filename: 'packages/bridge/src/__tests__/reconnection.test.ts',
      status: 'added',
      additions: 95,
      deletions: 0,
      changes: 95,
      patch: '@@ -0,0 +1,95 @@\n+import { describe, it, expect, vi } from \'vitest\';\n+import { ReconnectionManager } from \'../reconnection.js\';\n+\n+describe(\'ReconnectionManager\', () => {\n+  it(\'reconnects with exponential backoff\', async () => { ... });\n+  it(\'gives up after maxRetries\', async () => { ... });\n+  it(\'resets attempt count on success\', async () => { ... });\n+});',
    },
    {
      sha: 'ddd444',
      filename: 'packages/bridge/src/bridge.ts',
      status: 'modified',
      additions: 20,
      deletions: 5,
      changes: 25,
      patch: '@@ -78,6 +78,12 @@ export class NekteBridge {\n   constructor(config: BridgeConfig) {\n     this.config = config;\n+    this.reconnectionManager = config.reconnection\n+      ? new ReconnectionManager(config.reconnection)\n+      : undefined;',
    },
  ];
}

function makeCommitsResponse() {
  return Array.from({ length: 5 }, (_, i) => ({
    sha: `${['abc123', 'def456', 'ghi789', 'jkl012', 'mno345'][i]}abcdef0123456789`,
    commit: {
      author: {
        name: ['Bob Maintainer', 'Alice Dev', 'Bob Maintainer', 'Charlie QA', 'Eve Contrib'][i],
        email: `${['bob', 'alice', 'bob', 'charlie', 'eve'][i]}@nekte.dev`,
        date: `2026-04-0${7 - i}T${10 + i}:00:00Z`,
      },
      message: [
        'feat: add exponential backoff reconnection to MCP connector',
        'fix: handle empty tool schemas in catalog builder',
        'docs: update bridge configuration guide',
        'test: add integration tests for gRPC streaming',
        'refactor: extract budget resolution into shared utility',
      ][i],
    },
    stats: { additions: [347, 12, 45, 89, 23][i], deletions: [42, 3, 8, 5, 31][i], total: [389, 15, 53, 94, 54][i] },
  }));
}

function makeFileContentsResponse(path: string) {
  const content = `import { McpConnector } from './mcp-connector.js';
import { CatalogBuilder } from './catalog.js';
import { compressMcpResult } from './compressor.js';
import { MetricsCollector } from './metrics.js';

export class NekteBridge {
  readonly connector: McpConnector;
  readonly catalog: CatalogBuilder;
  readonly metrics: MetricsCollector;

  constructor(config: BridgeConfig) {
    this.connector = new McpConnector();
    this.catalog = new CatalogBuilder();
    this.metrics = new MetricsCollector();
  }

  async init(): Promise<void> {
    for (const server of this.config.mcpServers) {
      await this.connector.connect(server);
    }
    this.catalog.buildFrom(this.connector);
  }
}`;

  return {
    name: path.split('/').pop(),
    path,
    sha: 'abc123def456',
    size: content.length,
    type: 'file',
    content: Buffer.from(content).toString('base64'),
    encoding: 'base64',
  };
}

function makeSearchCodeResponse() {
  return {
    total_count: 12,
    items: Array.from({ length: 3 }, (_, i) => ({
      name: ['mcp-connector.ts', 'bridge.ts', 'catalog.ts'][i],
      path: `packages/bridge/src/${['mcp-connector.ts', 'bridge.ts', 'catalog.ts'][i]}`,
      sha: `sha${i}`,
      repository: { full_name: 'nekte-protocol/nekte' },
      text_matches: [{
        fragment: `...McpConnector.connect(config)...\n  const tools = await this.fetchTools(config);\n  return { config, tools, lastRefresh: Date.now() };`,
        matches: [{ text: 'McpConnector', indices: [3, 15] }],
      }],
    })),
  };
}

function makeWorkflowRunsResponse() {
  return {
    total_count: 25,
    workflow_runs: Array.from({ length: 5 }, (_, i) => ({
      id: 800000000 + i,
      name: 'CI',
      head_branch: ['main', 'feat/reconnection', 'main', 'fix/codec', 'main'][i],
      head_sha: `sha_${i}_abcdef`,
      status: 'completed',
      conclusion: ['success', 'success', 'failure', 'success', 'success'][i],
      run_number: 150 - i,
      created_at: `2026-04-0${7 - i}T09:00:00Z`,
      updated_at: `2026-04-0${7 - i}T09:12:00Z`,
      run_attempt: 1,
      jobs_url: `https://api.github.com/repos/nekte-protocol/nekte/actions/runs/${800000000 + i}/jobs`,
    })),
  };
}

// ---------------------------------------------------------------------------
// Tool dispatcher
// ---------------------------------------------------------------------------

function handleToolCall(name: string, args: Record<string, unknown>): unknown {
  switch (name) {
    case 'list_repos': return makeReposListResponse();
    case 'get_repo': return makeRepoResponse();
    case 'search_issues': return makeSearchIssuesResponse();
    case 'get_issue': return makeIssueResponse();
    case 'create_issue': return { ...makeIssueResponse(), number: 200, title: args.title };
    case 'get_pull_request': return makePRResponse();
    case 'list_pull_request_files': return makePRFilesResponse();
    case 'create_pull_request_review': return { id: 1, state: args.event, body: args.body };
    case 'list_commits': return makeCommitsResponse();
    case 'get_file_contents': return makeFileContentsResponse(args.path as string ?? 'src/index.ts');
    case 'search_code': return makeSearchCodeResponse();
    case 'list_workflow_runs': return makeWorkflowRunsResponse();
    default: return { error: `Unknown tool: ${name}` };
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC stdio server
// ---------------------------------------------------------------------------

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  if (!line.trim()) return;

  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  const method = msg.method as string;
  const id = msg.id as number | undefined;

  if (method === 'initialize') {
    respond(id!, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'github-mock', version: '1.0.0' },
    });
    return;
  }

  if (method === 'notifications/initialized') return;

  if (method === 'tools/list') {
    respond(id!, { tools: TOOLS });
    return;
  }

  if (method === 'tools/call') {
    const params = msg.params as { name: string; arguments: Record<string, unknown> };
    const result = handleToolCall(params.name, params.arguments ?? {});
    respond(id!, {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    });
    return;
  }

  if (id !== undefined) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } }) + '\n');
  }
});

function respond(id: number, result: unknown) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

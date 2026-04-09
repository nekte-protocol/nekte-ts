/**
 * Conformance Response Generator
 *
 * Generates realistic response payloads matching the exact shape and size
 * of real MCP server responses. Each generator produces data that mirrors
 * actual API responses (GitHub REST API, PostgreSQL query results, etc.)
 *
 * Response sizes are calibrated to real-world observations:
 *  - GitHub PR detail: ~3-5 KB JSON
 *  - GitHub issue list: ~8-15 KB JSON
 *  - File contents: ~2-20 KB (varies by file)
 *  - PostgreSQL query result: ~1-5 KB
 *  - Brave search results: ~3-8 KB
 *  - Fetch (web page): ~5-50 KB markdown
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function randomDate(daysAgo = 30): string {
  const d = new Date();
  d.setDate(d.getDate() - Math.floor(Math.random() * daysAgo));
  return d.toISOString();
}

function randomSha(): string {
  return Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

function filler(chars: number): string {
  const words = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua'.split(' ');
  let out = '';
  while (out.length < chars) {
    out += words[Math.floor(Math.random() * words.length)] + ' ';
  }
  return out.slice(0, chars);
}

// ---------------------------------------------------------------------------
// GitHub Responses
// ---------------------------------------------------------------------------

function githubUser(login = 'octocat') {
  return {
    login,
    id: 583231,
    node_id: 'MDQ6VXNlcjU4MzIzMQ==',
    avatar_url: `https://avatars.githubusercontent.com/u/583231?v=4`,
    gravatar_id: '',
    url: `https://api.github.com/users/${login}`,
    html_url: `https://github.com/${login}`,
    type: 'User',
    site_admin: false,
  };
}

function githubRepo(owner: string, name: string) {
  return {
    id: 123456789,
    node_id: 'R_kgDOB3abcd',
    name,
    full_name: `${owner}/${name}`,
    private: false,
    owner: githubUser(owner),
    html_url: `https://github.com/${owner}/${name}`,
    description: 'Agent-to-Agent coordination protocol',
    fork: false,
    url: `https://api.github.com/repos/${owner}/${name}`,
    created_at: '2024-01-15T10:00:00Z',
    updated_at: randomDate(7),
    pushed_at: randomDate(2),
    homepage: 'https://nekte.dev',
    size: 4520,
    stargazers_count: 342,
    watchers_count: 342,
    language: 'TypeScript',
    forks_count: 28,
    open_issues_count: 15,
    default_branch: 'main',
    topics: ['agents', 'mcp', 'protocol', 'typescript'],
    license: { key: 'mit', name: 'MIT License', spdx_id: 'MIT', url: 'https://api.github.com/licenses/mit' },
  };
}

function githubIssue(owner: string, repo: string, num: number) {
  return {
    url: `https://api.github.com/repos/${owner}/${repo}/issues/${num}`,
    repository_url: `https://api.github.com/repos/${owner}/${repo}`,
    html_url: `https://github.com/${owner}/${repo}/issues/${num}`,
    id: 1800000000 + num,
    node_id: `I_kwDOB3ab${num}`,
    number: num,
    title: `Bridge reconnection fails after network timeout (${num})`,
    user: githubUser('contributor-' + (num % 5)),
    labels: [
      { id: 1, name: 'bug', color: 'd73a4a', description: "Something isn't working" },
      { id: 2, name: 'P1', color: 'b60205', description: 'Critical priority' },
    ],
    state: 'open',
    locked: false,
    assignee: num % 3 === 0 ? githubUser('maintainer') : null,
    assignees: num % 3 === 0 ? [githubUser('maintainer')] : [],
    milestone: null,
    comments: Math.floor(Math.random() * 12),
    created_at: randomDate(60),
    updated_at: randomDate(10),
    closed_at: null,
    body: `## Description\n\nWhen a network timeout occurs during an active bridge session, the reconnection logic fails to restore the MCP connection.\n\n## Steps to Reproduce\n\n1. Start a NEKTE bridge with an MCP server\n2. Simulate a network interruption (e.g., ${filler(200)})\n3. Wait for the reconnection timeout\n4. Observe that the bridge enters a dead state\n\n## Expected Behavior\n\nThe bridge should automatically reconnect using exponential backoff.\n\n## Actual Behavior\n\nThe bridge throws an unhandled promise rejection and stops attempting reconnection.\n\n## Environment\n\n- Node.js: 20.11.0\n- @nekte/bridge: 0.2.1\n- OS: Ubuntu 22.04`,
    reactions: { url: '', total_count: 5, '+1': 3, '-1': 0, laugh: 0, hooray: 0, confused: 0, heart: 1, rocket: 1, eyes: 0 },
    timeline_url: `https://api.github.com/repos/${owner}/${repo}/issues/${num}/timeline`,
    performed_via_github_app: null,
  };
}

function githubPullRequest(owner: string, repo: string, num: number) {
  const issue = githubIssue(owner, repo, num);
  return {
    ...issue,
    url: `https://api.github.com/repos/${owner}/${repo}/pulls/${num}`,
    html_url: `https://github.com/${owner}/${repo}/pull/${num}`,
    diff_url: `https://github.com/${owner}/${repo}/pull/${num}.diff`,
    patch_url: `https://github.com/${owner}/${repo}/pull/${num}.patch`,
    title: `feat: add exponential backoff reconnection (PR #${num})`,
    body: `## Summary\n\nImplements exponential backoff for MCP bridge reconnection.\n\n## Changes\n\n- Added \`ReconnectionManager\` class with configurable backoff\n- Updated \`McpConnector\` to use reconnection manager\n- Added jitter to prevent thundering herd\n- New tests for reconnection scenarios\n\n## Test Plan\n\n- [x] Unit tests for backoff calculation\n- [x] Integration test with simulated disconnect\n- [x] Manual testing with real MCP server\n\nCloses #142`,
    state: 'open',
    merged: false,
    mergeable: true,
    mergeable_state: 'clean',
    head: { label: `${owner}:feat/reconnection`, ref: 'feat/reconnection', sha: randomSha(), user: githubUser(owner), repo: githubRepo(owner, repo) },
    base: { label: `${owner}:main`, ref: 'main', sha: randomSha(), user: githubUser(owner), repo: githubRepo(owner, repo) },
    draft: false,
    commits: 4,
    additions: 287,
    deletions: 43,
    changed_files: 6,
    requested_reviewers: [githubUser('reviewer-1')],
    requested_teams: [],
    review_comments: 2,
  };
}

function githubPrFiles() {
  return [
    { sha: randomSha(), filename: 'packages/bridge/src/reconnection.ts', status: 'added', additions: 156, deletions: 0, changes: 156, patch: filler(800) },
    { sha: randomSha(), filename: 'packages/bridge/src/mcp-connector.ts', status: 'modified', additions: 34, deletions: 12, changes: 46, patch: filler(400) },
    { sha: randomSha(), filename: 'packages/bridge/src/__tests__/reconnection.test.ts', status: 'added', additions: 89, deletions: 0, changes: 89, patch: filler(600) },
    { sha: randomSha(), filename: 'packages/bridge/src/index.ts', status: 'modified', additions: 3, deletions: 1, changes: 4, patch: filler(100) },
    { sha: randomSha(), filename: 'packages/bridge/package.json', status: 'modified', additions: 2, deletions: 1, changes: 3, patch: filler(80) },
    { sha: randomSha(), filename: 'packages/core/src/types.ts', status: 'modified', additions: 3, deletions: 2, changes: 5, patch: filler(120) },
  ];
}

function githubCommits(count = 5) {
  return Array.from({ length: count }, (_, i) => ({
    sha: randomSha(),
    node_id: `C_${randomId()}`,
    commit: {
      author: { name: 'Contributor', email: 'dev@example.com', date: randomDate(30) },
      committer: { name: 'Contributor', email: 'dev@example.com', date: randomDate(30) },
      message: ['feat: add reconnection manager', 'test: reconnection scenarios', 'fix: backoff jitter calculation', 'refactor: extract retry logic', 'docs: update bridge README'][i % 5],
      tree: { sha: randomSha(), url: '' },
      url: '',
      comment_count: 0,
    },
    url: '',
    html_url: '',
    author: githubUser('contributor-' + (i % 3)),
    committer: githubUser('contributor-' + (i % 3)),
    parents: [{ sha: randomSha(), url: '', html_url: '' }],
  }));
}

function githubCodeSearchResults() {
  return {
    total_count: 8,
    incomplete_results: false,
    items: Array.from({ length: 8 }, (_, i) => ({
      name: ['reconnection.ts', 'retry.ts', 'backoff.ts', 'connector.ts', 'transport.ts', 'client.ts', 'session.ts', 'pool.ts'][i],
      path: `packages/bridge/src/${['reconnection.ts', 'retry.ts', 'backoff.ts', 'connector.ts', 'transport.ts', 'client.ts', 'session.ts', 'pool.ts'][i]}`,
      sha: randomSha(),
      url: '',
      html_url: '',
      repository: { id: 123456789, name: 'nekte', full_name: 'nekte-protocol/nekte', owner: githubUser('nekte-protocol'), html_url: '' },
      score: 1 - i * 0.1,
      text_matches: [{ object_url: '', object_type: 'FileContent', property: 'content', fragment: filler(200), matches: [{ text: 'reconnect', indices: [0, 9] }] }],
    })),
  };
}

function githubIssueSearchResults(count = 6) {
  return {
    total_count: count,
    incomplete_results: false,
    items: Array.from({ length: count }, (_, i) => githubIssue('nekte-protocol', 'nekte', 140 + i)),
  };
}

function githubFileContents(path: string) {
  const code = `/**\n * ${path}\n * Auto-generated conformance response\n */\n\n${filler(2000)}\n\nexport class ReconnectionManager {\n  private attempts = 0;\n  private readonly maxAttempts: number;\n  private readonly baseDelayMs: number;\n\n  constructor(opts: { maxAttempts?: number; baseDelayMs?: number } = {}) {\n    this.maxAttempts = opts.maxAttempts ?? 10;\n    this.baseDelayMs = opts.baseDelayMs ?? 1000;\n  }\n\n  async reconnect(): Promise<boolean> {\n    while (this.attempts < this.maxAttempts) {\n      const delay = this.baseDelayMs * Math.pow(2, this.attempts);\n      const jitter = delay * 0.2 * Math.random();\n      await new Promise(r => setTimeout(r, delay + jitter));\n      this.attempts++;\n      // Attempt connection...\n    }\n    return false;\n  }\n\n  reset(): void { this.attempts = 0; }\n}\n`;
  return {
    type: 'file',
    encoding: 'utf-8',
    size: code.length,
    name: path.split('/').pop(),
    path,
    content: Buffer.from(code).toString('base64'),
    sha: randomSha(),
    url: '',
    html_url: '',
    git_url: '',
    download_url: '',
    _links: { self: '', git: '', html: '' },
  };
}

function githubWorkflowRuns() {
  return {
    total_count: 15,
    workflow_runs: Array.from({ length: 5 }, (_, i) => ({
      id: 7000000000 + i,
      name: 'CI',
      head_branch: i === 0 ? 'feat/reconnection' : 'main',
      head_sha: randomSha(),
      status: 'completed',
      conclusion: i < 4 ? 'success' : 'failure',
      url: '',
      html_url: '',
      created_at: randomDate(7),
      updated_at: randomDate(5),
      run_number: 200 + i,
      event: 'push',
      jobs_url: '',
      logs_url: '',
      actor: githubUser('contributor-' + (i % 3)),
    })),
  };
}

function githubRepos() {
  return Array.from({ length: 5 }, (_, i) => githubRepo('nekte-protocol', ['nekte', 'nekte-docs', 'nekte-examples', 'nekte-website', 'mcp-bridge-template'][i]));
}

function githubReview() {
  return { id: 1, node_id: `PRR_${randomId()}`, user: githubUser('reviewer'), body: 'LGTM!', state: 'APPROVED', html_url: '', submitted_at: randomDate(1) };
}

function githubPrStatus() {
  return {
    state: 'success',
    statuses: [
      { url: '', id: 1, node_id: '', state: 'success', description: 'Build succeeded', context: 'ci/build', created_at: randomDate(1), updated_at: randomDate(1) },
      { url: '', id: 2, node_id: '', state: 'success', description: 'Tests passed', context: 'ci/test', created_at: randomDate(1), updated_at: randomDate(1) },
      { url: '', id: 3, node_id: '', state: 'success', description: 'Lint passed', context: 'ci/lint', created_at: randomDate(1), updated_at: randomDate(1) },
    ],
    sha: randomSha(),
    total_count: 3,
    repository: githubRepo('nekte-protocol', 'nekte'),
  };
}

// ---------------------------------------------------------------------------
// Filesystem Responses
// ---------------------------------------------------------------------------

function fsReadTextFile() {
  return `import { describe, it, expect } from 'vitest';\nimport { ReconnectionManager } from '../reconnection.js';\n\n${filler(3000)}\n\ndescribe('ReconnectionManager', () => {\n  it('should use exponential backoff', async () => {\n    const mgr = new ReconnectionManager({ maxAttempts: 3, baseDelayMs: 10 });\n    const start = Date.now();\n    await mgr.reconnect();\n    const elapsed = Date.now() - start;\n    expect(elapsed).toBeGreaterThan(60); // 10 + 20 + 40 minimum\n  });\n});\n`;
}

function fsListDirectory() {
  return [
    '[DIR] src', '[DIR] dist', '[DIR] node_modules', '[DIR] __tests__',
    '[FILE] package.json', '[FILE] tsconfig.json', '[FILE] README.md',
    '[FILE] vitest.config.ts', '[FILE] CHANGELOG.md',
  ].join('\n');
}

function fsDirectoryTree() {
  return {
    name: 'bridge',
    type: 'directory',
    children: [
      { name: 'src', type: 'directory', children: [
        { name: 'bridge.ts', type: 'file' },
        { name: 'mcp-connector.ts', type: 'file' },
        { name: 'reconnection.ts', type: 'file' },
        { name: 'compressor.ts', type: 'file' },
        { name: 'catalog.ts', type: 'file' },
        { name: 'metrics.ts', type: 'file' },
        { name: 'index.ts', type: 'file' },
        { name: '__tests__', type: 'directory', children: [
          { name: 'compressor.test.ts', type: 'file' },
          { name: 'reconnection.test.ts', type: 'file' },
        ]},
      ]},
      { name: 'dist', type: 'directory', children: [] },
      { name: 'package.json', type: 'file' },
      { name: 'tsconfig.json', type: 'file' },
    ],
  };
}

function fsFileInfo() {
  return { size: 4520, created: randomDate(90), modified: randomDate(5), accessed: randomDate(1), isDirectory: false, isFile: true, permissions: 'rw-r--r--' };
}

function fsSearchFiles() {
  return [
    '/project/packages/bridge/src/reconnection.ts',
    '/project/packages/bridge/src/__tests__/reconnection.test.ts',
    '/project/packages/client/src/reconnect.ts',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Brave Search Responses
// ---------------------------------------------------------------------------

function braveWebSearch() {
  return {
    type: 'web',
    query: { original: 'MCP protocol agent coordination', altered: '' },
    web: {
      results: Array.from({ length: 10 }, (_, i) => ({
        title: [
          'Model Context Protocol - Anthropic',
          'MCP: The Standard for AI Agent Tool Use',
          'Building Agents with MCP - Developer Guide',
          'Agent-to-Agent Communication Protocols Compared',
          'NEKTE: Zero-Schema Agent Coordination',
          'MCP Server Development Best Practices',
          'Token Optimization in Multi-Agent Systems',
          'A2A Protocol by Google DeepMind',
          'The Future of AI Agent Interoperability',
          'MCP vs REST for Agent Communication',
        ][i],
        url: `https://example.com/result-${i}`,
        description: filler(200),
        is_source_local: false,
        is_source_both: false,
        language: 'en',
        family_friendly: true,
        age: `${i + 1} days ago`,
        meta_url: { scheme: 'https', netloc: 'example.com', hostname: 'example.com', favicon: '', path: `/result-${i}` },
        extra_snippets: [filler(150)],
      })),
      total_results: 1240000,
    },
    mixed: { type: 'mixed', main: [{ type: 'web', index: 0 }] },
  };
}

function braveLocalSearch() {
  return {
    type: 'local',
    results: Array.from({ length: 5 }, (_, i) => ({
      title: `Tech Hub ${i + 1}`,
      url: `https://maps.example.com/place-${i}`,
      description: filler(100),
      address: { streetAddress: `${100 + i} Market St`, addressLocality: 'San Francisco', addressRegion: 'CA', postalCode: '94105' },
      rating: { ratingValue: 4.2 + i * 0.1, ratingCount: 50 + i * 20, bestRating: 5 },
      phone: `+1-415-555-${1000 + i}`,
      openingHours: 'Mo-Fr 09:00-18:00',
      priceRange: '$$',
    })),
  };
}

// ---------------------------------------------------------------------------
// Fetch Responses
// ---------------------------------------------------------------------------

function fetchUrl() {
  return `# Model Context Protocol Documentation\n\n${filler(4000)}\n\n## Overview\n\nThe Model Context Protocol (MCP) provides a standardized way for AI assistants to connect with external data sources and tools.\n\n## Architecture\n\n${filler(2000)}\n\n### Server Implementation\n\n\`\`\`typescript\nimport { McpServer } from '@modelcontextprotocol/sdk';\n\nconst server = new McpServer({ name: 'example' });\n\nserver.tool('hello', { name: z.string() }, async ({ name }) => {\n  return { content: [{ type: 'text', text: \`Hello \${name}!\` }] };\n});\n\`\`\`\n\n${filler(3000)}\n\n## Best Practices\n\n1. Keep tool schemas minimal\n2. Use descriptive names\n3. Validate inputs thoroughly\n4. Return structured responses\n\n${filler(1500)}`;
}

// ---------------------------------------------------------------------------
// PostgreSQL Responses
// ---------------------------------------------------------------------------

function postgresQueryResult(sql: string) {
  if (sql.toLowerCase().includes('information_schema') || sql.toLowerCase().includes('pg_catalog')) {
    return {
      rows: [
        { table_name: 'tasks', table_schema: 'public', table_type: 'BASE TABLE', row_count: 45230 },
        { table_name: 'projects', table_schema: 'public', table_type: 'BASE TABLE', row_count: 128 },
        { table_name: 'users', table_schema: 'public', table_type: 'BASE TABLE', row_count: 892 },
        { table_name: 'comments', table_schema: 'public', table_type: 'BASE TABLE', row_count: 167540 },
        { table_name: 'labels', table_schema: 'public', table_type: 'BASE TABLE', row_count: 34 },
        { table_name: 'task_labels', table_schema: 'public', table_type: 'BASE TABLE', row_count: 89670 },
      ],
      rowCount: 6,
      fields: ['table_name', 'table_schema', 'table_type', 'row_count'],
    };
  }

  if (sql.toLowerCase().includes('explain')) {
    return {
      rows: [
        { 'QUERY PLAN': 'Sort  (cost=1245.32..1248.67 rows=1340 width=412)' },
        { 'QUERY PLAN': '  Sort Key: t.updated_at DESC' },
        { 'QUERY PLAN': '  ->  Hash Join  (cost=34.56..1180.23 rows=1340 width=412)' },
        { 'QUERY PLAN': '        Hash Cond: (t.project_id = p.id)' },
        { 'QUERY PLAN': '        ->  Seq Scan on tasks t  (cost=0.00..1089.30 rows=45230 width=380)' },
        { 'QUERY PLAN': '              Filter: (labels @> $1)' },
        { 'QUERY PLAN': '              Rows Removed by Filter: 43890' },
        { 'QUERY PLAN': '        ->  Hash  (cost=18.28..18.28 rows=128 width=36)' },
        { 'QUERY PLAN': '              ->  Seq Scan on projects p  (cost=0.00..18.28 rows=128 width=36)' },
        { 'QUERY PLAN': 'Planning Time: 0.542 ms' },
        { 'QUERY PLAN': 'Execution Time: 23.891 ms' },
      ],
      rowCount: 11,
      fields: ['QUERY PLAN'],
    };
  }

  if (sql.toLowerCase().includes('group by')) {
    return {
      rows: Array.from({ length: 12 }, (_, i) => ({
        project_name: ['nekte-core', 'nekte-bridge', 'nekte-client', 'nekte-server'][i % 4],
        status: ['open', 'in_progress', 'done'][i % 3],
        task_count: 50 + Math.floor(Math.random() * 200),
        avg_estimate_hours: (2 + Math.random() * 8).toFixed(1),
      })),
      rowCount: 12,
      fields: ['project_name', 'status', 'task_count', 'avg_estimate_hours'],
    };
  }

  // Default query response
  return {
    rows: Array.from({ length: 20 }, (_, i) => ({
      id: `task-${randomId()}`,
      title: `Task ${i + 1}: ${filler(60).trim()}`,
      status: ['open', 'in_progress', 'done', 'blocked'][i % 4],
      assignee: `dev-${i % 5}`,
      estimate_hours: (1 + Math.random() * 16).toFixed(1),
      created_at: randomDate(90),
      updated_at: randomDate(14),
      project_id: `proj-${i % 4}`,
      priority: ['P0', 'P1', 'P2', 'P3'][i % 4],
    })),
    rowCount: 20,
    fields: ['id', 'title', 'status', 'assignee', 'estimate_hours', 'created_at', 'updated_at', 'project_id', 'priority'],
  };
}

// ---------------------------------------------------------------------------
// Response Router
// ---------------------------------------------------------------------------

/**
 * Generate a realistic MCP response for a given tool call.
 * Wraps in MCP `content` array format.
 */
export function generateResponse(server: string, tool: string, args: Record<string, unknown>): { content: Array<{ type: string; text: string }> } {
  const data = generateRawResponse(server, tool, args);
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text', text }] };
}

function generateRawResponse(server: string, tool: string, args: Record<string, unknown>): unknown {
  switch (server) {
    case 'github':
      return githubResponse(tool, args);
    case 'filesystem':
      return filesystemResponse(tool, args);
    case 'brave-search':
      return braveResponse(tool, args);
    case 'fetch':
      return fetchUrl();
    case 'postgres':
      return postgresQueryResult(String(args.sql ?? ''));
    default:
      return { error: `Unknown server: ${server}` };
  }
}

function githubResponse(tool: string, args: Record<string, unknown>): unknown {
  const owner = String(args.owner ?? 'nekte-protocol');
  const repo = String(args.repo ?? 'nekte');
  switch (tool) {
    case 'get_issue': return githubIssue(owner, repo, Number(args.issue_number ?? 142));
    case 'list_issues': return Array.from({ length: 10 }, (_, i) => githubIssue(owner, repo, 140 + i));
    case 'search_issues': return githubIssueSearchResults();
    case 'create_issue': return githubIssue(owner, repo, 200);
    case 'update_issue': return githubIssue(owner, repo, Number(args.issue_number ?? 142));
    case 'add_issue_comment': return { id: 1, body: String(args.body ?? ''), user: githubUser('bot'), created_at: new Date().toISOString() };
    case 'get_pull_request': return githubPullRequest(owner, repo, Number(args.pull_number ?? 89));
    case 'list_pull_requests': return Array.from({ length: 5 }, (_, i) => githubPullRequest(owner, repo, 85 + i));
    case 'create_pull_request': return githubPullRequest(owner, repo, 100);
    case 'merge_pull_request': return { sha: randomSha(), merged: true, message: 'Pull Request successfully merged' };
    case 'get_pull_request_files': return githubPrFiles();
    case 'get_pull_request_status': return githubPrStatus();
    case 'get_pull_request_comments': return [{ id: 1, body: 'Consider adding jitter', user: githubUser('reviewer'), path: 'src/reconnection.ts', position: 15, created_at: randomDate(3) }];
    case 'get_pull_request_reviews': return [githubReview()];
    case 'create_pull_request_review': return githubReview();
    case 'update_pull_request_branch': return { message: 'Updating pull request branch.', url: '' };
    case 'get_file_contents': return githubFileContents(String(args.path ?? 'README.md'));
    case 'list_commits': return githubCommits(10);
    case 'search_code': return githubCodeSearchResults();
    case 'search_repositories': return { total_count: 5, incomplete_results: false, items: githubRepos() };
    case 'search_users': return { total_count: 3, items: [githubUser('octocat'), githubUser('dev-1'), githubUser('dev-2')] };
    case 'create_repository': return githubRepo(owner, String(args.name ?? 'new-repo'));
    case 'fork_repository': return githubRepo('fork-user', repo);
    case 'create_branch': return { ref: `refs/heads/${args.branch}`, node_id: randomId(), url: '', object: { type: 'commit', sha: randomSha(), url: '' } };
    case 'create_or_update_file': return { content: { name: String(args.path ?? '').split('/').pop(), path: args.path, sha: randomSha() }, commit: { sha: randomSha(), message: args.message } };
    case 'push_files': return { ref: `refs/heads/${args.branch}`, node_id: randomId(), object: { type: 'commit', sha: randomSha() } };
    default: return { tool, status: 'ok' };
  }
}

function filesystemResponse(tool: string, args: Record<string, unknown>): unknown {
  switch (tool) {
    case 'read_text_file': return fsReadTextFile();
    case 'read_media_file': return { data: 'iVBORw0KGgo=...', mimeType: 'image/png' };
    case 'read_multiple_files': return (args.paths as string[] ?? ['/a.ts', '/b.ts']).map(p => ({ path: p, content: filler(1500) }));
    case 'write_file': return `Successfully wrote ${(args.content as string ?? '').length} bytes to ${args.path}`;
    case 'edit_file': return `--- a/${args.path}\n+++ b/${args.path}\n@@ -10,3 +10,5 @@\n ${filler(200)}`;
    case 'create_directory': return `Directory created: ${args.path}`;
    case 'list_directory': return fsListDirectory();
    case 'list_directory_with_sizes': return fsListDirectory();
    case 'directory_tree': return fsDirectoryTree();
    case 'move_file': return `Moved ${args.source} to ${args.destination}`;
    case 'search_files': return fsSearchFiles();
    case 'get_file_info': return fsFileInfo();
    case 'list_allowed_directories': return ['/project', '/tmp'];
    default: return { tool, status: 'ok' };
  }
}

function braveResponse(tool: string, _args: Record<string, unknown>): unknown {
  return tool === 'brave_local_search' ? braveLocalSearch() : braveWebSearch();
}

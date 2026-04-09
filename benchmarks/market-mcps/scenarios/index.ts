/**
 * Real-World Agent Scenarios — Market MCPs
 *
 * Each scenario models a realistic multi-turn agent workflow using
 * real tool names and schemas from official MCP server packages.
 *
 * Scenarios are designed to cover:
 *  - Different tool counts (2 → 44 tools in context)
 *  - Different payload sizes (small queries → large file reads)
 *  - Different budget strategies (minimal for writes, full for reads)
 *  - Single-server and multi-server configurations
 */

import type { Scenario } from '../types.js';

// ---------------------------------------------------------------------------
// Scenario 1: DevOps Triage (GitHub + Filesystem = 40 tools)
// ---------------------------------------------------------------------------

export const DEVOPS_TRIAGE: Scenario = {
  name: 'DevOps Triage',
  servers: ['github', 'filesystem'],
  goal: 'Investigate a CI failure: check workflow runs, read source files, review PR, search for patterns',
  turns: [
    {
      description: 'List recent CI workflow runs',
      tool: 'list_pull_requests',
      server: 'github',
      args: { owner: 'nekte-protocol', repo: 'nekte', state: 'open', sort: 'updated', direction: 'desc' },
      budget: 'compact',
    },
    {
      description: 'Get details of the failing PR',
      tool: 'get_pull_request',
      server: 'github',
      args: { owner: 'nekte-protocol', repo: 'nekte', pull_number: 89 },
      budget: 'full',
    },
    {
      description: 'List files changed in the PR',
      tool: 'get_pull_request_files',
      server: 'github',
      args: { owner: 'nekte-protocol', repo: 'nekte', pull_number: 89 },
      budget: 'full',
    },
    {
      description: 'Check CI status for the PR',
      tool: 'get_pull_request_status',
      server: 'github',
      args: { owner: 'nekte-protocol', repo: 'nekte', pull_number: 89 },
      budget: 'compact',
    },
    {
      description: 'Read the main changed file from GitHub',
      tool: 'get_file_contents',
      server: 'github',
      args: { owner: 'nekte-protocol', repo: 'nekte', path: 'packages/bridge/src/reconnection.ts', branch: 'feat/reconnection' },
      budget: 'full',
    },
    {
      description: 'Read local test file for comparison',
      tool: 'read_text_file',
      server: 'filesystem',
      args: { path: '/project/packages/bridge/src/__tests__/reconnection.test.ts' },
      budget: 'full',
    },
    {
      description: 'Search project for related patterns',
      tool: 'search_files',
      server: 'filesystem',
      args: { path: '/project', pattern: '**/*reconnect*' },
      budget: 'compact',
    },
    {
      description: 'Get directory tree of bridge package',
      tool: 'directory_tree',
      server: 'filesystem',
      args: { path: '/project/packages/bridge' },
      budget: 'compact',
    },
    {
      description: 'Search GitHub code for backoff patterns',
      tool: 'search_code',
      server: 'github',
      args: { q: 'exponential backoff repo:nekte-protocol/nekte language:typescript' },
      budget: 'compact',
    },
    {
      description: 'Read PR comments for reviewer feedback',
      tool: 'get_pull_request_comments',
      server: 'github',
      args: { owner: 'nekte-protocol', repo: 'nekte', pull_number: 89 },
      budget: 'full',
    },
    {
      description: 'Check recent commits on the branch',
      tool: 'list_commits',
      server: 'github',
      args: { owner: 'nekte-protocol', repo: 'nekte', sha: 'feat/reconnection' },
      budget: 'compact',
    },
    {
      description: 'Submit review approval',
      tool: 'create_pull_request_review',
      server: 'github',
      args: {
        owner: 'nekte-protocol', repo: 'nekte', pull_number: 89,
        event: 'APPROVE', body: 'LGTM after CI fix',
        comments: [{ path: 'packages/bridge/src/reconnection.ts', line: 15, body: 'Add jitter to backoff' }],
      },
      budget: 'minimal',
    },
  ],
};

// ---------------------------------------------------------------------------
// Scenario 2: Research Assistant (Brave Search + Fetch = 3 tools)
// ---------------------------------------------------------------------------
// Few tools but HEAVY response payloads (web pages, search results)

export const RESEARCH_ASSISTANT: Scenario = {
  name: 'Research Assistant',
  servers: ['brave-search', 'fetch'],
  goal: 'Research MCP protocol alternatives, fetch documentation, compile findings',
  turns: [
    {
      description: 'Search for MCP protocol documentation',
      tool: 'brave_web_search',
      server: 'brave-search',
      args: { query: 'Model Context Protocol MCP specification documentation', count: 10 },
      budget: 'compact',
    },
    {
      description: 'Fetch the top result (MCP docs)',
      tool: 'fetch',
      server: 'fetch',
      args: { url: 'https://modelcontextprotocol.io/docs', max_length: 8000 },
      budget: 'full',
    },
    {
      description: 'Search for MCP alternatives and competitors',
      tool: 'brave_web_search',
      server: 'brave-search',
      args: { query: 'MCP alternatives agent-to-agent protocol A2A comparison', count: 10 },
      budget: 'compact',
    },
    {
      description: 'Fetch comparison article',
      tool: 'fetch',
      server: 'fetch',
      args: { url: 'https://example.com/mcp-vs-a2a', max_length: 8000 },
      budget: 'full',
    },
    {
      description: 'Search for token optimization techniques',
      tool: 'brave_web_search',
      server: 'brave-search',
      args: { query: 'LLM token optimization context window management techniques', count: 10 },
      budget: 'compact',
    },
    {
      description: 'Fetch technical deep dive',
      tool: 'fetch',
      server: 'fetch',
      args: { url: 'https://example.com/token-optimization-guide', max_length: 10000 },
      budget: 'compact',
    },
    {
      description: 'Search for local MCP meetups',
      tool: 'brave_local_search',
      server: 'brave-search',
      args: { query: 'AI developer meetup San Francisco', count: 5 },
      budget: 'minimal',
    },
    {
      description: 'Final broad search for recent developments',
      tool: 'brave_web_search',
      server: 'brave-search',
      args: { query: 'MCP protocol 2026 updates news', count: 10 },
      budget: 'compact',
    },
  ],
};

// ---------------------------------------------------------------------------
// Scenario 3: Data Analysis (PostgreSQL + Filesystem = 15 tools)
// ---------------------------------------------------------------------------

export const DATA_ANALYSIS: Scenario = {
  name: 'Data Analysis',
  servers: ['postgres', 'filesystem'],
  goal: 'Investigate database performance, analyze table structure, export findings to file',
  turns: [
    {
      description: 'List database tables and sizes',
      tool: 'query',
      server: 'postgres',
      args: { sql: "SELECT table_name, table_schema, table_type FROM information_schema.tables WHERE table_schema = 'public'" },
      budget: 'full',
    },
    {
      description: 'Analyze task distribution by status',
      tool: 'query',
      server: 'postgres',
      args: { sql: "SELECT status, count(*), avg(estimate_hours) FROM tasks GROUP BY status ORDER BY count(*) DESC" },
      budget: 'full',
    },
    {
      description: 'Run EXPLAIN on the slow query',
      tool: 'query',
      server: 'postgres',
      args: { sql: 'EXPLAIN (ANALYZE, BUFFERS) SELECT t.*, p.name FROM tasks t JOIN projects p ON t.project_id = p.id WHERE t.labels @> $1 ORDER BY t.updated_at DESC LIMIT 50' },
      budget: 'full',
    },
    {
      description: 'Get high-priority unassigned tasks',
      tool: 'query',
      server: 'postgres',
      args: { sql: "SELECT id, title, priority, created_at FROM tasks WHERE priority IN ('P0', 'P1') AND assignee IS NULL ORDER BY created_at" },
      budget: 'compact',
    },
    {
      description: 'Check project-level aggregations',
      tool: 'query',
      server: 'postgres',
      args: { sql: 'SELECT p.name as project_name, count(t.id) as task_count, avg(t.estimate_hours) as avg_hours FROM projects p LEFT JOIN tasks t ON t.project_id = p.id GROUP BY p.name ORDER BY task_count DESC' },
      budget: 'compact',
    },
    {
      description: 'Check existing analysis files',
      tool: 'list_directory',
      server: 'filesystem',
      args: { path: '/project/reports' },
      budget: 'minimal',
    },
    {
      description: 'Read previous analysis for comparison',
      tool: 'read_text_file',
      server: 'filesystem',
      args: { path: '/project/reports/last-analysis.md' },
      budget: 'compact',
    },
    {
      description: 'Get project directory structure',
      tool: 'directory_tree',
      server: 'filesystem',
      args: { path: '/project', excludePatterns: ['node_modules', 'dist'] },
      budget: 'compact',
    },
    {
      description: 'Query team velocity over last month',
      tool: 'query',
      server: 'postgres',
      args: { sql: "SELECT date_trunc('week', updated_at) as week, count(*) as completed FROM tasks WHERE status = 'done' AND updated_at > now() - interval '30 days' GROUP BY week ORDER BY week" },
      budget: 'compact',
    },
    {
      description: 'Write analysis results to file',
      tool: 'write_file',
      server: 'filesystem',
      args: { path: '/project/reports/analysis-2026-04.md', content: '# Analysis Report\n\n...' },
      budget: 'minimal',
    },
  ],
};

// ---------------------------------------------------------------------------
// Scenario 4: Multi-MCP Agent (All 5 servers = 44 tools)
// ---------------------------------------------------------------------------
// This is the stress test: maximum tools in context

export const MULTI_MCP_AGENT: Scenario = {
  name: 'Multi-MCP Agent',
  servers: ['github', 'filesystem', 'brave-search', 'fetch', 'postgres'],
  goal: 'Full sprint planning: research, code review, data analysis, documentation — using ALL available MCPs',
  turns: [
    {
      description: 'Search web for latest best practices',
      tool: 'brave_web_search',
      server: 'brave-search',
      args: { query: 'agent orchestration best practices 2026', count: 5 },
      budget: 'compact',
    },
    {
      description: 'Fetch a key reference article',
      tool: 'fetch',
      server: 'fetch',
      args: { url: 'https://example.com/agent-patterns', max_length: 5000 },
      budget: 'compact',
    },
    {
      description: 'List open issues in the repo',
      tool: 'list_issues',
      server: 'github',
      args: { owner: 'nekte-protocol', repo: 'nekte', state: 'open', sort: 'updated' },
      budget: 'compact',
    },
    {
      description: 'Get the highest priority issue',
      tool: 'get_issue',
      server: 'github',
      args: { owner: 'nekte-protocol', repo: 'nekte', issue_number: 142 },
      budget: 'full',
    },
    {
      description: 'Check task distribution in DB',
      tool: 'query',
      server: 'postgres',
      args: { sql: "SELECT status, count(*) FROM tasks GROUP BY status" },
      budget: 'compact',
    },
    {
      description: 'Review project structure',
      tool: 'directory_tree',
      server: 'filesystem',
      args: { path: '/project/packages', excludePatterns: ['node_modules', 'dist'] },
      budget: 'compact',
    },
    {
      description: 'Read bridge source for context',
      tool: 'read_text_file',
      server: 'filesystem',
      args: { path: '/project/packages/bridge/src/bridge.ts' },
      budget: 'compact',
    },
    {
      description: 'Get open PRs',
      tool: 'list_pull_requests',
      server: 'github',
      args: { owner: 'nekte-protocol', repo: 'nekte', state: 'open' },
      budget: 'compact',
    },
    {
      description: 'Get PR details for the active feature',
      tool: 'get_pull_request',
      server: 'github',
      args: { owner: 'nekte-protocol', repo: 'nekte', pull_number: 89 },
      budget: 'full',
    },
    {
      description: 'Run database diagnostic query',
      tool: 'query',
      server: 'postgres',
      args: { sql: 'EXPLAIN SELECT t.*, p.name FROM tasks t JOIN projects p ON t.project_id = p.id WHERE t.priority = \'P0\'' },
      budget: 'full',
    },
    {
      description: 'Search codebase for TODO comments',
      tool: 'search_files',
      server: 'filesystem',
      args: { path: '/project/packages', pattern: '**/*.ts' },
      budget: 'compact',
    },
    {
      description: 'Search GitHub for similar projects',
      tool: 'search_repositories',
      server: 'github',
      args: { query: 'agent protocol MCP bridge', perPage: 5 },
      budget: 'compact',
    },
    {
      description: 'Check recent commit activity',
      tool: 'list_commits',
      server: 'github',
      args: { owner: 'nekte-protocol', repo: 'nekte' },
      budget: 'compact',
    },
    {
      description: 'Search for competitive analysis',
      tool: 'brave_web_search',
      server: 'brave-search',
      args: { query: 'MCP bridge token savings benchmark comparison', count: 10 },
      budget: 'compact',
    },
    {
      description: 'Write sprint plan to file',
      tool: 'write_file',
      server: 'filesystem',
      args: { path: '/project/docs/sprint-plan-2026-04.md', content: '# Sprint Plan\n...' },
      budget: 'minimal',
    },
  ],
};

// ---------------------------------------------------------------------------
// Export all scenarios
// ---------------------------------------------------------------------------

export const ALL_SCENARIOS: Scenario[] = [
  DEVOPS_TRIAGE,
  RESEARCH_ASSISTANT,
  DATA_ANALYSIS,
  MULTI_MCP_AGENT,
];

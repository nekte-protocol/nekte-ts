/**
 * Real-World Agent Conversation Scenarios
 *
 * Each scenario models a realistic multi-turn agent workflow
 * with specific tool invocations and expected response patterns.
 *
 * These are NOT synthetic — they mirror actual agent behavior
 * observed in code review, issue triage, and data analysis tasks.
 */

export interface ConversationTurn {
  /** Human-readable description of what the agent does */
  description: string;
  /** Tool name to invoke */
  tool: string;
  /** Arguments for the tool call */
  args: Record<string, unknown>;
  /** Budget level for this turn (NEKTE only) */
  budget?: 'minimal' | 'compact' | 'full';
}

export interface Scenario {
  /** Scenario name */
  name: string;
  /** Which MCP server(s) this scenario uses */
  servers: string[];
  /** Conversation turns */
  turns: ConversationTurn[];
  /** Description of the agent's goal */
  goal: string;
}

// ---------------------------------------------------------------------------
// Scenario 1: Code Review Agent
// ---------------------------------------------------------------------------

export const CODE_REVIEW: Scenario = {
  name: 'Code Review',
  servers: ['github'],
  goal: 'Review a pull request: check CI status, read changed files, leave review',
  turns: [
    {
      description: 'Check recent CI runs for the repo',
      tool: 'list_workflow_runs',
      args: { owner: 'nekte-protocol', repo: 'nekte', branch: 'feat/reconnection' },
      budget: 'compact',
    },
    {
      description: 'Get the PR details',
      tool: 'get_pull_request',
      args: { owner: 'nekte-protocol', repo: 'nekte', pull_number: 89 },
      budget: 'full',
    },
    {
      description: 'List files changed in the PR',
      tool: 'list_pull_request_files',
      args: { owner: 'nekte-protocol', repo: 'nekte', pull_number: 89 },
      budget: 'full',
    },
    {
      description: 'Read the main new file',
      tool: 'get_file_contents',
      args: { owner: 'nekte-protocol', repo: 'nekte', path: 'packages/bridge/src/reconnection.ts', ref: 'feat/reconnection' },
      budget: 'full',
    },
    {
      description: 'Read the modified connector file',
      tool: 'get_file_contents',
      args: { owner: 'nekte-protocol', repo: 'nekte', path: 'packages/bridge/src/mcp-connector.ts', ref: 'feat/reconnection' },
      budget: 'full',
    },
    {
      description: 'Check recent commits on the PR branch',
      tool: 'list_commits',
      args: { owner: 'nekte-protocol', repo: 'nekte', sha: 'feat/reconnection' },
      budget: 'compact',
    },
    {
      description: 'Search for related error handling patterns',
      tool: 'search_code',
      args: { q: 'reconnect backoff repo:nekte-protocol/nekte language:typescript' },
      budget: 'compact',
    },
    {
      description: 'Submit the review',
      tool: 'create_pull_request_review',
      args: {
        owner: 'nekte-protocol',
        repo: 'nekte',
        pull_number: 89,
        event: 'APPROVE',
        body: 'LGTM! The exponential backoff implementation looks solid.',
        comments: [
          { path: 'packages/bridge/src/reconnection.ts', position: 15, body: 'Consider adding jitter to the backoff delay to avoid thundering herd.' },
        ],
      },
      budget: 'minimal',
    },
  ],
};

// ---------------------------------------------------------------------------
// Scenario 2: Issue Triage Agent
// ---------------------------------------------------------------------------

export const ISSUE_TRIAGE: Scenario = {
  name: 'Issue Triage',
  servers: ['github'],
  goal: 'Triage open bugs: search, read details, check related code, assign and label',
  turns: [
    {
      description: 'Search for open bugs',
      tool: 'search_issues',
      args: { q: 'is:issue is:open label:bug repo:nekte-protocol/nekte', sort: 'created', order: 'desc' },
      budget: 'compact',
    },
    {
      description: 'Get details on the highest priority bug',
      tool: 'get_issue',
      args: { owner: 'nekte-protocol', repo: 'nekte', issue_number: 142 },
      budget: 'full',
    },
    {
      description: 'Check the relevant source file',
      tool: 'get_file_contents',
      args: { owner: 'nekte-protocol', repo: 'nekte', path: 'packages/bridge/src/mcp-connector.ts' },
      budget: 'full',
    },
    {
      description: 'Search for related issues/PRs',
      tool: 'search_issues',
      args: { q: 'reconnect OR retry repo:nekte-protocol/nekte' },
      budget: 'compact',
    },
    {
      description: 'Check if there is already a PR for this',
      tool: 'get_pull_request',
      args: { owner: 'nekte-protocol', repo: 'nekte', pull_number: 89 },
      budget: 'compact',
    },
    {
      description: 'Check repo overview for context',
      tool: 'get_repo',
      args: { owner: 'nekte-protocol', repo: 'nekte' },
      budget: 'minimal',
    },
  ],
};

// ---------------------------------------------------------------------------
// Scenario 3: Database Performance Investigation
// ---------------------------------------------------------------------------

export const DB_PERFORMANCE: Scenario = {
  name: 'DB Performance',
  servers: ['database'],
  goal: 'Investigate slow query reports: identify bottlenecks, suggest index improvements',
  turns: [
    {
      description: 'Get top slow queries',
      tool: 'get_slow_queries',
      args: { limit: 10, order_by: 'total_time' },
      budget: 'full',
    },
    {
      description: 'Explain the slowest query',
      tool: 'explain_query',
      args: { query: 'SELECT t.*, p.name FROM tasks t JOIN projects p ON t.project_id = p.id WHERE t.labels @> $1 ORDER BY t.updated_at DESC LIMIT $2', buffers: true },
      budget: 'full',
    },
    {
      description: 'Check table stats for the tasks table',
      tool: 'get_table_stats',
      args: { table: 'tasks' },
      budget: 'full',
    },
    {
      description: 'Analyze index usage on tasks',
      tool: 'get_index_usage',
      args: { table: 'tasks', include_suggestions: true },
      budget: 'full',
    },
    {
      description: 'Describe the table schema to understand columns',
      tool: 'describe_table',
      args: { table: 'tasks', include_indexes: true, include_stats: true },
      budget: 'compact',
    },
    {
      description: 'Check for lock contention',
      tool: 'get_locks',
      args: { blocked_only: true },
      budget: 'compact',
    },
    {
      description: 'Check active connections',
      tool: 'get_connections',
      args: { state: 'active' },
      budget: 'compact',
    },
    {
      description: 'Run a diagnostic query',
      tool: 'execute_query',
      args: { query: 'SELECT project_name, status, count(*) as task_count, avg(estimate_hours) FROM tasks GROUP BY project_name, status ORDER BY task_count DESC', limit: 20 },
      budget: 'compact',
    },
  ],
};

// ---------------------------------------------------------------------------
// Scenario 4: Cross-Tool Sprint Planning
// ---------------------------------------------------------------------------

export const SPRINT_PLANNING: Scenario = {
  name: 'Sprint Planning',
  servers: ['github', 'database'],
  goal: 'Plan next sprint: check open issues, review data quality, assess team velocity',
  turns: [
    {
      description: 'List repos in the org',
      tool: 'list_repos',
      args: { owner: 'nekte-protocol' },
      budget: 'compact',
    },
    {
      description: 'Search for unassigned high-priority issues',
      tool: 'search_issues',
      args: { q: 'is:issue is:open label:P1 no:assignee repo:nekte-protocol/nekte' },
      budget: 'full',
    },
    {
      description: 'Get project task distribution from DB',
      tool: 'execute_query',
      args: { query: 'SELECT status, count(*), avg(estimate_hours) FROM tasks WHERE project_id = $1 GROUP BY status', params: ['project-uuid'] },
      budget: 'compact',
    },
    {
      description: 'Check recent commit velocity',
      tool: 'list_commits',
      args: { owner: 'nekte-protocol', repo: 'nekte', since: '2026-03-31T00:00:00Z' },
      budget: 'compact',
    },
    {
      description: 'Check CI stability',
      tool: 'list_workflow_runs',
      args: { owner: 'nekte-protocol', repo: 'nekte', status: 'failure' },
      budget: 'compact',
    },
    {
      description: 'Get database table sizes for capacity planning',
      tool: 'list_tables',
      args: { schema: 'public' },
      budget: 'compact',
    },
    {
      description: 'Check slow queries that might block sprint goals',
      tool: 'get_slow_queries',
      args: { limit: 5, order_by: 'mean_time' },
      budget: 'compact',
    },
    {
      description: 'Get the highest priority open issue details',
      tool: 'get_issue',
      args: { owner: 'nekte-protocol', repo: 'nekte', issue_number: 142 },
      budget: 'compact',
    },
    {
      description: 'Check existing PR addressing the issue',
      tool: 'get_pull_request',
      args: { owner: 'nekte-protocol', repo: 'nekte', pull_number: 89 },
      budget: 'compact',
    },
    {
      description: 'Check database schema overview',
      tool: 'list_schemas',
      args: {},
      budget: 'minimal',
    },
  ],
};

// ---------------------------------------------------------------------------
// All scenarios
// ---------------------------------------------------------------------------

export const ALL_SCENARIOS: Scenario[] = [
  CODE_REVIEW,
  ISSUE_TRIAGE,
  DB_PERFORMANCE,
  SPRINT_PLANNING,
];

/**
 * Database MCP Server (stdio)
 *
 * Simulates a real database administration MCP server with
 * realistic tool schemas and query results. Models a Postgres-like
 * system with schemas, tables, queries, and monitoring.
 */

import { createInterface } from 'node:readline';

// ---------------------------------------------------------------------------
// Tool definitions — mirrors real database MCP server
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'list_schemas',
    description: 'List all database schemas with table counts and size estimates',
    inputSchema: {
      type: 'object',
      properties: {
        include_system: { type: 'boolean', description: 'Include pg_catalog and information_schema', default: false },
      },
    },
  },
  {
    name: 'list_tables',
    description: 'List tables in a schema with row counts, size, and column info',
    inputSchema: {
      type: 'object',
      properties: {
        schema: { type: 'string', description: 'Schema name', default: 'public' },
        pattern: { type: 'string', description: 'LIKE pattern to filter table names' },
      },
    },
  },
  {
    name: 'describe_table',
    description: 'Get detailed column definitions, constraints, indexes, and foreign keys for a table',
    inputSchema: {
      type: 'object',
      properties: {
        schema: { type: 'string', default: 'public' },
        table: { type: 'string', description: 'Table name' },
        include_indexes: { type: 'boolean', default: true },
        include_constraints: { type: 'boolean', default: true },
        include_stats: { type: 'boolean', description: 'Include row count and size estimates', default: true },
      },
      required: ['table'],
    },
  },
  {
    name: 'execute_query',
    description: 'Execute a read-only SQL query and return results. Limited to SELECT statements for safety.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'SQL SELECT query to execute' },
        params: { type: 'array', items: { type: 'string' }, description: 'Parameterized query values ($1, $2, ...)' },
        limit: { type: 'number', description: 'Override LIMIT clause (max 1000)', default: 100 },
        format: { type: 'string', enum: ['table', 'json', 'csv'], default: 'json' },
        explain: { type: 'boolean', description: 'Prepend EXPLAIN ANALYZE to the query', default: false },
      },
      required: ['query'],
    },
  },
  {
    name: 'explain_query',
    description: 'Run EXPLAIN ANALYZE on a query and return the execution plan with timing and buffer info',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'SQL query to explain' },
        params: { type: 'array', items: { type: 'string' } },
        format: { type: 'string', enum: ['text', 'json', 'yaml'], default: 'text' },
        buffers: { type: 'boolean', description: 'Include buffer usage statistics', default: true },
        verbose: { type: 'boolean', default: false },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_slow_queries',
    description: 'Get top slow queries from pg_stat_statements ordered by total execution time',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', default: 10 },
        min_calls: { type: 'number', description: 'Minimum number of calls', default: 5 },
        order_by: { type: 'string', enum: ['total_time', 'mean_time', 'calls', 'rows'], default: 'total_time' },
      },
    },
  },
  {
    name: 'get_table_stats',
    description: 'Get table-level statistics: sequential vs index scans, dead tuples, last vacuum/analyze',
    inputSchema: {
      type: 'object',
      properties: {
        schema: { type: 'string', default: 'public' },
        table: { type: 'string' },
      },
      required: ['table'],
    },
  },
  {
    name: 'get_index_usage',
    description: 'Analyze index usage: unused indexes, duplicate indexes, missing index suggestions',
    inputSchema: {
      type: 'object',
      properties: {
        schema: { type: 'string', default: 'public' },
        table: { type: 'string', description: 'Optional: filter to specific table' },
        include_suggestions: { type: 'boolean', description: 'Include missing index suggestions based on seq scan patterns', default: true },
      },
    },
  },
  {
    name: 'get_connections',
    description: 'List active database connections with query state, duration, and resource usage',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', enum: ['active', 'idle', 'idle in transaction', 'all'], default: 'all' },
        min_duration_ms: { type: 'number', description: 'Only show connections running longer than N ms' },
      },
    },
  },
  {
    name: 'get_locks',
    description: 'Show current lock contention: blocked queries, lock holders, and wait chains',
    inputSchema: {
      type: 'object',
      properties: {
        blocked_only: { type: 'boolean', description: 'Only show blocked queries', default: false },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Realistic response payloads
// ---------------------------------------------------------------------------

function makeSchemasResponse() {
  return [
    { name: 'public', owner: 'app_user', tables: 24, size_mb: 1250, description: 'Main application schema' },
    { name: 'analytics', owner: 'analytics_user', tables: 12, size_mb: 8400, description: 'Analytics and event tracking' },
    { name: 'auth', owner: 'auth_service', tables: 6, size_mb: 45, description: 'Authentication and sessions' },
    { name: 'billing', owner: 'billing_service', tables: 9, size_mb: 320, description: 'Billing, subscriptions, invoices' },
  ];
}

function makeTablesResponse() {
  return [
    { name: 'users', rows: 2_450_000, size_mb: 180, columns: 18, has_primary_key: true, description: 'User accounts' },
    { name: 'organizations', rows: 45_000, size_mb: 12, columns: 14, has_primary_key: true, description: 'Organization entities' },
    { name: 'projects', rows: 380_000, size_mb: 95, columns: 22, has_primary_key: true, description: 'Projects within organizations' },
    { name: 'tasks', rows: 12_500_000, size_mb: 620, columns: 28, has_primary_key: true, description: 'Task/issue tracking' },
    { name: 'comments', rows: 34_000_000, size_mb: 280, columns: 10, has_primary_key: true, description: 'Comments on tasks' },
    { name: 'attachments', rows: 5_200_000, size_mb: 45, columns: 12, has_primary_key: true, description: 'File attachments metadata' },
    { name: 'audit_log', rows: 89_000_000, size_mb: 4200, columns: 15, has_primary_key: true, description: 'Audit trail for all mutations' },
    { name: 'notifications', rows: 67_000_000, size_mb: 520, columns: 16, has_primary_key: true, description: 'User notifications' },
  ];
}

function makeDescribeTableResponse() {
  return {
    schema: 'public',
    table: 'tasks',
    columns: [
      { name: 'id', type: 'uuid', nullable: false, default: 'gen_random_uuid()', description: 'Primary key' },
      { name: 'project_id', type: 'uuid', nullable: false, description: 'FK to projects' },
      { name: 'creator_id', type: 'uuid', nullable: false, description: 'FK to users' },
      { name: 'assignee_id', type: 'uuid', nullable: true, description: 'FK to users' },
      { name: 'title', type: 'varchar(500)', nullable: false },
      { name: 'body', type: 'text', nullable: true },
      { name: 'status', type: 'varchar(20)', nullable: false, default: "'open'", description: 'open|in_progress|review|done|cancelled' },
      { name: 'priority', type: 'smallint', nullable: false, default: '3', description: '1=critical, 2=high, 3=medium, 4=low' },
      { name: 'labels', type: 'text[]', nullable: true },
      { name: 'due_date', type: 'timestamptz', nullable: true },
      { name: 'estimate_hours', type: 'numeric(5,1)', nullable: true },
      { name: 'actual_hours', type: 'numeric(5,1)', nullable: true },
      { name: 'parent_task_id', type: 'uuid', nullable: true, description: 'Self-referencing FK for subtasks' },
      { name: 'sort_order', type: 'integer', nullable: false, default: '0' },
      { name: 'metadata', type: 'jsonb', nullable: true, description: 'Custom fields' },
      { name: 'created_at', type: 'timestamptz', nullable: false, default: 'now()' },
      { name: 'updated_at', type: 'timestamptz', nullable: false, default: 'now()' },
      { name: 'deleted_at', type: 'timestamptz', nullable: true, description: 'Soft delete' },
    ],
    indexes: [
      { name: 'tasks_pkey', columns: ['id'], type: 'btree', unique: true, size_mb: 280 },
      { name: 'tasks_project_status_idx', columns: ['project_id', 'status'], type: 'btree', unique: false, size_mb: 190 },
      { name: 'tasks_assignee_idx', columns: ['assignee_id'], type: 'btree', unique: false, size_mb: 120, where: 'assignee_id IS NOT NULL' },
      { name: 'tasks_created_at_idx', columns: ['created_at'], type: 'btree', unique: false, size_mb: 150 },
      { name: 'tasks_labels_gin', columns: ['labels'], type: 'gin', unique: false, size_mb: 95 },
      { name: 'tasks_metadata_gin', columns: ['metadata'], type: 'gin', unique: false, size_mb: 210 },
      { name: 'tasks_search_idx', columns: ['title', 'body'], type: 'gin', unique: false, size_mb: 340, method: 'to_tsvector' },
    ],
    constraints: [
      { name: 'tasks_pkey', type: 'PRIMARY KEY', columns: ['id'] },
      { name: 'tasks_project_fk', type: 'FOREIGN KEY', columns: ['project_id'], references: 'projects(id)' },
      { name: 'tasks_creator_fk', type: 'FOREIGN KEY', columns: ['creator_id'], references: 'users(id)' },
      { name: 'tasks_assignee_fk', type: 'FOREIGN KEY', columns: ['assignee_id'], references: 'users(id)' },
      { name: 'tasks_status_check', type: 'CHECK', definition: "status IN ('open','in_progress','review','done','cancelled')" },
    ],
    stats: { row_estimate: 12_500_000, total_size_mb: 620, index_size_mb: 1385, toast_size_mb: 180 },
  };
}

function makeQueryResponse() {
  return {
    columns: ['project_name', 'status', 'task_count', 'avg_hours', 'overdue_count'],
    rows: [
      { project_name: 'API Platform', status: 'in_progress', task_count: 342, avg_hours: 4.2, overdue_count: 18 },
      { project_name: 'Mobile App', status: 'in_progress', task_count: 215, avg_hours: 6.8, overdue_count: 7 },
      { project_name: 'Data Pipeline', status: 'in_progress', task_count: 128, avg_hours: 8.1, overdue_count: 23 },
      { project_name: 'Auth Service', status: 'in_progress', task_count: 67, avg_hours: 3.5, overdue_count: 2 },
      { project_name: 'Admin Dashboard', status: 'review', task_count: 89, avg_hours: 5.3, overdue_count: 12 },
      { project_name: 'Infrastructure', status: 'in_progress', task_count: 156, avg_hours: 7.2, overdue_count: 31 },
      { project_name: 'Documentation', status: 'open', task_count: 445, avg_hours: 2.1, overdue_count: 45 },
    ],
    row_count: 7,
    execution_time_ms: 234,
    plan_time_ms: 1.2,
  };
}

function makeExplainResponse() {
  return {
    plan: `Sort  (cost=45230.12..45280.45 rows=20131 width=96) (actual time=234.102..234.891 rows=7 loops=1)
  Sort Key: task_count DESC
  Sort Method: quicksort  Memory: 25kB
  ->  HashAggregate  (cost=43012.50..43213.81 rows=20131 width=96) (actual time=233.456..234.012 rows=7 loops=1)
        Group Key: p.name, t.status
        Batches: 1  Memory Usage: 2465kB
        ->  Hash Join  (cost=1234.50..40890.23 rows=212345 width=48) (actual time=12.345..189.678 rows=997 loops=1)
              Hash Cond: (t.project_id = p.id)
              ->  Seq Scan on tasks t  (cost=0.00..35678.00 rows=12500000 width=32) (actual time=0.012..145.234 rows=12500000 loops=1)
                    Filter: (status = 'in_progress')
                    Rows Removed by Filter: 0
              ->  Hash  (cost=890.00..890.00 rows=27560 width=24) (actual time=8.901..8.901 rows=380000 loops=1)
                    Buckets: 524288  Batches: 1  Memory Usage: 21504kB
                    ->  Seq Scan on projects p  (cost=0.00..890.00 rows=380000 width=24) (actual time=0.005..4.567 rows=380000 loops=1)
Planning Time: 1.234 ms
Execution Time: 235.123 ms`,
    suggestions: [
      'Consider adding a partial index on tasks(project_id) WHERE status = \'in_progress\' to avoid the sequential scan',
      'The Hash Join is spilling to disk — consider increasing work_mem for this query',
    ],
  };
}

function makeSlowQueriesResponse() {
  return Array.from({ length: 5 }, (_, i) => ({
    query: [
      'SELECT t.*, p.name FROM tasks t JOIN projects p ON t.project_id = p.id WHERE t.labels @> $1 ORDER BY t.updated_at DESC LIMIT $2',
      'SELECT u.*, count(t.id) as task_count FROM users u LEFT JOIN tasks t ON t.assignee_id = u.id WHERE u.org_id = $1 GROUP BY u.id ORDER BY task_count DESC',
      'UPDATE tasks SET status = $1, updated_at = now() WHERE id = ANY($2) AND project_id = $3',
      'SELECT * FROM audit_log WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at DESC LIMIT $3',
      'INSERT INTO notifications (user_id, type, payload) SELECT assignee_id, $1, $2 FROM tasks WHERE project_id = $3 AND status != \'done\'',
    ][i],
    calls: [45230, 12890, 8934, 67890, 3456][i],
    total_time_ms: [892345, 456789, 234567, 178901, 123456][i],
    mean_time_ms: [19.7, 35.4, 26.3, 2.6, 35.7][i],
    rows: [45230000, 12890000, 26802, 678900000, 10368][i],
    shared_blks_hit: [9800000, 4500000, 2100000, 15600000, 890000][i],
    shared_blks_read: [120000, 890000, 45000, 2300000, 12000][i],
  }));
}

function makeTableStatsResponse() {
  return {
    schema: 'public',
    table: 'tasks',
    seq_scan: 234,
    seq_tup_read: 2_925_000_000,
    idx_scan: 89_456_000,
    idx_tup_fetch: 178_912_000,
    n_tup_ins: 1_200_000,
    n_tup_upd: 8_900_000,
    n_tup_del: 340_000,
    n_live_tup: 12_500_000,
    n_dead_tup: 45_000,
    last_vacuum: '2026-04-07T03:00:00Z',
    last_autovacuum: '2026-04-07T03:00:00Z',
    last_analyze: '2026-04-07T03:15:00Z',
    last_autoanalyze: '2026-04-07T03:15:00Z',
    vacuum_count: 890,
    autovacuum_count: 720,
  };
}

function makeIndexUsageResponse() {
  return {
    indexes: [
      { name: 'tasks_pkey', scans: 89_456_000, tuples_read: 89_456_000, tuples_fetched: 89_456_000, size_mb: 280 },
      { name: 'tasks_project_status_idx', scans: 12_340_000, tuples_read: 24_680_000, tuples_fetched: 12_340_000, size_mb: 190 },
      { name: 'tasks_assignee_idx', scans: 5_670_000, tuples_read: 11_340_000, tuples_fetched: 5_670_000, size_mb: 120 },
      { name: 'tasks_created_at_idx', scans: 890_000, tuples_read: 4_450_000, tuples_fetched: 890_000, size_mb: 150 },
      { name: 'tasks_labels_gin', scans: 234_000, tuples_read: 1_170_000, tuples_fetched: 234_000, size_mb: 95 },
      { name: 'tasks_metadata_gin', scans: 12_000, tuples_read: 24_000, tuples_fetched: 12_000, size_mb: 210 },
    ],
    unused: [
      { name: 'tasks_metadata_gin', scans: 12_000, size_mb: 210, recommendation: 'Very low scan count relative to size. Consider dropping if metadata queries are rare.' },
    ],
    suggestions: [
      { table: 'tasks', columns: ['status', 'due_date'], reason: 'High seq_scan count with frequent WHERE status AND due_date filters', estimated_benefit: 'Could reduce 234 seq scans on 12.5M row table' },
    ],
  };
}

function makeConnectionsResponse() {
  return Array.from({ length: 6 }, (_, i) => ({
    pid: 12340 + i,
    usename: ['app_user', 'app_user', 'analytics_user', 'app_user', 'billing_service', 'auth_service'][i],
    application_name: ['web-api', 'web-api', 'analytics-worker', 'background-jobs', 'billing-cron', 'auth-service'][i],
    client_addr: `10.0.${i}.${100 + i}`,
    state: ['active', 'idle', 'active', 'idle in transaction', 'active', 'idle'][i],
    query: [
      'SELECT * FROM tasks WHERE project_id = $1 AND status = $2 ORDER BY updated_at DESC LIMIT 50',
      '',
      'INSERT INTO analytics.events SELECT * FROM staging.events WHERE created_at > $1',
      'UPDATE tasks SET status = $1 WHERE id = $2',
      'SELECT * FROM billing.invoices WHERE due_date < now() AND status = \'pending\'',
      '',
    ][i],
    query_start: i % 2 === 0 ? `2026-04-07T14:${20 + i}:00Z` : null,
    state_change: `2026-04-07T14:${20 + i}:00Z`,
    wait_event_type: i === 3 ? 'Lock' : null,
    wait_event: i === 3 ? 'transactionid' : null,
    backend_xid: i === 3 ? '12345678' : null,
  }));
}

function makeLocksResponse() {
  return {
    blocked: [
      {
        blocked_pid: 12343,
        blocked_query: 'UPDATE tasks SET status = $1 WHERE id = $2',
        blocked_user: 'app_user',
        blocking_pid: 12340,
        blocking_query: 'SELECT * FROM tasks WHERE project_id = $1 AND status = $2 ORDER BY updated_at DESC LIMIT 50',
        blocking_user: 'app_user',
        lock_type: 'transactionid',
        duration_ms: 4500,
      },
    ],
    total_locks: 23,
    exclusive_locks: 3,
    share_locks: 20,
  };
}

// ---------------------------------------------------------------------------
// Tool dispatcher
// ---------------------------------------------------------------------------

function handleToolCall(name: string, _args: Record<string, unknown>): unknown {
  switch (name) {
    case 'list_schemas': return makeSchemasResponse();
    case 'list_tables': return makeTablesResponse();
    case 'describe_table': return makeDescribeTableResponse();
    case 'execute_query': return makeQueryResponse();
    case 'explain_query': return makeExplainResponse();
    case 'get_slow_queries': return makeSlowQueriesResponse();
    case 'get_table_stats': return makeTableStatsResponse();
    case 'get_index_usage': return makeIndexUsageResponse();
    case 'get_connections': return makeConnectionsResponse();
    case 'get_locks': return makeLocksResponse();
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
      serverInfo: { name: 'database-mock', version: '1.0.0' },
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

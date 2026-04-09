/**
 * Market MCP Server Registry
 *
 * Real tool schemas extracted from official @modelcontextprotocol packages.
 * Each entry faithfully reproduces the exact tool names, descriptions, and
 * input schemas that a real MCP client would receive from `tools/list`.
 *
 * Sources:
 *  - @modelcontextprotocol/server-github (26 tools)
 *  - @modelcontextprotocol/server-filesystem (14 tools, excluding deprecated read_file)
 *  - @modelcontextprotocol/server-brave-search (2 tools)
 *  - @modelcontextprotocol/server-fetch (1 tool)
 *  - @modelcontextprotocol/server-postgres (1 tool)
 */

import type { McpServerDef, McpToolDef } from '../types.js';

// ---------------------------------------------------------------------------
// GitHub MCP — 26 tools
// ---------------------------------------------------------------------------

const githubTools: McpToolDef[] = [
  {
    name: 'create_or_update_file',
    description: 'Create or update a single file in a GitHub repository',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner (username or organization)' },
        repo: { type: 'string', description: 'Repository name' },
        path: { type: 'string', description: 'Path where to create/update the file' },
        content: { type: 'string', description: 'Content of the file' },
        message: { type: 'string', description: 'Commit message' },
        branch: { type: 'string', description: 'Branch to create/update the file in' },
        sha: { type: 'string', description: 'SHA of the file being replaced (required when updating existing files)' },
      },
      required: ['owner', 'repo', 'path', 'content', 'message', 'branch'],
    },
  },
  {
    name: 'search_repositories',
    description: 'Search for GitHub repositories',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (see GitHub search syntax)' },
        page: { type: 'number', description: 'Page number for pagination (default: 1)' },
        perPage: { type: 'number', description: 'Number of results per page (default: 30, max: 100)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'create_repository',
    description: 'Create a new GitHub repository in your account',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Repository name' },
        description: { type: 'string', description: 'Repository description' },
        private: { type: 'boolean', description: 'Whether the repository should be private' },
        autoInit: { type: 'boolean', description: 'Initialize with README.md' },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_file_contents',
    description: 'Get the contents of a file or directory from a GitHub repository',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner (username or organization)' },
        repo: { type: 'string', description: 'Repository name' },
        path: { type: 'string', description: 'Path to the file or directory' },
        branch: { type: 'string', description: 'Branch to get contents from' },
      },
      required: ['owner', 'repo', 'path'],
    },
  },
  {
    name: 'push_files',
    description: 'Push multiple files to a GitHub repository in a single commit',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner (username or organization)' },
        repo: { type: 'string', description: 'Repository name' },
        branch: { type: 'string', description: "Branch to push to (e.g., 'main' or 'master')" },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: { path: { type: 'string' }, content: { type: 'string' } },
            required: ['path', 'content'],
          },
          description: 'Array of files to push',
        },
        message: { type: 'string', description: 'Commit message' },
      },
      required: ['owner', 'repo', 'branch', 'files', 'message'],
    },
  },
  {
    name: 'create_issue',
    description: 'Create a new issue in a GitHub repository',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' }, repo: { type: 'string' }, title: { type: 'string' },
        body: { type: 'string' },
        assignees: { type: 'array', items: { type: 'string' } },
        milestone: { type: 'number' },
        labels: { type: 'array', items: { type: 'string' } },
      },
      required: ['owner', 'repo', 'title'],
    },
  },
  {
    name: 'create_pull_request',
    description: 'Create a new pull request in a GitHub repository',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner (username or organization)' },
        repo: { type: 'string', description: 'Repository name' },
        title: { type: 'string', description: 'Pull request title' },
        body: { type: 'string', description: 'Pull request body/description' },
        head: { type: 'string', description: 'The name of the branch where your changes are implemented' },
        base: { type: 'string', description: 'The name of the branch you want the changes pulled into' },
        draft: { type: 'boolean', description: 'Whether to create the pull request as a draft' },
        maintainer_can_modify: { type: 'boolean', description: 'Whether maintainers can modify the pull request' },
      },
      required: ['owner', 'repo', 'title', 'head', 'base'],
    },
  },
  {
    name: 'fork_repository',
    description: 'Fork a GitHub repository to your account or specified organization',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner (username or organization)' },
        repo: { type: 'string', description: 'Repository name' },
        organization: { type: 'string', description: 'Optional: organization to fork to (defaults to your personal account)' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'create_branch',
    description: 'Create a new branch in a GitHub repository',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner (username or organization)' },
        repo: { type: 'string', description: 'Repository name' },
        branch: { type: 'string', description: 'Name for the new branch' },
        from_branch: { type: 'string', description: "Optional: source branch to create from (defaults to the repository's default branch)" },
      },
      required: ['owner', 'repo', 'branch'],
    },
  },
  {
    name: 'list_commits',
    description: 'Get list of commits of a branch in a GitHub repository',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' }, repo: { type: 'string' },
        sha: { type: 'string' }, page: { type: 'number' }, perPage: { type: 'number' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'list_issues',
    description: 'List issues in a GitHub repository with filtering options',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' }, repo: { type: 'string' },
        direction: { type: 'string', enum: ['asc', 'desc'] },
        labels: { type: 'array', items: { type: 'string' } },
        page: { type: 'number' }, per_page: { type: 'number' },
        since: { type: 'string' },
        sort: { type: 'string', enum: ['created', 'updated', 'comments'] },
        state: { type: 'string', enum: ['open', 'closed', 'all'] },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'update_issue',
    description: 'Update an existing issue in a GitHub repository',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' }, repo: { type: 'string' }, issue_number: { type: 'number' },
        title: { type: 'string' }, body: { type: 'string' },
        assignees: { type: 'array', items: { type: 'string' } },
        milestone: { type: 'number' },
        labels: { type: 'array', items: { type: 'string' } },
        state: { type: 'string', enum: ['open', 'closed'] },
      },
      required: ['owner', 'repo', 'issue_number'],
    },
  },
  {
    name: 'add_issue_comment',
    description: 'Add a comment to an existing issue',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' }, repo: { type: 'string' },
        issue_number: { type: 'number' }, body: { type: 'string' },
      },
      required: ['owner', 'repo', 'issue_number', 'body'],
    },
  },
  {
    name: 'search_code',
    description: 'Search for code across GitHub repositories',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string' },
        order: { type: 'string', enum: ['asc', 'desc'] },
        page: { type: 'number', minimum: 1 },
        per_page: { type: 'number', minimum: 1, maximum: 100 },
      },
      required: ['q'],
    },
  },
  {
    name: 'search_issues',
    description: 'Search for issues and pull requests across GitHub repositories',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string' },
        order: { type: 'string', enum: ['asc', 'desc'] },
        page: { type: 'number', minimum: 1 },
        per_page: { type: 'number', minimum: 1, maximum: 100 },
        sort: {
          type: 'string',
          enum: ['comments', 'reactions', 'reactions-+1', 'reactions--1', 'reactions-smile',
            'reactions-thinking_face', 'reactions-heart', 'reactions-tada', 'interactions', 'created', 'updated'],
        },
      },
      required: ['q'],
    },
  },
  {
    name: 'search_users',
    description: 'Search for users on GitHub',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string' },
        order: { type: 'string', enum: ['asc', 'desc'] },
        page: { type: 'number', minimum: 1 },
        per_page: { type: 'number', minimum: 1, maximum: 100 },
        sort: { type: 'string', enum: ['followers', 'repositories', 'joined'] },
      },
      required: ['q'],
    },
  },
  {
    name: 'get_issue',
    description: 'Get details of a specific issue in a GitHub repository.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' }, repo: { type: 'string' }, issue_number: { type: 'number' },
      },
      required: ['owner', 'repo', 'issue_number'],
    },
  },
  {
    name: 'get_pull_request',
    description: 'Get details of a specific pull request',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner (username or organization)' },
        repo: { type: 'string', description: 'Repository name' },
        pull_number: { type: 'number', description: 'Pull request number' },
      },
      required: ['owner', 'repo', 'pull_number'],
    },
  },
  {
    name: 'list_pull_requests',
    description: 'List and filter repository pull requests',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner (username or organization)' },
        repo: { type: 'string', description: 'Repository name' },
        state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'State of the pull requests to return' },
        head: { type: 'string', description: 'Filter by head user or head organization and branch name' },
        base: { type: 'string', description: 'Filter by base branch name' },
        sort: { type: 'string', enum: ['created', 'updated', 'popularity', 'long-running'], description: 'What to sort results by' },
        direction: { type: 'string', enum: ['asc', 'desc'], description: 'The direction of the sort' },
        per_page: { type: 'number', description: 'Results per page (max 100)' },
        page: { type: 'number', description: 'Page number of the results' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'create_pull_request_review',
    description: 'Create a review on a pull request',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner (username or organization)' },
        repo: { type: 'string', description: 'Repository name' },
        pull_number: { type: 'number', description: 'Pull request number' },
        commit_id: { type: 'string', description: 'The SHA of the commit that needs a review' },
        body: { type: 'string', description: 'The body text of the review' },
        event: { type: 'string', enum: ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'], description: 'The review action to perform' },
        comments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' }, position: { type: 'number' },
              line: { type: 'number' }, body: { type: 'string' },
            },
            required: ['path', 'body'],
          },
          description: 'Comments to post as part of the review',
        },
      },
      required: ['owner', 'repo', 'pull_number', 'body', 'event'],
    },
  },
  {
    name: 'merge_pull_request',
    description: 'Merge a pull request',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner (username or organization)' },
        repo: { type: 'string', description: 'Repository name' },
        pull_number: { type: 'number', description: 'Pull request number' },
        commit_title: { type: 'string', description: 'Title for the automatic commit message' },
        commit_message: { type: 'string', description: 'Extra detail to append to automatic commit message' },
        merge_method: { type: 'string', enum: ['merge', 'squash', 'rebase'], description: 'Merge method to use' },
      },
      required: ['owner', 'repo', 'pull_number'],
    },
  },
  {
    name: 'get_pull_request_files',
    description: 'Get the list of files changed in a pull request',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' }, repo: { type: 'string' }, pull_number: { type: 'number' },
      },
      required: ['owner', 'repo', 'pull_number'],
    },
  },
  {
    name: 'get_pull_request_status',
    description: 'Get the combined status of all status checks for a pull request',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' }, repo: { type: 'string' }, pull_number: { type: 'number' },
      },
      required: ['owner', 'repo', 'pull_number'],
    },
  },
  {
    name: 'update_pull_request_branch',
    description: 'Update a pull request branch with the latest changes from the base branch',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' }, repo: { type: 'string' }, pull_number: { type: 'number' },
        expected_head_sha: { type: 'string', description: "The expected SHA of the pull request's HEAD ref" },
      },
      required: ['owner', 'repo', 'pull_number'],
    },
  },
  {
    name: 'get_pull_request_comments',
    description: 'Get the review comments on a pull request',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' }, repo: { type: 'string' }, pull_number: { type: 'number' },
      },
      required: ['owner', 'repo', 'pull_number'],
    },
  },
  {
    name: 'get_pull_request_reviews',
    description: 'Get the reviews on a pull request',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' }, repo: { type: 'string' }, pull_number: { type: 'number' },
      },
      required: ['owner', 'repo', 'pull_number'],
    },
  },
];

// ---------------------------------------------------------------------------
// Filesystem MCP — 14 tools (excluding deprecated read_file)
// ---------------------------------------------------------------------------

const filesystemTools: McpToolDef[] = [
  {
    name: 'read_text_file',
    description: 'Read the complete contents of a file from the file system as text. Handles various text encodings and provides detailed error messages if the file cannot be read. Use this tool when you need to examine the contents of a single file. Use the \'head\' parameter to read only the first N lines of a file, or the \'tail\' parameter to read only the last N lines of a file. Operates on the file as text regardless of extension. Only works within allowed directories.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        tail: { type: 'number', description: 'If provided, returns only the last N lines of the file' },
        head: { type: 'number', description: 'If provided, returns only the first N lines of the file' },
      },
      required: ['path'],
    },
  },
  {
    name: 'read_media_file',
    description: 'Read an image or audio file. Returns the base64 encoded data and MIME type. Only works within allowed directories.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'read_multiple_files',
    description: 'Read the contents of multiple files simultaneously. This is more efficient than reading files one by one when you need to analyze or compare multiple files. Each file\'s content is returned with its path as a reference. Failed reads for individual files won\'t stop the entire operation. Only works within allowed directories.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Array of file paths to read. Each path must be a string pointing to a valid file within allowed directories.' },
      },
      required: ['paths'],
    },
  },
  {
    name: 'write_file',
    description: 'Create a new file or completely overwrite an existing file with new content. Use with caution as it will overwrite existing files without warning. Handles text content with proper encoding. Only works within allowed directories.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Make line-based edits to a text file. Each edit replaces exact line sequences with new content. Returns a git-style diff showing the changes made. Only works within allowed directories.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              oldText: { type: 'string', description: 'Text to search for - must match exactly' },
              newText: { type: 'string', description: 'Text to replace with' },
            },
            required: ['oldText', 'newText'],
          },
        },
        dryRun: { type: 'boolean', default: false, description: 'Preview changes using git-style diff format' },
      },
      required: ['path', 'edits'],
    },
  },
  {
    name: 'create_directory',
    description: 'Create a new directory or ensure a directory exists. Can create multiple nested directories in one operation. If the directory already exists, this operation will succeed silently. Perfect for setting up directory structures for projects or ensuring required paths exist. Only works within allowed directories.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'list_directory',
    description: 'Get a detailed listing of all files and directories in a specified path. Results clearly distinguish between files and directories with [FILE] and [DIR] prefixes. This tool is essential for understanding directory structure and finding specific files within a directory. Only works within allowed directories.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'list_directory_with_sizes',
    description: 'Get a detailed listing of all files and directories in a specified path, including sizes. Results clearly distinguish between files and directories with [FILE] and [DIR] prefixes. This tool is useful for understanding directory structure and finding specific files within a directory. Only works within allowed directories.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        sortBy: { type: 'string', enum: ['name', 'size'], default: 'name', description: 'Sort entries by name or size' },
      },
      required: ['path'],
    },
  },
  {
    name: 'directory_tree',
    description: "Get a recursive tree view of files and directories as a JSON structure. Each entry includes 'name', 'type' (file/directory), and 'children' for directories. Files have no children array, while directories always have a children array (which may be empty). The output is formatted with 2-space indentation for readability. Only works within allowed directories.",
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        excludePatterns: { type: 'array', items: { type: 'string' }, default: [] },
      },
      required: ['path'],
    },
  },
  {
    name: 'move_file',
    description: 'Move or rename files and directories. Can move files between directories and rename them in a single operation. If the destination exists, the operation will fail. Works across different directories and can be used for simple renaming within the same directory. Both source and destination must be within allowed directories.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string' }, destination: { type: 'string' },
      },
      required: ['source', 'destination'],
    },
  },
  {
    name: 'search_files',
    description: "Recursively search for files and directories matching a pattern. The patterns should be glob-style patterns that match paths relative to the working directory. Use pattern like '*.ext' to match files in current directory, and '**/*.ext' to match files in all subdirectories. Returns full paths to all matching items. Great for finding files when you don't know their exact location. Only searches within allowed directories.",
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        pattern: { type: 'string' },
        excludePatterns: { type: 'array', items: { type: 'string' }, default: [] },
      },
      required: ['path', 'pattern'],
    },
  },
  {
    name: 'get_file_info',
    description: 'Retrieve detailed metadata about a file or directory. Returns comprehensive information including size, creation time, last modified time, permissions, and type. This tool is perfect for understanding file characteristics without reading the actual content. Only works within allowed directories.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'list_allowed_directories',
    description: 'Returns the list of directories that this server is allowed to access. Subdirectories within these allowed directories are also accessible. Use this to understand which directories and their nested paths are available before trying to access files.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ---------------------------------------------------------------------------
// Brave Search MCP — 2 tools
// ---------------------------------------------------------------------------

const braveSearchTools: McpToolDef[] = [
  {
    name: 'brave_web_search',
    description: 'Performs a web search using the Brave Search API, ideal for general queries, news, articles, and online content. Use this for broad information gathering, recent events, or when you need diverse web sources. Supports pagination, content filtering, and freshness controls. Maximum 20 results per request, with offset for pagination.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (max 400 chars, 50 words)' },
        count: { type: 'number', description: 'Number of results (1-20, default 10)', default: 10 },
        offset: { type: 'number', description: 'Pagination offset (max 9, default 0)', default: 0 },
      },
      required: ['query'],
    },
  },
  {
    name: 'brave_local_search',
    description: "Searches for local businesses and places using Brave's Local Search API. Best for queries related to physical locations, businesses, restaurants, services, etc. Returns detailed information including: Business names and addresses, Ratings and review counts, Phone numbers and opening hours. Use this when the query implies 'near me' or mentions specific locations. Automatically falls back to web search if no local results are found.",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: "Local search query (e.g. 'pizza near Central Park')" },
        count: { type: 'number', description: 'Number of results (1-20, default 5)', default: 5 },
      },
      required: ['query'],
    },
  },
];

// ---------------------------------------------------------------------------
// Fetch MCP — 1 tool
// ---------------------------------------------------------------------------

const fetchTools: McpToolDef[] = [
  {
    name: 'fetch',
    description: "Fetches a URL from the internet and optionally extracts its contents as markdown.\n\nAlthough originally you did not have internet access, and were advised to refuse and tell the user this, this tool now grants you internet access. Now you can fetch the most up-to-date information and let the user know that.",
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', format: 'uri', description: 'URL to fetch' },
        max_length: { type: 'integer', default: 5000, description: 'Maximum number of characters to return.', exclusiveMinimum: 0, exclusiveMaximum: 1000000 },
        start_index: { type: 'integer', default: 0, description: 'On return output starting at this character index, useful if a previous fetch was truncated and more context is required.', minimum: 0 },
        raw: { type: 'boolean', default: false, description: 'Get the actual HTML content of the requested page, without simplification.' },
      },
      required: ['url'],
    },
  },
];

// ---------------------------------------------------------------------------
// PostgreSQL MCP — 1 tool
// ---------------------------------------------------------------------------

const postgresTools: McpToolDef[] = [
  {
    name: 'query',
    description: 'Run a read-only SQL query',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string' },
      },
      required: ['sql'],
    },
  },
];

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const MCP_REGISTRY: Record<string, McpServerDef> = {
  github: {
    id: 'github',
    npmPackage: '@modelcontextprotocol/server-github',
    category: 'dev',
    toolCount: githubTools.length,
    tools: githubTools,
  },
  filesystem: {
    id: 'filesystem',
    npmPackage: '@modelcontextprotocol/server-filesystem',
    category: 'infra',
    toolCount: filesystemTools.length,
    tools: filesystemTools,
  },
  'brave-search': {
    id: 'brave-search',
    npmPackage: '@modelcontextprotocol/server-brave-search',
    category: 'search',
    toolCount: braveSearchTools.length,
    tools: braveSearchTools,
  },
  fetch: {
    id: 'fetch',
    npmPackage: '@modelcontextprotocol/server-fetch',
    category: 'search',
    toolCount: fetchTools.length,
    tools: fetchTools,
  },
  postgres: {
    id: 'postgres',
    npmPackage: '@modelcontextprotocol/server-postgres',
    category: 'data',
    toolCount: postgresTools.length,
    tools: postgresTools,
  },
};

/** Get all servers as an ordered array */
export function getAllServers(): McpServerDef[] {
  return Object.values(MCP_REGISTRY);
}

/** Get servers by IDs */
export function getServers(ids: string[]): McpServerDef[] {
  return ids.map((id) => {
    const s = MCP_REGISTRY[id];
    if (!s) throw new Error(`Unknown MCP server: ${id}. Available: ${Object.keys(MCP_REGISTRY).join(', ')}`);
    return s;
  });
}

/** Collect all tools across given servers */
export function collectTools(serverIds: string[]): McpToolDef[] {
  return getServers(serverIds).flatMap((s) => s.tools);
}

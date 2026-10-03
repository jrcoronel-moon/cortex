import { NextRequest, NextResponse } from 'next/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { mcpListNotes, mcpGetNote, mcpCreateNote, mcpUpdateNote, mcpSearchNotes, mcpListSpaces, validateApiKey, type McpScope } from '@/lib/mcp';
import { validateAccessToken } from '@/lib/oauth';
import { readableFileIds, workspaceFileIds, readableSpaces, workspaceSpaces } from '@/lib/access';
import db from '@/lib/db';

// Session store for MCP transports (in-memory, ok for Node.js persistence)
const sessions = new Map<string, { server: McpServer; transport: WebStandardStreamableHTTPServerTransport }>();

// Zod schemas for tool inputs
const getNoteTool = z.object({
  id_or_title: z.string().describe('The note ID or title to retrieve'),
});

const searchNotesTool = z.object({
  query: z.string().describe('The search query'),
});

const createNoteTool = z.object({
  title: z.string().describe('The note title'),
  content: z.string().describe('The note content (optional)').optional(),
});

const updateNoteTool = z.object({
  id_or_title: z.string().describe('The note ID or title to update'),
  content: z.string().describe('The new content'),
});

function createMcpServer(scope: McpScope): McpServer {
  const server = new McpServer({
    name: 'cortex-mcp',
    version: '1.0.0',
  });

  server.tool('test_tool', 'Test tool', async () => {
    return {
      content: [{ type: 'text' as const, text: 'Test response' }],
    };
  });

  // List the folders/spaces the user can access
  server.tool('list_spaces', 'List the spaces (folders) the user can access, with their hierarchy (id, name, parentId). Use this to see the workspace/knowledge-base structure.', async () => {
    const spaces = mcpListSpaces(scope);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(spaces, null, 2) }],
    };
  });

  // List all notes in workspace
  server.tool('list_notes', 'List all notes in the workspace.', async () => {
    const notes = mcpListNotes(scope);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(notes, null, 2),
        },
      ],
    };
  });

  // Get note by ID or title
  server.tool(
    'get_note',
    'Get the full content of a note by ID or title.',
    { id_or_title: z.string().describe('The note ID or title to retrieve') },
    async ({ id_or_title }) => {
      const note = mcpGetNote(scope, id_or_title);
      if (!note) {
        return {
          content: [{ type: 'text' as const, text: 'Note not found' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(note, null, 2) }],
      };
    }
  );

  // Semantic search of notes
  server.tool(
    'search_notes',
    'Search notes by semantic meaning using AI embeddings.',
    { query: z.string().describe('The search query') },
    async ({ query }) => {
      const results = await mcpSearchNotes(scope, query);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
      };
    }
  );

  // Create a new note
  server.tool(
    'create_note',
    'Create a new note in the workspace.',
    {
      title: z.string().describe('The note title'),
      content: z.string().optional().describe('The note content (optional)'),
    },
    async ({ title, content }) => {
      const note = mcpCreateNote(scope, title, content ?? '');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(note, null, 2) }],
      };
    }
  );

  // Update existing note
  server.tool(
    'update_note',
    'Update the content of an existing note.',
    {
      id_or_title: z.string().describe('The note ID or title to update'),
      content: z.string().describe('The new content'),
    },
    async ({ id_or_title, content }) => {
      try {
        const result = mcpUpdateNote(scope, id_or_title, content);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}

function auth(request: NextRequest): McpScope | null {
  const authHeader = request.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return null;

  // OAuth access token → run as the authorizing user across everything they can read.
  const oauthToken = validateAccessToken(token);
  if (oauthToken) {
    // The app must still exist — deleting it (revoking the connection) denies access.
    const app = db.prepare('SELECT exposed_folders FROM oauth_applications WHERE id = ?')
      .get(oauthToken.applicationId) as { exposed_folders: string } | undefined;
    if (!app) return null;

    const user = db.prepare('SELECT id, email, role FROM users WHERE id = ?')
      .get(oauthToken.userId) as { id: string; email: string; role: string } | undefined;
    if (!user) return null;

    const writeWs = db.prepare('SELECT id FROM workspaces WHERE owner_id = ? LIMIT 1')
      .get(user.id) as { id: string } | undefined;

    return {
      userId: user.id,
      fileIds: readableFileIds(user),
      spaces: readableSpaces(user),
      exposedFolders: JSON.parse(app.exposed_folders || '[]'),
      writeWorkspaceId: writeWs?.id ?? null,
    };
  }

  // API key (Claude Code) → scoped to the key's workspace + exposed folders.
  const apiKeyAuth = validateApiKey(token);
  if (apiKeyAuth) {
    return {
      userId: apiKeyAuth.userId,
      fileIds: workspaceFileIds(apiKeyAuth.workspaceId),
      spaces: workspaceSpaces(apiKeyAuth.workspaceId),
      exposedFolders: apiKeyAuth.exposedFolders || [],
      writeWorkspaceId: apiKeyAuth.workspaceId,
    };
  }

  return null;
}

export async function GET(request: NextRequest) {
  // Streamable-HTTP clients (Claude.ai) probe with an unauthenticated GET and
  // expect a 401 + WWW-Authenticate to kick off OAuth discovery — the same
  // challenge as POST. Returning a 200 health blob here makes the client report
  // "not a valid MCP server", so we gate GET behind auth too.
  const scope = auth(request);
  if (!scope) {
    const base = publicBaseUrl(request);
    return NextResponse.json(
      { error: 'Unauthorized', error_description: 'OAuth token required' },
      {
        status: 401,
        headers: {
          ...CORS_HEADERS,
          'WWW-Authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
        },
      }
    );
  }

  // Authenticated: hand the GET (standalone SSE stream) to the MCP transport,
  // exactly like POST — this mirrors the reference SDK handler.
  return handleMcp(request, scope);
}

// Shared transport dispatch for GET/POST/DELETE: find (or create for POST) the
// session's MCP transport and let it handle the request.
async function handleMcp(request: NextRequest, scope: McpScope) {
  try {
    const sessionIdHeader = request.headers.get('mcp-session-id');
    let sessionData = sessionIdHeader ? sessions.get(sessionIdHeader) : undefined;

    if (!sessionData) {
      const server = createMcpServer(scope);
      const sessionId = crypto.randomUUID();
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId,
      });
      await server.connect(transport);
      sessionData = { server, transport };
      sessions.set(sessionId, sessionData);
    }

    return sessionData.transport.handleRequest(request);
  } catch (err: any) {
    console.error('[MCP] handleRequest error:', err?.stack || err?.message || err);
    return NextResponse.json({ error: err?.message || 'mcp_error' }, { status: 500 });
  }
}

function publicBaseUrl(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const host = forwardedHost || request.headers.get('host') || 'cortex.example.com';
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  return `${proto}://${host}`;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, mcp-session-id',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, mcp-session-id',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function unauthorized(request: NextRequest) {
  const base = publicBaseUrl(request);
  return NextResponse.json(
    { error: 'Unauthorized', error_description: 'OAuth token required' },
    {
      status: 401,
      headers: {
        ...CORS_HEADERS,
        'WWW-Authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
      },
    }
  );
}

export async function POST(request: NextRequest) {
  const scope = auth(request);
  if (!scope) return unauthorized(request);
  return handleMcp(request, scope);
}

export async function DELETE(request: NextRequest) {
  const scope = auth(request);
  if (!scope) return unauthorized(request);
  return handleMcp(request, scope);
}

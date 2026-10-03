import { NextResponse } from 'next/server';

// Public, unauthenticated health/capabilities probe for the Status tab. The main
// /api/mcp (and /api/mcp/web) endpoints require auth and return 401 to
// unauthenticated GETs (so Claude.ai starts OAuth), so a separate health route
// is used for the admin Status panel.
const TOOLS = [
  { name: 'list_notes', description: 'List all notes in the workspace.' },
  { name: 'get_note', description: 'Get the full content of a note by ID or title.' },
  { name: 'search_notes', description: 'Search notes by semantic meaning using AI embeddings.' },
  { name: 'create_note', description: 'Create a new note in the workspace.' },
  { name: 'update_note', description: 'Update the content of an existing note.' },
  { name: 'test_tool', description: 'Test tool' },
];

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    name: 'Cortex MCP Server',
    version: '1.0.0',
    capabilities: { tools: true },
    tools: TOOLS,
  });
}

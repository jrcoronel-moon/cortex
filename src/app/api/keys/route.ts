import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { createApiKey, listApiKeys, deleteApiKey } from '@/lib/mcp';

export async function GET() {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(listApiKeys(session.id));
}

export async function POST(request: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { name, workspaceId, exposedFolders } = await request.json();
  if (!name || !workspaceId) return NextResponse.json({ error: 'Missing name or workspaceId' }, { status: 400 });
  const { record, raw } = createApiKey(session.id, workspaceId, name, exposedFolders || []);
  return NextResponse.json({ ...record, key: raw }, { status: 201 });
}

export async function DELETE(request: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  deleteApiKey(id, session.id);
  return NextResponse.json({ success: true });
}

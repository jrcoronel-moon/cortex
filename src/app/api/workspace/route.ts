import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getWorkspacesForUser, createWorkspace, deleteWorkspace } from '@/lib/workspaces';

export async function GET() {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await getWorkspacesForUser(session.id));
}

export async function POST(request: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { name } = await request.json();
  if (!name?.trim()) return NextResponse.json({ error: 'Missing name' }, { status: 400 });
  try {
    const workspace = await createWorkspace(session.id, name.trim());
    return NextResponse.json(workspace, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  try {
    await deleteWorkspace(id, session.id);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.message === 'forbidden' ? 403 : 500 });
  }
}

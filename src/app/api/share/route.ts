import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import db from '@/lib/db';
import { randomBytes } from 'crypto';
import { canManageNode } from '@/lib/permissions';

// GET /api/share?token=xxx  — public, no auth required
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'missing_token' }, { status: 400 });

  const node = db.prepare(
    'SELECT id, name, content, updated_at as updatedAt FROM nodes WHERE share_token = ? AND type = ?'
  ).get(token, 'file') as any;

  if (!node) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json(node);
}

// POST /api/share  — requires auth, generates or returns token
export async function POST(request: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { nodeId } = await request.json();
  if (!nodeId) return NextResponse.json({ error: 'missing_nodeId' }, { status: 400 });

  const node = db.prepare('SELECT id, type, share_token FROM nodes WHERE id = ?').get(nodeId) as any;
  if (!node) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!canManageNode(session, nodeId)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (node.type !== 'file') return NextResponse.json({ error: 'folders_not_shareable' }, { status: 400 });

  if (node.share_token) {
    return NextResponse.json({ token: node.share_token });
  }

  const token = randomBytes(16).toString('hex');
  db.prepare('UPDATE nodes SET share_token = ? WHERE id = ?').run(token, nodeId);
  return NextResponse.json({ token });
}

// DELETE /api/share?nodeId=xxx  — requires auth, revokes share
export async function DELETE(request: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const nodeId = searchParams.get('nodeId');
  if (!nodeId) return NextResponse.json({ error: 'missing_nodeId' }, { status: 400 });
  if (!canManageNode(session, nodeId)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  db.prepare('UPDATE nodes SET share_token = NULL WHERE id = ?').run(nodeId);
  return NextResponse.json({ success: true });
}

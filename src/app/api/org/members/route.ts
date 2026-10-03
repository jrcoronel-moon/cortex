import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isOrgOwnerOrAdmin, getOrganization } from '@/lib/organizations';

export async function DELETE(request: Request) {
  try {
    const session = getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get('orgId');
    const userId = searchParams.get('userId');
    if (!orgId || !userId) return NextResponse.json({ error: 'Missing params' }, { status: 400 });

    const canManage = await isOrgOwnerOrAdmin(orgId, session.id);
    if (!canManage) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const org = await getOrganization(orgId);
    if (!org) return NextResponse.json({ error: 'Org not found' }, { status: 404 });

    // Cannot remove the owner
    if (org.ownerId === userId) {
      return NextResponse.json({ error: 'Cannot remove the owner' }, { status: 400 });
    }

    db.prepare('DELETE FROM organization_members WHERE org_id = ? AND user_id = ?').run(orgId, userId);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import db from '@/lib/db';
import { getSession } from '@/lib/auth';


function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidDomain(input: string): boolean {
  return /^@?[^\s@]+\.[^\s@]+$/.test(input);
}

function normalizeInput(input: string): { value: string; type: 'email' | 'domain' } {
  if (input.startsWith('@')) {
    return { value: input, type: 'domain' };
  }
  if (isValidEmail(input)) {
    return { value: input, type: 'email' };
  }
  if (isValidDomain(input)) {
    return { value: '@' + input, type: 'domain' };
  }
  throw new Error('Invalid email or domain format');
}

/**
 * Whether `session` may manage shares for `folder`.
 * - Superadmin: always.
 * - Workspace folders: the workspace owner.
 * - Group/domain folders (group_id set, e.g. the domain knowledge base): the
 *   legacy user_groups 'edit' grant OR — the case that actually matters now —
 *   an owner/admin of the Organization whose domain matches the group. The
 *   user_groups table is never populated by the app, so org ownership is the
 *   real permission path for domain folders.
 */
function canManageFolder(session: any, folder: any): boolean {
  if (session.role === 'admin') return true;

  if (folder.workspace_id) {
    const workspace = db.prepare('SELECT owner_id FROM workspaces WHERE id = ?').get(folder.workspace_id) as any;
    if (workspace && workspace.owner_id === session.id) return true;
  }

  if (folder.group_id) {
    const userInGroup = db.prepare('SELECT access_level FROM user_groups WHERE user_id = ? AND group_id = ?').get(session.id, folder.group_id) as any;
    if (userInGroup && userInGroup.access_level === 'edit') return true;

    // Org owner/admin of the group's domain can manage its folders.
    const group = db.prepare('SELECT name FROM groups WHERE id = ?').get(folder.group_id) as { name: string } | undefined;
    if (group) {
      const org = db.prepare('SELECT id FROM organizations WHERE LOWER(domain) = LOWER(?)').get(group.name) as { id: string } | undefined;
      if (org) {
        const member = db.prepare(
          "SELECT 1 FROM organization_members WHERE org_id = ? AND user_id = ? AND role IN ('owner','admin')"
        ).get(org.id, session.id);
        if (member) return true;
      }
    }
  }

  return false;
}

export async function POST(request: Request) {
  try {
    const session = getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { folderId, sharedWith, accessLevel } = await request.json();

    if (!folderId || !sharedWith || !accessLevel) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Verify folder exists and user has edit access
    const folder = db.prepare('SELECT id, workspace_id, group_id FROM nodes WHERE id = ? AND type = ?').get(folderId, 'folder') as any;
    if (!folder) {
      return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
    }

    // Check if user owns the workspace or has edit access
    const hasAccess = canManageFolder(session, folder);

    if (!hasAccess) {
      return NextResponse.json({ error: 'No permission to share this folder' }, { status: 403 });
    }

    // Normalize and validate input
    const normalized = normalizeInput(sharedWith);

    if (!['view', 'edit'].includes(accessLevel)) {
      return NextResponse.json({ error: 'Invalid access level' }, { status: 400 });
    }

    // Check if share already exists
    const existing = db.prepare(`
      SELECT id FROM folder_shares
      WHERE folder_id = ? AND shared_with = ?
    `).get(folderId, normalized.value) as any;

    if (existing) {
      // Update access level
      db.prepare('UPDATE folder_shares SET access_level = ? WHERE id = ?').run(accessLevel, existing.id);
      return NextResponse.json({
        id: existing.id,
        folderId,
        sharedWith: normalized.value,
        shareType: normalized.type,
        accessLevel,
      });
    }

    // Create new share
    const shareId = randomUUID();
    db.prepare(`
      INSERT INTO folder_shares (id, folder_id, shared_by, shared_with, share_type, access_level)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(shareId, folderId, session.id, normalized.value, normalized.type, accessLevel);

    return NextResponse.json({
      id: shareId,
      folderId,
      sharedWith: normalized.value,
      shareType: normalized.type,
      accessLevel,
    }, { status: 201 });
  } catch (err: any) {
    console.error('Share POST error:', err);
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function GET(request: Request) {
  try {
    const session = getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const folderId = searchParams.get('folderId');
    const mine = searchParams.get('mine');

    // Return all shares created by current user, grouped by folder
    if (mine === 'true') {
      const shares = db.prepare(`
        SELECT fs.id, fs.folder_id, fs.shared_with, fs.share_type, fs.access_level, fs.created_at,
               n.name as folder_name
        FROM folder_shares fs
        JOIN nodes n ON fs.folder_id = n.id
        WHERE fs.shared_by = ?
        ORDER BY n.name ASC, fs.created_at DESC
      `).all(session.id) as any[];
      return NextResponse.json(shares);
    }

    if (!folderId) {
      return NextResponse.json({ error: 'Missing folderId' }, { status: 400 });
    }

    // Verify user has access to folder
    const folder = db.prepare('SELECT id, workspace_id, group_id FROM nodes WHERE id = ?').get(folderId) as any;
    if (!folder) {
      return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
    }

    const hasAccess = canManageFolder(session, folder);

    if (!hasAccess) {
      return NextResponse.json({ error: 'No permission to view shares' }, { status: 403 });
    }

    const shares = db.prepare(`
      SELECT id, shared_with, share_type, access_level, created_at
      FROM folder_shares
      WHERE folder_id = ?
      ORDER BY created_at DESC
    `).all(folderId) as any[];

    return NextResponse.json(shares);
  } catch (err: any) {
    console.error('Share GET error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const shareId = searchParams.get('shareId');

    if (!shareId) {
      return NextResponse.json({ error: 'Missing shareId' }, { status: 400 });
    }

    // Get the share and verify user has access to the folder
    const share = db.prepare('SELECT folder_id FROM folder_shares WHERE id = ?').get(shareId) as any;
    if (!share) {
      return NextResponse.json({ error: 'Share not found' }, { status: 404 });
    }

    const folder = db.prepare('SELECT id, workspace_id, group_id FROM nodes WHERE id = ?').get(share.folder_id) as any;
    if (!folder) {
      return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
    }

    const hasAccess = canManageFolder(session, folder);

    if (!hasAccess) {
      return NextResponse.json({ error: 'No permission to revoke shares' }, { status: 403 });
    }

    db.prepare('DELETE FROM folder_shares WHERE id = ?').run(shareId);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Share DELETE error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

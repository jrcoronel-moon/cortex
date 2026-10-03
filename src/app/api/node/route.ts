import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import db from '@/lib/db';
import { getSession } from '@/lib/auth';
import { canManageNode, canReadNode, canAccessWorkspace } from '@/lib/permissions';

export async function GET(request: Request) {
  try {
    const session = getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const workspaceId = searchParams.get('workspaceId');

    // Single-node content fetch — used by the lazy loader on the client.
    if (id) {
      if (!canReadNode(session, id)) {
        // Don't distinguish "forbidden" from "missing" — avoid leaking node existence.
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      const node = db.prepare(
        'SELECT id, name, type, parent_id as parentId, content, group_id as groupId, workspace_id as workspaceId, updated_at as updatedAt FROM nodes WHERE id = ?'
      ).get(id);
      if (!node) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json(node);
    }

    if (!workspaceId) return NextResponse.json({ error: 'Missing workspaceId' }, { status: 400 });

    let nodes: any[] = [];

    // Workspace root folders — only if the user can actually access this workspace.
    if (canAccessWorkspace(session, workspaceId)) {
      nodes = db.prepare(
        'SELECT id, name, type, parent_id as parentId FROM nodes WHERE workspace_id = ? AND type = ? AND parent_id IS NULL ORDER BY name ASC'
      ).all(workspaceId, 'folder') as any[];
    }

    // If no accessible workspace nodes, fall back to group_spaces from the user's own groups.
    if (nodes.length === 0) {
      const userGroups = db.prepare('SELECT group_id FROM user_groups WHERE user_id = ?').all(session.id) as { group_id: string }[];

      if (userGroups.length > 0) {
        const groupIds = userGroups.map(g => g.group_id);
        const placeholders = groupIds.map(() => '?').join(',');
        nodes = db.prepare(`
          SELECT n.id, n.name, n.type, n.parent_id as parentId
          FROM nodes n
          WHERE n.type = 'folder' AND n.parent_id IS NULL AND n.id IN (
            SELECT space_id FROM group_spaces WHERE group_id IN (${placeholders})
          )
          ORDER BY n.name ASC
        `).all(...groupIds) as any[];
      }
    }

    return NextResponse.json(nodes);
  } catch (err: any) {
    console.error('Get Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { name, parentId, groupId, content, type, workspaceId: reqWorkspaceId } = await request.json();
    if (!name || !type) return NextResponse.json({ error: 'Missing name or type' }, { status: 400 });

    // Admin/editor can always create; regular users need workspace ownership
    if (session.role !== 'admin' && session.role !== 'editor') {
      const wsId = reqWorkspaceId;
      if (!wsId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      const ownsWorkspace = db.prepare('SELECT id FROM workspaces WHERE id = ? AND owner_id = ?').get(wsId, session.id);
      const memberAccess = db.prepare("SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ? AND role IN ('editor','owner')").get(wsId, session.id);
      if (!ownsWorkspace && !memberAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Use provided workspaceId, or fall back to user's first owned workspace
    let workspaceId: string | null = reqWorkspaceId ?? null;
    if (!workspaceId) {
      const workspace = db.prepare('SELECT id FROM workspaces WHERE owner_id = ? LIMIT 1').get(session.id) as { id: string } | undefined;
      workspaceId = workspace?.id ?? null;
    }

    const id = randomUUID();
    const finalName = type === 'file' && !name.endsWith('.md') ? `${name}.md` : name;
    const initialContent = content ?? (type === 'file' ? `---\ntitle: ${name}\n---\n\n` : null);

    db.prepare(
      'INSERT INTO nodes (id, name, type, parent_id, content, group_id, workspace_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, finalName, type, parentId || null, initialContent, groupId || null, workspaceId);

    const node = db.prepare(
      'SELECT id, name, type, parent_id as parentId, content, group_id as groupId, workspace_id as workspaceId, updated_at as updatedAt FROM nodes WHERE id = ?'
    ).get(id);

    return NextResponse.json(node, { status: 201 });
  } catch (err: any) {
    console.error('Create Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id, content, name, parentId, reorder } = await request.json();
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    // Admin/editor can always edit; regular users need workspace ownership
    if (session.role !== 'admin' && session.role !== 'editor') {
      const node = db.prepare('SELECT workspace_id FROM nodes WHERE id = ?').get(id) as { workspace_id: string } | undefined;
      if (!node) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      const ownsWorkspace = node.workspace_id && db.prepare('SELECT id FROM workspaces WHERE id = ? AND owner_id = ?').get(node.workspace_id, session.id);
      const memberAccess = node.workspace_id && db.prepare("SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ? AND role IN ('editor','owner')").get(node.workspace_id, session.id);
      if (!ownsWorkspace && !memberAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Reorder operation — drop a node before/after a sibling (drag & drop).
    // Adopts the target's parent (so it doubles as move+position) and
    // renumbers all siblings 0..n in one transaction, so ordering is stable.
    if (reorder?.targetId && (reorder.position === 'before' || reorder.position === 'after')) {
      if (reorder.targetId === id) return NextResponse.json({ success: true });
      const dragged = db.prepare('SELECT id, type FROM nodes WHERE id = ?').get(id) as { id: string; type: string } | undefined;
      const target = db.prepare('SELECT id, parent_id FROM nodes WHERE id = ?').get(reorder.targetId) as { id: string; parent_id: string | null } | undefined;
      if (!dragged || !target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

      // Prevent moving a folder into its own subtree (target lives inside it).
      if (dragged.type === 'folder' && target.parent_id) {
        const cycle = db.prepare(`
          WITH RECURSIVE descendants(id) AS (
            SELECT id FROM nodes WHERE id = ?
            UNION ALL
            SELECT n.id FROM nodes n JOIN descendants d ON n.parent_id = d.id
          )
          SELECT 1 FROM descendants WHERE id = ? LIMIT 1
        `).get(id, target.parent_id);
        if (cycle) return NextResponse.json({ error: 'cycle' }, { status: 400 });
      }

      const siblings = db.prepare(
        'SELECT id, name, sort_order as sortOrder FROM nodes WHERE ' +
        (target.parent_id === null ? 'parent_id IS NULL' : 'parent_id = ?') +
        ' AND id != ?'
      ).all(...(target.parent_id === null ? [id] : [target.parent_id, id])) as { id: string; name: string; sortOrder: number | null }[];

      // Current visual order: manual sort first, then natural name order.
      siblings.sort((a, b) => {
        const ao = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
        const bo = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      });

      const at = siblings.findIndex(s => s.id === reorder.targetId);
      if (at === -1) return NextResponse.json({ error: 'invalid_target' }, { status: 400 });
      const ordered = siblings.map(s => s.id);
      ordered.splice(reorder.position === 'before' ? at : at + 1, 0, id);

      const apply = db.transaction(() => {
        db.prepare('UPDATE nodes SET parent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(target.parent_id, id);
        const upd = db.prepare('UPDATE nodes SET sort_order = ? WHERE id = ?');
        ordered.forEach((nid, idx) => upd.run(idx, nid));
      });
      apply();

      return NextResponse.json({
        success: true,
        parentId: target.parent_id,
        order: ordered.map((nid, idx) => ({ id: nid, sortOrder: idx })),
      });
    }

    // Move operation — reparent a node (drag & drop). parentId === null moves to root.
    if (parentId !== undefined) {
      const node = db.prepare('SELECT type FROM nodes WHERE id = ?').get(id) as { type: string } | undefined;
      if (!node) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      if (parentId !== null) {
        const target = db.prepare("SELECT type FROM nodes WHERE id = ?").get(parentId) as { type: string } | undefined;
        if (!target || target.type !== 'folder') {
          return NextResponse.json({ error: 'invalid_target' }, { status: 400 });
        }
        // Prevent moving a folder into itself or one of its descendants (cycle).
        if (node.type === 'folder') {
          const cycle = db.prepare(`
            WITH RECURSIVE descendants(id) AS (
              SELECT id FROM nodes WHERE id = ?
              UNION ALL
              SELECT n.id FROM nodes n JOIN descendants d ON n.parent_id = d.id
            )
            SELECT 1 FROM descendants WHERE id = ? LIMIT 1
          `).get(id, parentId);
          if (cycle) return NextResponse.json({ error: 'cycle' }, { status: 400 });
        }
      }
      db.prepare('UPDATE nodes SET parent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(parentId, id);
      return NextResponse.json({ success: true });
    }

    // Rename operation
    if (name !== undefined) {
      const node = db.prepare('SELECT type FROM nodes WHERE id = ?').get(id) as { type: string } | undefined;
      if (!node) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      const finalName = node.type === 'file' && !name.endsWith('.md') ? `${name}.md` : name;
      db.prepare('UPDATE nodes SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(finalName, id);
      return NextResponse.json({ success: true, name: finalName });
    }

    if (content === undefined) return NextResponse.json({ error: 'Missing content' }, { status: 400 });

    db.prepare('UPDATE nodes SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(content, id);

    // Generate embedding async — don't await so save response is instant.
    // Lazy import: keeps @xenova/transformers (native onnx) out of the route's
    // build-time module graph (breaks `next build` page-data collection otherwise).
    import('@/lib/embeddings').then(m => m.upsertEmbedding(id, content)).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Save Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) return NextResponse.json({ error: 'Missing ID' }, { status: 400 });

    // Validate access. canManageNode covers every edit path: superadmin/editor,
    // workspace owner/editor-member, org owner/admin of the node's domain KB, and
    // folder_shares 'edit' grants (resolving nested nodes to their root folder).
    const node = db.prepare('SELECT id FROM nodes WHERE id = ?').get(id) as { id: string } | undefined;
    if (!node) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canManageNode(session, id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Execute recursive deletion using CTE
    const query = `
      WITH RECURSIVE descendants(id) AS (
        SELECT id FROM nodes WHERE id = ?
        UNION ALL
        SELECT n.id FROM nodes n
        JOIN descendants d ON n.parent_id = d.id
      )
      DELETE FROM nodes WHERE id IN descendants;
    `;

    db.prepare(query).run(id);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Delete Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

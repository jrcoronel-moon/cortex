import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getSession } from '@/lib/auth';
import { randomUUID } from 'crypto';

interface UploadFilePayload {
  path: string;
  content: string;
}

export async function POST(request: Request) {
  try {
    const session = getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { groupId, workspaceId: reqWorkspaceId, files } = await request.json() as { groupId: string | null, workspaceId?: string | null, files: UploadFilePayload[] };

    if (!files || !Array.isArray(files)) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    // Resolve the workspace_id: prefer the explicit one from the client, fall
    // back to the user's first owned workspace so uploads always end up in a
    // workspace the user can actually see.
    let workspaceId: string | null = reqWorkspaceId ?? null;
    if (!workspaceId) {
      const ws = db.prepare('SELECT id FROM workspaces WHERE owner_id = ? LIMIT 1').get(session.id) as { id: string } | undefined;
      workspaceId = ws?.id ?? null;
    }

    const insertedIds: string[] = [];

    // Reuse an existing folder with the same name under the same parent/workspace
    // instead of creating a duplicate. This is what lets large uploads be split
    // into many sequential batches: folders created in an earlier batch are found
    // and reused by later ones, so the tree stitches together correctly.
    const findFolder = db.prepare(
      "SELECT id FROM nodes WHERE name = ? AND type = 'folder' AND parent_id IS ? AND workspace_id IS ?"
    );
    const insertFolder = db.prepare(
      "INSERT INTO nodes (id, name, type, parent_id, group_id, workspace_id) VALUES (?, ?, 'folder', ?, ?, ?)"
    );
    const insertFile = db.prepare(
      "INSERT INTO nodes (id, name, type, parent_id, content, group_id, workspace_id) VALUES (?, ?, 'file', ?, ?, ?, ?)"
    );

    const tx = db.transaction(() => {
      const pathMap = new Map<string, string>();

      for (const file of files) {
        const parts = file.path.split('/').filter(Boolean);
        let currentParentId: string | null = null;
        let cumulativePath = '';

        for (let i = 0; i < parts.length; i++) {
          const partName = parts[i];
          const isFile = i === parts.length - 1;
          cumulativePath = cumulativePath ? `${cumulativePath}/${partName}` : partName;

          if (isFile) {
            const newId = randomUUID();
            insertedIds.push(newId);
            insertFile.run(newId, partName, currentParentId, file.content, groupId, workspaceId);
            continue;
          }

          // Folder: reuse if seen earlier in this batch, then if it already
          // exists in the DB (a previous batch), otherwise create it.
          if (pathMap.has(cumulativePath)) {
            currentParentId = pathMap.get(cumulativePath)!;
            continue;
          }

          const existing = findFolder.get(partName, currentParentId, workspaceId) as { id: string } | undefined;
          let folderId: string;
          if (existing) {
            folderId = existing.id;
          } else {
            folderId = randomUUID();
            insertedIds.push(folderId);
            insertFolder.run(folderId, partName, currentParentId, groupId, workspaceId);
          }
          pathMap.set(cumulativePath, folderId);
          currentParentId = folderId;
        }
      }
    });

    tx();

    // Return inserted nodes so client can update state without a full reload
    const inserted = insertedIds.length
      ? db.prepare(
          `SELECT id, name, type, parent_id as parentId, content, group_id as groupId, workspace_id as workspaceId, updated_at as updatedAt FROM nodes WHERE id IN (${insertedIds.map(() => '?').join(',')})`
        ).all(...insertedIds)
      : [];

    return NextResponse.json({ success: true, nodes: inserted });
  } catch (err: any) {
    console.error('Upload Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

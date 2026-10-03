"use server";

import db from './db';
import { getSession } from './auth';
import { canReadNode, canManageNode } from './permissions';
import { getReadableNodes, type AccessNode } from './access';

export type NodeType = 'folder' | 'file';

export type DriveNode = AccessNode;

/**
 * Nodes the current session may read. Thin wrapper over `getReadableNodes`
 * (lib/access.ts), which holds the shared user-scoped access logic.
 */
export async function getFiles(): Promise<DriveNode[]> {
  const session = getSession();
  if (!session) return [];
  return getReadableNodes(session);
}

export async function saveFileContent(id: string, newContent: string) {
  const session = getSession();
  if (!session) throw new Error("Unauthorized");
  if (!canManageNode(session, id)) throw new Error("Forbidden");

  db.prepare('UPDATE nodes SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newContent, id);
}

/** Fetch content for a single node. Used to lazy-load after the tree renders. */
export async function getNodeContent(id: string): Promise<string | null> {
  const session = getSession();
  if (!session) return null;
  if (!canReadNode(session, id)) return null;
  const row = db.prepare('SELECT content FROM nodes WHERE id = ?').get(id) as { content: string | null } | undefined;
  return row?.content ?? null;
}

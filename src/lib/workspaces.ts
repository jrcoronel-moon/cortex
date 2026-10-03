"use server";

import { randomUUID } from 'crypto';
import db from './db';

export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  role?: string;
}

export async function getWorkspacesForUser(userId: string): Promise<Workspace[]> {
  return db.prepare(`
    SELECT w.id, w.name, w.owner_id as ownerId, w.created_at as createdAt,
           COALESCE(wm.role, 'owner') as role
    FROM workspaces w
    LEFT JOIN workspace_members wm ON w.id = wm.workspace_id AND wm.user_id = ?
    WHERE w.owner_id = ? OR wm.user_id = ?
    ORDER BY w.created_at ASC
  `).all(userId, userId, userId) as Workspace[];
}

export async function createWorkspace(userId: string, name: string): Promise<Workspace> {
  const id = randomUUID();
  db.prepare('INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)').run(id, name, userId);
  return db.prepare(
    'SELECT id, name, owner_id as ownerId, created_at as createdAt FROM workspaces WHERE id = ?'
  ).get(id) as Workspace;
}

export async function deleteWorkspace(workspaceId: string, userId: string): Promise<void> {
  const ws = db.prepare('SELECT owner_id FROM workspaces WHERE id = ?').get(workspaceId) as any;
  if (!ws || ws.owner_id !== userId) throw new Error('forbidden');
  db.transaction(() => {
    db.prepare('DELETE FROM workspace_members WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM api_keys WHERE workspace_id = ?').run(workspaceId);
    db.prepare('UPDATE nodes SET workspace_id = NULL WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);
  })();
}

export async function ensureDefaultWorkspace(userId: string, name = 'Mi Workspace'): Promise<Workspace> {
  const existing = await getWorkspacesForUser(userId);
  if (existing.length > 0) return existing[0];
  return createWorkspace(userId, name);
}

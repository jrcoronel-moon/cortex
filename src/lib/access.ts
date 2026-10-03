import db from './db';

// Shared, user-scoped read-access logic. This is the single source of truth for
// "which nodes can this user read", used by both the app tree loader
// (lib/drive.ts `getFiles`) and the MCP server (lib/mcp.ts). It lives outside
// the "use server" module so it can be a plain sync function reusable anywhere.

export interface AccessUser {
  id: string;
  email: string;
  role: string;
}

export interface AccessNode {
  id: string;
  name: string;
  type: 'folder' | 'file';
  parentId: string | null;
  content: string | null;
  groupId: string | null;
  workspaceId: string | null;
  updatedAt: string;
  sortOrder?: number | null;
  isShared?: boolean;
}

// Tree columns: skip `content` so the initial load stays small. Content is
// fetched lazily per node.
const NODE_COLS =
  "id, name, type, parent_id as parentId, NULL as content, group_id as groupId, workspace_id as workspaceId, updated_at as updatedAt, sort_order as sortOrder";

/**
 * All nodes `user` may read, across every access path: owned/member workspaces,
 * the domain knowledge base (group_spaces of the group named after their email
 * domain), folders shared with their email or domain, and the welcome file.
 * Admins see everything. Deduped by id.
 */
export function getReadableNodes(user: AccessUser, adminSeesAll = true): AccessNode[] {
  // The platform admin sees every node in the app UI. For external principals
  // (MCP connectors) we pass adminSeesAll=false so even an admin is scoped to
  // their OWN spaces — an agent must not read every tenant's notes.
  if (adminSeesAll && user.role === 'admin') {
    return db.prepare(`SELECT ${NODE_COLS} FROM nodes`).all() as AccessNode[];
  }

  // Owned + member workspaces (whole subtree).
  const workspaceNodes = db.prepare(`
    WITH RECURSIVE
      workspace_nodes(id) AS (
        SELECT id FROM nodes WHERE workspace_id IN (
          SELECT id FROM workspaces WHERE owner_id = ?
          UNION
          SELECT workspace_id FROM workspace_members WHERE user_id = ?
        )
        UNION ALL
        SELECT n.id FROM nodes n
        JOIN workspace_nodes w ON n.parent_id = w.id
      )
    SELECT ${NODE_COLS} FROM nodes
    WHERE id IN workspace_nodes
  `).all(user.id, user.id) as AccessNode[];

  let allNodes: AccessNode[] = [...workspaceNodes];

  // Domain knowledge base (group whose name === the user's email domain).
  const domain = user.email.split('@')[1];
  const group = db.prepare('SELECT id FROM groups WHERE name = ?').get(domain) as { id: string } | undefined;

  if (group) {
    const groupNodes = db.prepare(`
      WITH RECURSIVE
        accessible_nodes(id) AS (
          SELECT space_id FROM group_spaces WHERE group_id = ?
          UNION ALL
          SELECT n.id FROM nodes n
          JOIN accessible_nodes a ON n.parent_id = a.id
        )
      SELECT ${NODE_COLS} FROM nodes
      WHERE id IN accessible_nodes OR id IN ('home-folder', 'welcome-file', 'welcome-file-es', 'format-demo-file')
    `).all(group.id) as AccessNode[];
    allNodes = [...allNodes, ...groupNodes];
  }

  // Folders shared with this user (by email or domain), whole subtree.
  const userDomain = '@' + domain;
  const sharedFolderIds = db.prepare(`
    SELECT DISTINCT folder_id FROM folder_shares
    WHERE shared_with = ? OR shared_with = ?
  `).all(user.email, userDomain) as { folder_id: string }[];

  for (const { folder_id } of sharedFolderIds) {
    const sharedNodes = db.prepare(`
      WITH RECURSIVE
        shared_nodes(id) AS (
          SELECT ? as id
          UNION ALL
          SELECT n.id FROM nodes n
          JOIN shared_nodes s ON n.parent_id = s.id
        )
      SELECT ${NODE_COLS} FROM nodes
      WHERE id IN shared_nodes
    `).all(folder_id) as AccessNode[];

    for (const node of sharedNodes) {
      if (node.parentId === null) node.isShared = true;
    }
    allNodes = [...allNodes, ...sharedNodes];
  }

  // Welcome file for users without a domain group.
  if (!group) {
    const welcomeFile = db.prepare(`SELECT ${NODE_COLS} FROM nodes WHERE id IN ('home-folder', 'welcome-file', 'welcome-file-es', 'format-demo-file')`).all() as AccessNode[];
    allNodes = [...allNodes, ...welcomeFile];
  }

  const seen = new Set<string>();
  return allNodes.filter(n => (seen.has(n.id) ? false : (seen.add(n.id), true)));
}

/**
 * Set of file-node ids `user` can read. Used to scope MCP tools for OAuth clients.
 * Pass adminSeesAll=false (the MCP default) so an admin principal is limited to
 * their own spaces rather than every tenant's notes.
 */
export function readableFileIds(user: AccessUser, adminSeesAll = false): Set<string> {
  return new Set(getReadableNodes(user, adminSeesAll).filter(n => n.type === 'file').map(n => n.id));
}

/** Set of file-node ids in a workspace. Used to scope MCP tools for API-key clients. */
export function workspaceFileIds(workspaceId: string): Set<string> {
  const rows = db.prepare("SELECT id FROM nodes WHERE type = 'file' AND workspace_id = ?").all(workspaceId) as { id: string }[];
  return new Set(rows.map(r => r.id));
}

export interface Space { id: string; name: string; parentId: string | null }

/** Folders/spaces `user` can access. Mirrors readableFileIds' scoping (admin off by default for MCP). */
export function readableSpaces(user: AccessUser, adminSeesAll = false): Space[] {
  return getReadableNodes(user, adminSeesAll)
    .filter(n => n.type === 'folder')
    .map(n => ({ id: n.id, name: n.name, parentId: n.parentId }));
}

/** Folders/spaces in a workspace. Used for API-key (Claude Code) clients. */
export function workspaceSpaces(workspaceId: string): Space[] {
  return db.prepare("SELECT id, name, parent_id as parentId FROM nodes WHERE type = 'folder' AND workspace_id = ?")
    .all(workspaceId) as Space[];
}

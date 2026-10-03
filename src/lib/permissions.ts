import db from './db';

/**
 * Whether `session` may *manage* (edit/delete) the node `nodeId` and its subtree.
 *
 * This mirrors how a node becomes editable across the app's overlapping access
 * models. A user can manage a node when ANY of these holds:
 *   1. Platform superadmin / editor (handled by the caller, but also short-circuited here).
 *   2. Workspace ownership or editor/owner membership of the node's workspace.
 *   3. Domain knowledge base: owner/admin of the Organization whose domain matches
 *      the node's group — via the node's own group_id (legacy) or via group_spaces
 *      attached to the root ancestor. Also honors the legacy user_groups 'edit' grant.
 *   4. A folder_shares grant with access_level='edit' to the user's email or domain,
 *      attached to the root ancestor of the node.
 *
 * Sharing/group links attach to the ROOT folder, so for nested nodes we resolve
 * the top-most ancestor before checking group_spaces / folder_shares.
 */
export function canManageNode(session: { id: string; email: string; role: string }, nodeId: string): boolean {
  if (session.role === 'admin' || session.role === 'editor') return true;

  const node = db.prepare('SELECT workspace_id, group_id, parent_id FROM nodes WHERE id = ?')
    .get(nodeId) as { workspace_id: string | null; group_id: string | null; parent_id: string | null } | undefined;
  if (!node) return false;

  // 2. Workspace ownership / editor membership.
  if (node.workspace_id) {
    const owns = db.prepare('SELECT 1 FROM workspaces WHERE id = ? AND owner_id = ?').get(node.workspace_id, session.id);
    if (owns) return true;
    const member = db.prepare(
      "SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ? AND role IN ('editor','owner')"
    ).get(node.workspace_id, session.id);
    if (member) return true;
  }

  // Resolve the root ancestor — shares and group links attach to root folders.
  let rootId = nodeId;
  let parentId = node.parent_id;
  const seen = new Set<string>([nodeId]);
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    rootId = parentId;
    const parent = db.prepare('SELECT parent_id FROM nodes WHERE id = ?')
      .get(parentId) as { parent_id: string | null } | undefined;
    if (!parent) break;
    parentId = parent.parent_id;
  }

  // 3. Domain knowledge base — collect candidate group ids (node's own + group_spaces on root).
  const groupIds = new Set<string>();
  if (node.group_id) groupIds.add(node.group_id);
  for (const g of db.prepare('SELECT group_id FROM group_spaces WHERE space_id = ?').all(rootId) as { group_id: string }[]) {
    groupIds.add(g.group_id);
  }
  for (const gid of Array.from(groupIds)) {
    const legacy = db.prepare('SELECT access_level FROM user_groups WHERE user_id = ? AND group_id = ?')
      .get(session.id, gid) as { access_level: string } | undefined;
    if (legacy?.access_level === 'edit') return true;

    const group = db.prepare('SELECT name FROM groups WHERE id = ?').get(gid) as { name: string } | undefined;
    if (group) {
      const org = db.prepare('SELECT id FROM organizations WHERE LOWER(domain) = LOWER(?)').get(group.name) as { id: string } | undefined;
      if (org) {
        const m = db.prepare(
          "SELECT 1 FROM organization_members WHERE org_id = ? AND user_id = ? AND role IN ('owner','admin')"
        ).get(org.id, session.id);
        if (m) return true;
      }
    }
  }

  // 4. folder_shares with edit access to this user's email or domain, on the root folder.
  const domain = '@' + (session.email.split('@')[1] ?? '');
  const share = db.prepare(`
    SELECT 1 FROM folder_shares
    WHERE folder_id = ? AND access_level = 'edit'
      AND (LOWER(shared_with) = LOWER(?) OR LOWER(shared_with) = LOWER(?))
    LIMIT 1
  `).get(rootId, session.email, domain);
  if (share) return true;

  return false;
}

/**
 * Whether `session` may *read* the node `nodeId`.
 *
 * Read access is the same set of paths as the tree loader in `getFiles()` —
 * any path that would surface the node in a user's tree also lets them read it.
 * It is intentionally broader than `canManageNode`: it accepts ANY workspace
 * membership role (not just editor/owner), ANY `user_groups` access level, and
 * `folder_shares` of any access level (view OR edit). Keep this in sync with
 * `getFiles()` in lib/drive.ts.
 */
export function canReadNode(session: { id: string; email: string; role: string }, nodeId: string): boolean {
  if (session.role === 'admin' || session.role === 'editor') return true;
  // The welcome/demo files are seeded for every user and surfaced by getFiles().
  if (nodeId === 'home-folder' || nodeId === 'welcome-file' || nodeId === 'welcome-file-es' || nodeId === 'format-demo-file') return true;

  const node = db.prepare('SELECT workspace_id, group_id, parent_id FROM nodes WHERE id = ?')
    .get(nodeId) as { workspace_id: string | null; group_id: string | null; parent_id: string | null } | undefined;
  if (!node) return false;

  // 1. Workspace ownership or membership of ANY role.
  if (node.workspace_id) {
    const owns = db.prepare('SELECT 1 FROM workspaces WHERE id = ? AND owner_id = ?').get(node.workspace_id, session.id);
    if (owns) return true;
    const member = db.prepare('SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
      .get(node.workspace_id, session.id);
    if (member) return true;
  }

  // Resolve the root ancestor — shares and group links attach to root folders.
  let rootId = nodeId;
  let parentId = node.parent_id;
  const seen = new Set<string>([nodeId]);
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    rootId = parentId;
    const parent = db.prepare('SELECT parent_id FROM nodes WHERE id = ?')
      .get(parentId) as { parent_id: string | null } | undefined;
    if (!parent) break;
    parentId = parent.parent_id;
  }

  // 2. Domain knowledge base — node's own group_id + group_spaces on the root.
  const groupIds = new Set<string>();
  if (node.group_id) groupIds.add(node.group_id);
  for (const g of db.prepare('SELECT group_id FROM group_spaces WHERE space_id = ?').all(rootId) as { group_id: string }[]) {
    groupIds.add(g.group_id);
  }
  // The user's domain group (getFiles surfaces a group whose name === the user's domain).
  const domainName = session.email.split('@')[1] ?? '';
  const domainGroup = db.prepare('SELECT id FROM groups WHERE name = ?').get(domainName) as { id: string } | undefined;
  for (const gid of Array.from(groupIds)) {
    if (domainGroup && gid === domainGroup.id) return true;
    const legacy = db.prepare('SELECT 1 FROM user_groups WHERE user_id = ? AND group_id = ?').get(session.id, gid);
    if (legacy) return true;
    const group = db.prepare('SELECT name FROM groups WHERE id = ?').get(gid) as { name: string } | undefined;
    if (group) {
      const org = db.prepare('SELECT id FROM organizations WHERE LOWER(domain) = LOWER(?)').get(group.name) as { id: string } | undefined;
      if (org) {
        const m = db.prepare('SELECT 1 FROM organization_members WHERE org_id = ? AND user_id = ?').get(org.id, session.id);
        if (m) return true;
      }
    }
  }

  // 3. folder_shares of ANY access level to this user's email or domain, on the root folder.
  const domain = '@' + domainName;
  const share = db.prepare(`
    SELECT 1 FROM folder_shares
    WHERE folder_id = ?
      AND (LOWER(shared_with) = LOWER(?) OR LOWER(shared_with) = LOWER(?))
    LIMIT 1
  `).get(rootId, session.email, domain);
  if (share) return true;

  return false;
}

/** Whether `session` may read the contents of workspace `workspaceId` (owner or member of any role). */
export function canAccessWorkspace(session: { id: string; role: string }, workspaceId: string): boolean {
  if (session.role === 'admin' || session.role === 'editor') return true;
  const owns = db.prepare('SELECT 1 FROM workspaces WHERE id = ? AND owner_id = ?').get(workspaceId, session.id);
  if (owns) return true;
  const member = db.prepare('SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?').get(workspaceId, session.id);
  return !!member;
}

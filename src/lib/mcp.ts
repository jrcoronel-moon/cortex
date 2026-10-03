import { randomUUID, createHash } from 'crypto';
import db from './db';

// ── API Keys ──────────────────────────────────────────────────────────────────

export function hashKey(raw: string) {
  return createHash('sha256').update(raw).digest('hex');
}

export function generateApiKey() {
  const raw = `dks_live_${randomUUID().replace(/-/g, '')}`;
  return { raw, hash: hashKey(raw) };
}

export interface ApiKeyRecord {
  id: string; name: string; workspaceId: string;
  createdAt: string; lastUsedAt: string | null;
}

export function createApiKey(userId: string, workspaceId: string, name: string, exposedFolders: string[] = []) {
  const id = randomUUID();
  const { raw, hash } = generateApiKey();
  db.prepare('INSERT INTO api_keys (id, user_id, workspace_id, key_hash, name, exposed_folders) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    userId,
    workspaceId,
    hash,
    name,
    JSON.stringify(exposedFolders)
  );
  const record = db.prepare('SELECT id, name, workspace_id as workspaceId, created_at as createdAt, last_used_at as lastUsedAt, exposed_folders as exposedFolders FROM api_keys WHERE id = ?').get(id) as any;
  return { record: { ...record, exposedFolders: JSON.parse(record.exposedFolders || '[]') }, raw };
}

export function listApiKeys(userId: string): (ApiKeyRecord & { exposedFolders?: string[] })[] {
  const rows = db.prepare('SELECT id, name, workspace_id as workspaceId, created_at as createdAt, last_used_at as lastUsedAt, exposed_folders as exposedFolders FROM api_keys WHERE user_id = ?').all(userId) as any[];
  return rows.map(r => ({ ...r, exposedFolders: JSON.parse(r.exposedFolders || '[]') }));
}

export function deleteApiKey(keyId: string, userId: string) {
  db.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?').run(keyId, userId);
}

export function validateApiKey(raw: string) {
  const hash = hashKey(raw);
  const key = db.prepare('SELECT user_id, workspace_id, exposed_folders FROM api_keys WHERE key_hash = ?').get(hash) as any;
  if (!key) return null;
  db.prepare('UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE key_hash = ?').run(hash);
  return {
    userId: key.user_id,
    workspaceId: key.workspace_id,
    exposedFolders: JSON.parse(key.exposed_folders || '[]'),
  };
}

// ── MCP Tool Handlers ─────────────────────────────────────────────────────────

/**
 * The set of content an MCP principal may act on, computed once at connect time.
 * - `fileIds`: every file node the principal can read (API key → its workspace;
 *   OAuth → everything the authorizing user can read, via lib/access).
 * - `exposedFolders`: optional further restriction (only notes under these folders).
 * - `writeWorkspaceId`: where create_note writes; null → writes are refused.
 */
export interface McpScope {
  userId: string;
  fileIds: Set<string>;
  /** Folders/spaces the principal can access (id, name, parentId for hierarchy). */
  spaces: { id: string; name: string; parentId: string | null }[];
  exposedFolders: string[];
  writeWorkspaceId: string | null;
}

function getNodeAncestors(nodeId: string): string[] {
  const ancestors: string[] = [];
  let currentId: string | null = nodeId;
  const seen = new Set<string>([nodeId]);
  while (currentId) {
    const node = db.prepare('SELECT parent_id FROM nodes WHERE id = ?').get(currentId) as any;
    if (!node || !node.parent_id || seen.has(node.parent_id)) break;
    ancestors.push(node.parent_id);
    seen.add(node.parent_id);
    currentId = node.parent_id;
  }
  return ancestors;
}

function isNodeInFolders(nodeId: string, folderIds: string[]): boolean {
  if (folderIds.length === 0) return true;
  const ancestors = getNodeAncestors(nodeId);
  return folderIds.some(folderId => ancestors.includes(folderId));
}

/** Whether the scope grants access to a node: readable by the principal AND within any exposed folders. */
function inScope(scope: McpScope, nodeId: string): boolean {
  return scope.fileIds.has(nodeId) && isNodeInFolders(nodeId, scope.exposedFolders);
}

/** Fetch file rows for a set of ids, chunked to stay under SQLite's variable limit. */
function fetchFilesByIds(ids: string[]): any[] {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const ph = chunk.map(() => '?').join(',');
    out.push(...db.prepare(
      `SELECT id, name, content, updated_at as updatedAt FROM nodes WHERE type='file' AND id IN (${ph})`
    ).all(...chunk) as any[]);
  }
  return out;
}

export function mcpListSpaces(scope: McpScope) {
  // Honor any exposed-folder restriction: a space qualifies if no restriction is
  // set, it IS an exposed folder, or it lives under one.
  return scope.spaces
    .filter(s =>
      scope.exposedFolders.length === 0 ||
      scope.exposedFolders.includes(s.id) ||
      isNodeInFolders(s.id, scope.exposedFolders))
    .map(s => ({ id: s.id, name: s.name, parentId: s.parentId }));
}

export function mcpListNotes(scope: McpScope) {
  const ids = Array.from(scope.fileIds).filter(id => isNodeInFolders(id, scope.exposedFolders));
  return fetchFilesByIds(ids)
    .map(n => ({
      id: n.id,
      title: n.name.replace('.md', ''),
      excerpt: (n.content ?? '').replace(/---[\s\S]*?---/, '').trim().slice(0, 150),
      updatedAt: n.updatedAt,
    }))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export function mcpGetNote(scope: McpScope, idOrTitle: string) {
  // Narrow to candidates by id or (with/without .md) name, then enforce scope access.
  const candidates = db.prepare(
    `SELECT id, name, content, updated_at as updatedAt FROM nodes
     WHERE type='file' AND (id=? OR LOWER(name)=LOWER(?) OR LOWER(name)=LOWER(?))`
  ).all(idOrTitle, idOrTitle, `${idOrTitle}.md`) as any[];

  return candidates.find(n => inScope(scope, n.id)) ?? null;
}

export async function mcpSearchNotes(scope: McpScope, query: string) {
  const { semanticSearch } = await import('./embeddings');
  // Scan all embeddings, then keep only what this scope can access.
  const results = await semanticSearch(query, null, 40);
  return results
    .filter(r => inScope(scope, r.id))
    .slice(0, 10)
    .map(r => ({
      id: r.id,
      title: r.name.replace('.md', ''),
      excerpt: r.excerpt,
      score: r.score,
    }));
}

export function mcpCreateNote(scope: McpScope, title: string, content: string) {
  if (!scope.writeWorkspaceId) throw new Error('no_writable_workspace');
  const id = randomUUID();
  const name = title.endsWith('.md') ? title : `${title}.md`;
  const body = content || `---\ntitle: ${title}\n---\n\n`;
  db.prepare('INSERT INTO nodes (id, name, type, content, workspace_id) VALUES (?, ?, ?, ?, ?)').run(id, name, 'file', body, scope.writeWorkspaceId);
  // A freshly-created note is in-scope for subsequent reads within this session.
  scope.fileIds.add(id);
  return { id, name, content: body };
}

export function mcpUpdateNote(scope: McpScope, idOrTitle: string, content: string) {
  const note = mcpGetNote(scope, idOrTitle) as any;
  if (!note) throw new Error('note_not_found');
  db.prepare('UPDATE nodes SET content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(content, note.id);
  return { id: note.id, updated: true };
}

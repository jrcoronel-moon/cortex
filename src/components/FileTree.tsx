"use client";

import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { DriveNode } from '@/lib/drive';
import { ChevronRight, ChevronDown, File, Folder, Trash2, Pencil, Share2, Settings, Plus, FilePlus, FolderPlus } from 'lucide-react';
import styles from './components.module.css';

interface FileTreeProps {
  nodes: DriveNode[];
  onSelectNode: (node: DriveNode) => void;
  activeNodeId: string | null;
  isOpen: boolean;
  onDeleteNode?: (id: string) => void;
  onRenameNode?: (id: string, newName: string) => void;
  onShareNode?: (node: DriveNode) => void;
  onMoveNode?: (id: string, newParentId: string | null) => void;
  onReorderNode?: (id: string, targetId: string, position: 'before' | 'after') => void;
  onCreateNode?: (parentId: string | null, type: 'file' | 'folder', name: string) => Promise<boolean> | void;
}

export default function FileTree({ nodes, onSelectNode, activeNodeId, isOpen, onDeleteNode, onRenameNode, onShareNode, onMoveNode, onReorderNode, onCreateNode }: FileTreeProps) {
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({ 'home-folder': true });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null); // folder id, or '__root__'
  // Where the current drag would land: inside a folder, or before/after a row.
  const [dropHint, setDropHint] = useState<{ id: string; mode: 'into' | 'before' | 'after' } | null>(null);
  // Instant full-name tooltip for truncated rows (native title is too slow).
  const [hint, setHint] = useState<{ text: string; x: number; y: number } | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  // Per-folder quick-create popover: pick note/folder, then type the name inline.
  const [createMenu, setCreateMenu] = useState<{ id: string; x: number; y: number; type?: 'file' | 'folder' } | null>(null);
  const [createName, setCreateName] = useState('');
  const createInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submitCreate = async () => {
    if (!createMenu?.type || !onCreateNode) return;
    const name = createName.trim();
    if (!name) return;
    const folderId = createMenu.id;
    const ok = await onCreateNode(folderId, createMenu.type, name);
    if (ok !== false) {
      setExpandedFolders(prev => ({ ...prev, [folderId]: true }));
      setCreateMenu(null);
      setCreateName('');
    }
  };

  const dndEnabled = !!onMoveNode || !!onReorderNode;

  const toggleFolder = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedFolders(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const startRename = (node: DriveNode, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(node.id);
    setEditingName(node.name.replace('.md', ''));
    setTimeout(() => inputRef.current?.select(), 50);
  };

  const commitRename = (node: DriveNode) => {
    const trimmed = editingName.trim();
    if (trimmed && trimmed !== node.name.replace('.md', '') && onRenameNode) {
      onRenameNode(node.id, trimmed);
    }
    setEditingId(null);
  };

  // True if `ancestorId` is `nodeId` itself or one of its ancestors — used to
  // forbid dropping a folder into itself or one of its own descendants.
  const isSelfOrAncestor = (ancestorId: string, nodeId: string): boolean => {
    const byId = new Map(nodes.map(n => [n.id, n]));
    let current: string | null = nodeId;
    while (current) {
      if (current === ancestorId) return true;
      current = byId.get(current)?.parentId ?? null;
    }
    return false;
  };

  // Whether the currently-dragged node may drop into a folder.
  const canDropInto = (dragId: string | null, targetFolderId: string): boolean => {
    if (!dragId || dragId === targetFolderId) return false;
    if (isSelfOrAncestor(dragId, targetFolderId)) return false; // into own subtree
    const dragged = nodes.find(n => n.id === dragId);
    if (dragged && dragged.parentId === targetFolderId) return false; // already there
    return true;
  };

  const handleDropInto = (targetParentId: string | null) => {
    const id = draggingId;
    setDraggingId(null);
    setDragOverId(null);
    if (!id || !onMoveNode) return;
    if (targetParentId !== null && !canDropInto(id, targetParentId)) return;
    onMoveNode(id, targetParentId);
    if (targetParentId) setExpandedFolders(prev => ({ ...prev, [targetParentId]: true }));
  };

  const renderTree = (parentId: string | null = null, depth = 0) => {
    const children = nodes.filter(n => n.parentId === parentId);
    if (children.length === 0) return null;

    // Manual order (drag & drop) wins; otherwise natural name order with
    // numeric awareness ("2" before "10", numbered docs read in sequence).
    // Folders and files interleave so numbered trees keep their source order.
    return children.sort((a, b) => {
      const ao = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
      const bo = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    }).map(node => {
      const isExpanded = expandedFolders[node.id];
      const isActive = activeNodeId === node.id;
      const isEditing = editingId === node.id;
      const isFolder = node.type === 'folder';
      const isDropTarget = dropHint?.id === node.id && dropHint.mode === 'into' && canDropInto(draggingId, node.id);
      const dropEdge = dropHint?.id === node.id && dropHint.mode !== 'into' ? dropHint.mode : null;
      const childCount = isFolder ? nodes.filter(n => n.parentId === node.id).length : 0;

      // A before/after drop lands in this node's PARENT — forbid it when that
      // parent lives inside the dragged folder's own subtree.
      const canDropBeside = (dragId: string | null): boolean => {
        if (!dragId || dragId === node.id || !onReorderNode) return false;
        if (node.parentId && isSelfOrAncestor(dragId, node.parentId)) return false;
        return true;
      };
      // Pick the drop mode from the cursor's vertical position on the row:
      // folders offer before (top ~28%) / into (middle) / after (bottom ~28%);
      // files offer before / after split at the middle.
      const dropModeAt = (e: React.DragEvent): 'into' | 'before' | 'after' | null => {
        const r = e.currentTarget.getBoundingClientRect();
        const frac = (e.clientY - r.top) / Math.max(1, r.height);
        if (isFolder) {
          if (frac >= 0.28 && frac <= 0.72) return canDropInto(draggingId, node.id) ? 'into' : null;
          const edge = frac < 0.28 ? 'before' : 'after';
          return canDropBeside(draggingId) ? edge : (canDropInto(draggingId, node.id) ? 'into' : null);
        }
        return canDropBeside(draggingId) ? (frac < 0.5 ? 'before' : 'after') : null;
      };
      // Row stays highlighted while its options/create menu is open, so it's
      // obvious which node the popover belongs to.
      const hasMenuOpen = menu?.id === node.id || createMenu?.id === node.id;

      return (
        <div key={node.id}>
          <div
            className={`${styles.treeNode} ${isActive ? styles.active : ''}`}
            style={{
              paddingLeft: '8px',
              opacity: draggingId === node.id ? 0.4 : 1,
              ...(isDropTarget ? { outline: '1px solid var(--accent-primary)', outlineOffset: '-1px', background: 'rgba(99,102,241,0.12)', borderRadius: '4px' } : {}),
              ...(dropEdge ? { boxShadow: dropEdge === 'before' ? 'inset 0 2px 0 var(--accent-primary)' : 'inset 0 -2px 0 var(--accent-primary)' } : {}),
              ...(hasMenuOpen ? { background: 'rgba(99,102,241,0.18)', borderRadius: '4px' } : {}),
            }}
            draggable={dndEnabled && !isEditing}
            onDragStart={(e) => {
              if (!dndEnabled) return;
              e.dataTransfer.setData('text/plain', node.id);
              e.dataTransfer.effectAllowed = 'move';
              setDraggingId(node.id);
            }}
            onDragEnd={() => { setDraggingId(null); setDragOverId(null); setDropHint(null); }}
            onDragOver={dndEnabled ? (e) => {
              const mode = dropModeAt(e);
              if (mode) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setDropHint(prev => (prev?.id === node.id && prev.mode === mode ? prev : { id: node.id, mode }));
              } else {
                setDropHint(prev => (prev?.id === node.id ? null : prev));
              }
            } : undefined}
            onDragLeave={dndEnabled ? () => setDropHint(prev => (prev?.id === node.id ? null : prev)) : undefined}
            onDrop={dndEnabled ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              const mode = dropModeAt(e);
              setDropHint(null);
              if (mode === 'into') { handleDropInto(node.id); return; }
              const dragId = draggingId;
              setDraggingId(null);
              setDragOverId(null);
              if (dragId && mode) onReorderNode?.(dragId, node.id, mode);
            } : undefined}
            onMouseEnter={(e) => {
              const row = e.currentTarget as HTMLElement;
              if (hintTimer.current) clearTimeout(hintTimer.current);
              hintTimer.current = setTimeout(() => {
                const span = row.querySelector('[data-nodename]') as HTMLElement | null;
                if (!span || span.scrollWidth <= span.clientWidth + 1) return; // not truncated
                const r = row.getBoundingClientRect();
                setHint({ text: node.name.replace('.md', ''), x: r.left + 12, y: r.bottom + 4 });
              }, 150);
            }}
            onMouseLeave={() => {
              if (hintTimer.current) clearTimeout(hintTimer.current);
              setHint(null);
            }}
            onClick={() => {
              if (isEditing) return;
              if (node.type === 'folder') setExpandedFolders(prev => ({ ...prev, [node.id]: !prev[node.id] }));
              onSelectNode(node);
            }}
          >
            {node.type === 'folder' ? (
              <span className={styles.nodeIcon} onClick={(e) => toggleFolder(node.id, e)}>
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
            ) : (
              <span className={styles.nodeIcon} style={{ marginLeft: '14px' }}>
                <File size={14} />
              </span>
            )}

            {node.type === 'folder' && <Folder size={14} className={styles.nodeIcon} style={{ marginRight: '6px', color: '#6366f1' }} />}
            {node.type === 'folder' && node.isShared && <Share2 size={12} style={{ marginRight: '4px', color: '#8b5cf6' }} aria-label="Carpeta compartida" />}

            {isEditing ? (
              <input
                ref={inputRef}
                value={editingName}
                onChange={e => setEditingName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitRename(node);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                onBlur={() => commitRename(node)}
                onClick={e => e.stopPropagation()}
                style={{ flex: 1, minWidth: 0, background: 'var(--surface-3)', border: '1px solid var(--accent-primary)', color: 'white', borderRadius: '3px', padding: '1px 4px', fontSize: '0.85rem', outline: 'none' }}
              />
            ) : (
              <span className={styles.nodeName} data-nodename>{node.name.replace('.md', '')}</span>
            )}

            {isFolder && childCount > 0 && !isEditing && (
              <span className={styles.folderBadge}>{childCount}</span>
            )}

            {!isEditing && isFolder && onCreateNode && (
              <Plus
                size={14}
                className={styles.nodeGear}
                aria-label="Crear dentro de esta carpeta"
                onClick={(e) => {
                  e.stopPropagation();
                  const r = e.currentTarget.getBoundingClientRect();
                  setCreateName('');
                  setCreateMenu(prev => (prev?.id === node.id ? null : { id: node.id, x: r.right, y: r.bottom + 4 }));
                }}
              />
            )}
            {!isEditing && (onRenameNode || onDeleteNode || onShareNode) && (
              <Settings
                size={14}
                className={styles.nodeGear}
                aria-label="Options"
                onClick={(e) => {
                  e.stopPropagation();
                  const r = e.currentTarget.getBoundingClientRect();
                  setMenu(prev => (prev?.id === node.id ? null : { id: node.id, x: r.right, y: r.bottom + 4 }));
                }}
              />
            )}
          </div>

          {node.type === 'folder' && isExpanded && (
            <div className={styles.treeChildren}>{renderTree(node.id, depth + 1)}</div>
          )}
        </div>
      );
    });
  };


  return (
    <>
      <div className={styles.sidebar} style={{ display: isOpen ? 'flex' : 'none', transition: 'width 0.2s ease', background: 'transparent', borderRight: 'none', width: '100%' }}>
        <div
          className={styles.fileTree}
          // Drop on the empty area (not on a row) → move the node to the root.
          onDragOver={dndEnabled ? (e) => { if (draggingId) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } } : undefined}
          onDrop={dndEnabled ? (e) => {
            e.preventDefault();
            if (e.target === e.currentTarget) handleDropInto(null);
            else { setDraggingId(null); setDragOverId(null); }
          } : undefined}
        >
          {renderTree(null, 0)}
        </div>
      </div>

      {/* Menus render in a portal to <body>: the floating panel's backdrop-filter
          makes it the containing block for position:fixed, which both offset the
          popovers and let overflow:hidden clip them. */}
      {menu && typeof document !== 'undefined' && (() => {
        const node = nodes.find(n => n.id === menu.id);
        if (!node) return null;
        const canShare = !!onShareNode && node.type === 'folder' && !node.parentId;
        return createPortal(
          <>
            <div className={styles.menuOverlay} onClick={() => setMenu(null)} />
            <div
              className={styles.nodeMenu}
              style={{ top: menu.y, left: menu.x, transform: 'translateX(-100%)' }}
              onClick={e => e.stopPropagation()}
            >
              {onRenameNode && (
                <button
                  className={styles.nodeMenuItem}
                  onClick={() => {
                    setMenu(null);
                    setEditingId(node.id);
                    setEditingName(node.name.replace('.md', ''));
                    setTimeout(() => inputRef.current?.select(), 50);
                  }}
                >
                  <Pencil size={13} /> Renombrar
                </button>
              )}
              {canShare && (
                <button className={styles.nodeMenuItem} onClick={() => { setMenu(null); onShareNode!(node); }}>
                  <Share2 size={13} /> Compartir
                </button>
              )}
              {onDeleteNode && (
                <button
                  className={`${styles.nodeMenuItem} ${styles.nodeMenuDanger}`}
                  onClick={() => { setMenu(null); onDeleteNode(node.id); }}
                >
                  <Trash2 size={13} /> Eliminar
                </button>
              )}
            </div>
          </>,
          document.body
        );
      })()}

      {/* Per-folder quick-create: pick the type, then name it inline — no modal. */}
      {createMenu && typeof document !== 'undefined' && createPortal(
        <>
          <div className={styles.menuOverlay} onClick={() => { setCreateMenu(null); setCreateName(''); }} />
          <div
            className={styles.nodeMenu}
            style={{ top: createMenu.y, left: createMenu.x, transform: 'translateX(-100%)' }}
            onClick={e => e.stopPropagation()}
          >
            {!createMenu.type ? (
              <>
                <button
                  className={styles.nodeMenuItem}
                  onClick={() => {
                    setCreateMenu(prev => (prev ? { ...prev, type: 'file' } : prev));
                    setTimeout(() => createInputRef.current?.focus(), 50);
                  }}
                >
                  <FilePlus size={13} /> Nueva nota
                </button>
                <button
                  className={styles.nodeMenuItem}
                  onClick={() => {
                    setCreateMenu(prev => (prev ? { ...prev, type: 'folder' } : prev));
                    setTimeout(() => createInputRef.current?.focus(), 50);
                  }}
                >
                  <FolderPlus size={13} /> Nueva carpeta
                </button>
              </>
            ) : (
              <div style={{ padding: '6px 8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                {createMenu.type === 'file' ? <FilePlus size={13} style={{ flexShrink: 0, opacity: 0.7 }} /> : <FolderPlus size={13} style={{ flexShrink: 0, opacity: 0.7 }} />}
                <input
                  ref={createInputRef}
                  value={createName}
                  onChange={e => setCreateName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') submitCreate();
                    if (e.key === 'Escape') { setCreateMenu(null); setCreateName(''); }
                  }}
                  placeholder={createMenu.type === 'file' ? 'Nombre de la nota…' : 'Nombre de la carpeta…'}
                  style={{ width: '160px', background: 'var(--surface-3)', border: '1px solid var(--accent-primary)', color: 'white', borderRadius: '4px', padding: '3px 6px', fontSize: '0.8rem', outline: 'none' }}
                />
              </div>
            )}
          </div>
        </>,
        document.body
      )}

      {/* Instant full-name tooltip (only for truncated rows). */}
      {hint && typeof document !== 'undefined' && createPortal(
        <div className={styles.treeHint} style={{ left: hint.x, top: hint.y }}>{hint.text}</div>,
        document.body
      )}
    </>
  );
}

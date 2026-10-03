"use client";

import type React from 'react';
import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import FileTree from '@/components/FileTree';
import ShareFolderModal from '@/components/ShareFolderModal';
import MarkdownEditor from '@/components/MarkdownEditor';
import nextDynamic from 'next/dynamic';
// Lazy-loaded: pulls in three.js / react-force-graph-3d only when the graph opens,
// keeping them out of the main workspace bundle.
const KnowledgeGraph = nextDynamic(() => import('@/components/KnowledgeGraph'), { ssr: false });
import { getFiles, DriveNode } from '@/lib/drive';
import { parseMarkdownMetadata } from '@/lib/metadata';
import styles from '@/components/components.module.css';
import { Search, Settings, Share, PanelLeftClose, PanelLeftOpen, Network, UploadCloud, Bookmark, Pencil, BookOpen, Save, ChevronLeft, ChevronRight, ChevronDown, X, File as FileIcon, Folder, Plus, Volume2, VolumeX, Printer, Heart, LogOut, MoreHorizontal, Sparkles, Send, Users, FileInput, GripVertical, CircleDollarSign, Download } from 'lucide-react';
import { isSuperAdmin } from '@/lib/superadmin';
import ImportModal from '@/components/ImportModal';
import Link from 'next/link';
import toast from 'react-hot-toast';


interface WorkspaceProps {
  user: any;
  groups: any[];
  workspaces: { id: string; name: string; role?: string }[];
  initialNodes?: DriveNode[];
}

export default function WorkspaceClient({ user, groups, workspaces, initialNodes = [] }: WorkspaceProps) {
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(workspaces[0]?.id ?? '');
  const [workspaceList, setWorkspaceList] = useState(workspaces);

  // Compute isEditor - re-evaluate when workspaceList or activeWorkspaceId changes
  const isEditor = useMemo(() => {
    if (user.role === 'admin' || user.role === 'editor') return true;
    const currentWorkspace = workspaceList.find(w => w.id === activeWorkspaceId);
    return currentWorkspace?.role === 'owner';
  }, [user.role, activeWorkspaceId, workspaceList]);
  const [nodes, setNodes] = useState<DriveNode[]>(initialNodes);
  const [activeNode, setActiveNode] = useState<DriveNode | null>(null);
  const [openTabs, setOpenTabs] = useState<DriveNode[]>([]);
  
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [ribbonExpanded, setRibbonExpanded] = useState(false);

  // Floating tree panel: draggable position (persisted). Default docks just
  // right of the ribbon. Initial state is SSR-safe (no window); hydrated from
  // localStorage on mount.
  const [sidebarPos, setSidebarPos] = useState<{ x: number; y: number }>({ x: 74, y: 96 });
  const [sidebarWidth, setSidebarWidth] = useState(264);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef<{ dx: number; dy: number } | null>(null);
  const resizing = useRef(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('cortex_sidebar_pos');
      if (saved) {
        const p = JSON.parse(saved);
        if (typeof p?.x === 'number' && typeof p?.y === 'number') setSidebarPos(clampSidebarPos(p.x, p.y));
      }
      const w = Number(localStorage.getItem('cortex_sidebar_w'));
      if (w >= 220 && w <= 560) setSidebarWidth(w);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Right-edge resize handle: drag to widen/narrow the tree panel (persisted).
  const onSidebarResizeStart = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    resizing.current = true;
    const onMove = (ev: PointerEvent) => {
      if (!resizing.current) return;
      const rect = sidebarRef.current?.getBoundingClientRect();
      if (!rect) return;
      const w = Math.max(220, Math.min(560, ev.clientX - rect.left));
      setSidebarWidth(w);
    };
    const onUp = () => {
      resizing.current = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setSidebarWidth(w => {
        try { localStorage.setItem('cortex_sidebar_w', String(Math.round(w))); } catch {}
        return w;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  function clampSidebarPos(x: number, y: number) {
    if (typeof window === 'undefined') return { x, y };
    const w = sidebarRef.current?.offsetWidth ?? 264;
    const h = sidebarRef.current?.offsetHeight ?? Math.min(window.innerHeight * 0.72, window.innerHeight - 24);
    return {
      x: Math.max(8, Math.min(x, window.innerWidth - w - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - h - 8)),
    };
  }

  const onSidebarDragMove = useCallback((e: PointerEvent) => {
    if (!dragOffset.current) return;
    setSidebarPos(clampSidebarPos(e.clientX - dragOffset.current.dx, e.clientY - dragOffset.current.dy));
  }, []);

  const onSidebarDragEnd = useCallback(() => {
    dragOffset.current = null;
    window.removeEventListener('pointermove', onSidebarDragMove);
    window.removeEventListener('pointerup', onSidebarDragEnd);
    setSidebarPos(p => {
      try { localStorage.setItem('cortex_sidebar_pos', JSON.stringify(p)); } catch {}
      return p;
    });
  }, [onSidebarDragMove]);

  const onSidebarDragStart = useCallback((e: React.PointerEvent) => {
    // Don't start a drag from interactive controls in the header.
    if ((e.target as HTMLElement).closest('button, select, input')) return;
    const rect = sidebarRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragOffset.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    window.addEventListener('pointermove', onSidebarDragMove);
    window.addEventListener('pointerup', onSidebarDragEnd);
  }, [onSidebarDragMove, onSidebarDragEnd]);

  // Keep the panel on-screen when the window is resized.
  useEffect(() => {
    const onResize = () => setSidebarPos(p => clampSidebarPos(p.x, p.y));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const [sidebarView, setSidebarView] = useState<'files'|'search'|'favorites'|'ai'|'shares'>('files');

  // Ribbon click behaves as a toggle: clicking the icon of the view that's
  // already showing closes the panel; otherwise open it on that view.
  const toggleSidebarView = useCallback((view: typeof sidebarView): boolean => {
    if (sidebarOpen && sidebarView === view) {
      setSidebarOpen(false);
      return false;
    }
    setSidebarView(view);
    setSidebarOpen(true);
    return true;
  }, [sidebarOpen, sidebarView]);
  const [myShares, setMyShares] = useState<any[]>([]);
  const [graphOpen, setGraphOpen] = useState(false);

  // Mini related-docs panel (under the TOC): top-5 most-connected documents to
  // the one being read, computed server-side (links + embeddings + terms).
  const [relatedDocs, setRelatedDocs] = useState<{ id: string; name: string; score: number; kinds: string[] }[]>([]);

  // Related panel: collapsible (click its title) and draggable (drag its title).
  // A pointer gesture under 5px is a click-toggle; anything larger is a drag.
  // Position is relative to the editor wrapper; null = default bottom-right dock.
  const [relatedCollapsed, setRelatedCollapsed] = useState(false);
  const [relatedPos, setRelatedPos] = useState<{ x: number; y: number } | null>(null);
  const relatedRef = useRef<HTMLElement>(null);
  const relatedDrag = useRef<{ dx: number; dy: number; startX: number; startY: number; moved: boolean } | null>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem('cortex_related_collapsed') === '1') setRelatedCollapsed(true);
      const saved = localStorage.getItem('cortex_related_pos');
      if (saved) {
        const p = JSON.parse(saved);
        if (typeof p?.x === 'number' && typeof p?.y === 'number') setRelatedPos(p);
      }
    } catch {}
  }, []);

  const clampRelatedPos = useCallback((x: number, y: number) => {
    const el = relatedRef.current;
    const parent = el?.parentElement;
    if (!el || !parent) return { x, y };
    return {
      x: Math.max(8, Math.min(x, parent.clientWidth - el.offsetWidth - 8)),
      y: Math.max(8, Math.min(y, parent.clientHeight - el.offsetHeight - 8)),
    };
  }, []);

  const onRelatedDragMove = useCallback((e: PointerEvent) => {
    const d = relatedDrag.current;
    const parent = relatedRef.current?.parentElement;
    if (!d || !parent) return;
    if (!d.moved && Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) < 5) return;
    d.moved = true;
    const rect = parent.getBoundingClientRect();
    setRelatedPos(clampRelatedPos(e.clientX - rect.left - d.dx, e.clientY - rect.top - d.dy));
  }, [clampRelatedPos]);

  const onRelatedDragEnd = useCallback(() => {
    const d = relatedDrag.current;
    relatedDrag.current = null;
    window.removeEventListener('pointermove', onRelatedDragMove);
    window.removeEventListener('pointerup', onRelatedDragEnd);
    if (!d) return;
    if (!d.moved) {
      // Plain click on the title → toggle collapse.
      setRelatedCollapsed(v => {
        try { localStorage.setItem('cortex_related_collapsed', v ? '0' : '1'); } catch {}
        return !v;
      });
    } else {
      setRelatedPos(p => {
        try { if (p) localStorage.setItem('cortex_related_pos', JSON.stringify(p)); } catch {}
        return p;
      });
    }
  }, [onRelatedDragMove]);

  const onRelatedDragStart = useCallback((e: React.PointerEvent) => {
    const rect = relatedRef.current?.getBoundingClientRect();
    if (!rect) return;
    relatedDrag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, startX: e.clientX, startY: e.clientY, moved: false };
    window.addEventListener('pointermove', onRelatedDragMove);
    window.addEventListener('pointerup', onRelatedDragEnd);
  }, [onRelatedDragMove, onRelatedDragEnd]);

  useEffect(() => {
    if (!activeNode || activeNode.type !== 'file') { setRelatedDocs([]); return; }
    let cancelled = false;
    fetch(`/api/graph/related?id=${encodeURIComponent(activeNode.id)}`)
      .then(r => (r.ok ? r.json() : { related: [] }))
      .then(data => { if (!cancelled) setRelatedDocs(Array.isArray(data.related) ? data.related : []); })
      .catch(() => { if (!cancelled) setRelatedDocs([]); });
    return () => { cancelled = true; };
  }, [activeNode?.id, activeNode?.type]);
  
  const [favorites, setFavorites] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileParentId, setNewFileParentId] = useState('');
  const [newFileType, setNewFileType] = useState<'file' | 'folder'>('file');
  const submitCreateRef = useRef<(() => void) | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);

  // Upload State
  const [showUpload, setShowUpload] = useState(false);
  const [uploadGroup, setUploadGroup] = useState(groups[0]?.id || '');
  const [isUploading, setIsUploading] = useState(false);

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string>('');

  // AI Chat state
  const [aiMessages, setAiMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  // Uncontrolled on purpose: a controlled input here re-renders the WHOLE
  // workspace (incl. the markdown re-parse of the open doc) on every keystroke,
  // which made typing in the chat crawl. The value is read only on send.
  const aiInputRef = useRef<HTMLTextAreaElement>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSources, setAiSources] = useState<{ id: string; name: string; score: number }[]>([]);
  const aiEndRef = useRef<HTMLDivElement | null>(null);

  // Share state
  const [sharePopoverOpen, setSharePopoverOpen] = useState(false);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);

  // Folder sharing state
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareModalFolderNode, setShareModalFolderNode] = useState<DriveNode | null>(null);

  // Semantic search state
  const [searchMode, setSearchMode] = useState<'keyword' | 'fulltext' | 'semantic'>('keyword');
  const [semanticResults, setSemanticResults] = useState<{ id: string; name: string; score: number; excerpt: string }[]>([]);
  const [ftResults, setFtResults] = useState<{ id: string; name: string; snippet: string }[]>([]);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const semanticTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Nav history — Fix 0.5
  const [navHistory, setNavHistory] = useState<string[]>([]);
  const [navIndex, setNavIndex] = useState(-1);
  const isNavigating = useRef(false);

  // Autosave debounce — Fix 0.1
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const PREFERRED_VOICE = 'Google español de Estados Unidos';
    const loadVoices = () => {
      const all = window.speechSynthesis.getVoices();
      const googleVoices = all.filter(v => v.name.startsWith('Google'));
      if (googleVoices.length === 0) return;
      setVoices(googleVoices);
      const preferred = googleVoices.find(v => v.name === PREFERRED_VOICE)
        || googleVoices.find(v => v.lang === 'es-US')
        || googleVoices.find(v => v.lang.startsWith('es'))
        || googleVoices[0];
      setSelectedVoice(preferred.name);
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  useEffect(() => {
    // Refresh workspace list from server (catches workspaces created in /settings)
    fetch('/api/workspace')
      .then(r => r.json())
      .then(list => {
        if (Array.isArray(list) && list.length > 0) {
          setWorkspaceList(list);
          setActiveWorkspaceId(prev => prev || list[0].id);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Restaura tabs/nodo activo desde localStorage contra la lista de nodos.
    const restoreFromStorage = (data: DriveNode[]) => {
      // Fix 0.4 — Restaurar tabs y nodo activo desde localStorage
      const savedTabIds: string[] = JSON.parse(localStorage.getItem('cortex_open_tabs') || '[]');
      const savedActiveId: string | null = localStorage.getItem('cortex_active_node');
      const restoredTabs = savedTabIds.map(id => data.find(n => n.id === id)).filter(Boolean) as DriveNode[];
      const restoredActive = data.find(n => n.id === savedActiveId) || null;

      if (restoredTabs.length > 0) {
        setOpenTabs(restoredTabs);
        setActiveNode(restoredActive || restoredTabs[restoredTabs.length - 1]);
      } else {
        const welcomeNode = data.find(n => n.name === 'Welcome.md');
        if (welcomeNode) { setActiveNode(welcomeNode); setOpenTabs([welcomeNode]); }
      }

      // Fix 0.4 — Restaurar favoritos
      const savedFavs: string[] = JSON.parse(localStorage.getItem('cortex_favorites') || '[]');
      setFavorites(savedFavs);
    };

    // El árbol ya llega por SSR (initialNodes); restauramos al instante y
    // evitamos el round-trip de getFiles(). Fallback al fetch si vino vacío.
    if (initialNodes.length > 0) {
      restoreFromStorage(initialNodes);
    } else {
      getFiles().then(data => {
        setNodes(data);
        restoreFromStorage(data);
      });
    }
  }, []);

  // Cancel speech and reset share when activeNode changes
  useEffect(() => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setSharePopoverOpen(false);
    setShareToken(null);
  }, [activeNode?.id]);

  // Lazy-load content for the active node. The tree query strips `content` to
  // keep the initial payload small; we hydrate it the moment a note is opened.
  useEffect(() => {
    if (!activeNode || activeNode.type !== 'file') return;
    if (activeNode.content !== null && activeNode.content !== undefined) return;
    const aborted = { current: false };
    fetch(`/api/node?id=${encodeURIComponent(activeNode.id)}`)
      .then(r => (r.ok ? r.json() : null))
      .then((row: any) => {
        if (aborted.current || !row) return;
        const content = row.content ?? '';
        setActiveNode(prev => (prev && prev.id === row.id ? { ...prev, content } : prev));
        setNodes(prev => prev.map(n => (n.id === row.id ? { ...n, content } : n)));
        setOpenTabs(prev => prev.map(n => (n.id === row.id ? { ...n, content } : n)));
      })
      .catch(() => {});
    return () => { aborted.current = true; };
  }, [activeNode?.id]);

  // Close share popover on outside click
  useEffect(() => {
    if (!sharePopoverOpen) return;
    const handler = () => setSharePopoverOpen(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [sharePopoverOpen]);

  // Fix 0.4 — Persistir tabs, nodo activo y favoritos en localStorage
  useEffect(() => {
    localStorage.setItem('cortex_open_tabs', JSON.stringify(openTabs.map(t => t.id)));
  }, [openTabs]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (activeNode) localStorage.setItem('cortex_active_node', activeNode.id);
  }, [activeNode]);

  useEffect(() => {
    localStorage.setItem('cortex_favorites', JSON.stringify(favorites));
  }, [favorites]);

  const handleContentChange = (newContent: string) => {
    if (!activeNode) return;
    const updatedNode = { ...activeNode, content: newContent };
    setActiveNode(updatedNode);
    setNodes(prev => prev.map(n => n.id === activeNode.id ? updatedNode : n));
    setOpenTabs(prev => prev.map(n => n.id === activeNode.id ? updatedNode : n));

    // Fix 0.1 — Autosave con debounce de 2 segundos
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      fetch('/api/node', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: activeNode.id, content: newContent }),
      });
    }, 2000);
  };

  const handleNodeSelect = (node: DriveNode) => {
    if (node.type === 'file') {
      setActiveNode(node);
      if (!openTabs.find(t => t.id === node.id)) {
        setOpenTabs(prev => [...prev, node]);
      }
      // Fix 0.5 — Actualizar historial de navegación
      if (!isNavigating.current) {
        setNavHistory(prev => [...prev.slice(0, navIndex + 1), node.id]);
        setNavIndex(prev => prev + 1);
      }
      isNavigating.current = false;
    }
  };

  // Fix 0.5 — Back/Forward
  const handleNavBack = () => {
    if (navIndex <= 0) return;
    const node = nodes.find(n => n.id === navHistory[navIndex - 1]);
    if (node) { isNavigating.current = true; setNavIndex(i => i - 1); handleNodeSelect(node); }
  };

  const handleNavForward = () => {
    if (navIndex >= navHistory.length - 1) return;
    const node = nodes.find(n => n.id === navHistory[navIndex + 1]);
    if (node) { isNavigating.current = true; setNavIndex(i => i + 1); handleNodeSelect(node); }
  };

  const closeTab = (e: any, id: string) => {
    e.stopPropagation();
    const newTabs = openTabs.filter(t => t.id !== id);
    setOpenTabs(newTabs);
    if (activeNode?.id === id) {
      setActiveNode(newTabs.length > 0 ? newTabs[newTabs.length - 1] : null);
    }
  };

  const handleGraphNodeClick = (nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (node) handleNodeSelect(node);
  }

  const handleDeleteNode = async (id: string) => {
    setConfirmDeleteId(id);
  };

  const confirmDelete = async () => {
    if (!confirmDeleteId) return;
    const id = confirmDeleteId;
    setConfirmDeleteId(null);
    const res = await fetch(`/api/node?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      // Remove the node and all its descendants from state — no full reload
      const toRemove = new Set<string>();
      const collect = (nodeId: string) => {
        toRemove.add(nodeId);
        nodes.filter(n => n.parentId === nodeId).forEach(n => collect(n.id));
      };
      collect(id);
      setNodes(prev => prev.filter(n => !toRemove.has(n.id)));
      setOpenTabs(prev => prev.filter(t => !toRemove.has(t.id)));
      if (activeNode && toRemove.has(activeNode.id)) setActiveNode(null);
    } else {
      toast.error('Error al eliminar. Verifica tus permisos.');
    }
  };

  const handleRenameNode = async (id: string, newName: string) => {
    const res = await fetch('/api/node', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: newName }),
    });
    if (res.ok) {
      const { name: finalName } = await res.json();
      setNodes(prev => prev.map(n => n.id === id ? { ...n, name: finalName } : n));
      if (activeNode?.id === id) setActiveNode(prev => prev ? { ...prev, name: finalName } : prev);
      setOpenTabs(prev => prev.map(t => t.id === id ? { ...t, name: finalName } : t));
    } else {
      toast.error('Error al renombrar');
    }
  };

  const handleMoveNode = async (id: string, newParentId: string | null) => {
    const node = nodes.find(n => n.id === id);
    if (!node || node.parentId === newParentId) return; // no-op
    // Optimistic update; revert on failure.
    setNodes(prev => prev.map(n => n.id === id ? { ...n, parentId: newParentId } : n));
    const res = await fetch('/api/node', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, parentId: newParentId }),
    });
    if (!res.ok) {
      setNodes(prev => prev.map(n => n.id === id ? { ...n, parentId: node.parentId } : n));
      const err = await res.json().catch(() => ({}));
      toast.error(err.error === 'cycle' ? 'No puedes mover una carpeta dentro de sí misma' : 'No se pudo mover');
    }
  };

  // Drop before/after a sibling: the server renumbers the whole folder and
  // returns the final order — apply it locally (no refetch).
  const handleReorderNode = async (id: string, targetId: string, position: 'before' | 'after') => {
    const res = await fetch('/api/node', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, reorder: { targetId, position } }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error === 'cycle' ? 'No puedes mover una carpeta dentro de sí misma' : 'No se pudo reordenar');
      return;
    }
    const orderMap = new Map<string, number>((data.order ?? []).map((o: { id: string; sortOrder: number }) => [o.id, o.sortOrder]));
    setNodes(prev => prev.map(n => {
      const so = orderMap.get(n.id);
      if (n.id === id) return { ...n, parentId: data.parentId ?? n.parentId, sortOrder: so ?? n.sortOrder };
      return so !== undefined ? { ...n, sortOrder: so } : n;
    }));
  };

  const handleShareNode = useCallback((node: DriveNode) => {
    setShareModalFolderNode(node);
    setShareModalOpen(true);
  }, []);

  // Stable prop identities for the memoized MarkdownEditor ("latest ref"
  // pattern): the wrappers never change identity, but always dispatch to the
  // freshest handlers. Without this, every WorkspaceClient render would defeat
  // React.memo and re-parse the whole document.
  const editorHandlers = useRef({
    onChange: (_c: string) => {},
    onNavigate: (_f: string) => {},
    onTagClick: (_t: string) => {},
  });
  editorHandlers.current.onChange = handleContentChange;
  editorHandlers.current.onTagClick = (tag: string) => {
    setSidebarOpen(true);
    setSidebarView('search');
    setSearchQuery(tag);
  };
  const editorOnChange = useCallback((c: string) => editorHandlers.current.onChange(c), []);
  const editorOnNavigate = useCallback((f: string) => editorHandlers.current.onNavigate(f), []);
  const editorOnTagClick = useCallback((t: string) => editorHandlers.current.onTagClick(t), []);

  // Shared creation logic: used by the "Crear nuevo" modal (ribbon +) and by
  // the per-folder + menu in the tree (which already knows parent + type).
  const handleCreateNode = async (parentId: string | null, type: 'file' | 'folder', name: string): Promise<boolean> => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    try {
      const wsId = activeWorkspaceId && activeWorkspaceId.trim() ? activeWorkspaceId : (workspaceList[0]?.id ?? null);
      const res = await fetch('/api/node', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmed,
          type,
          parentId: parentId || null,
          workspaceId: wsId,
          content: type === 'file' ? `---\ntitle: ${trimmed}\n---\n\n` : null,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        toast.error('Error al crear');
        return false;
      }
      const newNode = await res.json() as DriveNode;
      setNodes(prev => [...prev, newNode]);
      if (type === 'file') handleNodeSelect(newNode);
      toast.success(`${type === 'file' ? 'Nota' : 'Carpeta'} creada`);
      return true;
    } catch {
      toast.error('Error de red');
      return false;
    }
  };

  const handleNavigate = (fileName: string) => {
    const target = nodes.find(n => {
      const { metadata } = parseMarkdownMetadata(n.content || '');
      const nameMatch = n.name.replace('.md', '') === fileName || n.name === fileName || metadata.title === fileName;
      const aliasMatch = metadata.aliases?.includes(fileName);
      return nameMatch || aliasMatch;
    });
    if (target) handleNodeSelect(target);
  };
  editorHandlers.current.onNavigate = handleNavigate;

  const handleManualSave = async () => {
    if (!activeNode) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    try {
      const res = await fetch('/api/node', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: activeNode.id, content: activeNode.content }),
      });
      if (res.ok) toast.success('Guardado');
      else toast.error('Error al guardar');
    } catch {
      toast.error('Error de red');
    }
  };

  const handleExportPdf = () => {
    if (!activeNode) return;
    window.print();
  };

  const handleShare = async () => {
    if (!activeNode) return;
    setSharePopoverOpen(v => {
      if (!v) setShareToken(null);
      return !v;
    });
    if (!sharePopoverOpen) {
      setShareLoading(true);
      try {
        const res = await fetch('/api/share', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nodeId: activeNode.id }),
        });
        if (res.ok) {
          const { token } = await res.json();
          setShareToken(token);
        }
      } finally {
        setShareLoading(false);
      }
    }
  };

  const handleRevokeShare = async () => {
    if (!activeNode) return;
    await fetch(`/api/share?nodeId=${activeNode.id}`, { method: 'DELETE' });
    setShareToken(null);
    toast.success('Enlace revocado');
  };

  const handleAiSend = async () => {
    const text = aiInputRef.current?.value.trim() ?? '';
    if (!text || aiLoading) return;
    const newMessages = [...aiMessages, { role: 'user' as const, content: text }];
    setAiMessages(newMessages);
    if (aiInputRef.current) aiInputRef.current.value = '';
    setAiLoading(true);
    setAiSources([]);
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages,
          workspaceId: activeWorkspaceId || undefined,
          nodeId: activeNode?.id || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setAiMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
        setAiSources(data.sources ?? []);
      } else {
        setAiMessages(prev => [...prev, { role: 'assistant', content: `⚠️ ${data.message ?? 'Error al conectar con la IA.'}` }]);
      }
    } catch {
      setAiMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Error de red.' }]);
    } finally {
      setAiLoading(false);
      setTimeout(() => aiEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    // Keep only markdown files (webkitRelativePath is set for folder uploads).
    const valid = Array.from(e.target.files).filter(f => /\.(md|markdown)$/i.test(f.name));
    if (valid.length === 0) {
      toast.error('No se encontraron archivos .md');
      e.target.value = '';
      return;
    }

    setIsUploading(true);
    const toastId = toast.loading(`Subiendo 0/${valid.length}…`);

    // Send in size-bounded batches so a 12k-file folder doesn't blow up browser
    // memory or exceed request limits. Content is read per batch (not all upfront)
    // and the server reuses existing folders so batches stitch into one tree.
    const MAX_BATCH_BYTES = 3 * 1024 * 1024; // ~3 MB of content per request
    const MAX_BATCH_FILES = 500;
    const wsId = activeWorkspaceId && activeWorkspaceId.trim() ? activeWorkspaceId : (workspaceList[0]?.id ?? null);

    const insertedNodes: DriveNode[] = [];
    let done = 0;
    let batch: File[] = [];
    let batchBytes = 0;

    const flush = async () => {
      if (batch.length === 0) return;
      const payloadFiles = await Promise.all(
        batch.map(async f => ({ path: (f as any).webkitRelativePath || f.name, content: await f.text() }))
      );
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: uploadGroup || null, workspaceId: wsId, files: payloadFiles }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      insertedNodes.push(...(data.nodes ?? []));
      done += batch.length;
      toast.loading(`Subiendo ${done}/${valid.length}…`, { id: toastId });
      batch = [];
      batchBytes = 0;
    };

    try {
      for (const f of valid) {
        if (batch.length >= MAX_BATCH_FILES || (batch.length > 0 && batchBytes + f.size > MAX_BATCH_BYTES)) {
          await flush();
        }
        batch.push(f);
        batchBytes += f.size;
      }
      await flush();

      // De-dupe against current state (folders reused across batches may repeat).
      setNodes(prev => {
        const seen = new Set(prev.map(n => n.id));
        const fresh = insertedNodes.filter(n => !seen.has(n.id));
        return [...prev, ...fresh];
      });
      toast.success(`${done} archivo${done > 1 ? 's' : ''} subido${done > 1 ? 's' : ''}`, { id: toastId });
    } catch (err) {
      toast.error(`Subida interrumpida tras ${done}/${valid.length} archivos`, { id: toastId });
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };


  const toggleFavorite = () => {
    if (!activeNode) return;
    setFavorites(prev => 
      prev.includes(activeNode.id) ? prev.filter(id => id !== activeNode.id) : [...prev, activeNode.id]
    );
  };

  const getBreadcrumb = () => {
    if (!activeNode) return '';
    let path = activeNode.name.replace('.md', '');
    let curr = activeNode;
    while(curr.parentId) {
      const parent = nodes.find(n => n.id === curr.parentId);
      if (parent) {
        path = parent.name + ' / ' + path;
        curr = parent;
      } else {
        break;
      }
    }
    return path;
  };

  const getBreadcrumbPath = (parentId: string | null | undefined) => {
    if (!parentId) return '';
    let path = '';
    let curr: any = nodes.find(n => n.id === parentId);
    while(curr) {
      path = path ? curr.name + ' / ' + path : curr.name;
      curr = nodes.find(n => n.id === curr.parentId);
    }
    return path;
  };

  const stripMarkdownToText = (content: string): string => {
    let text = content;

    // Remove code blocks (``` ... ```)
    text = text.replace(/```[\s\S]*?```/g, '');

    // Remove mermaid blocks (```mermaid ... ```)
    text = text.replace(/```mermaid[\s\S]*?```/g, '');

    // Remove ASCII diagram blocks (```ascii, ```diagram, ```txt, ```text, etc.)
    text = text.replace(/```(?:ascii|diagram|txt|text|art)[\s\S]*?```/g, '');

    // Remove inline code (`...`)
    text = text.replace(/`[^`]+`/g, '');

    // Remove images ![alt](url)
    text = text.replace(/!\[.*?\]\(.*?\)/g, '');

    // Convert links [text](url) to just text
    text = text.replace(/\[([^\]]+)\]\([^\)]*\)/g, '$1');

    // Remove common emojis (by replacing with space and filtering)
    const emojiRegex = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/g;
    text = text.replace(emojiRegex, '');

    // Remove markdown formatting
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1'); // bold
    text = text.replace(/\*([^*]+)\*/g, '$1'); // italic
    text = text.replace(/__([^_]+)__/g, '$1'); // bold with underscore
    text = text.replace(/_([^_]+)_/g, '$1'); // italic with underscore
    text = text.replace(/^#+\s+/gm, ''); // headings
    text = text.replace(/^>\s+/gm, ''); // blockquotes
    text = text.replace(/^---+$/gm, ''); // horizontal rules

    // Remove ASCII art lines (lines with mostly box-drawing or ASCII art characters)
    text = text.split('\n').filter(line => {
      const asciiArtChars = /[│─┌┐└┘├┤┬┴┼║═╔╗╚╝╠╣╦╩╬┃┄┅┆┇┈┉┊┋]/g;
      const matches = line.match(asciiArtChars) || [];
      const asciiRatio = matches.length / line.length;
      return asciiRatio < 0.3; // If more than 30% ASCII art chars, skip
    }).join('\n');

    // Collapse multiple blank lines
    text = text.replace(/\n{3,}/g, '\n\n');

    // Clean up extra spaces
    text = text.replace(/\s+/g, ' ').trim();

    return text;
  };

  const speakTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopSpeaking = () => {
    window.speechSynthesis.cancel();
    if (speakTimer.current) { clearInterval(speakTimer.current); speakTimer.current = null; }
    setIsSpeaking(false);
  };

  const handleSpeak = () => {
    if (!activeNode) return;
    const synth = window.speechSynthesis;

    if (isSpeaking) {
      stopSpeaking();
      return;
    }

    const { cleanContent } = parseMarkdownMetadata(activeNode.content || '');
    const textToRead = stripMarkdownToText(cleanContent);

    if (!textToRead) {
      toast.error('No text content to read');
      return;
    }

    // The Web Speech API cuts off long utterances (Chrome stops after ~15s), so
    // split the text into short chunks (by sentence, ~200 chars) and queue them.
    const maxLen = 200;
    const pieces = textToRead.replace(/\s+/g, ' ').match(/[^.!?\n]+[.!?]*\s*/g) || [textToRead];
    const chunks: string[] = [];
    let cur = '';
    for (const p of pieces) {
      if (p.length > maxLen) {
        if (cur.trim()) { chunks.push(cur.trim()); cur = ''; }
        for (let i = 0; i < p.length; i += maxLen) chunks.push(p.slice(i, i + maxLen).trim());
        continue;
      }
      if ((cur + p).length > maxLen && cur) { chunks.push(cur.trim()); cur = ''; }
      cur += p;
    }
    if (cur.trim()) chunks.push(cur.trim());
    const queue = chunks.filter(Boolean);
    if (queue.length === 0) { toast.error('No text content to read'); return; }

    const voice = voices.find(v => v.name === selectedVoice);
    synth.cancel();
    setIsSpeaking(true);
    // Chrome pauses synthesis after ~15s even mid-queue; a periodic resume() keeps it going.
    if (speakTimer.current) clearInterval(speakTimer.current);
    speakTimer.current = setInterval(() => window.speechSynthesis.resume(), 10000);
    queue.forEach((chunk, i) => {
      const u = new SpeechSynthesisUtterance(chunk);
      if (voice) u.voice = voice;
      if (i === queue.length - 1) u.onend = () => stopSpeaking();
      u.onerror = () => stopSpeaking();
      synth.speak(u);
    });
  };

  // Nodes filtered by active workspace
  const visibleNodes = useMemo(() => {
    const wsId = activeWorkspaceId || workspaceList[0]?.id;
    if (!wsId) return nodes;
    const isDefaultWorkspace = wsId === workspaceList[0]?.id;
    return nodes.filter(n =>
      n.workspaceId === wsId ||
      (n.workspaceId === null && isDefaultWorkspace)
    );
  }, [nodes, activeWorkspaceId, workspaceList]);

  // Search Results
  const searchResults = useMemo(() => {
    if (!searchQuery) return [];
    return visibleNodes.filter(n => {
       if (n.type !== 'file') return false;
       const q = searchQuery.toLowerCase();
       if (n.name.toLowerCase().includes(q)) return true;
       // Check tags and content
       const { metadata, cleanContent } = parseMarkdownMetadata(n.content || '');
       if (metadata.tags && metadata.tags.some(t => t.toLowerCase().includes(q))) return true;
       if (cleanContent.toLowerCase().includes(q)) return true;
       return false;
    });
  }, [nodes, searchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
  <>
    <main data-print-hide style={{ display: 'flex', background: 'transparent' }} className="h-screen w-full animate-fade-in obsidian-layout">

      {/* Floating, collapsible ribbon: most-used actions always shown; the rest
          appear when expanded. */}
      <div className={`${styles.ribbon} ${styles.glass}`} style={{ zIndex: graphOpen ? 1001 : undefined }}>
        {/* Primary (most-used) */}
        <div className={styles.ribbonIcon} onClick={() => toggleSidebarView('files')} title="Espacios (clic para abrir/cerrar)">
          <Folder size={20} />
        </div>
        {isEditor && (
          <div className={styles.ribbonIcon} onClick={() => setCreateModalOpen(true)} title="Create New File">
            <Plus size={20} />
          </div>
        )}
        {isEditor && (
          <div className={styles.ribbonIcon} onClick={() => setImportOpen(true)} title="Importar (Markdown, carpetas, Word, web, PDF)">
            <FileInput size={20} />
          </div>
        )}
        <div className={styles.ribbonIcon} onClick={() => toggleSidebarView('search')} title="Search">
          <Search size={20} />
        </div>
        <div className={styles.ribbonIcon} onClick={() => toggleSidebarView('favorites')} title="Bookmarks">
          <Bookmark size={20} />
        </div>
        <div className={styles.ribbonIcon} onClick={() => toggleSidebarView('ai')} title="Asistente IA">
          <Sparkles size={20} />
        </div>
        {isEditor && (
          <div className={styles.ribbonIcon} onClick={() => {
            if (toggleSidebarView('shares')) {
              fetch('/api/folders/share?mine=true').then(r => r.json()).then(data => {
                if (Array.isArray(data)) setMyShares(data);
              });
            }
          }} title="Compartidos">
            <Share size={20} />
          </div>
        )}

        {/* Secondary — always mounted so it animates open AND closed */}
        <div className={`${styles.ribbonSecondary} ${ribbonExpanded ? styles.ribbonSecondaryOpen : ''}`}>
          <div className={styles.ribbonDivider} />
          {isEditor && (user.role === 'admin' || groups.length > 0) && (
            <>
              <label className={styles.ribbonIcon} title="Upload markdown files" style={{ cursor: 'pointer' }}>
                <FileIcon size={20} />
                <input
                  type="file"
                  accept=".md,.markdown,text/markdown"
                  multiple
                  onChange={handleUpload}
                  disabled={isUploading}
                  style={{ display: 'none' }}
                />
              </label>
              <label className={styles.ribbonIcon} title="Upload folder" style={{ cursor: 'pointer' }}>
                <UploadCloud size={20} />
                {/* @ts-ignore */}
                <input type="file" webkitdirectory="" directory="" onChange={handleUpload} disabled={isUploading} style={{ display: 'none' }} />
              </label>
            </>
          )}
          <div className={`${styles.ribbonIcon} ${styles.hideOnMobile}`} onClick={() => { setGraphOpen(true); setSidebarOpen(false); }} title="Graph View">
            <Network size={20} />
          </div>
          <Link href="/org/people" className={styles.ribbonIcon} title="Organization">
            <Users size={20} />
          </Link>
          <Link href="/settings" className={styles.ribbonIcon} title="Settings / BYOK">
            <Settings size={20} />
          </Link>
          {isSuperAdmin(user) && (
            <Link href="/admin" className={styles.ribbonIcon} title="Gestión SaaS">
              <CircleDollarSign size={20} />
            </Link>
          )}
        </div>

        {/* Expand / collapse toggle */}
        <div
          className={styles.ribbonIcon}
          onClick={() => setRibbonExpanded(v => !v)}
          title={ribbonExpanded ? 'Menos opciones' : 'Más opciones'}
        >
          {ribbonExpanded ? <X size={20} /> : <MoreHorizontal size={20} />}
        </div>

        <div style={{ flex: 1 }}></div>

        <div
          className={styles.ribbonIcon}
          title={`Cerrar sesión (${user.email})`}
          onClick={async () => {
            await fetch('/api/logout', { method: 'POST' });
            window.location.href = '/login';
          }}
        >
          <LogOut size={20} />
        </div>
      </div>

      {/* Floating, draggable liquid-glass panel holding the spaces/folders tree. */}
      <div
        ref={sidebarRef}
        className={`${styles.floatingSidebar} ${styles.glass}`}
        style={{
          left: `${sidebarPos.x}px`,
          top: `${sidebarPos.y}px`,
          width: `${sidebarWidth}px`,
          opacity: sidebarOpen ? 1 : 0,
          transform: sidebarOpen ? 'translateX(0) scale(1)' : 'translateX(-16px) scale(0.98)',
          pointerEvents: sidebarOpen ? 'auto' : 'none',
          zIndex: graphOpen ? 1001 : undefined,
        }}
      >
        <div className={styles.sidebarResizeHandle} onPointerDown={onSidebarResizeStart} title="Arrastra para ensanchar/achicar" />

        <div
          className={styles.sidebarHeader}
          onPointerDown={onSidebarDragStart}
          style={{ padding: '8px 10px', gap: '6px', height: '44px', boxSizing: 'border-box' }}
        >
          <span className={styles.sidebarGrip} title="Arrastra para mover"><GripVertical size={15} /></span>
          {workspaceList.length > 1 ? (
            <select
              value={activeWorkspaceId}
              onChange={e => setActiveWorkspaceId(e.target.value)}
              style={{ flex: 1, background: 'var(--surface-2)', border: '1px solid var(--border-light)', color: 'var(--foreground)', padding: '4px 6px', borderRadius: '5px', fontSize: '0.8rem', cursor: 'pointer', minWidth: 0 }}
            >
              {workspaceList.map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          ) : (
            <span style={{ flex: 1, fontSize: '0.8rem', opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {workspaceList[0]?.name ?? 'Mi Workspace'}
            </span>
          )}
          <button onClick={() => setSidebarOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--foreground)', cursor: 'pointer', opacity: 0.6, flexShrink: 0, display: 'flex' }}>
            <PanelLeftClose size={16} />
          </button>
        </div>

        {sidebarView === 'files' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'auto' }}>
            <FileTree
              nodes={visibleNodes}
              onSelectNode={handleNodeSelect}
              activeNodeId={activeNode?.id || null}
              isOpen={true}
              onDeleteNode={isEditor ? handleDeleteNode : undefined}
              onRenameNode={isEditor ? handleRenameNode : undefined}
              onShareNode={handleShareNode}
              onMoveNode={isEditor ? handleMoveNode : undefined}
              onReorderNode={isEditor ? handleReorderNode : undefined}
              onCreateNode={isEditor ? handleCreateNode : undefined}
            />
          </div>
        )}

        {sidebarView === 'search' && (
          <div style={{ padding: '16px', flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto' }}>
            {/* Mode toggle */}
            <div style={{ display: 'flex', background: 'var(--surface-2)', borderRadius: '6px', padding: '2px' }}>
              {([
                { key: 'keyword', label: 'Nombre' },
                { key: 'fulltext', label: 'Texto' },
                { key: 'semantic', label: '✦ Semántica' },
              ] as const).map(m => (
                <button
                  key={m.key}
                  onClick={() => { setSearchMode(m.key); setSemanticResults([]); setFtResults([]); }}
                  style={{ flex: 1, padding: '5px', fontSize: '0.75rem', border: 'none', borderRadius: '5px', cursor: 'pointer', fontFamily: 'inherit',
                    background: searchMode === m.key ? 'var(--accent-primary)' : 'transparent',
                    color: searchMode === m.key ? '#fff' : 'rgba(255,255,255,0.5)'
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <input
              value={searchQuery}
              onChange={e => {
                const q = e.target.value;
                setSearchQuery(q);
                const remote = searchMode === 'semantic' || searchMode === 'fulltext';
                if (remote && q.trim().length > 2) {
                  if (semanticTimer.current) clearTimeout(semanticTimer.current);
                  setSemanticLoading(true);
                  const mode = searchMode;
                  semanticTimer.current = setTimeout(async () => {
                    try {
                      const url = mode === 'semantic'
                        ? `/api/search?q=${encodeURIComponent(q)}`
                        : `/api/search/text?q=${encodeURIComponent(q)}`;
                      const res = await fetch(url);
                      if (res.ok) {
                        const data = await res.json();
                        if (mode === 'semantic') setSemanticResults(data); else setFtResults(data);
                      }
                    } finally { setSemanticLoading(false); }
                  }, mode === 'fulltext' ? 250 : 600);
                } else {
                  setSemanticResults([]);
                  setFtResults([]);
                  setSemanticLoading(false);
                }
              }}
              placeholder={searchMode === 'semantic' ? 'Escribe una idea o concepto...' : searchMode === 'fulltext' ? 'Buscar texto dentro de los documentos...' : 'Buscar por nombre, tags...'}
              style={{ padding: '8px', background: 'var(--surface-2)', border: '1px solid var(--border-light)', color: 'white', borderRadius: '4px', width: '100%' }}
            />

            {semanticLoading && (
              <div style={{ fontSize: '0.78rem', opacity: 0.5, textAlign: 'center' }}>Buscando...</div>
            )}

            {searchMode === 'semantic' && !semanticLoading && semanticResults.length === 0 && searchQuery.length === 0 && user.role === 'admin' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <p style={{ fontSize: '0.75rem', opacity: 0.45, margin: 0 }}>
                  Las notas existentes necesitan ser indexadas para aparecer en búsqueda semántica.
                </p>
                <button
                  onClick={async () => {
                    setReindexing(true);
                    try {
                      const res = await fetch('/api/admin/reindex', { method: 'POST' });
                      const data = await res.json();
                      toast.success(`${data.reindexed} notas indexadas`);
                    } catch { toast.error('Error al reindexar'); }
                    finally { setReindexing(false); }
                  }}
                  disabled={reindexing}
                  style={{ fontSize: '0.78rem', padding: '6px 10px', background: 'var(--surface-2)', border: '1px solid var(--border-light)', color: 'var(--foreground)', borderRadius: '6px', cursor: reindexing ? 'not-allowed' : 'pointer', opacity: reindexing ? 0.6 : 1 }}
                >
                  {reindexing ? 'Indexando...' : '⟳ Reindexar notas existentes'}
                </button>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {searchMode === 'semantic' ? (
                semanticResults.map(r => (
                  <div key={r.id} onClick={() => { const n = nodes.find(x => x.id === r.id); if (n) handleNodeSelect(n); }}
                    style={{ padding: '8px', cursor: 'pointer', borderRadius: '4px', background: activeNode?.id === r.id ? 'var(--surface-3)' : 'transparent', display: 'flex', flexDirection: 'column', gap: '2px' }} className="hoverable">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.85rem' }}>{r.name.replace('.md', '')}</span>
                      <span style={{ fontSize: '0.7rem', opacity: 0.4 }}>{Math.round(r.score * 100)}%</span>
                    </div>
                    {r.excerpt && <span style={{ fontSize: '0.72rem', opacity: 0.45, lineHeight: 1.4 }}>{r.excerpt.slice(0, 100)}…</span>}
                  </div>
                ))
              ) : searchMode === 'fulltext' ? (
                searchQuery.trim().length > 2
                  ? (ftResults.length > 0
                      ? ftResults.map(r => (
                          <div key={r.id} onClick={() => { const n = nodes.find(x => x.id === r.id); if (n) handleNodeSelect(n); }}
                            style={{ padding: '8px', cursor: 'pointer', borderRadius: '4px', background: activeNode?.id === r.id ? 'var(--surface-3)' : 'transparent', display: 'flex', flexDirection: 'column', gap: '2px' }} className="hoverable">
                            <span style={{ fontSize: '0.85rem' }}>{r.name.replace('.md', '')}</span>
                            {r.snippet && <span style={{ fontSize: '0.72rem', opacity: 0.5, lineHeight: 1.4 }} dangerouslySetInnerHTML={{ __html: r.snippet }} />}
                          </div>
                        ))
                      : (!semanticLoading && <span style={{ fontSize: '0.8rem', opacity: 0.4 }}>Sin resultados para &quot;{searchQuery}&quot;</span>))
                  : null
              ) : (
                searchQuery.trim()
                  ? (searchResults.length > 0
                      ? searchResults.map(n => {
                          const parentPath = getBreadcrumbPath(n.parentId);
                          return (
                            <div key={n.id} onClick={() => handleNodeSelect(n)} style={{ padding: '8px', cursor: 'pointer', borderRadius: '4px', background: activeNode?.id === n.id ? 'var(--surface-3)' : 'transparent', display: 'flex', flexDirection: 'column' }} className="hoverable">
                              <span style={{ fontSize: '0.85rem' }}>{n.name}</span>
                              {parentPath && <span style={{ fontSize: '0.7rem', opacity: 0.5, marginTop: '4px' }}>en {parentPath}</span>}
                            </div>
                          );
                        })
                      : <span style={{ fontSize: '0.8rem', opacity: 0.4 }}>Sin resultados para &quot;{searchQuery}&quot;</span>)
                  : null
              )}
            </div>
          </div>
        )}

        {sidebarView === 'favorites' && (
          <div style={{ padding: '16px', flex: 1, overflowY: 'auto' }}>
            <h3 style={{ fontSize: '0.9rem', marginBottom: '16px', opacity: 0.8 }}>Saved Documents</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {favorites.map(id => {
                const n = nodes.find(x => x.id === id);
                if (!n) return null;
                return (
                  <div key={id} onClick={() => handleNodeSelect(n)} style={{ padding: '8px', cursor: 'pointer', borderRadius: '4px', background: activeNode?.id === id ? 'var(--surface-3)' : 'transparent' }} className="hoverable">
                     <span style={{ fontSize: '0.85rem' }}><FileIcon size={12} style={{display:'inline', marginRight:'8px'}}/>{n.name}</span>
                  </div>
                )
              })}
              {favorites.length === 0 && <span style={{ fontSize: '0.8rem', opacity: 0.5 }}>No favorites added.</span>}
            </div>
          </div>
        )}

        {sidebarView === 'shares' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Share size={14} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
              <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Mis Compartidos</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {myShares.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 8px', opacity: 0.45, fontSize: '0.78rem', lineHeight: 1.6 }}>
                  <Share size={22} style={{ display: 'block', margin: '0 auto 8px' }} />
                  No has compartido ninguna carpeta aún.
                </div>
              ) : (() => {
                const byFolder: Record<string, any[]> = {};
                myShares.forEach(s => {
                  if (!byFolder[s.folder_id]) byFolder[s.folder_id] = [];
                  byFolder[s.folder_id].push(s);
                });
                return Object.entries(byFolder).map(([folderId, shares]) => (
                  <div key={folderId} style={{ background: 'var(--surface-2)', borderRadius: '8px', padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                      <Folder size={13} style={{ color: '#6366f1', flexShrink: 0 }} />
                      <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{shares[0].folder_name}</span>
                    </div>
                    {shares.map((s: any) => (
                      <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 0', borderTop: '1px solid var(--border-light)' }}>
                        <span style={{ flex: 1, fontSize: '0.78rem', opacity: 0.8, wordBreak: 'break-all' }}>{s.shared_with}</span>
                        <span style={{ fontSize: '0.72rem', opacity: 0.5, whiteSpace: 'nowrap' }}>{s.access_level}</span>
                        <button
                          onClick={async () => {
                            await fetch(`/api/folders/share?shareId=${s.id}`, { method: 'DELETE' });
                            setMyShares(prev => prev.filter(x => x.id !== s.id));
                          }}
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#e06c75', padding: '2px', flexShrink: 0 }}
                          title="Revocar acceso"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                ));
              })()}
            </div>
          </div>
        )}

        {sidebarView === 'ai' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            {/* Chat header */}
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sparkles size={14} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
              <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Asistente IA</span>
              {aiMessages.length > 0 && (
                <button onClick={() => { setAiMessages([]); setAiSources([]); }} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', opacity: 0.4, color: 'var(--foreground)', fontSize: '0.72rem' }}>
                  Limpiar
                </button>
              )}
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {aiMessages.length === 0 && (
                <div style={{ textAlign: 'center', padding: '24px 8px', opacity: 0.45, fontSize: '0.78rem', lineHeight: 1.6 }}>
                  <Sparkles size={22} style={{ marginBottom: '8px', display: 'block', margin: '0 auto 8px' }} />
                  Pregunta sobre tus notas o pide ayuda para escribir.
                  {activeNode && (
                    <div style={{ marginTop: '8px', opacity: 0.7 }}>
                      Contexto activo: <strong>{activeNode.name.replace('.md', '')}</strong>
                    </div>
                  )}
                </div>
              )}
              {aiMessages.map((msg, i) => (
                <div key={i} style={{
                  alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '90%',
                  background: msg.role === 'user' ? 'var(--accent-primary)' : 'var(--surface-2)',
                  color: msg.role === 'user' ? '#fff' : 'var(--foreground)',
                  padding: '8px 12px',
                  borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                  fontSize: '0.82rem',
                  lineHeight: 1.55,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {msg.content}
                </div>
              ))}
              {aiLoading && (
                <div style={{ alignSelf: 'flex-start', background: 'var(--surface-2)', padding: '8px 12px', borderRadius: '12px 12px 12px 2px', fontSize: '0.82rem', opacity: 0.6 }}>
                  ···
                </div>
              )}
              {aiSources.length > 0 && !aiLoading && (
                <div style={{ fontSize: '0.7rem', opacity: 0.4, display: 'flex', flexWrap: 'wrap', gap: '4px', paddingTop: '4px' }}>
                  <span>Fuentes:</span>
                  {aiSources.map(s => (
                    <span key={s.id} onClick={() => { const n = nodes.find(x => x.id === s.id); if (n) handleNodeSelect(n); }} style={{ cursor: 'pointer', textDecoration: 'underline' }}>
                      {s.name.replace('.md', '')}
                    </span>
                  ))}
                </div>
              )}
              <div ref={aiEndRef} />
            </div>

            {/* Input */}
            <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border-light)', display: 'flex', gap: '6px' }}>
              <textarea
                ref={aiInputRef}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAiSend(); } }}
                placeholder="Escribe tu pregunta... (Enter para enviar)"
                rows={2}
                style={{ flex: 1, background: 'var(--surface-2)', border: '1px solid var(--border-light)', color: 'var(--foreground)', padding: '7px 10px', borderRadius: '6px', fontSize: '0.8rem', resize: 'none', fontFamily: 'inherit', lineHeight: 1.4 }}
              />
              <button
                onClick={handleAiSend}
                disabled={aiLoading}
                style={{ background: 'var(--accent-primary)', color: '#fff', border: 'none', borderRadius: '6px', padding: '0 12px', cursor: aiLoading ? 'not-allowed' : 'pointer', opacity: aiLoading ? 0.5 : 1, display: 'flex', alignItems: 'center' }}
              >
                <Send size={15} />
              </button>
            </div>
          </div>
        )}

      </div>

      {/* Main Area */}
      <div className={styles.mainArea} style={{ background: 'transparent' }}>
        
        {/* Tab Bar */}
        <div className={styles.tabBar}>
           {!sidebarOpen && (
             <button onClick={() => setSidebarOpen(true)} className={styles.tabBarButton} title="Expand Sidebar">
               <PanelLeftOpen size={18} />
             </button>
           )}
           {openTabs.map(tab => (
             <div key={tab.id} className={`${styles.tab} ${activeNode?.id === tab.id ? styles.activeTab : ''}`} onClick={() => handleNodeSelect(tab)}>
               <span style={{ paddingRight: '12px' }}>{tab.name.replace('.md', '')}</span>
               <button onClick={(e) => closeTab(e, tab.id)} className={styles.closeTabBtn}><X size={14}/></button>
             </div>
           ))}
        </div>

        <header className={styles.editorHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <ChevronLeft size={20} onClick={handleNavBack} style={{ opacity: navIndex > 0 ? 0.9 : 0.3, cursor: navIndex > 0 ? 'pointer' : 'default' }} />
            <ChevronRight size={20} onClick={handleNavForward} style={{ opacity: navIndex < navHistory.length - 1 ? 0.9 : 0.3, cursor: navIndex < navHistory.length - 1 ? 'pointer' : 'default' }} />
            <span style={{ fontSize: '0.85rem', fontWeight: 500, opacity: 0.7, marginLeft: '8px' }}>
              {getBreadcrumb() || 'No file selected'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
             {activeNode && (
               <>
                 <button onClick={toggleFavorite} className={styles.iconBtn} title="Favorite">
                   <Bookmark size={18} style={{ fill: favorites.includes(activeNode.id) ? 'var(--accent-primary)' : 'transparent', color: favorites.includes(activeNode.id) ? 'var(--accent-primary)' : 'var(--foreground)' }} />
                 </button>
                 <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                   {voices.length > 0 && (
                     <select
                       value={selectedVoice}
                       onChange={e => setSelectedVoice(e.target.value)}
                       style={{
                         background: 'var(--surface-1)',
                         border: '1px solid rgba(255,255,255,0.15)',
                         color: 'rgba(255,255,255,0.8)',
                         padding: '3px 6px',
                         borderRadius: '4px',
                         fontSize: '0.75rem',
                         cursor: 'pointer',
                         maxWidth: '140px'
                       }}
                       title="Select voice"
                     >
                       {voices.map(v => (
                         <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>
                       ))}
                     </select>
                   )}
                   <button onClick={handleSpeak} className={styles.iconBtn} title={isSpeaking ? "Stop reading" : "Read aloud"}>
                     {isSpeaking ? <VolumeX size={18} /> : <Volume2 size={18} />}
                   </button>
                 </div>
                 <button onClick={handleExportPdf} className={styles.iconBtn} title="Export as PDF">
                   <Printer size={18} />
                 </button>
                 <button
                   className={styles.iconBtn}
                   title="Descargar markdown (.md)"
                   onClick={() => {
                     if (!activeNode) return;
                     const name = activeNode.name.endsWith('.md') ? activeNode.name : `${activeNode.name}.md`;
                     const blob = new Blob([activeNode.content ?? ''], { type: 'text/markdown;charset=utf-8' });
                     const url = URL.createObjectURL(blob);
                     const a = document.createElement('a');
                     a.href = url;
                     a.download = name;
                     a.click();
                     URL.revokeObjectURL(url);
                   }}
                 >
                   <Download size={18} />
                 </button>
                 {/* Share button + popover */}
                 <div style={{ position: 'relative' }}>
                   <button onClick={handleShare} className={styles.iconBtn} title="Compartir nota" style={{ color: shareToken ? 'var(--accent-primary)' : undefined }}>
                     <Share size={18} />
                   </button>
                   {sharePopoverOpen && (
                     <div style={{ position: 'absolute', top: '36px', right: 0, background: 'var(--surface-1)', border: '1px solid var(--border-light)', borderRadius: '10px', padding: '16px', width: '320px', boxShadow: 'var(--shadow-glass)', zIndex: 500 }} onClick={e => e.stopPropagation()}>
                       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                         <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>Compartir nota</span>
                         <X size={14} style={{ cursor: 'pointer', opacity: 0.5 }} onClick={() => setSharePopoverOpen(false)} />
                       </div>
                       {shareLoading ? (
                         <div style={{ fontSize: '0.8rem', opacity: 0.5, textAlign: 'center', padding: '8px' }}>Generando enlace...</div>
                       ) : shareToken ? (
                         <>
                           <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                             <input
                               readOnly
                               value={`${window.location.origin}/share/${shareToken}`}
                               style={{ flex: 1, background: 'var(--surface-2)', border: '1px solid var(--border-light)', color: 'var(--foreground)', padding: '7px 10px', borderRadius: '6px', fontSize: '0.78rem' }}
                             />
                             <button
                               onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/share/${shareToken}`); toast.success('Enlace copiado'); }}
                               style={{ padding: '7px 12px', background: 'var(--accent-primary)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap' }}
                             >
                               Copiar
                             </button>
                           </div>
                           <p style={{ fontSize: '0.72rem', opacity: 0.45, margin: '0 0 10px' }}>Cualquier persona con el enlace puede leer esta nota.</p>
                           <button onClick={handleRevokeShare} style={{ fontSize: '0.75rem', color: '#e06c75', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
                             Revocar acceso
                           </button>
                         </>
                       ) : (
                         <div style={{ fontSize: '0.8rem', opacity: 0.5 }}>No se pudo generar el enlace.</div>
                       )}
                     </div>
                   )}
                 </div>
                 {isEditor && (
                   <>
                     <button onClick={handleManualSave} className={styles.iconBtn} title="Save File">
                       <Save size={18} />
                     </button>
                     <button onClick={() => setIsEditMode(!isEditMode)} className={styles.iconBtn} title={isEditMode ? "Switch to View" : "Switch to Edit"}>
                       {isEditMode ? <BookOpen size={18} /> : <Pencil size={18} /> }
                     </button>
                   </>
                 )}
               </>
             )}
          </div>
        </header>

        {activeNode && activeNode.type === 'file' ? (
          <div style={{ flex: 1, overflow: 'auto', position: 'relative', display: 'flex', flexDirection: 'column' }}>
             <MarkdownEditor
               content={activeNode.content || ''}
               onChange={editorOnChange}
               onNavigate={editorOnNavigate}
               forceMode={isEditMode ? 'edit' : 'preview'}
               onTagClick={editorOnTagClick}
             />

             {/* Mini graph of links: the 5 documents most connected to this one,
                 pinned under the TOC at the bottom-right. */}
             {!isEditMode && relatedDocs.length > 0 && (
               <aside
                 ref={relatedRef}
                 className={styles.relatedPanel}
                 aria-label="Documentos relacionados"
                 style={relatedPos ? { left: relatedPos.x, top: relatedPos.y, right: 'auto', bottom: 'auto' } : undefined}
               >
                 <div
                   className={styles.relatedHeader}
                   onPointerDown={onRelatedDragStart}
                   title="Clic: colapsar/expandir · Arrastrar: mover"
                   style={relatedCollapsed ? { marginBottom: 0 } : undefined}
                 >
                   <GripVertical size={11} style={{ opacity: 0.5, flexShrink: 0 }} />
                   <Network size={12} />
                   <span style={{ flex: 1 }}>Relacionados{relatedCollapsed ? ` (${relatedDocs.length})` : ''}</span>
                   <ChevronDown size={12} style={{ transform: relatedCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.2s ease', flexShrink: 0 }} />
                 </div>
                 {!relatedCollapsed && relatedDocs.map(r => (
                   <button key={r.id} className={styles.relatedItem} onClick={() => handleGraphNodeClick(r.id)} title={r.name}>
                     <span className={styles.relatedKinds}>
                       {r.kinds.includes('link') && <i style={{ background: '#e0e6ed' }} title="Enlace directo" />}
                       {r.kinds.includes('semantic') && <i style={{ background: '#818cf8' }} title="Similitud IA" />}
                       {r.kinds.includes('keyword') && <i style={{ background: '#67e8f9' }} title="Términos compartidos" />}
                     </span>
                     <span className={styles.relatedName}>{r.name}</span>
                     <span className={styles.relatedBar}><i style={{ width: `${Math.min(100, Math.round(r.score * 25))}%` }} /></span>
                   </button>
                 ))}
               </aside>
             )}
          </div>
        ) : (
          <div className="flex-center h-full w-full" style={{ fontSize: '0.875rem', opacity: 0.5 }}>
            Select a file to start editing.
          </div>
        )}

        {graphOpen && (
          <KnowledgeGraph nodes={nodes} onNodeClick={(id) => { handleGraphNodeClick(id); setGraphOpen(false); }} onClose={() => setGraphOpen(false)} />
        )}

        {/* Confirm Delete Modal */}
        {confirmDeleteId && (() => {
          const target = nodes.find(n => n.id === confirmDeleteId);
          return (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={() => setConfirmDeleteId(null)}>
              <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border-light)', borderRadius: '10px', padding: '24px', width: '360px', boxShadow: 'var(--shadow-glass)' }} onClick={e => e.stopPropagation()}>
                <h3 style={{ margin: '0 0 8px', fontSize: '1rem', fontWeight: 600 }}>¿Eliminar {target?.type === 'folder' ? 'carpeta' : 'archivo'}?</h3>
                <p style={{ margin: '0 0 20px', fontSize: '0.85rem', opacity: 0.6 }}>
                  <strong>{target?.name.replace('.md', '')}</strong> se eliminará permanentemente{target?.type === 'folder' ? ' junto con todo su contenido' : ''}.
                </p>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                  <button onClick={() => setConfirmDeleteId(null)} className="btn" style={{ padding: '8px 16px' }}>Cancelar</button>
                  <button onClick={confirmDelete} style={{ padding: '8px 16px', background: '#e06c75', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>Eliminar</button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Create File Modal */}
        <ImportModal
          open={importOpen}
          onClose={() => setImportOpen(false)}
          workspaceId={activeWorkspaceId || workspaceList[0]?.id || null}
          folders={visibleNodes.filter(n => n.type === 'folder').map(n => ({ id: n.id, name: n.name }))}
          onCreated={(node) => { setNodes(prev => [...prev, node]); handleNodeSelect(node); }}
          onUploadMarkdown={handleUpload}
        />

        {createModalOpen && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '100px' }} onClick={() => { setCreateModalOpen(false); setNewFileName(''); setNewFileParentId(''); setNewFileType('file'); }}>
             <div style={{ background: 'var(--surface-1)', padding: '24px', borderRadius: '8px', width: '400px', boxShadow: 'var(--shadow-glass)', border: '1px solid var(--border-light)' }} onClick={e => e.stopPropagation()}>
               <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                 <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600 }}>Crear nuevo</h3>
                 <X size={16} onClick={() => { setCreateModalOpen(false); setNewFileName(''); setNewFileParentId(''); setNewFileType('file'); }} style={{ cursor: 'pointer', opacity: 0.5 }} />
               </div>
               
               <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

                 {/* Type toggle — File or Folder */}
                 <div style={{ display: 'flex', background: 'var(--surface-2)', borderRadius: '6px', padding: '2px' }}>
                   {(['file', 'folder'] as const).map(t => (
                     <button key={t} onClick={() => setNewFileType(t)}
                       style={{ flex: 1, padding: '6px', fontSize: '0.82rem', border: 'none', borderRadius: '5px', cursor: 'pointer', fontFamily: 'inherit',
                         background: newFileType === t ? 'var(--accent-primary)' : 'transparent',
                         color: newFileType === t ? '#fff' : 'rgba(255,255,255,0.5)' }}>
                       {t === 'file' ? '📄 Archivo' : '📁 Carpeta'}
                     </button>
                   ))}
                 </div>

                 <div>
                   <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', opacity: 0.7 }}>
                     {newFileType === 'file' ? 'Nombre (sin .md)' : 'Nombre de la carpeta'}
                   </label>
                   <input
                     autoFocus
                     value={newFileName}
                     onChange={e => setNewFileName(e.target.value)}
                     onKeyDown={e => { if (e.key === 'Enter') submitCreateRef.current?.(); }}
                     placeholder={newFileType === 'file' ? 'ej. mis-notas' : 'ej. Proyectos'}
                     style={{ background: 'var(--background)', border: '1px solid var(--border-light)', color: 'white', padding: '10px 12px', borderRadius: '6px', width: '100%', outline: 'none' }}
                   />
                 </div>

                 <div>
                   <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', opacity: 0.7 }}>Carpeta padre</label>
                   <select
                     value={newFileParentId}
                     onChange={e => setNewFileParentId(e.target.value)}
                     style={{ background: 'var(--background)', border: '1px solid var(--border-light)', color: 'white', padding: '10px 12px', borderRadius: '6px', width: '100%', outline: 'none' }}
                   >
                     <option value="">Raíz (/)</option>
                     {visibleNodes.filter(n => n.type === 'folder').map(folder => (
                       <option key={folder.id} value={folder.id}>
                         {getBreadcrumbPath(folder.parentId) ? getBreadcrumbPath(folder.parentId) + ' / ' + folder.name : folder.name}
                       </option>
                     ))}
                   </select>
                 </div>

                 <button
                   className="btn btn-primary"
                   style={{ width: '100%', justifyContent: 'center', marginTop: '8px' }}
                   ref={el => { submitCreateRef.current = el ? () => el.click() : null; }}
                   onClick={async () => {
                     const ok = await handleCreateNode(newFileParentId || null, newFileType, newFileName);
                     if (ok) {
                       setCreateModalOpen(false);
                       setNewFileName('');
                       setNewFileParentId('');
                       setNewFileType('file');
                     }
                   }}
                 >
                   {newFileType === 'file' ? 'Crear archivo' : 'Crear carpeta'}
                 </button>
               </div>
             </div>
          </div>
        )}

        {/* Share Folder Modal */}
        {shareModalOpen && shareModalFolderNode && (
          <ShareFolderModal
            folderId={shareModalFolderNode.id}
            folderName={shareModalFolderNode.name}
            onClose={() => {
              setShareModalOpen(false);
              setShareModalFolderNode(null);
            }}
          />
        )}
      </div>
    </main>

    {/* Print-only layer — invisible on screen, full page when printing */}
    {activeNode && (
      <div
        data-print-content
        style={{ display: 'none' }}
        dangerouslySetInnerHTML={{ __html: (() => {
          const raw = activeNode.content || '';
          const withoutFrontmatter = raw.replace(/^---[\s\S]*?---\n?/, '');
          return `<pre style="white-space:pre-wrap;font-family:inherit">${withoutFrontmatter.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>`;
        })() }}
      />
    )}
  </>
  );
}

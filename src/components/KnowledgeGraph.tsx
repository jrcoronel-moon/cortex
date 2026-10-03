"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import * as THREE from 'three';
import SpriteText from 'three-spritetext';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import styles from './components.module.css';
import { DriveNode } from '@/lib/drive';
import { Minimize2, Loader2, Info, X, Hand } from 'lucide-react';
import { parseMarkdownMetadata } from '@/lib/metadata';

// next/dynamic does NOT forward refs — bridge the component ref through a
// regular prop (innerRef), otherwise fgRef stays null and everything that
// needs the instance (bloom, starfield, autoRotate, hand control) silently
// does nothing.
const ForceGraph3D = dynamic(
  () =>
    import('react-force-graph-3d').then(mod => {
      const Comp = mod.default as any;
      const WithRef = ({ innerRef, ...props }: any) => <Comp ref={innerRef} {...props} />;
      return WithRef;
    }),
  { ssr: false }
);

interface KnowledgeGraphProps {
  nodes: DriveNode[];
  onNodeClick: (nodeId: string) => void;
  onClose: () => void;
}

type LinkKind = 'wikilink' | 'mdlink' | 'tag' | 'property' | 'semantic' | 'keyword';

// Visual language per connection type. Directed edges (real links you authored)
// carry an arrow; the AI-discovered edges (semantic/keyword) are undirected and
// glow like synapses.
const LINK_STYLE: Record<LinkKind, { color: string; particle: string; directed: boolean; width: number; particles: number }> = {
  wikilink: { color: 'rgba(226,232,255,0.50)', particle: '#ffffff', directed: true,  width: 1.3, particles: 2 },
  mdlink:   { color: 'rgba(226,232,255,0.34)', particle: '#cbd5ff', directed: true,  width: 1.0, particles: 2 },
  tag:      { color: 'rgba(16,185,129,0.30)',  particle: '#34d399', directed: false, width: 0.7, particles: 0 },
  property: { color: 'rgba(245,158,11,0.26)',  particle: '#fbbf24', directed: false, width: 0.7, particles: 0 },
  semantic: { color: 'rgba(139,148,255,0.60)', particle: '#b4bcff', directed: false, width: 1.7, particles: 4 },
  keyword:  { color: 'rgba(56,189,248,0.45)',  particle: '#7dd3fc', directed: false, width: 1.1, particles: 3 },
};

// Cluster palette — each detected topic community gets its own hue (like brain
// regions), so related documents share a colour even across folders.
const COMMUNITY_PALETTE = ['#8b93ff', '#f472b6', '#34d399', '#fbbf24', '#38bdf8', '#a78bfa', '#fb7185', '#4ade80', '#f97316', '#22d3ee', '#e879f9', '#facc15'];
const ISOLATED_COLOR = '#64748b'; // nodes with no connections
const NODE_COLOR: Record<string, string> = {
  file: '#8b93ff',
  tag: '#10b981',
  property: '#f59e0b',
};

// How much each edge type pulls two nodes into the same topic community.
const COMMUNITY_WEIGHT: Record<string, number> = {
  wikilink: 2.0, mdlink: 1.8, semantic: 1.6, keyword: 1.2, tag: 1.0, property: 0.8,
};

// The force engine mutates link endpoints from id strings into node objects —
// normalise back to the id wherever we read them.
const idOf = (v: any): string => (typeof v === 'object' && v !== null ? v.id : v);

// Weighted label propagation: every node starts as its own community and
// repeatedly adopts the strongest label among its neighbours until stable.
// Deterministic (sorted visit order, lexicographic tie-break) so colours don't
// jump around between renders.
function detectCommunities(nodeIds: string[], links: { source: string; target: string; kind: string }[]): Map<string, string> {
  const adj = new Map<string, { id: string; w: number }[]>();
  const addAdj = (a: string, b: string, w: number) => {
    const arr = adj.get(a);
    if (arr) arr.push({ id: b, w });
    else adj.set(a, [{ id: b, w }]);
  };
  for (const l of links) {
    const w = COMMUNITY_WEIGHT[l.kind] ?? 1;
    addAdj(l.source, l.target, w);
    addAdj(l.target, l.source, w);
  }
  const order = [...nodeIds].sort();
  const label = new Map<string, string>();
  for (const id of order) label.set(id, id);
  for (let iter = 0; iter < 12; iter++) {
    let changed = false;
    for (const id of order) {
      const neigh = adj.get(id);
      if (!neigh || neigh.length === 0) continue;
      const counts = new Map<string, number>();
      for (const { id: nb, w } of neigh) {
        const nl = label.get(nb)!;
        counts.set(nl, (counts.get(nl) || 0) + w);
      }
      let best = label.get(id)!;
      let bestC = counts.get(best) || 0;
      counts.forEach((c, l) => {
        if (c > bestC || (c === bestC && l < best)) { best = l; bestC = c; }
      });
      if (best !== label.get(id)) { label.set(id, best); changed = true; }
    }
    if (!changed) break;
  }
  return label;
}

// ── Structural link parsing (unchanged behaviour) ──────────────────────────
function parseWikiLinks(content: string): string[] {
  const links: string[] = [];
  const regex = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  let match;
  while ((match = regex.exec(content)) !== null) links.push(match[1].trim());
  return links;
}

function parseMarkdownLinks(content: string): string[] {
  const stripped = content.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  const links: string[] = [];
  const regex = /(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match;
  while ((match = regex.exec(stripped)) !== null) {
    const url = match[1].trim();
    if (!url) continue;
    if (/^(https?:|mailto:|tel:|ftp:|data:|#)/i.test(url)) continue;
    links.push(url);
  }
  return links;
}

function buildPathMap(nodes: DriveNode[]): Map<string, string> {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const cache = new Map<string, string>();
  const visit = (n: DriveNode): string => {
    if (cache.has(n.id)) return cache.get(n.id)!;
    if (!n.parentId) { const p = '/' + n.name; cache.set(n.id, p); return p; }
    const parent = byId.get(n.parentId);
    if (!parent) { cache.set(n.id, '/' + n.name); return '/' + n.name; }
    const p = visit(parent) + '/' + n.name;
    cache.set(n.id, p);
    return p;
  };
  for (const n of nodes) visit(n);
  return cache;
}

function normalizePath(base: string, href: string): string {
  if (href.startsWith('/')) return href;
  const baseParts = base.split('/').filter(Boolean);
  baseParts.pop();
  for (const part of href.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') baseParts.pop();
    else baseParts.push(part);
  }
  return '/' + baseParts.join('/');
}

function resolveLink(
  href: string, sourceNode: DriveNode, fileNodes: DriveNode[],
  pathMap: Map<string, string>, fileNodesByName: Map<string, DriveNode[]>
): DriveNode | null {
  const sourcePath = pathMap.get(sourceNode.id) || '/' + sourceNode.name;
  const looksLikePath = href.includes('/') || /\.(md|markdown)$/i.test(href);
  if (looksLikePath) {
    const normalized = normalizePath(sourcePath, href);
    const candidates = [normalized];
    if (!/\.(md|markdown)$/i.test(normalized)) candidates.push(normalized + '.md');
    for (const cand of candidates) {
      for (const n of fileNodes) {
        const np = pathMap.get(n.id);
        if (np && np.toLowerCase() === cand.toLowerCase()) return n;
      }
    }
  }
  const bareName = href.split('/').pop()!.replace(/\.(md|markdown)$/i, '').trim().toLowerCase();
  const matches = fileNodesByName.get(bareName) || [];
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    const sameParent = matches.find(m => m.parentId === sourceNode.parentId);
    return sameParent || matches[0];
  }
  return null;
}

// Shared radial-glow texture for node halos (built once, tinted per node).
let glowTexture: THREE.Texture | null = null;
function getGlowTexture(): THREE.Texture {
  if (glowTexture) return glowTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.28)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.06)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  glowTexture = new THREE.CanvasTexture(canvas);
  return glowTexture;
}

// Distant starfield — two point clouds (fine dust + brighter stars).
function makeStarfield(): THREE.Group {
  const group = new THREE.Group();
  const build = (count: number, sizeMin: number, sizeMax: number, opacity: number) => {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Random point on a spherical shell, radius 700–1300.
      const r = 700 + Math.random() * 600;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xdde3ff,
      size: sizeMin + Math.random() * (sizeMax - sizeMin),
      transparent: true,
      opacity,
      sizeAttenuation: true,
      depthWrite: false,
    });
    return new THREE.Points(geo, mat);
  };
  group.add(build(900, 1.0, 1.6, 0.5));
  group.add(build(160, 2.2, 3.2, 0.85));
  return group;
}

export default function KnowledgeGraph({ nodes, onNodeClick, onClose }: KnowledgeGraphProps) {
  const [graphData, setGraphData] = useState<{ nodes: any[]; links: any[] }>({ nodes: [], links: [] });
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);
  const sceneReady = useRef(false);
  const [dimensions, setDimensions] = useState({ width: 300, height: 300 });
  const [rootFilter, setRootFilter] = useState<string>('__all__');
  const [semanticLinks, setSemanticLinks] = useState<any[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [showAi, setShowAi] = useState(true);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // ── Hand tracking (MediaPipe): pinch to grab — move to orbit, closer/farther
  // to zoom. Camera frames never leave the browser. ──────────────────────────
  const [handMode, setHandMode] = useState<'off' | 'loading' | 'on' | 'error'>('off');
  const handRt = useRef<{
    stream?: MediaStream;
    landmarker?: any;
    raf?: number;
    last?: { x: number; y: number; size: number; pinch: boolean } | null;
  }>({});
  const handVideoRef = useRef<HTMLVideoElement>(null);
  const handCursorRef = useRef<HTMLDivElement>(null);

  const stopHandTracking = useCallback(() => {
    const rt = handRt.current;
    if (rt.raf) cancelAnimationFrame(rt.raf);
    try { rt.landmarker?.close(); } catch {}
    rt.stream?.getTracks().forEach(t => t.stop());
    handRt.current = {};
    if (handCursorRef.current) handCursorRef.current.style.display = 'none';
    const controls = fgRef.current?.controls?.();
    if (controls) controls.autoRotate = true;
    setHandMode('off');
  }, []);

  const startHandTracking = useCallback(async () => {
    setHandMode('loading');
    try {
      const video = handVideoRef.current;
      if (!video) throw new Error('no_video');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' } });
      video.srcObject = stream;
      await video.play();

      const vision = await import('@mediapipe/tasks-vision');
      const fileset = await vision.FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
      );
      const landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 1,
      });

      handRt.current = { stream, landmarker, last: null };
      const controls = fgRef.current?.controls?.();
      if (controls) controls.autoRotate = false;
      setHandMode('on');

      const dist2d = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y);
      const loop = () => {
        const rt = handRt.current;
        if (!rt.landmarker) return;
        try {
          const res = rt.landmarker.detectForVideo(video, performance.now());
          const lm = res?.landmarks?.[0];
          const cursor = handCursorRef.current;
          if (lm) {
            const cx = 1 - lm[9].x; // mirrored so moving right moves right
            const cy = lm[9].y;
            const handSize = dist2d(lm[0], lm[9]);              // wrist→middle knuckle ≈ hand scale (proximity proxy)
            const pinch = dist2d(lm[4], lm[8]) < handSize * 0.5; // thumb tip ↔ index tip

            if (cursor) {
              cursor.style.display = 'block';
              cursor.style.left = `${cx * 100}%`;
              cursor.style.top = `${cy * 100}%`;
              cursor.dataset.pinch = pinch ? '1' : '0';
            }

            const fg = fgRef.current;
            if (pinch && rt.last?.pinch && fg) {
              const dx = cx - rt.last.x;
              const dy = cy - rt.last.y;
              const dz = handSize - rt.last.size;
              const cam = fg.camera();
              const ctl = fg.controls();
              if (cam && ctl) {
                const offset = new THREE.Vector3().copy(cam.position).sub(ctl.target);
                const sph = new THREE.Spherical().setFromVector3(offset);
                sph.theta -= dx * 5;
                sph.phi = Math.max(0.15, Math.min(Math.PI - 0.15, sph.phi - dy * 5));
                sph.radius = Math.max(50, Math.min(1300, sph.radius * (1 - dz * 10)));
                offset.setFromSpherical(sph);
                cam.position.copy(ctl.target).add(offset);
                cam.lookAt(ctl.target);
                ctl.update?.();
              }
            }
            rt.last = { x: cx, y: cy, size: handSize, pinch };
          } else {
            if (cursor) cursor.style.display = 'none';
            rt.last = null;
          }
        } catch { /* single bad frame — keep looping */ }
        rt.raf = requestAnimationFrame(loop);
      };
      handRt.current.raf = requestAnimationFrame(loop);
    } catch {
      stopHandTracking();
      setHandMode('error');
    }
  }, [stopHandTracking]);

  // Full cleanup when the graph unmounts (camera must never stay on).
  useEffect(() => () => stopHandTracking(), [stopHandTracking]);

  const rootFolders = useMemo(
    () => nodes.filter(n => n.type === 'folder' && !n.parentId).sort((a, b) => a.name.localeCompare(b.name)),
    [nodes]
  );

  useEffect(() => {
    if (rootFilter !== '__all__' && !rootFolders.some(r => r.id === rootFilter)) setRootFilter('__all__');
  }, [rootFolders, rootFilter]);

  const visibleNodes = useMemo(() => {
    if (rootFilter === '__all__') return nodes;
    const byParent = new Map<string | null, DriveNode[]>();
    for (const n of nodes) {
      const arr = byParent.get(n.parentId) || []; arr.push(n); byParent.set(n.parentId, arr);
    }
    const keep = new Set<string>([rootFilter]);
    const stack = [rootFilter];
    while (stack.length) {
      const current = stack.pop()!;
      for (const child of byParent.get(current) || [])
        if (!keep.has(child.id)) { keep.add(child.id); stack.push(child.id); }
    }
    return nodes.filter(n => keep.has(n.id));
  }, [nodes, rootFilter]);

  const visibleFileIds = useMemo(
    () => visibleNodes.filter(n => n.type === 'file').map(n => n.id),
    [visibleNodes]
  );

  // Fetch the AI (content-derived) edges for whatever files are currently visible.
  useEffect(() => {
    if (visibleFileIds.length < 2) { setSemanticLinks([]); return; }
    let cancelled = false;
    setAiLoading(true);
    fetch('/api/graph/semantic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: visibleFileIds }),
    })
      .then(r => (r.ok ? r.json() : { edges: [] }))
      .then(data => { if (!cancelled) setSemanticLinks(Array.isArray(data.edges) ? data.edges : []); })
      .catch(() => { if (!cancelled) setSemanticLinks([]); })
      .finally(() => { if (!cancelled) setAiLoading(false); });
    return () => { cancelled = true; };
  }, [visibleFileIds]);

  // Build the structural graph (nodes + wikilink/mdlink/tag/property edges).
  const structural = useMemo(() => {
    const gNodes: any[] = [];
    const gLinks: any[] = [];
    const propNodesMap = new Map<string, any>();
    const fileNodes = visibleNodes.filter(n => n.type === 'file');
    const pathMap = buildPathMap(visibleNodes);

    const fileNodesByName = new Map<string, DriveNode[]>();
    for (const n of fileNodes) {
      const key = n.name.replace(/\.(md|markdown)$/i, '').toLowerCase();
      const arr = fileNodesByName.get(key) || []; arr.push(n); fileNodesByName.set(key, arr);
    }

    const titleIndex = new Map<string, DriveNode[]>();
    const aliasIndex = new Map<string, DriveNode[]>();
    const metaByFileId = new Map<string, any>();
    for (const n of fileNodes) {
      const { metadata } = parseMarkdownMetadata(n.content || '');
      metaByFileId.set(n.id, metadata);
      const display = (metadata.title || n.name.replace(/\.md$/, '')).trim().toLowerCase();
      const tArr = titleIndex.get(display) || []; tArr.push(n); titleIndex.set(display, tArr);
      if (Array.isArray(metadata.aliases)) {
        for (const a of metadata.aliases) {
          const k = String(a).trim().toLowerCase(); if (!k) continue;
          const aArr = aliasIndex.get(k) || []; aArr.push(n); aliasIndex.set(k, aArr);
        }
      }
    }

    for (const n of fileNodes) {
      const metadata = metaByFileId.get(n.id) || {};
      gNodes.push({ id: n.id, name: metadata.title || n.name.replace(/\.md$/, ''), realId: n.id, val: 3, type: 'file', degree: 0 });
    }

    const addEdge = (source: DriveNode, target: DriveNode, kind: LinkKind) => {
      if (source.id === target.id) return;
      gLinks.push({ source: source.id, target: target.id, kind });
    };
    const resolveWikiTarget = (raw: string, source: DriveNode): DriveNode | null => {
      const key = raw.trim().toLowerCase();
      const tryList = (list: DriveNode[]): DriveNode | null => {
        if (list.length === 1) return list[0];
        if (list.length > 1) return list.find(m => m.parentId === source.parentId) || list[0];
        return null;
      };
      return tryList(titleIndex.get(key) || []) || tryList(aliasIndex.get(key) || []) || tryList(fileNodesByName.get(key) || []);
    };

    for (const n of fileNodes) {
      if (!n.content) continue;
      const metadata = metaByFileId.get(n.id) || {};
      for (const raw of parseWikiLinks(n.content)) { const t = resolveWikiTarget(raw, n); if (t) addEdge(n, t, 'wikilink'); }
      for (const href of parseMarkdownLinks(n.content)) { const t = resolveLink(href, n, fileNodes, pathMap, fileNodesByName); if (t) addEdge(n, t, 'mdlink'); }
      if (Array.isArray(metadata.tags)) {
        for (const tag of metadata.tags) {
          const tagId = `tag:${tag}`;
          if (!propNodesMap.has(tagId)) { const obj = { id: tagId, name: `#${tag}`, val: 2, type: 'tag', color: NODE_COLOR.tag, degree: 0 }; propNodesMap.set(tagId, obj); gNodes.push(obj); }
          gLinks.push({ source: n.id, target: tagId, kind: 'tag' });
        }
      }
      for (const k of Object.keys(metadata).filter(k => !['title', 'aliases', 'tags', 'created', 'updated'].includes(k))) {
        const val = metadata[k]; if (!val) continue;
        const propId = `prop:${k}:${val}`;
        if (!propNodesMap.has(propId)) { const obj = { id: propId, name: `${k}: ${val}`, val: 1.5, type: 'property', color: NODE_COLOR.property, degree: 0 }; propNodesMap.set(propId, obj); gNodes.push(obj); }
        gLinks.push({ source: n.id, target: propId, kind: 'property' });
      }
    }
    return { gNodes, gLinks };
  }, [visibleNodes]);

  // Merge structural + AI edges, size nodes by degree, and commit to the graph.
  useEffect(() => {
    if (containerRef.current) {
      setDimensions({ width: containerRef.current.offsetWidth, height: containerRef.current.offsetHeight });
    }
    const nodeIds = new Set(structural.gNodes.map(n => n.id));
    // Fresh link copies with string endpoints: the force engine mutates the
    // objects it ingests (source/target become node refs), so never reuse them.
    const links = structural.gLinks.map(l => ({ ...l, source: idOf(l.source), target: idOf(l.target) }));
    if (showAi) {
      for (const e of semanticLinks) {
        // Only draw AI edges whose endpoints are both present in the current view.
        if (nodeIds.has(e.source) && nodeIds.has(e.target)) {
          links.push({ source: e.source, target: e.target, kind: e.kind, score: e.score });
        }
      }
    }
    // Degree → node size, so hubs read bigger (depth cue).
    const degree = new Map<string, number>();
    for (const l of links) {
      degree.set(l.source, (degree.get(l.source) || 0) + 1);
      degree.set(l.target, (degree.get(l.target) || 0) + 1);
    }

    // Topic communities over the merged graph (authored + AI edges): related
    // documents share a colour regardless of which folder they live in.
    const labels = detectCommunities(structural.gNodes.map(n => n.id), links);
    const commSize = new Map<string, number>();
    labels.forEach(l => commSize.set(l, (commSize.get(l) || 0) + 1));
    // Biggest community takes the first palette slot, and so on — stable ranking.
    const ranked = Array.from(commSize.entries())
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([l]) => l);
    const colorIndex = new Map(ranked.map((l, i) => [l, i]));
    const communityColor = (id: string): string => {
      if (!degree.get(id)) return ISOLATED_COLOR;
      const idx = colorIndex.get(labels.get(id) || id) ?? 0;
      return COMMUNITY_PALETTE[idx % COMMUNITY_PALETTE.length];
    };

    const gNodes = structural.gNodes.map(n => ({
      ...n,
      degree: degree.get(n.id) || 0,
      val: (n.type === 'file' ? 3 : n.val) + Math.min(6, (degree.get(n.id) || 0) * 0.6),
      color: n.type === 'file' ? communityColor(n.id) : NODE_COLOR[n.type],
    }));
    setGraphData({ nodes: gNodes, links });
  }, [structural, semanticLinks, showAi]);

  // One-time scene dressing: bloom pass, fog, starfield, gentle auto-rotate.
  const handleEngineReady = useCallback(() => {
    const fg = fgRef.current;
    if (!fg || sceneReady.current) return;
    try {
      // Selective bloom via HDR threshold: only node cores exceed 1.0 (their
      // material colour is scaled >1 below), so spheres glow while labels
      // (plain white, 1.0) and links stay crisp — no washed-out text.
      const bloom = new UnrealBloomPass(new THREE.Vector2(dimensions.width, dimensions.height), 1.0, 0.6, 1.05);
      fg.postProcessingComposer().addPass(bloom);
      const scene = fg.scene();
      scene.fog = new THREE.Fog(0x04050e, 180, 1500);
      scene.add(makeStarfield());
      const controls = fg.controls();
      if (controls) { controls.autoRotate = true; controls.autoRotateSpeed = 0.4; }
      sceneReady.current = true;
    } catch { /* composer not ready yet — retried on next tick */ }
  }, [dimensions.width, dimensions.height]);

  // Node = glowing core sphere + additive halo sprite + label.
  const nodeThreeObject = useCallback((node: any) => {
    const group = new THREE.Group();
    const color = node.color || NODE_COLOR[node.type] || NODE_COLOR.file;
    const radius = Math.max(2.5, node.val);
    // Core colour scaled >1 (HDR) so ONLY spheres cross the bloom threshold.
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 20, 20),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, opacity: 0.95 })
    );
    group.add(sphere);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTexture(),
      color,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    halo.scale.set(radius * 4.5, radius * 4.5, 1);
    group.add(halo);
    // Only label files and hubs to keep the scene legible. Labels sit clear of
    // the halo and carry a dark outline so the glow can't wash them out.
    if (node.type === 'file' || node.degree >= 2) {
      const label = new SpriteText(node.name);
      label.color = node.type === 'file' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.65)';
      label.textHeight = node.type === 'file' ? 4.5 : 3;
      label.fontFace = 'Outfit, Sans-Serif';
      (label as any).strokeColor = 'rgba(0,0,0,0.85)';
      (label as any).strokeWidth = 1.6;
      (label as any).material.depthWrite = false;
      (label as any).position.set(0, radius * 2.6 + 5, 0);
      group.add(label);
    }
    return group;
  }, []);

  // Hover highlight — connected links flare up, the rest fade back.
  const touchesHover = useCallback((l: any) => {
    if (!hoverId) return false;
    return idOf(l.source) === hoverId || idOf(l.target) === hoverId;
  }, [hoverId]);

  const linkColor = useCallback((l: any) => {
    const base = (LINK_STYLE[l.kind as LinkKind] || LINK_STYLE.mdlink).color;
    if (!hoverId) return base;
    return touchesHover(l) ? '#ffffff' : 'rgba(148,163,184,0.05)';
  }, [hoverId, touchesHover]);

  const linkWidth = useCallback((l: any) => {
    const base = (LINK_STYLE[l.kind as LinkKind] || LINK_STYLE.mdlink).width;
    return touchesHover(l) ? base * 2.2 : base;
  }, [touchesHover]);

  const linkParticles = useCallback((l: any) => {
    const base = (LINK_STYLE[l.kind as LinkKind] || LINK_STYLE.mdlink).particles;
    return touchesHover(l) ? Math.max(4, base + 2) : base;
  }, [touchesHover]);

  const aiCount = useMemo(() => graphData.links.filter((l: any) => l.kind === 'semantic' || l.kind === 'keyword').length, [graphData.links]);

  return (
    <div className={`${styles.graphContainer} ${styles.expanded}`} ref={containerRef}>
      <div className={styles.graphHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>Graph View</span>
          {rootFolders.length > 0 && (
            <select
              value={rootFilter}
              onChange={(e) => setRootFilter(e.target.value)}
              title="Filter by root folder"
              style={{ background: 'var(--surface-2, rgba(255,255,255,0.06))', border: '1px solid var(--border-light, rgba(255,255,255,0.12))', color: 'rgba(255,255,255,0.85)', padding: '3px 8px', borderRadius: '4px', fontSize: '0.74rem', cursor: 'pointer', maxWidth: '180px', outline: 'none' }}
            >
              <option value="__all__">All folders</option>
              {rootFolders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          )}
          <button
            onClick={() => setShowAi(v => !v)}
            title="Conexiones IA (similitud de contenido + términos compartidos)"
            style={{ display: 'flex', alignItems: 'center', gap: '5px', background: showAi ? 'rgba(129,140,248,0.22)' : 'transparent', border: '1px solid rgba(129,140,248,0.4)', color: showAi ? '#c7cbff' : 'rgba(255,255,255,0.6)', padding: '3px 9px', borderRadius: '999px', fontSize: '0.72rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            {aiLoading ? <Loader2 size={12} className="animate-spin" /> : <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#818cf8', boxShadow: '0 0 6px #818cf8' }} />}
            Conexiones IA {!aiLoading && aiCount > 0 ? `(${aiCount})` : ''}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            onClick={() => (handMode === 'on' || handMode === 'loading' ? stopHandTracking() : startHandTracking())}
            title={
              handMode === 'on' ? 'Desactivar control por mano' :
              handMode === 'loading' ? 'Activando cámara…' :
              handMode === 'error' ? 'No se pudo activar la cámara (¿permiso denegado?)' :
              'Control por mano (cámara): pellizca para mover y hacer zoom'
            }
            style={{
              background: handMode === 'on' ? 'rgba(16,185,129,0.22)' : 'transparent',
              border: 'none',
              color: handMode === 'on' ? '#6ee7b7' : handMode === 'error' ? '#f87171' : 'rgba(255,255,255,0.75)',
              cursor: 'pointer', display: 'flex', padding: '5px', borderRadius: '6px',
            }}
          >
            {handMode === 'loading' ? <Loader2 size={16} className="animate-spin" /> : <Hand size={16} />}
          </button>
          <button
            onClick={() => setInfoOpen(v => !v)}
            title="Cómo leer el grafo"
            style={{ background: infoOpen ? 'rgba(129,140,248,0.22)' : 'transparent', border: 'none', color: infoOpen ? '#c7cbff' : 'rgba(255,255,255,0.75)', cursor: 'pointer', display: 'flex', padding: '5px', borderRadius: '6px' }}
          >
            <Info size={16} />
          </button>
          <button onClick={onClose} title="Cerrar" style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', padding: '5px' }}>
            <Minimize2 size={16} />
          </button>
        </div>
      </div>

      {/* Help panel — how to read the graph */}
      {infoOpen && (
        <aside className={styles.graphInfoPanel}>
          <div className={styles.graphInfoHeader}>
            <span>Cómo leer el grafo</span>
            <button onClick={() => setInfoOpen(false)} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', display: 'flex' }}>
              <X size={14} />
            </button>
          </div>
          <div className={styles.graphInfoBody}>
            <p>
              Cada burbuja es un <strong>documento</strong>. Las líneas son relaciones
              reales entre sus contenidos — el sistema las calcula y mide, no solo
              las dibuja.
            </p>

            <h4>Qué significa lo que ves</h4>
            <ul>
              <li><strong>Color</strong> = grupo temático. Documentos relacionados comparten color aunque vivan en carpetas distintas (comunidades detectadas sobre todas las conexiones).</li>
              <li><strong>Tamaño</strong> = centralidad. Cuantas más conexiones tiene un documento, más grande se dibuja: es un pilar de conocimiento.</li>
              <li><strong style={{ color: '#94a3b8' }}>Gris</strong> = sin conexiones detectadas (todavía).</li>
            </ul>

            <h4>Tipos de conexión</h4>
            <ul>
              <li><i className={styles.dot} style={{ background: '#e0e6ed' }} /> <strong>Enlaces</strong> — los escribiste tú: <code>[[nota]]</code> o <code>[texto](ruta)</code>. Llevan flecha: indican de dónde a dónde.</li>
              <li><i className={styles.dot} style={{ background: '#818cf8' }} /> <strong>Similitud (IA)</strong> — la IA leyó el contenido (embeddings) y detectó que hablan del mismo tema, aunque nunca los enlazaras. Las partículas viajan más rápido cuanto mayor es la correlación.</li>
              <li><i className={styles.dot} style={{ background: '#67e8f9' }} /> <strong>Términos compartidos</strong> — comparten palabras clave distintivas (análisis TF-IDF del texto).</li>
              <li><i className={styles.dot} style={{ background: '#10b981' }} /> <strong>Tags</strong> y <i className={styles.dot} style={{ background: '#f59e0b' }} /> <strong>Propiedades</strong> — metadatos del frontmatter.</li>
            </ul>

            <h4>Interacción</h4>
            <ul>
              <li><strong>Pasa el mouse</strong> sobre un nodo: sus conexiones se encienden y el resto se atenúa.</li>
              <li><strong>Clic</strong> en un nodo: abre el documento.</li>
              <li><strong>Arrastra</strong> para rotar, <strong>rueda</strong> para acercar.</li>
              <li>El botón <strong>Conexiones IA</strong> muestra u oculta las relaciones descubiertas por IA.</li>
              <li>✋ <strong>Control por mano</strong> (icono de mano): activa la cámara y <strong>pellizca</strong> (pulgar + índice) para agarrar el grafo — mueve la mano para rotar, acércala o aléjala de la cámara para hacer zoom. El vídeo se procesa en tu navegador, no se envía a ningún lado.</li>
            </ul>
          </div>
        </aside>
      )}

      {/* Legend */}
      <div className={styles.graphLegend}>
        <span><i style={{ background: '#818cf8' }} /> Similitud (IA)</span>
        <span><i style={{ background: '#67e8f9' }} /> Términos comp.</span>
        <span><i style={{ background: '#e0e6ed' }} /> Enlaces</span>
        <span><i style={{ background: '#10b981' }} /> Tags</span>
        <span><i style={{ background: '#f59e0b' }} /> Props</span>
        <span style={{ opacity: 0.55 }}>· color = grupo temático</span>
      </div>

      <div className={styles.graphVignette} />

      {/* Hand-tracking plumbing: offscreen camera feed + on-screen hand cursor. */}
      <video ref={handVideoRef} playsInline muted style={{ position: 'absolute', width: '2px', height: '2px', opacity: 0, pointerEvents: 'none' }} />
      <div ref={handCursorRef} className={styles.handCursor} style={{ display: 'none' }} />

      {typeof window !== 'undefined' && (
        <ForceGraph3D
          innerRef={fgRef}
          width={dimensions.width}
          height={dimensions.height}
          graphData={graphData}
          backgroundColor="rgba(4,5,14,0)"
          controlType="orbit"
          showNavInfo={false}
          nodeThreeObject={nodeThreeObject}
          nodeLabel={(n: any) => n.name}
          onEngineTick={handleEngineReady}
          onNodeHover={(n: any) => setHoverId(n ? n.id : null)}
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkOpacity={0.55}
          linkCurvature={(l: any) => (l.kind === 'semantic' || l.kind === 'keyword' ? 0.18 : 0)}
          linkDirectionalArrowLength={(l: any) => ((LINK_STYLE[l.kind as LinkKind] || LINK_STYLE.mdlink).directed ? 2.5 : 0)}
          linkDirectionalArrowRelPos={1}
          linkDirectionalParticles={linkParticles}
          linkDirectionalParticleWidth={(l: any) => (l.kind === 'semantic' ? 2.6 : 1.7)}
          linkDirectionalParticleSpeed={(l: any) => 0.004 + (l.score ? l.score * 0.005 : 0.002)}
          linkDirectionalParticleColor={(l: any) => (LINK_STYLE[l.kind as LinkKind] || LINK_STYLE.mdlink).particle}
          onNodeClick={(node: any) => { if (node.realId) onNodeClick(node.realId); }}
        />
      )}
    </div>
  );
}

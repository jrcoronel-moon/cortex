import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getSession } from '@/lib/auth';
import { canReadNode } from '@/lib/permissions';
import { readableFileIds } from '@/lib/access';
import { cosine, topTerms, parseWikiLinkTargets, parseInternalMdLinks } from '@/lib/graph-signals';

// Top-N documents most related to one note — the mini "related" panel shown
// under the TOC. Combines three measured signals:
//   · direct links (authored, both directions)  — strongest
//   · embedding cosine similarity                — meaning
//   · shared distinctive terms                   — vocabulary
export const dynamic = 'force-dynamic';

const MAX_CANDIDATES = 800;
const TOP_N = 5;
const TARGET_TERMS = 20; // distinctive terms taken from the target doc

export async function GET(request: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 });
  if (!canReadNode(session, id)) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const target = db.prepare(
    `SELECT n.id, n.name, n.content, e.vector FROM nodes n
     LEFT JOIN embeddings e ON e.node_id = n.id WHERE n.id = ?`
  ).get(id) as { id: string; name: string; content: string | null; vector: string | null } | undefined;
  if (!target) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let candidateIds = Array.from(readableFileIds(session, true)).filter(x => x !== id);
  if (candidateIds.length === 0) return NextResponse.json({ related: [] });
  if (candidateIds.length > MAX_CANDIDATES) candidateIds = candidateIds.slice(0, MAX_CANDIDATES);

  const placeholders = candidateIds.map(() => '?').join(',');
  const candidates = db.prepare(
    `SELECT n.id, n.name, n.content, e.vector FROM nodes n
     LEFT JOIN embeddings e ON e.node_id = n.id WHERE n.id IN (${placeholders})`
  ).all(...candidateIds) as { id: string; name: string; content: string | null; vector: string | null }[];

  const bare = (name: string) => name.replace(/\.(md|markdown)$/i, '').trim().toLowerCase();
  const targetName = bare(target.name);
  let targetVec: number[] | null = null;
  if (target.vector) { try { targetVec = JSON.parse(target.vector); } catch { targetVec = null; } }

  // Outgoing authored links from the target (wikilinks + internal md links → bare names).
  const outgoing = new Set<string>();
  if (target.content) {
    for (const t of parseWikiLinkTargets(target.content)) outgoing.add(t.toLowerCase());
    for (const href of parseInternalMdLinks(target.content)) outgoing.add(bare(href.split('/').pop() || ''));
  }

  // Target's distinctive terms (by tf; idf needs a corpus, so keep it simple here —
  // STOP + length filters already remove most glue words).
  const targetTermList = Array.from(topTerms(target.content || '').entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, TARGET_TERMS)
    .map(([t]) => t);
  const targetTermSet = new Set(targetTermList);

  const wikiRef = new RegExp(`\\[\\[${targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\||\\]\\])`, 'i');

  const scored = candidates.map(c => {
    let score = 0;
    const kinds: string[] = [];

    // Direct links, both directions.
    const cName = bare(c.name);
    let direct = 0;
    if (outgoing.has(cName)) direct++;
    if (c.content && wikiRef.test(c.content)) direct++;
    if (direct > 0) { score += 3 * direct; kinds.push('link'); }

    // Embedding similarity.
    if (targetVec && c.vector) {
      try {
        const s = cosine(targetVec, JSON.parse(c.vector));
        if (s >= 0.45) { score += s * 2; if (s >= 0.6) kinds.push('semantic'); }
      } catch { /* bad vector — skip */ }
    }

    // Shared distinctive terms.
    if (c.content && targetTermSet.size) {
      const ctf = topTerms(c.content);
      let sharedCount = 0;
      for (const t of targetTermList) if (ctf.has(t)) sharedCount++;
      if (sharedCount >= 3) { score += Math.min(1, sharedCount / 6); kinds.push('keyword'); }
    }

    return { id: c.id, name: c.name.replace(/\.(md|markdown)$/i, ''), score: Number(score.toFixed(3)), kinds };
  });

  const related = scored
    .filter(r => r.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);

  return NextResponse.json({ related });
}

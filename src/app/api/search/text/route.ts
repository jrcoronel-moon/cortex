import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { fullTextSearch } from '@/lib/search';
import { getFiles } from '@/lib/drive';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const q = new URL(request.url).searchParams.get('q')?.trim();
  if (!q) return NextResponse.json({ error: 'Missing q' }, { status: 400 });

  try {
    // Over-fetch, then keep only docs this session can actually see.
    const hits = fullTextSearch(q, 60);
    if (hits.length === 0) return NextResponse.json([]);

    const accessible = new Set((await getFiles()).map(n => n.id));
    const results = hits.filter(h => accessible.has(h.id)).slice(0, 30);
    return NextResponse.json(results);
  } catch (err: any) {
    console.error('Full-text search error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

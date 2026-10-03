import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getFiles } from '@/lib/drive';

// embeddings is imported lazily in the handler (pulls native onnxruntime that
// breaks `next build` page-data collection if imported at module top level).
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q')?.trim();
  if (!query) return NextResponse.json({ error: 'Missing q' }, { status: 400 });

  try {
    const { semanticSearch } = await import('@/lib/embeddings');
    // Over-fetch across all nodes, then keep only docs this session can actually read.
    const results = await semanticSearch(query, null, 40);
    const accessible = new Set((await getFiles()).map(n => n.id));
    return NextResponse.json(results.filter(r => accessible.has(r.id)).slice(0, 8));
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

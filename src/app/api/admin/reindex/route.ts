import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

// Do NOT import @/lib/embeddings at the top level: it pulls @xenova/transformers
// -> onnxruntime-node (native), which `next build`'s page-data collection tries
// to load and crashes on the CI's native amd64. Import it lazily in the handler.
export const dynamic = 'force-dynamic';

export async function POST() {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { reindexAll } = await import('@/lib/embeddings');
  const count = await reindexAll();
  return NextResponse.json({ reindexed: count });
}

import { notFound } from 'next/navigation';
import db from '@/lib/db';
import SharedNoteView from './SharedNoteView';

export default function SharePage({ params }: { params: { token: string } }) {
  const node = db.prepare(
    'SELECT id, name, content, updated_at as updatedAt FROM nodes WHERE share_token = ? AND type = ?'
  ).get(params.token, 'file') as { id: string; name: string; content: string; updatedAt: string } | undefined;

  if (!node) notFound();

  return <SharedNoteView node={node} />;
}

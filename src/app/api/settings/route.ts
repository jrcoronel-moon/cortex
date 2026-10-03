import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { encrypt, decrypt } from '@/lib/crypto';
import db from '@/lib/db';

export async function GET() {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const row = db.prepare('SELECT byok_provider, byok_key_enc, byok_model FROM user_settings WHERE user_id = ?').get(session.id) as any;
    return NextResponse.json({
      byokProvider: row?.byok_provider ?? null,
      byokModel: row?.byok_model ?? null,
      hasKey: !!row?.byok_key_enc,
    });
  } catch (err: any) {
    // Don't break the settings page if the byok_model column is somehow missing.
    console.error('Settings GET error:', err?.message);
    const row = db.prepare('SELECT byok_provider, byok_key_enc FROM user_settings WHERE user_id = ?').get(session.id) as any;
    return NextResponse.json({
      byokProvider: row?.byok_provider ?? null,
      byokModel: null,
      hasKey: !!row?.byok_key_enc,
    });
  }
}

export async function PUT(request: Request) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { provider, apiKey, model } = await request.json();
  if (!provider) return NextResponse.json({ error: 'Missing provider' }, { status: 400 });

  const existing = db.prepare('SELECT byok_key_enc FROM user_settings WHERE user_id = ?').get(session.id) as any;
  // A key is required unless one is already stored (lets the user change provider/model
  // without re-entering the key — the form shows a placeholder, not the real key).
  if (!apiKey && !existing?.byok_key_enc) {
    return NextResponse.json({ error: 'Missing apiKey' }, { status: 400 });
  }

  const encrypted = apiKey ? encrypt(apiKey) : existing.byok_key_enc;
  try {
    db.prepare(`
      INSERT INTO user_settings (user_id, byok_provider, byok_key_enc, byok_model, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET byok_provider=excluded.byok_provider, byok_key_enc=excluded.byok_key_enc, byok_model=excluded.byok_model, updated_at=excluded.updated_at
    `).run(session.id, provider, encrypted, model ?? null);
  } catch (err: any) {
    // Self-heal if the byok_model column is missing (migration not yet applied), then retry once.
    if (String(err?.message).includes('byok_model')) {
      try { db.exec("ALTER TABLE user_settings ADD COLUMN byok_model TEXT"); } catch {}
      db.prepare(`
        INSERT INTO user_settings (user_id, byok_provider, byok_key_enc, byok_model, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET byok_provider=excluded.byok_provider, byok_key_enc=excluded.byok_key_enc, byok_model=excluded.byok_model, updated_at=excluded.updated_at
      `).run(session.id, provider, encrypted, model ?? null);
    } else {
      console.error('Settings PUT error:', err?.message);
      return NextResponse.json({ error: 'save_failed', detail: err?.message ?? String(err) }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}

export async function DELETE() {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(session.id);
  return NextResponse.json({ success: true });
}

export async function POST() {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const row = db.prepare('SELECT byok_key_enc FROM user_settings WHERE user_id = ?').get(session.id) as any;
  if (!row?.byok_key_enc) return NextResponse.json({ error: 'No key stored' }, { status: 404 });

  try {
    const plain = decrypt(row.byok_key_enc);
    return NextResponse.json({ apiKey: plain });
  } catch {
    return NextResponse.json({ error: 'Decryption failed' }, { status: 500 });
  }
}

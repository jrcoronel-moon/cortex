import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createSessionValue } from '@/lib/auth';
import db from '@/lib/db';

// Solo disponible en desarrollo
export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }

  const { email } = await request.json().catch(() => ({}));
  const adminEmail = email || 'admin@cortex.local';

  // Crear usuario admin si no existe
  let user = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail) as { id: string } | undefined;
  if (!user) {
    const id = randomUUID();
    db.prepare("INSERT INTO users (id, email, role) VALUES (?, ?, 'admin')").run(id, adminEmail);
  } else {
    db.prepare("UPDATE users SET role = 'admin' WHERE email = ?").run(adminEmail);
  }

  const sessionValue = createSessionValue(adminEmail);
  if (!sessionValue) {
    return NextResponse.json({ error: 'Could not create session' }, { status: 500 });
  }

  const res = NextResponse.json({ success: true });
  res.cookies.set('cortex_session', sessionValue, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24,
    path: '/',
  });
  return res;
}

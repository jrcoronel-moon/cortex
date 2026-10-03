import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { createSessionValue } from '@/lib/auth';
import { cookies } from 'next/headers';

function consumePendingInvite(email: string) {
  const token = cookies().get('pending_invite_token')?.value;
  if (!token) return null;
  cookies().delete('pending_invite_token');

  const invite = db.prepare(`
    SELECT id, org_id, email, role, expires_at, accepted_at
    FROM org_invitations WHERE token = ?
  `).get(token) as any;
  if (!invite || invite.accepted_at || Date.now() > invite.expires_at) return null;
  if (invite.email.toLowerCase() !== email.toLowerCase()) return null;
  return invite;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  // Resolve public base URL (Caddy/Cloudflare forwards X-Forwarded-Host)
  const forwardedHost = request.headers.get('x-forwarded-host');
  const host = forwardedHost || request.headers.get('host') || '';
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const baseUrl = process.env.APP_URL || (host ? `${proto}://${host}` : request.url);

  if (!token) {
    return NextResponse.redirect(new URL('/login?error=no_token', baseUrl));
  }

  // Use transaction to atomically check and consume token (prevent concurrent replay)
  const consumeToken = db.transaction((tokenToConsume: string) => {
    const linkParam = db.prepare('SELECT email, expires_at FROM magic_links WHERE token = ?').get(tokenToConsume) as any;

    if (!linkParam) {
      return { success: false, error: 'invalid_token' };
    }

    if (Date.now() > linkParam.expires_at) {
      db.prepare('DELETE FROM magic_links WHERE token = ?').run(tokenToConsume);
      return { success: false, error: 'expired_token' };
    }

    // Delete token atomically with this read operation
    db.prepare('DELETE FROM magic_links WHERE token = ?').run(tokenToConsume);

    return { success: true, email: linkParam.email };
  });

  const result = consumeToken(token);

  if (!result.success) {
    return NextResponse.redirect(new URL(`/login?error=${result.error}`, baseUrl));
  }

  // Create session
  const sessionVal = createSessionValue(result.email);
  if (!sessionVal) {
    return NextResponse.redirect(new URL('/login?error=session_failed', baseUrl));
  }

  // Consume pending invite if email matches
  const invite = consumePendingInvite(result.email);
  if (invite) {
    const userRow = db.prepare('SELECT id FROM users WHERE email = ?').get(result.email) as { id: string } | undefined;
    if (userRow) {
      db.transaction(() => {
        db.prepare('INSERT OR IGNORE INTO organization_members (org_id, user_id, role) VALUES (?, ?, ?)').run(invite.org_id, userRow.id, invite.role);
        db.prepare('UPDATE org_invitations SET accepted_at = CURRENT_TIMESTAMP WHERE id = ?').run(invite.id);
      })();
    }
  }

  const returnTo = new URL(request.url).searchParams.get('returnTo');
  const finalRedirect = returnTo && returnTo.startsWith('/') ? returnTo : '/';
  const res = NextResponse.redirect(new URL(finalRedirect, baseUrl));
  const isProduction = process.env.NODE_ENV === 'production';

  res.cookies.set('cortex_session', sessionVal, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 86400
  });

  return res;
}

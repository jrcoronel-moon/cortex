import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import db from '@/lib/db';
import { getSession } from '@/lib/auth';
import { cookies } from 'next/headers';

export async function GET(request: Request) {
  const baseUrl = process.env.APP_URL || request.url;
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  if (!token) {
    return NextResponse.redirect(new URL('/login?error=invalid_invite', baseUrl));
  }

  const invite = db.prepare(`
    SELECT id, org_id, email, role, expires_at, accepted_at
    FROM org_invitations WHERE token = ?
  `).get(token) as any;

  if (!invite) {
    return NextResponse.redirect(new URL('/login?error=invite_not_found', baseUrl));
  }

  if (invite.accepted_at) {
    return NextResponse.redirect(new URL('/?info=already_member', baseUrl));
  }

  if (Date.now() > invite.expires_at) {
    return NextResponse.redirect(new URL('/login?error=invite_expired', baseUrl));
  }

  // If logged in: check email matches and accept
  const session = getSession();
  if (session) {
    if (session.email.toLowerCase() !== invite.email.toLowerCase()) {
      return NextResponse.redirect(new URL(`/login?error=invite_wrong_email&expected=${encodeURIComponent(invite.email)}`, baseUrl));
    }

    db.transaction(() => {
      db.prepare(`
        INSERT OR IGNORE INTO organization_members (org_id, user_id, role)
        VALUES (?, ?, ?)
      `).run(invite.org_id, session.id, invite.role);
      db.prepare('UPDATE org_invitations SET accepted_at = CURRENT_TIMESTAMP WHERE id = ?').run(invite.id);
    })();

    return NextResponse.redirect(new URL('/?info=joined_org', baseUrl));
  }

  // Not logged in: store token in cookie and redirect to login
  cookies().set('pending_invite_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return NextResponse.redirect(new URL(`/login?invite=${encodeURIComponent(invite.email)}`, baseUrl));
}
